# M1 Slice 8: drift — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** drift is detected, never reverted (success criterion 4). `mediaplane drift` reports
a change made in an app to anything Mediaplane manages there, with what was applied and
what the app holds now, and a verdict for each secret from the app's own check. `plan`
shows the same drift, as what `apply` would put back. `apply` puts it back (Re-apply).
`mediaplane keep <app>.<resource>.<field>` keeps the app's value as an override in
`stack.yaml`, changing nothing else in the file, so drift is clear and a second `apply`
changes nothing (Keep mine); `mediaplane keep <app>.<resource>` stops Mediaplane managing a
resource deleted outside it. Drift writes to no app, and its checks leave fewer marks than
`plan`'s, as the owner decided on 2026-10-17.

**Architecture:**

- **The three-way comparison** (spec §6.3) lives in `examine`, the function `plan` and the
  wire step already run for each resource: D is the resource's `desired`, with the
  `overrides:` that name its managed fields; L is its record in `state/resources.json`; O
  is what the app holds. A field drifted when O differs from L and from D. `plan`'s result
  gains `drift` and `checks` (how each secret was checked).
- **Overrides** become part of D everywhere (`desiredOf`), checked by `plan` before it asks
  any app. A resource may declare fields held as lists, compared as sets, and fields an
  override can't change (`locked`), with why: what it is known by, and every field that
  says where an app sends a key. Every request that carries a key is built from the
  stack's own address for the other app (`sendsTo`), whatever an override or an app
  holds.
- **The catalog** reads each managed field through a `FieldReader`, so a value of another
  shape is reported as one Mediaplane can't read, never as empty; every managed field
  reaches the app from D, so a kept value stays.
- **`mediaplane drift`** is `plan` in observe-only mode (no preflight, every running app
  asked), under apply's lock. Its one write is each secret check's verdict and time, by
  name, in `state/resources.json`: what lets drift and `plan` not check again a secret
  found refused, and drift check Jellyfin's admin once a day.
- **`mediaplane keep`** looks at one resource, asking the app only to read it, and adds
  one line under `overrides:` with a textual insertion that is checked to parse to the
  same stack with the override, keeping the file's mode and group, then records the
  value as applied.
- **Tests:** unit tests on the fake apps, made no kinder than the real ones by this
  slice's probes; an end-to-end test of success criterion 4 against the real apps, and
  `drift` and `keep` from the image in the deploy test.

**Tech Stack:** as Slice 7 (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no new image.

**Spec:** [`docs/design/m1-engine-cli.md`](../../design/m1-engine-cli.md), in particular:

- §2.3, success criterion 4 ("Drift is detected, never reverted"), and criterion 3 (a
  second `apply` changes nothing);
- §3.2 (`drift` and `history` units), §3.3 (the `yaml` Document API, for Keep mine);
- §4.2 (`overrides:`, override keys `<app>.<resource>.<field>`, externally managed mode);
- §5 and §5.1 (the plan and apply stages, `requires`), §5.2 (`plan`, `drift`, `keep`);
- §6.2 (what each integration manages), §6.3 (the drift model, in full), §6.4;
- §7 (security), §8.1(3) (the end-to-end suite's drift step), §9 (the documentation set),
  §11 (every slice's refinements).

Slice context: [`docs/plans/m1-roadmap.md`](../m1-roadmap.md): the S8 row ("The three-way
drift model, `drift`, `keep` (Keep mine), a comment-preserving override writer,
`unmanaged`, the "drift reported" runbook, and the S8 items below, with the owner's
decisions of 2026-10-17"; it proves success criterion 4), the S9 and S10 rows, "After
M1", and every S8 item in "Inputs for later slices from the reviews", the owner's
decisions of 2026-10-17 first. ADR 0003 (written by this slice) and ADR 0004.

Revised after the controller's pre-flight scan of the first version of this plan, as its
rulings of 2026-10-25 say: B1 (keys go only to the stack's own addresses, both ways), I1
to I4, and M1 to M17, M10 moved to Slice 10. The decisions name the rulings that changed
them.

## How to read the code in this plan

- **A new file is given whole** (`Create`). Write it as shown.
- **A changed file is given as a `diff` block** (`Change`): the exact `git diff -U1`
  output, with one line of context. Save it to a file and run `git apply <file>` from the
  repo root, or make the same edit by hand. Apply a task's blocks in the order given.
- **Generated files are never edited by hand.** A step that changes a catalog fact, a
  schema description or the CLI says to run `pnpm docs:generate`, and names what it
  rewrites.
- Every block was applied in order to a fresh worktree at `3439f9d`, and each task's tests
  failed before its implementation and passed after it (see the completion checklist).

## Global Constraints

Everything in the Slice 1, 2a, 2b, 2c, 3a, 3d, 3b, 3c, 4, 5, 6 and 7 Global Constraints
still holds (`docs/plans/m1-s1-pure-core.md` to `docs/plans/m1-s7-plex.md`):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses, hostnames, tokens or ids in committed files. Test secrets look like
  `'0'.repeat(32)` or `fake-admin-password`. Addresses in tests and docs come from the
  documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), private
  ranges, or `fd00::/8`;
- neutral framing: no piracy-flavoured language or examples (spec §1.4(6));
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes no file, and changes nothing in the apps but for its documented marks.
  Its one change to Docker is still joining the wiring network from the image (S3b);
- Docker is reached only through the `Runtime` (the end-to-end tests may call `docker`
  themselves);
- unit tests never need Docker, except the spawned tests in
  `packages/cli/src/main.test.ts`, and never reach a real app or plex.tv: HTTP tests use
  `fakeHttpApp`, `fakeStackApis`, `fakeSonarr` or `fakePlexTv` on `127.0.0.1`;
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
- the integration contract (S3b to S7): `observe`, `create`, `update`, `requires`,
  `after`, `resolve` and `verify`; resource records hold names only; a resource that
  requires a failed or skipped one is `skipped`; a resource may `require` another app's
  only when that app comes before it through `after` (the catalog invariant test);
- the shared Servarr provider (`catalog/_shared/servarr-provider.ts`) stays the one way to
  wire a Servarr provider, and the arrs' media-server connections share one spec
  (`catalog/_shared/servarr-connection.ts`);
- bootstrap before publish (S5 to S7) is unchanged: `plan` never runs a setup, and drift
  never does either;
- keys go only to the stack's own address for an app (S6), never to a host, port, URL
  base or TLS setting read from an app, nor one an override sets: such a field is fixed,
  and every request that carries a key is built from the stack's own address;
- never push.

The spec's exact values for this slice, verbatim:

- §2.3, criterion 4: "**Drift is detected, never reverted.** A manual edit to any managed
  field is reported by `mediaplane drift` with the expected and actual values. Re-apply
  restores it, and Keep mine records it as an override so drift is clear."
- §2.3, criterion 3: "**Idempotent.** A second `apply` reports `No changes`, exits 0 and
  modifies nothing."
- §3.3: "**YAML:** the `yaml` package's Document API, so that writes to `stack.yaml`
  (Keep mine, `migrate`) **preserve the user's comments and formatting**."
- §4.2: "**Override keys** follow the form `<app>.<resource>.<field>`. The set of
  overridable fields is declared per integration and documented in each app's README.";
  "**Externally managed mode.** With `managed_by: external`, Mediaplane never writes
  `stack.yaml`. `migrate` and Keep mine print the snippet to add instead."
- §5.2: "`drift` | Report drift only (§6.3)"; "`keep <path>` | Keep mine: record a drifted
  value or a deletion as an override".
- §6.3: "**D (desired):** derived from `stack.yaml` plus `overrides`. **L (last
  applied):** the snapshot in `state/resources.json`. **O (observed):** read back from the
  app's API."
- §6.3, the rules: "**Only managed fields are compared.** Each integration declares its
  managed fields, and the app's README lists them. Those are also the only fields `keep`
  accepts; anything else is rejected with an explanation."; "**Secrets are verified,
  never compared.**"; "**Identity is the app-assigned ID** recorded in `resources.json`.";
  "**Keep mine writes to `overrides:`** using the comment-preserving YAML writer. In
  `managed_by: external` mode it prints the snippet instead."; "**Drift never writes to an
  app.** Only `apply` does."
- §6.3, the table: "Managed resource missing | Deleted outside Mediaplane | `drift` and
  `plan` | Re-apply recreates it. Keep mine records `<app>.<resource>: unmanaged`, and
  Mediaplane stops managing it"; "A shared key changed at its source … | `drift`, on the
  source and on each consumer | Keep mine reads the new key and propagates it to every
  consumer. Re-apply restores the old key at the source".
- §8.1(3), step 3: "mutates a managed field through the app's API, then asserts that
  `drift` reports it, Keep mine clears it, and Re-apply restores it".

These are added or restated for this slice:

- **Drift never writes to an app.** `drift` makes the calls `plan` makes, and fewer of the
  checks that leave a mark. Its one write is `state/resources.json`: each secret check's
  verdict and time, by the secret's name. `keep` writes `stack.yaml` (one line) and
  `state/resources.json`.
- **Secrets never appear** in drift's or keep's output, `--json`, errors, change records,
  `state/resources.json`, `stack.yaml`, logs or end-to-end failure messages. A value an
  app holds that contains one of the run's secrets is shown with `***` and marked
  `redacted`; `keep` refuses it. End-to-end checks compare names and non-secret values,
  never a secret's.
- **`keep` keeps the file as it is** apart from its one line: comments, key order, quoting,
  spacing and line ends, and its mode and group. It refuses, with the line to add by
  hand, a `stack.yaml` it can't write safely: a link, a file with other names, one of
  another user or of a group its user isn't in, one written as a single `{ … }` block, or
  one managed by automation.
- **A value Mediaplane can't read is said to be,** never read as empty or false, and a
  check that could change more than its marks fails closed: it is left undone, saying
  why and what clears it.
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
  that changes a catalog fact, a schema description or the CLI runs `pnpm docs:generate`
  first, and commits the generated files with it.
- **Docs.**
  - Hand-written docs describe only behaviour that is built and tested. Anything planned
    says so plainly, with the slice that brings it.
  - Short, plain sentences; lists rather than wide tables; no internal jargon.
  - Diagrams are plain-text `text` blocks no wider than 40 columns, never Mermaid,
    because Mermaid doesn't render in the GitHub mobile app.
  - Generated files carry a "generated, do not edit" line and are never edited by hand.

## Decisions taken in this plan

The spec, the roadmap and the reviews leave these open. Each is marked `Decision:` where
it is applied. The ones to look at first are marked **(check)**. Every fact about an app
below was probed while writing this plan, on real Docker (29.8, Compose 5.5.1, aarch64),
with the pinned images (Sonarr 4.0.20, Radarr 6.4.4, Prowlarr 2.6.5, qBittorrent 5.2.4,
Jellyfin 12.2, Seerr 3.5.0, Plex `1.43.4.10903-e5521bd8c-ls327`), on a stack `apply` made
from this plan's code, or for Plex, an unclaimed Plex reached at its address. No plex.tv
call was needed or made. The plan was revised after the controller's pre-flight scan, as
its rulings of 2026-10-25 say (B1, I1 to I4, M1 to M17; M10 moved to Slice 10): each
decision a ruling changed names it.

1. **(check) The three-way comparison** (Task 1; §6.3). D is what the stack wants: each
   resource's `desired`, with its overrides (decision 8). L is its record. O is what the
   app holds. A managed field drifted when O differs from L **and** from D: a value the
   stack now wants, as after you edit `stack.yaml` to match the app, is a pending change
   that `apply` records (`adopt`), not drift. So drift needs a record: a resource never
   applied has no L, and its differences are only `plan`'s updates; nor is a record of
   another name than the stack now wants, which is of what it wanted before (Task 2:
   qBittorrent's category, once Sonarr's is kept as another, decision 7). A field's
   `expected` is the value `apply` sets, D; when `stack.yaml` has changed it since, the
   item has `applied`, L, too (ruling M17). Each drift item says what kind it is: `field`
   (with `expected` and `actual`, O), `missing` (§6.3's "Managed resource missing"),
   `secret` (the app's own check refuses one: §6.3's "Test endpoint fails"), and, from
   Task 4, `key` and `left` (decisions 14 and 15). It is shown by `drift` and by `plan`
   (§6.3's "Shown by"), in `plan`'s `--json` as `drift`, with `checks`, how each secret
   was checked: additive fields within `mediaplane.plan/v1`.
2. **(check) `drift` is `plan`, looking only** (Task 4; §3.2's "the planner in
   observe-only mode"). It skips preflight (the host's ports and folders aren't drift),
   asks every app that runs and is healthy, even one `apply` would recreate (it is about
   what the app holds now), and runs under apply's lock, so neither runs while the other
   does. Its exit code follows `plan`'s: 0 when nothing drifted and every resource and
   secret was checked, 2 otherwise (something drifted, or a resource or secret couldn't
   be checked, ruling M15), 1 on an error. That holds from Task 4 on (ruling M3). Its
   `--json` is `mediaplane.drift/v1`. It is built so that a schedule (M2) can call it as
   it is; this slice builds no schedule. Its `--help` follows `plan --help`'s form, which
   names a repo path; pointing both at the published docs is added to Slice 10's list.
3. **(check) Drift's one write: what its checks found** (Tasks 1 and 4). The owner's
   decisions of 2026-10-17 need drift to remember: a secret it found refused, so as not to
   check it again, and when it last checked Jellyfin's admin. That goes in each
   resource's record, as `checks`: per secret, `passed` or `refused`, and when, never a
   value or a hash. It is an optional field within `mediaplane.resources/v1` (as change
   records grew in S3a). A record `apply`'s wire step writes has none, so a secret
   `apply` sets is checked afresh. `plan` reads `checks`, and still writes nothing.
4. **(check) A secret found refused isn't checked again until `apply` sets it** (Task 1;
   the owner's decisions on the "failing" mark and on qBittorrent's ban). `plan` and drift
   take it as refused, with `since`, without another check; `apply`'s own plan does the
   same, so its wire step sets the secret without checking it either (S3c's `refused`).
   Probed: a failing test of Sonarr's download client records a failure in Sonarr's
   status of it (`DownloadClientStatus`, `EscalationLevel` 1). More failing tests, a
   minute apart, leave the level at 1; once the first failure is five minutes old, each
   sets `DisabledTill` to a minute on, and Sonarr's health says `All download clients are
   unavailable due to failures`; a passing test resets it. qBittorrent bans an address
   from signing in after five failed sign-ins in a row (403, even with the right password
   then), and its API still takes the key meanwhile (probed again). So one check per
   change of a secret, not one per run, is what drift costs.
5. **Jellyfin's admin is checked by drift once a day at most** (Task 4; the owner's
   decision on Jellyfin's activity log). Probed: a check that passes adds three entries to
   Jellyfin's activity log (`SessionStarted`, `AuthenticationSucceeded`,
   `SessionEnded`), one that fails one (`AuthenticationFailed`). A resource may say at
   most how often drift checks its secrets while they pass (`checkEvery`): Jellyfin's
   admin, 24 hours, tested through `examine` with the real spec: skipped within a day,
   made after (ruling M7). `plan` and `apply` check it every time: an `admin.password`
   changed in `stack.yaml` must reach Jellyfin, and only a check tells that it hasn't.
   Drift's output says a verdict was taken from its last check, and when (ruling M11).
6. **(check) `plan` and drift leave an arr's download client key unchecked while
   qBittorrent lacks a category the client names** (Task 3; the owner's decision on
   qBittorrent's post-import category, widened). Probed: Sonarr's own test of its
   download client makes each category the client names that qBittorrent lacks, with no
   save path, its own (`tvCategory`) and its post-import one (`tvImportedCategory`);
   an unset post-import category is left out of the client's settings, a cleared one is
   `""`. So the client's `verify`, in `plan` and drift (`VerifyContext.readOnly`), reads
   the client and asks qBittorrent's categories first, through the run's own client for
   qBittorrent (`peer`), and answers `{ unchecked }`, saying what clears it, while one is
   missing, while a setting isn't text, or while qBittorrent can't be asked (it fails
   closed, rulings M5 and M6). The decision's words name the post-import category; the
   client's own is added because `unmanaged` lets you delete qBittorrent's (a first draft
   of this plan made `television` in qBittorrent from `drift`, on the probe stack). The
   fake arrs' test makes both, as the real one does (ruling I3), so the test of the
   widening fails without it. `apply`'s test runs as before, and makes it.
7. **(check) A download client's category kept as another is qBittorrent's to have**
   (Task 2; ruling I1). `qbittorrent.category_tv` wants the category Sonarr's client is
   kept with (`sonarr.download_client.category`), under `/data/torrents/<name>`, so
   `plan` shows it as a change and `apply` makes it, never the arr's test; until then the
   client waits for it (`requires`), and drift says so: "what it requires is yet to be
   put in place, which apply does first". The category made before stays, yours. A
   category you stop Mediaplane managing (`unmanaged`) and delete is yours to make again:
   the reason, the runbook and the qBittorrent README say to make it in qBittorrent, or
   name one the stack has. This keeps the owner's decision: `plan` never makes a
   category.
8. **(check) Overrides are part of D** (Task 2; §4.2, §6.3). `desiredOf` applies each
   `<address>.<field>` override to a resource's `desired`, and again after `resolve`, so
   Keep mine wins over what only the app can say (Seerr's profile). `<app>.<resource>:
   unmanaged` takes the resource out: it is neither made, nor looked at, nor reported.
   `plan` checks the overrides before it asks any app, as errors: an app, a resource or a
   field that isn't there, with the closest name (names are case-sensitive, the roadmap's
   S8 item); a secret; a fixed field (decision 9); a value of another type than the
   field's; and `<app>.<resource>` with anything but `unmanaged`. An override that does
   nothing warns (`overrides.unused`): of an app the stack doesn't have, of a field of a
   resource it doesn't want, or of a field of a resource made `unmanaged` (ruling M12);
   an `unmanaged` one of a resource it doesn't want is quiet from Task 2 on (ruling M3):
   it keeps a resource left in an app yours (decision 15). A field held as one
   comma-separated list (`lists`: folders, categories, tags, libraries, the whitelist) is
   compared as a set, with one helper for its items (`listItems`, ruling M8).
9. **(check) What a resource is known by, and where a key goes, can't be kept** (Task 2;
   the roadmap's S8 items on identity; ruling B1). A resource may declare fixed fields
   (`locked`), each with why, which overrides and Keep mine refuse with that reason:
   - a root folder's `path`: the arr knows a root folder by its path and can't move one,
     so another path would add a second root folder beside the one that holds your
     library. To move a library: move it in the arr, then make the root folder
     `unmanaged`;
   - a Jellyfin or Plex library's `name` (Mediaplane finds it by its name when its record
     is lost, and Seerr enables it by its name) and what it holds (`collectionType`,
     `type`: the apps can't change it);
   - a root folder's `accessible` (decision 11), and Seerr's `initialized` (Seerr can't go
     back to its setup wizard);
   - every field that says where an app sends a key, with the reason "it sets where a key
     is sent (spec §11, Slice 6)": the host, port and TLS of the arrs' download clients,
     the host and port of their connections to Jellyfin and Plex, Prowlarr's links'
     `baseUrl` and `prowlarrUrl`, and the host and port of Seerr's media server (Jellyfin
     or Plex) and of its Sonarr and Radarr servers; and Prowlarr's indexer proxy's host,
     which your indexers' requests, and the keys in them, go through. Drift still
     reports a change to one, and `apply` puts it back.

   Renaming is handled by what each app keys a library by. Probed: a Jellyfin library
   renamed loses its `ItemId` until Jellyfin refreshes, and gets the same one back with its
   old name, so Jellyfin keys it by its name: a renamed one reads as `missing`. Plex keeps
   a library's key across a rename, so with its record, a renamed one reads as drift on
   `name`, which `apply` puts back. Neither makes a library again on a folder another
   library of its holds (Task 3): `create` refuses, saying to rename it back, or make it
   `unmanaged`, which Seerr then stops enabling too.
10. **(check) Keys go only to the stack's own addresses, both ways** (Task 2; ruling B1;
    §11, Slice 6). Besides the fixed fields, every request that carries a key is built
    from the stack's own service address for the other app, never from a managed field
    (which an override could set) nor from what the app holds: a resource's `desired`
    gives it as `sendsTo`, which overrides never touch, and create, update and every
    check send it. That covers the tests Mediaplane has an app run with a key the app
    holds: an arr's test of its download client (now aimed with `urlBase: ''` too) and of
    its connections, Prowlarr's of a link, and Seerr's of a server; Seerr's list of
    Jellyfin's users, which Seerr asks with the key it holds at the address it holds, is
    asked only while Seerr holds the stack's (`{ unchecked }` otherwise). Each catalog
    resource has a test that an override, or a value the app holds, of the destination
    doesn't move where the key goes. The arrs fill a masked secret of a provider sent
    back by its id with the one they hold, as Mediaplane's tests already relied on.
11. **A root folder's folder, deleted by hand** (Task 3; the roadmap's S8 item). Probed:
    Sonarr reads `accessible` from the disk each time it is asked (false at once after
    `rmdir`, true at once after `mkdir`). So `accessible` becomes a managed field, wanted
    `true`: drift reports it, and `apply`'s update makes the folder again, as the wire step
    makes it for a new root folder. Upgrading means each root folder's record lacks the
    field: the first `plan` after upgrading shows each root folder as `adopt`, which
    changes nothing in the arr, and the next `apply` records it.
12. **A value Mediaplane can't read is said to be** (Task 3; the roadmap's S8 items on
    shapes, and on `enable`; rulings M5 and M13). Every observe reads its managed fields
    through a `FieldReader`, which leaves a field of another type, or missing, out of
    `fields` and names it in `unreadable` with what kind of value it found, never the
    value (`text, not a number`): qBittorrent's, Seerr's, Jellyfin's, Plex's and the
    admins' too. What a resource is found by (its id, its name) is still parsed strictly,
    and an answer Mediaplane can't parse at all leaves the resource unknown. A missing
    `CollectionType` (Jellyfin's mixed content) is unreadable, not empty. An optional
    setting the app leaves out is `""` only when it is absent or `""`; a value of another
    type is unreadable, and where it says where a key goes (TLS, a URL base), the host is.
    A folder with a comma in its name can't be told apart in `paths` or `location`: it is
    reported as unreadable, naming the folder (not a secret field); and Jellyfin's update
    now reads the folders as Jellyfin lists them (the roadmap's S8 item: one such folder
    made the library fail every `apply`). Drift's output redacts the run's secrets from
    `unreadable` too (ruling M4).
13. **(check) Keep mine writes one line, checked, and asks the app little** (Task 5; §3.3,
    §4.2, §6.3; rulings M9 and M16). §3.3 names the `yaml` Document API to preserve
    comments and formatting. Probed: a round-trip through it re-spaces comments aligned
    after values (`media_server: jellyfin   # …` loses its spacing), moves a comment after
    `overrides:` onto the next line, re-indents, and drops CRLF line ends and a missing
    last line end; it is byte-identical only on files such as `init`'s starter. So `keep`
    uses the Document API to find where `overrides:` and its last line are
    (`parseDocument`, the node ranges), and inserts the line there as text: after the last
    override, in its indentation, or a new `overrides:` at the end, or the value of one
    written before replaced, or into a `{ … }` flow. It then parses the new text and
    requires the same stack with the override, or writes nothing. It keeps the file's mode
    and group, writes atomically, and refuses a `stack.yaml` that is a link (a rename
    would replace the link), has other names (a rename would part it from them), belongs
    to another user (a rename would make it Mediaplane's), belongs to a group its user
    isn't in (the rename couldn't keep it), or is written as one `{ … }` block, each time
    giving the line to add by hand. An ACL or extended attribute isn't kept, which the
    docs say. With `managed_by: external`, it writes nothing and gives that line in the
    error's hint, which is §4.2's "print the snippet"; giving it as a field of
    `mediaplane.keep/v1`, with the rest of externally managed mode, is Slice 10's (ruling
    M10, parked). It looks at its one resource only: it checks that the app takes
    Mediaplane's key, reads the resource, checks none of its secrets and runs no test of
    the app's; what only the app can say (Seerr's profile, which Seerr's test gives) is
    the value applied. So every request it makes goes to the app's own address. It then
    records the kept value as applied, so drift is clear for it and `apply` has nothing
    to do for it.
14. **(check) A shared key changed at its source is reported, not repaired, in S8** (Task
    4; §6.3's last row; the brief leaves the call to this plan). When an app refuses the
    key Mediaplane holds for it (its key check fails `auth`), drift reports it on the app
    (`key`, naming the key), and on each resource of another app whose desired secrets
    hold that key, whether or not that app can be asked (`key`, with `source`). Repairing
    it is left to Slice 10:
    - **Re-apply's** "restores the old key at the source (for qBittorrent: stop, rewrite
      `qBittorrent.conf`, start)" is exactly the "restore the key at the source" that the
      owner moved to S10 on 2026-10-25 for installs from before Slice 3a: the same stop,
      file rewrite and start, for each app with a pre-start file. Building it twice, once
      here for drift and once there, would be two ways to do one thing.
    - **Keep mine's** "reads the new key and propagates it" needs the new key read from the
      app's own files (`config.xml`, `qBittorrent.conf`, `settings.json`): that is S10's
      key recovery from appdata, and the store's write path for an app's key, which S10
      changes for lost state anyway.

    Until then, the wiring failed runbook gives the steps by hand for each app, and the
    CLI points to it for a `key` item, never saying that `apply` puts it back (decision
    16).
15. **What Mediaplane made that the stack no longer wants is reported, not removed** (Task
    4; the roadmap's S8 item on links to an app that leaves the stack). A recorded
    resource the stack doesn't want, of an app still in the stack and reached, is looked
    up by its record: one the app still holds is `left` drift (Prowlarr's link to Sonarr,
    once Sonarr leaves); one the app can't say about is a warning (`drift.left-unknown`)
    and a wiring check that couldn't be made, so drift isn't clear and exits 2 (ruling
    I4). `keep <app>.<resource>` takes it as yours (`unmanaged`), forgetting its record.
    Removing it needs a delete for every kind of resource and its own end-to-end test
    (§8.1(3) step 4): moved to S10.
16. **The CLI says what puts each kind of drift right** (Tasks 4 and 5; ruling I2). After
    the drift lines, `plan` and `drift` print one line for each kind there is: `apply`
    puts back a field, a resource or a secret (with Keep mine's hint, from Task 5); a key
    changed at its source is put back by hand, as the wiring failed runbook shows; what is
    left in an app is removed there, or kept with `keep <app>.<resource>`. Neither of the
    last two says that `apply` puts it back.
17. **(check) Prowlarr's indexer proxy is read, never tested** (Task 4; the roadmap's S8
    item). Probed: with Byparr stopped, Prowlarr's own health check (`Check Health`, every
    six hours) reports `IndexerProxyStatusCheck: All indexer proxies are unavailable due to
    failures`, without any test from Mediaplane, and clears it once Byparr is back. Its
    result is in `GET /api/v1/health`. A resource may read its app's health (`health`):
    drift warns of it (`drift.health`), and of a health check it can't read. It is a
    warning, not drift, and doesn't change the exit code: `apply` can't put a solver that
    is down right.
18. **Every managed field reaches the app from D** (Task 2), or a kept value would never
    settle: Prowlarr's proxy gets each tag `tags` names, made or found by label; Jellyfin's
    libraries are made with, and keep, each folder in `paths`; Plex's each in `location`
    (probed: Plex takes one `location` per folder, made or updated, and an update
    replaces them); Seerr's servers take `isDefault`. Seerr's `libraries` names the
    libraries Mediaplane enables: an override naming fewer leaves the others to you, and
    a library no longer managed in Jellyfin or Plex is never enabled by Mediaplane.
19. **Secrets stay out** (all tasks; §6.3, §7.2(4)). A drift item never holds a secret: L
    was refused for one before it was written, and O and `unreadable` are redacted with
    the run's secrets, with `redacted: true` when that changed them. `keep` refuses a
    redacted value, a secret and a value it can't read. `checks` holds a secret's name, a
    verdict and a time.
20. **The lock names its command** (Task 4). `state/lock` records `drift` or `keep`, so a
    held lock says `mediaplane drift is running`; apply's lock reads as before.
21. **The contract grows, optionally** (Tasks 1 to 4; §3.2):
    `ObservedResource.unreadable`; `DesiredResource.sendsTo`; `ResourceSpec.lists`,
    `locked`, `checkEvery` and `health`; `verify(api, desired, observed, ctx?)` may answer
    `{ unchecked }`; `update(api, desired, observed, changes?)`. An integration that
    leaves them out keeps its meaning, so no other resource changes.
22. **Fakes no kinder than the real ones** (Tasks 3 and 4). The fake arrs' test of a
    download client makes each category it names that qBittorrent lacks, its own and its
    post-import one (ruling I3), as Sonarr's does; their root folders say `accessible`
    from the folders their `mkdir` made; the fake Prowlarr answers `GET /api/v1/health`;
    the fake qBittorrent's ban was there already (S3c). Drift's and keep's tests share
    their home and runtime helpers (`testing/home.ts`, ruling M8).
23. **(check) The end-to-end test of success criterion 4** (Task 6; §8.1(3) step 3) runs on
    the real apps, without Prowlarr and Seerr, to stay short: a category changed in
    Sonarr, a wrong key in Radarr's connection to Jellyfin, qBittorrent's save path
    changed and its `movies` category deleted, and a folder added to Jellyfin's Movies, by
    the apps' own APIs. `drift` reports each with what `apply` sets and what the app
    holds; a second `drift` doesn't check the refused key again; `apply` puts each back,
    and `drift` is clear. Then, changed again, `keep` refuses what can't be kept (where
    Sonarr sends qBittorrent's key among it), and keeps the category, the folder and
    Sonarr's deleted root folder (`unmanaged`): `stack.yaml` gains exactly three lines,
    its comments kept; drift finds nothing, but waits for qBittorrent's kept category;
    `apply` makes it, and only it (ruling I1's remedy, proved); drift is clear; and the
    next `apply` changes nothing. The deploy test runs `drift` and `keep` from the image,
    through the proxy.
24. **No new socket-proxy permission** (all tasks; ADR 0008). `drift` and `keep` make the
    calls `plan` makes. `deploy/mediaplane.compose.yaml` and `deploy/deploy.test.ts` don't
    change.
25. **The docs** (Task 7): the drift reported runbook (new), ADR 0003 (new, Accepted), the
    architecture (a drift section), the threat model (drift's marks and write, keep's
    write, T17 with where keys go, ruling B1), the app READMEs (what drift reports and
    Keep mine keeps there; the facts mark fixed fields, generated in Tasks 2 and 3), the
    root README ("What works so far"), the deploy guide, the wiring failed runbook, the
    spec (§3.2, §5.2 and §11, "Slice 8", and the earlier slices' "Slice 8" promises,
    ruling M1) and the roadmap (S8 done, each S8 item settled, and each item moved to S9,
    S10 or M2's `doctor` added to that list, rulings M2, M10, M14 and M15). The CLI and
    `stack.yaml` references are generated in Tasks 2, 4 and 5.
26. **Seerr's Jellyfin key is checked once per `apply`** (Task 3; the owner's decision).
    `update` may be told what differs (`changes`): Seerr's media server, told its key was
    refused, gives Seerr the stack's key without asking Seerr's list of Jellyfin's users
    again. Probed: each failing check of a Seerr server logs one line in Seerr's log
    (`[error][Radarr]: [Radarr] Failed to retrieve tags: … 401`), with no throttling; a
    passing check logs nothing.

## File structure (new and changed in this slice)

`packages/engine/src/`:

- `integrations/types.ts`: `ObservedResource.unreadable`; `DesiredResource.sendsTo`;
  `VerifyContext`, `Unchecked`; `ResourceSpec.lists`, `locked`, `checkEvery`, `health`;
  `verify`'s `ctx`, `update`'s `changes`.
- `integrations/wiring.ts` (+test): the three-way comparison in `examine` (`Drift`,
  `SecretCheck`, `sameValue`, `listItems`); `planWiring`'s `drift`, `checks`, `drift`
  mode, `only`; `key` and `left` drift, the apps' health; `DRIFT_RUNBOOK`.
- `integrations/overrides.ts` (+test), new: `desiredOf`, `withOverrides`, `isUnmanaged`,
  `UNMANAGED`, `SENDS_A_KEY`, `overrideTarget`, `checkOverrides`.
- `integrations/read.ts` (+test), new: `fieldReader`, `FieldReader`.
- `integrations/resources.ts` (+test): `KnownResource.checks`.
- `integrations/wire.ts` (+test): overrides, `VerifyContext` and `changes`.
- `plan/plan.ts` (+test): `PlanResult.drift`, `checks`; `PlanOptions.drift`, `only`;
  overrides checked.
- `drift.ts` (+test), new: `drift`, `DriftResult`, `DriftOptions`.
- `keep.ts` (+test), new: `keep`, `KeepResult`, `KeepOptions`.
- `config/overrides-file.ts` (+test), new: `withOverride`, `overrideLine`,
  `stackFileProblem`; `config/schema.ts`: the `overrides` and `managed_by` descriptions.
- `util/atomic.ts` (+test): `writeFileAtomic`'s `group`.
- `state/lock.ts` (+test): the lock's `command`.
- `runbooks.ts`: `drift-reported`.
- `testing/wiring.ts`, `testing/prowlarr.ts`: the fakes, as decision 22 says;
  `testing/home.ts`, new: drift's and keep's home and runtime.
- `apply/apply.ts`: the empty plan's new fields.

`packages/cli/src/`: `run.ts` (+test): `drift` and `keep`; `output.ts` (+test): the
`Drift` section of `plan`, `driftLine`, `driftAdvice`, `printDrift`, `printKeep`,
`mediaplane.drift/v1`, `mediaplane.keep/v1`.

`catalog/`: `_shared/secret.ts` (`sendsToOf`), `servarr.ts`, `servarr-provider.ts`,
`servarr-download.ts` (+test), `servarr-connection.ts` (+test); `sonarr/integration.ts`,
`radarr/integration.ts`; `prowlarr/integration.ts` (+test); `qbittorrent/integration.ts`
(+test); `jellyfin/integration.ts` (+test); `plex/integration.ts` (+test);
`seerr/integration.ts` (+test); `catalog.test.ts`.

Elsewhere: `scripts/docs/catalog-facts.ts` (+test): fixed fields; `test/e2e/drift.e2e.test.ts`,
new; `test/e2e/deploy.e2e.test.ts`, `test/e2e/helpers.ts`; the docs, and the generated
references and app facts.

**Tasks:**

1. The three-way comparison in `plan`: drift, and how each secret was checked.
2. Overrides: what the stack wants, with Keep mine's values; the fields that can't be
   kept; and keys sent only to the stack's own addresses.
3. The catalog: what an app holds that Mediaplane can't read, a root folder's folder, a
   renamed library, and `plan`'s marks as the owner decided.
4. `mediaplane drift`.
5. `mediaplane keep`.
6. End-to-end: success criterion 4 on the real apps, and from the image.
7. Docs.

Each task's behaviour agrees with the decisions when it lands (ruling M3): nothing a task
builds is changed back by a later one.

**Out of scope here:**

- **Restoring a key at its source, or giving a new one to every app that holds it**
  (§6.3's shared-key resolutions), with key recovery: Slice 10 (decision 14).
- **Removing what Mediaplane made when its app leaves the stack** (§8.1(3) step 4): Slice 10
  (decision 15).
- **Externally managed mode** beyond `keep`'s refusal with the line to add (and that line
  as a field of `mediaplane.keep/v1`, ruling M10), re-adoption by name after lost state,
  rotating the admin password, Jellyfin's key deleted by hand, giving Seerr a new Plex
  token or another Jellyfin key: Slice 10.
- **Drift on a schedule,** and alerts: M2.

---

### Task 1: The three-way comparison in `plan`: drift, and how each secret was checked

Every later task builds on what `examine` now says of each resource: what drifted, and how
each of its secrets was checked.

Decision: drift is a field that differs from both what was applied and what is wanted;
`expected` is what `apply` sets, with `applied` when `stack.yaml` changed it (decision 1).
Decision: a secret drift found refused is refused, without another check, in `plan` too
(decisions 3 and 4).
Decision: no secret in a drift item, `unreadable` redacted too (decision 19); the contract
grows optionally (decision 21).

**Files:**
- Modify: `packages/cli/src/output.ts`, `packages/engine/src/apply/apply.ts`, `packages/engine/src/integrations/resources.ts`, `packages/engine/src/integrations/types.ts`, `packages/engine/src/integrations/wire.ts`, `packages/engine/src/integrations/wiring.ts`, `packages/engine/src/plan/plan.ts`
- Test: `packages/cli/src/output.test.ts`, `packages/engine/src/integrations/resources.test.ts`, `packages/engine/src/integrations/wire.test.ts`, `packages/engine/src/integrations/wiring.test.ts`, `packages/engine/src/plan/plan.test.ts`

**Interfaces:**
- **Consumes:** S3b to S7's `examine`, `planWiring`, `wire`, `KnownResource`,
  `fakeSonarr`, `FAKE_LOGIN`.
- **Produces:**
  - `ObservedResource.unreadable?: Readonly<Record<string, string>>`;
  - `interface VerifyContext { readOnly: boolean; peer(app: string): AppApi | undefined }`,
    `interface Unchecked { unchecked: string }`;
    `ResourceSpec.verify?(api, desired, observed, ctx?: VerifyContext): Promise<boolean | Unchecked>`,
    `ResourceSpec.update(api, desired, observed, changes?: readonly string[]): Promise<void>`;
  - `KnownResource.checks?: Record<string, { verdict: 'passed' | 'refused'; at: string }>`;
  - in `integrations/wiring.ts`: `interface Drift { resource: string; kind: 'field' | 'missing' | 'secret'; field?; expected?: Scalar; applied?: Scalar; actual?: Scalar | null; unreadable?: string; redacted?: boolean; secret?: string; since?: string }`,
    `interface SecretCheck { resource: string; secret: string; verdict: 'passed' | 'refused' | 'unchecked'; reason?: string; at?: string }`,
    `Examined.drift: Drift[]`, `Examined.checks: SecretCheck[]`,
    `ExamineOptions.context?: VerifyContext`, `interface PlannedWiring { changes; diagnostics; drift; checks }`;
  - `PlanResult.drift: Drift[]`, `PlanResult.checks: SecretCheck[]`;
  - in `packages/cli/src/output.ts`: `driftLine(drift: Drift): string`, and `plan`'s
    `Drift, changed outside Mediaplane since it was applied:` section;
  - in `wiring.test.ts`: one `sonarrWith(resources, ...overrides)`, for every later test
    there (ruling M8).

- [ ] **Step 1: Write the failing tests**

**Change** `packages/cli/src/output.test.ts`:

```diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index 4ec2b23..fa587ce 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -2,3 +2,10 @@ import type { ActionResult, ChangeRecord, PlanResult } from '@mediaplane/engine'
 import { describe, expect, it } from 'vitest';
-import { printApply, printHistory, printPlan, printRecord, printStep } from './output';
+import {
+  driftLine,
+  printApply,
+  printHistory,
+  printPlan,
+  printRecord,
+  printStep,
+} from './output';
 import type { Io } from './run';
@@ -34,2 +41,4 @@ const PLAN: PlanResult = {
   wiring: [],
+  drift: [],
+  checks: [],
   bootstrap: [],
@@ -76,2 +85,82 @@ describe('printPlan: the wiring', () => {
 
+describe('printPlan: drift', () => {
+  const DRIFTED: PlanResult = {
+    ...PLAN,
+    files: [],
+    wiring: [
+      { resource: 'sonarr.download_client', action: 'update', changes: ['category'] },
+    ],
+    drift: [
+      {
+        resource: 'sonarr.download_client',
+        kind: 'field',
+        field: 'category',
+        expected: 'tv',
+        actual: 'television',
+      },
+      {
+        resource: 'sonarr.download_client',
+        kind: 'field',
+        field: 'enable',
+        expected: true,
+        actual: null,
+        unreadable: 'text, not a boolean',
+      },
+      { resource: 'qbittorrent.category_movies', kind: 'missing' },
+      { resource: 'radarr.download_client', kind: 'secret', secret: 'apiKey' },
+      {
+        resource: 'qbittorrent.admin',
+        kind: 'secret',
+        secret: 'password',
+        since: '2026-10-20T08:00:00.000Z',
+      },
+    ],
+    checks: [
+      { resource: 'radarr.download_client', secret: 'apiKey', verdict: 'refused' },
+    ],
+  };
+
+  it('says what apply sets, and what was applied, when stack.yaml and the app both changed', () => {
+    expect(
+      driftLine({
+        resource: 'qbittorrent.preferences',
+        kind: 'field',
+        field: 'savePath',
+        expected: '/data/torrents',
+        applied: '/data/old',
+        actual: '/data/other',
+      }),
+    ).toBe(
+      '  ~ qbittorrent.preferences.savePath: expected "/data/torrents", actual "/data/other" (Mediaplane applied "/data/old"; stack.yaml has changed it since)',
+    );
+  });
+
+  it('says what changed outside Mediaplane: what was applied, and what the app holds', () => {
+    const term = capture();
+    printPlan(DRIFTED, { json: false }, term.io);
+    expect(term.stdout()).toBe(
+      [
+        'Drift, changed outside Mediaplane since it was applied:',
+        '  ~ sonarr.download_client.category: expected "tv", actual "television"',
+        "  ~ sonarr.download_client.enable: expected true, actual one Mediaplane can't read (text, not a boolean)",
+        '  - qbittorrent.category_movies: deleted outside Mediaplane',
+        "  ! radarr.download_client.apiKey: refused by the app's own check",
+        "  ! qbittorrent.admin.password: refused by the app's own check (found by drift at 2026-10-20T08:00:00.000Z; not checked again until apply sets it)",
+        '  apply puts each back.',
+        'Wiring:',
+        '  ~ update      sonarr.download_client (category)',
+        'Plan: 1 resource to wire.',
+        '',
+      ].join('\n'),
+    );
+  });
+
+  it('gives the drift and the checks in JSON', () => {
+    const term = capture();
+    printPlan(DRIFTED, { json: true }, term.io);
+    const shown = JSON.parse(term.stdout()) as PlanResult;
+    expect([shown.drift, shown.checks]).toEqual([DRIFTED.drift, DRIFTED.checks]);
+  });
+});
+
 describe('printPlan', () => {
```

**Change** `packages/engine/src/integrations/resources.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/resources.test.ts b/packages/engine/src/integrations/resources.test.ts
index 9bfc00f..fc92ece 100644
--- a/packages/engine/src/integrations/resources.test.ts
+++ b/packages/engine/src/integrations/resources.test.ts
@@ -43,2 +43,25 @@ describe('resources.json', () => {
 
+  it("keeps what drift found of each secret, by name, and refuses a check it can't read", async () => {
+    const home = await tempDir('mediaplane-resources-');
+    const checked: KnownResources = {
+      'sonarr.admin': { ...ADMIN, checks: { password: { verdict: 'refused', at: AT } } },
+    };
+    await writeResources(home, checked);
+    expect(await readResources(home)).toEqual(checked);
+    const odd = await homeWith(
+      JSON.stringify({
+        schema: 'mediaplane.resources/v1',
+        resources: {
+          'sonarr.admin': {
+            ...ADMIN,
+            checks: { password: { verdict: 'maybe', at: AT } },
+          },
+        },
+      }),
+    );
+    await expect(readResources(odd)).rejects.toThrow(
+      'resources.sonarr.admin.checks.password.verdict:',
+    );
+  });
+
   it('refuses a file of another schema or shape, saying where', async () => {
```

**Change** `packages/engine/src/integrations/wire.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wire.test.ts b/packages/engine/src/integrations/wire.test.ts
index 687467b..a21a110 100644
--- a/packages/engine/src/integrations/wire.test.ts
+++ b/packages/engine/src/integrations/wire.test.ts
@@ -163,2 +163,29 @@ describe('wire', () => {
 
+  it("tells an update what differs, and a check that it is apply's, with the apps it may ask", async () => {
+    const seen: unknown[] = [];
+    const told: ResourceSpec = {
+      ...FAKE_LOGIN,
+      verify: (api, desired, observed, ctx) => {
+        seen.push(ctx?.readOnly, ctx?.peer('sonarr')?.name, ctx?.peer('qbittorrent'));
+        return FAKE_LOGIN.verify?.(api, desired, observed, ctx) ?? Promise.resolve(false);
+      },
+      update: (api, desired, observed, changes) => {
+        seen.push(changes);
+        return FAKE_LOGIN.update(api, desired, observed);
+      },
+    };
+    const stack = stackOf(
+      WIRED_CATALOG.map((def) =>
+        def.id === 'sonarr'
+          ? { ...def, integration: { after: [], resources: [told] } }
+          : def,
+      ),
+    );
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: 'fake-other' });
+    const { run } = await wireWith(sonarr, { stack, known: RECORDED });
+    expect(await run).toEqual(['sonarr.login updated password']);
+    // The fixture's Sonarr is named by its id; qBittorrent isn't up in this stack.
+    expect(seen).toEqual([false, 'sonarr', undefined, ['password']]);
+  });
+
   it('changes nothing, and writes nothing, when all is as wanted', async () => {
```

**Change** `packages/engine/src/integrations/wiring.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.test.ts b/packages/engine/src/integrations/wiring.test.ts
index 31b2e4e..43fc8fa 100644
--- a/packages/engine/src/integrations/wiring.test.ts
+++ b/packages/engine/src/integrations/wiring.test.ts
@@ -68,2 +68,11 @@ const RECORDED: KnownResources = {
 
+/** WIRED_CATALOG, with Sonarr's resources replaced by `resources`. */
+function sonarrWith(resources: ResourceSpec[]) {
+  return stackOf(
+    WIRED_CATALOG.map((def) =>
+      def.id === 'sonarr' ? { ...def, integration: { after: [], resources } } : def,
+    ),
+  );
+}
+
 describe('planWiring', () => {
@@ -75,2 +84,11 @@ describe('planWiring', () => {
       diagnostics: [],
+      drift: [],
+      checks: [
+        {
+          resource: 'sonarr.login',
+          secret: 'password',
+          verdict: 'unchecked',
+          reason: 'the app has none to check: apply makes it with them',
+        },
+      ],
     });
@@ -165,11 +183,2 @@ describe('planWiring', () => {
 
-  /** WIRED_CATALOG, with Sonarr's resources replaced by `resources`. */
-  function sonarrWith(resources: ResourceSpec[]) {
-    return stackOf(
-      WIRED_CATALOG.map((def) =>
-        def.id === 'sonarr' ? { ...def, integration: { after: [], resources } } : def,
-      ),
-    );
-  }
-
   it('leaves the secrets unchecked while a resource they require is yet to be made', async () => {
@@ -1004 +1013,277 @@ describe('settled', () => {
 });
+
+describe('planWiring: drift (spec §6.3)', () => {
+  const AT = '2026-10-20T08:00:00.000Z';
+
+  it('says what was applied and what the app holds of a field changed in it', async () => {
+    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
+    const planned = await planWiring(options(sonarr, { known: RECORDED }));
+    expect(planned.changes).toEqual([
+      { resource: 'sonarr.login', action: 'update', changes: ['user'] },
+    ]);
+    expect(planned.drift).toEqual([
+      {
+        resource: 'sonarr.login',
+        kind: 'field',
+        field: 'user',
+        expected: 'admin',
+        actual: 'someone',
+      },
+    ]);
+    // The update sets the password with the user, so it isn't checked.
+    expect(planned.checks).toEqual([
+      {
+        resource: 'sonarr.login',
+        secret: 'password',
+        verdict: 'unchecked',
+        reason: 'a managed field differs: apply sets the secrets with it',
+      },
+    ]);
+  });
+
+  it('finds no drift without a record, or where the app holds what the stack now wants', async () => {
+    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
+    // Never applied: an update, not a change made outside Mediaplane.
+    expect((await planWiring(options(sonarr))).drift).toEqual([]);
+    // Applied as "admin", and the stack now wants the user the app holds: adopted.
+    sonarr.state.user = 'admin';
+    const old = {
+      'sonarr.login': { ...RECORDED['sonarr.login'], fields: { user: 'old' } },
+    };
+    const planned = await planWiring(options(sonarr, { known: old as KnownResources }));
+    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'adopt' }]);
+    expect(planned.drift).toEqual([]);
+    expect(planned.checks).toEqual([
+      { resource: 'sonarr.login', secret: 'password', verdict: 'passed' },
+    ]);
+  });
+
+  it('says what apply sets, and what was applied, when stack.yaml and the app both changed it', async () => {
+    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
+    const old = {
+      'sonarr.login': { ...RECORDED['sonarr.login'], fields: { user: 'old' } },
+    };
+    const planned = await planWiring(options(sonarr, { known: old as KnownResources }));
+    expect(planned.drift).toEqual([
+      {
+        resource: 'sonarr.login',
+        kind: 'field',
+        field: 'user',
+        expected: 'admin',
+        applied: 'old',
+        actual: 'someone',
+      },
+    ]);
+  });
+
+  it('says a resource it applied was deleted outside Mediaplane', async () => {
+    const sonarr = await fakeSonarr({ key: KEY });
+    const planned = await planWiring(options(sonarr, { known: RECORDED }));
+    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'create' }]);
+    expect(planned.drift).toEqual([{ resource: 'sonarr.login', kind: 'missing' }]);
+    expect(planned.checks).toEqual([
+      {
+        resource: 'sonarr.login',
+        secret: 'password',
+        verdict: 'unchecked',
+        reason: 'the app has none to check: apply makes it with them',
+      },
+    ]);
+  });
+
+  it("says a secret the app's own check refuses, by name only", async () => {
+    const sonarr = await fakeSonarr({
+      key: KEY,
+      user: 'admin',
+      password: 'fake-changed',
+    });
+    const planned = await planWiring(options(sonarr, { known: RECORDED }));
+    expect(planned.drift).toEqual([
+      { resource: 'sonarr.login', kind: 'secret', secret: 'password' },
+    ]);
+    expect(planned.checks).toEqual([
+      { resource: 'sonarr.login', secret: 'password', verdict: 'refused' },
+    ]);
+    expect(JSON.stringify(planned)).not.toContain(PASSWORD);
+  });
+
+  it('takes a secret drift found refused as refused, with no check, until apply sets it', async () => {
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const found = {
+      'sonarr.login': {
+        ...RECORDED['sonarr.login'],
+        checks: { password: { verdict: 'refused', at: AT } },
+      },
+    } as KnownResources;
+    const planned = await planWiring(options(sonarr, { known: found }));
+    expect(planned.changes).toEqual([
+      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
+    ]);
+    expect(planned.drift).toEqual([
+      { resource: 'sonarr.login', kind: 'secret', secret: 'password', since: AT },
+    ]);
+    expect(planned.checks).toEqual([
+      { resource: 'sonarr.login', secret: 'password', verdict: 'refused', at: AT },
+    ]);
+    // No sign-in: each one that fails counts towards qBittorrent's ban.
+    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
+    // A check drift found passing is checked again.
+    const passed = {
+      'sonarr.login': {
+        ...RECORDED['sonarr.login'],
+        checks: { password: { verdict: 'passed', at: AT } },
+      },
+    } as KnownResources;
+    expect((await planWiring(options(sonarr, { known: passed }))).checks).toEqual([
+      { resource: 'sonarr.login', secret: 'password', verdict: 'passed' },
+    ]);
+    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(true);
+  });
+
+  it('leaves the other secrets unchecked beside one found refused, and one with no check', async () => {
+    const two: ResourceSpec = { ...FAKE_LOGIN, secrets: ['password', 'token'] };
+    const found = {
+      'sonarr.login': {
+        ...RECORDED['sonarr.login'],
+        secrets: ['password', 'token'],
+        checks: { password: { verdict: 'refused', at: AT } },
+      },
+    } as KnownResources;
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const planned = await planWiring(
+      options(sonarr, { stack: sonarrWith([two]), known: found }),
+    );
+    expect(planned.checks).toEqual([
+      { resource: 'sonarr.login', secret: 'password', verdict: 'refused', at: AT },
+      {
+        resource: 'sonarr.login',
+        secret: 'token',
+        verdict: 'unchecked',
+        reason: 'apply sets it with the refused one',
+      },
+    ]);
+    const unverified: ResourceSpec = {
+      name: FAKE_LOGIN.name,
+      fields: FAKE_LOGIN.fields,
+      secrets: FAKE_LOGIN.secrets,
+      desired: (ctx) => FAKE_LOGIN.desired(ctx),
+      observe: (api, known) => FAKE_LOGIN.observe(api, known),
+      create: (api, desired) => FAKE_LOGIN.create(api, desired),
+      update: (api, desired, observed) => FAKE_LOGIN.update(api, desired, observed),
+    };
+    const blind = await planWiring(
+      options(sonarr, { stack: sonarrWith([unverified]), known: RECORDED }),
+    );
+    expect(blind.checks).toEqual([
+      {
+        resource: 'sonarr.login',
+        secret: 'password',
+        verdict: 'unchecked',
+        reason: 'it has no check',
+      },
+    ]);
+  });
+
+  it("reports a field the app holds in a shape it can't read, never as empty", async () => {
+    const odd: ResourceSpec = {
+      ...FAKE_LOGIN,
+      observe: () =>
+        Promise.resolve({
+          id: null,
+          name: 'login',
+          fields: {},
+          unreadable: { user: 'a number, not text' },
+        }),
+    };
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const planned = await planWiring(
+      options(sonarr, { stack: sonarrWith([odd]), known: RECORDED }),
+    );
+    expect(planned.changes).toEqual([
+      { resource: 'sonarr.login', action: 'update', changes: ['user'] },
+    ]);
+    expect(planned.drift).toEqual([
+      {
+        resource: 'sonarr.login',
+        kind: 'field',
+        field: 'user',
+        expected: 'admin',
+        actual: null,
+        unreadable: 'a number, not text',
+      },
+    ]);
+  });
+
+  it("keeps a secret out of what it says of a value it can't read", async () => {
+    const odd: ResourceSpec = {
+      ...FAKE_LOGIN,
+      observe: () =>
+        Promise.resolve({
+          id: null,
+          name: 'login',
+          fields: {},
+          unreadable: { user: `a folder with a comma in its name, /x,${PASSWORD}` },
+        }),
+    };
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const planned = await planWiring(
+      options(sonarr, { stack: sonarrWith([odd]), known: RECORDED }),
+    );
+    expect(planned.drift).toEqual([
+      {
+        resource: 'sonarr.login',
+        kind: 'field',
+        field: 'user',
+        expected: 'admin',
+        actual: null,
+        unreadable: 'a folder with a comma in its name, /x,***',
+        redacted: true,
+      },
+    ]);
+  });
+
+  it('keeps a secret out of a value the app holds, and says it did', async () => {
+    const sonarr = await fakeSonarr({
+      key: KEY,
+      user: `x${PASSWORD}`,
+      password: PASSWORD,
+    });
+    const planned = await planWiring(options(sonarr, { known: RECORDED }));
+    expect(planned.drift).toEqual([
+      {
+        resource: 'sonarr.login',
+        kind: 'field',
+        field: 'user',
+        expected: 'admin',
+        actual: 'x***',
+        redacted: true,
+      },
+    ]);
+  });
+
+  it('gives a check what it may do and ask in plan, and says why it left one undone', async () => {
+    const seen: unknown[] = [];
+    const careful: ResourceSpec = {
+      ...FAKE_LOGIN,
+      verify: (_api, _desired, _observed, ctx) => {
+        seen.push(ctx?.readOnly, ctx?.peer('sonarr')?.name, ctx?.peer('radarr'));
+        return Promise.resolve({ unchecked: 'it would make a category' });
+      },
+    };
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const planned = await planWiring(
+      options(sonarr, { stack: sonarrWith([careful]), known: RECORDED }),
+    );
+    // The fixture's Sonarr is named by its id.
+    expect(seen).toEqual([true, 'sonarr', undefined]);
+    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
+    expect(planned.checks).toEqual([
+      {
+        resource: 'sonarr.login',
+        secret: 'password',
+        verdict: 'unchecked',
+        reason: 'it would make a category',
+      },
+    ]);
+  });
+});
```

**Change** `packages/engine/src/plan/plan.test.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.test.ts b/packages/engine/src/plan/plan.test.ts
index 14cab6b..7b05d5f 100644
--- a/packages/engine/src/plan/plan.test.ts
+++ b/packages/engine/src/plan/plan.test.ts
@@ -959,2 +959,41 @@ describe('plan: the wiring', () => {
 
+  it('says what changed in an app since it was applied, and how each secret was checked', async () => {
+    const sonarr = await fakeSonarr({
+      key: '0'.repeat(32),
+      user: 'someone',
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
+      changed: true,
+      wiring: [{ resource: 'sonarr.login', action: 'update', changes: ['user'] }],
+      drift: [
+        {
+          resource: 'sonarr.login',
+          kind: 'field',
+          field: 'user',
+          expected: 'admin',
+          actual: 'someone',
+        },
+      ],
+      checks: [{ resource: 'sonarr.login', secret: 'password', verdict: 'unchecked' }],
+    });
+  });
+
   it('checks the wiring after the start on a first plan, asking no app', async () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/cli/src/output.test.ts packages/engine/src/integrations/resources.test.ts packages/engine/src/integrations/wire.test.ts packages/engine/src/integrations/wiring.test.ts packages/engine/src/plan/plan.test.ts`
Expected: FAIL. 17 tests fail, 141 pass: 12 in `wiring.test.ts` (`expected undefined to deeply equal […]`: `planWiring` gives no `drift` nor `checks`), 2 in `output.test.ts` (no `Drift` section, nor `applied`), and one in each of `plan.test.ts`, `resources.test.ts` (`checks` refused as an unknown key) and `wire.test.ts` (`update` is given no `changes`).

- [ ] **Step 3: Write the comparison, the checks and `plan`'s drift**

**Change** `packages/cli/src/output.ts`:

```diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index 812734b..cba88c7 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -9,2 +9,3 @@ import {
   type Diagnostic,
+  type Drift,
   type PlanResult,
@@ -47,2 +48,27 @@ function wiringLine(change: WiringChange): string {
 
+/** A value as drift shows it: text in quotes, so that an empty one shows. */
+function shownValue(value: Drift['actual']): string {
+  return typeof value === 'string' ? JSON.stringify(value) : String(value);
+}
+
+/**
+ * One change made outside Mediaplane, as plan and drift show it: the field, what was
+ * applied and what the app holds; a resource deleted; or a secret the app refuses.
+ */
+export function driftLine(drift: Drift): string {
+  switch (drift.kind) {
+    case 'field': {
+      const actual =
+        drift.unreadable === undefined
+          ? shownValue(drift.actual ?? null)
+          : `one Mediaplane can't read (${drift.unreadable})`;
+      return `  ~ ${drift.resource}.${drift.field ?? ''}: expected ${shownValue(drift.expected ?? null)}, actual ${actual}${drift.applied === undefined ? '' : ` (Mediaplane applied ${shownValue(drift.applied)}; stack.yaml has changed it since)`}`;
+    }
+    case 'missing':
+      return `  - ${drift.resource}: deleted outside Mediaplane`;
+    case 'secret':
+      return `  ! ${drift.resource}.${drift.secret ?? ''}: refused by the app's own check${drift.since === undefined ? '' : ` (found by drift at ${drift.since}; not checked again until apply sets it)`}`;
+  }
+}
+
 export function formatDiagnostic(diagnostic: Diagnostic): string {
@@ -124,2 +150,7 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
   }
+  if (result.drift.length > 0) {
+    io.stdout('Drift, changed outside Mediaplane since it was applied:\n');
+    for (const drift of result.drift) io.stdout(`${driftLine(drift)}\n`);
+    io.stdout('  apply puts each back.\n');
+  }
   const wiring = result.wiring.filter((change) => change.action !== 'unchanged');
```

**Change** `packages/engine/src/apply/apply.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index 329c466..ca6d163 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -607,2 +607,4 @@ function emptyPlan(): PlanResult {
     wiring: [],
+    drift: [],
+    checks: [],
     bootstrap: [],
```

**Change** `packages/engine/src/integrations/resources.ts`:

```diff
diff --git a/packages/engine/src/integrations/resources.ts b/packages/engine/src/integrations/resources.ts
index 9c30176..9ff2015 100644
--- a/packages/engine/src/integrations/resources.ts
+++ b/packages/engine/src/integrations/resources.ts
@@ -24,2 +24,16 @@ const knownSchema = z.strictObject({
   appliedAt: z.iso.datetime(),
+  /**
+   * What `mediaplane drift` found of each secret when it last checked it, by name: its
+   * verdict and when. Plan and drift don't check again a secret found refused, until
+   * apply sets it, and its record then has none (spec §6.3). Never a value.
+   */
+  checks: z
+    .record(
+      z.string(),
+      z.strictObject({
+        verdict: z.enum(['passed', 'refused']),
+        at: z.iso.datetime(),
+      }),
+    )
+    .optional(),
 });
```

**Change** `packages/engine/src/integrations/types.ts`:

```diff
diff --git a/packages/engine/src/integrations/types.ts b/packages/engine/src/integrations/types.ts
index d980637..db2f052 100644
--- a/packages/engine/src/integrations/types.ts
+++ b/packages/engine/src/integrations/types.ts
@@ -32,2 +32,23 @@ export interface ObservedResource {
   fields: Fields;
+  /**
+   * The managed fields the app holds in a shape Mediaplane can't read, by name, with what
+   * it found: each is left out of `fields`, so it differs, and is never read as empty.
+   */
+  unreadable?: Readonly<Record<string, string>>;
+}
+
+/** What a resource's verify may use besides its own app's API. */
+export interface VerifyContext {
+  /**
+   * True in plan and drift, which change nothing in the apps but for the marks their
+   * checks leave (spec §5.2): a check that would change more is left undone.
+   */
+  readOnly: boolean;
+  /** Another app of the stack, as this run reached it, once it took Mediaplane's key. */
+  peer(app: string): AppApi | undefined;
+}
+
+/** A check of a resource's secrets left undone, and why: plan and drift say so. */
+export interface Unchecked {
+  unchecked: string;
 }
@@ -89,3 +110,5 @@ export interface ResourceSpec {
    * `secrets` isn't empty. Asked only while every managed field matches: update sets the
-   * secrets with the fields. Throws AppApiError when the app can't say.
+   * secrets with the fields. Throws AppApiError when the app can't say. Unchecked, when it
+   * leaves the check undone: in plan and drift (`ctx.readOnly`), for one that would change
+   * more than its marks. Without `ctx`, it is apply's.
    */
@@ -95,3 +118,4 @@ export interface ResourceSpec {
     observed: ObservedResource,
-  ): Promise<boolean>;
+    ctx?: VerifyContext,
+  ): Promise<boolean | Unchecked>;
   /** Make it. The id the app gave it, or null for a singleton. */
@@ -100,3 +124,5 @@ export interface ResourceSpec {
    * Make what the app holds match: the managed fields and the secrets, always both, since
-   * the secrets go unchecked when a field differs. Idempotent.
+   * the secrets go unchecked when a field differs. Idempotent. `changes` names what
+   * differs, fields and secrets, as plan says it: a secret named there was found refused,
+   * and needs no other check.
    */
@@ -106,2 +132,3 @@ export interface ResourceSpec {
     observed: ObservedResource,
+    changes?: readonly string[],
   ): Promise<void>;
```

**Change** `packages/engine/src/integrations/wire.ts`:

```diff
diff --git a/packages/engine/src/integrations/wire.ts b/packages/engine/src/integrations/wire.ts
index 0e96656..1c42db7 100644
--- a/packages/engine/src/integrations/wire.ts
+++ b/packages/engine/src/integrations/wire.ts
@@ -11,3 +11,9 @@ import { foundSecrets, redact, type FoundSecrets } from '../util/redact';
 import { readResources, writeResources, type KnownResources } from './resources';
-import type { DesiredResource, Fields, ResourceSpec, WiringContext } from './types';
+import type {
+  DesiredResource,
+  Fields,
+  ResourceSpec,
+  VerifyContext,
+  WiringContext,
+} from './types';
 import {
@@ -135,2 +141,5 @@ export async function wire(options: WireOptions): Promise<string[]> {
   const done: string[] = [];
+  /** The apps that took Mediaplane's key: what a check may ask of another app. */
+  const checked = new Map<string, ReachedApp['api']>();
+  const context: VerifyContext = { readOnly: false, peer: (id) => checked.get(id) };
   const values = redactionValues(secrets);
@@ -189,2 +198,3 @@ export async function wire(options: WireOptions): Promise<string[]> {
     }
+    checked.set(app.def.id, client.api);
     for (const spec of wantedResources(ctx)) {
@@ -221,2 +231,3 @@ export async function wire(options: WireOptions): Promise<string[]> {
           refused: planned?.action === 'update' ? (planned.changes ?? []) : [],
+          context,
         });
@@ -246,3 +257,3 @@ export async function wire(options: WireOptions): Promise<string[]> {
         } else if (result.action === 'update' && result.observed !== undefined) {
-          await spec.update(client.api, result.desired, result.observed);
+          await spec.update(client.api, result.desired, result.observed, result.changes);
         }
```

**Change** `packages/engine/src/integrations/wiring.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index a50b234..a9735e6 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -23,2 +23,4 @@ import type {
   ResourceSpec,
+  Scalar,
+  VerifyContext,
   WiringContext,
@@ -54,2 +56,43 @@ export interface WiringChange {
 
+/**
+ * What changed in an app outside Mediaplane since Mediaplane last applied a resource
+ * (spec §6.3: O ≠ L), never a secret's value:
+ * - `field`: a managed field holds another value than the one applied, and than the one
+ *   the stack now wants (`expected`, what apply sets): `actual`, or null with `unreadable`
+ *   when the app holds it in a shape Mediaplane can't read. When stack.yaml has changed
+ *   it since, `applied` is the value Mediaplane applied;
+ * - `missing`: the app no longer holds it;
+ * - `secret`: the app's own check refuses one of its secrets (`since`: when drift found
+ *   it, for one it doesn't check again).
+ */
+export interface Drift {
+  /** "<app>.<resource>". */
+  resource: string;
+  kind: 'field' | 'missing' | 'secret';
+  field?: string;
+  /** The value apply sets: what the stack wants (D). */
+  expected?: Scalar;
+  /** What Mediaplane applied (L), when the stack now wants another value. */
+  applied?: Scalar;
+  actual?: Scalar | null;
+  unreadable?: string;
+  /** true when `actual` or `unreadable` held one of the run's secrets, shown as ***. */
+  redacted?: boolean;
+  secret?: string;
+  since?: string;
+}
+
+/**
+ * How one secret of a resource was checked (spec §6.3, "verified, never compared"): passed
+ * or refused by the app's own check, or unchecked, with why. `at`: when drift last checked
+ * it, for a verdict it took from then, rather than check again now.
+ */
+export interface SecretCheck {
+  resource: string;
+  secret: string;
+  verdict: 'passed' | 'refused' | 'unchecked';
+  reason?: string;
+  at?: string;
+}
+
 /** For tests: where an app is reached, and how long its calls take and are tried. */
@@ -259,2 +302,6 @@ export interface Examined {
   changes: string[];
+  /** What changed in the app since Mediaplane last applied it; none without a record. */
+  drift: Drift[];
+  /** How each of its secrets was checked. */
+  checks: SecretCheck[];
 }
@@ -276,8 +323,19 @@ export interface ExamineOptions {
   refused?: readonly string[];
+  /**
+   * What the resource's verify may use (VerifyContext); apply's, which may change things,
+   * by default. Plan and drift give `readOnly`, and then a secret drift found refused (the
+   * record's `checks`) is taken as refused, without another check, until apply sets it.
+   */
+  context?: VerifyContext;
 }
 
+/** Apply's VerifyContext, without another app: what a check gets by default. */
+const APPLYING: VerifyContext = { readOnly: false, peer: () => undefined };
+
 /**
- * Look at one resource: observe it, compare its managed fields, and check its secrets by
- * using them (spec §6.3), unless `options` say not to. Undefined when the stack wants
- * none. Throws AppApiError.
+ * Look at one resource: observe it, compare its managed fields with what the stack wants
+ * (D against O), and check its secrets by using them (spec §6.3), unless `options` say
+ * not to. Against its record (L), say what changed in the app outside Mediaplane: drift,
+ * a field that differs from both what was applied and what is wanted now. Undefined when
+ * the stack wants none. Throws AppApiError.
  */
@@ -292,2 +350,3 @@ export async function examine(
   if (wanted === undefined) return undefined;
+  const address = resourceAddress(ctx.app, spec);
   const desired =
@@ -297,4 +356,18 @@ export async function examine(
   const observed = await spec.observe(api, known, desired);
+  const unchecked = (reason: string): SecretCheck[] =>
+    spec.secrets.map((secret) => ({
+      resource: address,
+      secret,
+      verdict: 'unchecked',
+      reason,
+    }));
   if (observed === undefined) {
-    return { desired, observed, action: 'create', changes: [] };
+    return {
+      desired,
+      observed,
+      action: 'create',
+      changes: [],
+      drift: known === undefined ? [] : [{ resource: address, kind: 'missing' }],
+      checks: unchecked('the app has none to check: apply makes it with them'),
+    };
   }
@@ -309,2 +382,4 @@ export async function examine(
   );
+  const drift =
+    known === undefined ? [] : fieldDrift(address, compared, known, desired, observed);
   // A field that differs makes it an update, which sets the secrets too: checking them
@@ -312,11 +387,23 @@ export async function examine(
   // have yet fails as if the password were wrong.
-  if (changes.length === 0 && spec.secrets.length > 0) {
-    const refused = (options.refused ?? []).filter((name) => spec.secrets.includes(name));
-    if (refused.length > 0) {
-      changes.push(...refused);
-    } else if (options.verify !== false && spec.verify !== undefined) {
-      if (!(await spec.verify(api, desired, observed))) changes.push(...spec.secrets);
-    }
+  const checks =
+    spec.secrets.length === 0
+      ? []
+      : changes.length > 0
+        ? unchecked('a managed field differs: apply sets the secrets with it')
+        : await checkSecrets(spec, api, address, desired, observed, known, options);
+  const refused = checks.filter((check) => check.verdict === 'refused');
+  changes.push(...refused.map((check) => check.secret));
+  if (known !== undefined) {
+    drift.push(
+      ...refused.map((check): Drift => ({
+        resource: address,
+        kind: 'secret',
+        secret: check.secret,
+        ...(check.at === undefined ? {} : { since: check.at }),
+      })),
+    );
+  }
+  if (changes.length > 0) {
+    return { desired, observed, action: 'update', changes, drift, checks };
   }
-  if (changes.length > 0) return { desired, observed, action: 'update', changes };
   const recorded =
@@ -324,3 +411,114 @@ export async function examine(
     compared.every((field) => known.fields[field] === desired.fields[field]);
-  return { desired, observed, action: recorded ? 'unchanged' : 'adopt', changes };
+  return {
+    desired,
+    observed,
+    action: recorded ? 'unchanged' : 'adopt',
+    changes,
+    drift,
+    checks,
+  };
+}
+
+/**
+ * The managed fields that changed in the app since they were applied (O ≠ L), unless the
+ * app now holds what the stack wants (O = D: stack.yaml was changed to match). A field
+ * the app holds in a shape Mediaplane can't read has drifted too, with no value.
+ */
+function fieldDrift(
+  address: string,
+  compared: readonly string[],
+  known: KnownResource,
+  desired: DesiredResource,
+  observed: ObservedResource,
+): Drift[] {
+  return compared.flatMap((field): Drift[] => {
+    const applied = known.fields[field];
+    if (applied === undefined) return [];
+    // What apply would set; and what it applied, when stack.yaml has changed it since.
+    const wanted = desired.fields[field];
+    const expected = wanted ?? applied;
+    const was = wanted === undefined || wanted === applied ? {} : { applied };
+    const unreadable =
+      observed.unreadable?.[field] ??
+      (observed.fields[field] === undefined ? 'the app gave none' : undefined);
+    if (unreadable !== undefined) {
+      return [
+        {
+          resource: address,
+          kind: 'field',
+          field,
+          expected,
+          ...was,
+          actual: null,
+          unreadable,
+        },
+      ];
+    }
+    const actual = observed.fields[field];
+    if (actual === applied || actual === wanted) return [];
+    return [{ resource: address, kind: 'field', field, expected, ...was, actual }];
+  });
+}
+
+/**
+ * Check a resource's secrets by using them, once every managed field matches: refused
+ * ones that apply's own plan found (`refused`), or, in plan and drift, that drift found
+ * (the record's `checks`), are taken as refused without another check; secrets waiting
+ * for what they require stay unchecked.
+ */
+async function checkSecrets(
+  spec: ResourceSpec,
+  api: AppApi,
+  address: string,
+  desired: DesiredResource,
+  observed: ObservedResource,
+  known: KnownResource | undefined,
+  options: ExamineOptions,
+): Promise<SecretCheck[]> {
+  const context = options.context ?? APPLYING;
+  const all = (verdict: SecretCheck['verdict'], reason?: string): SecretCheck[] =>
+    spec.secrets.map((secret) => ({
+      resource: address,
+      secret,
+      verdict,
+      ...(reason === undefined ? {} : { reason }),
+    }));
+  const planned = (options.refused ?? []).filter((name) => spec.secrets.includes(name));
+  if (planned.length > 0) {
+    return spec.secrets.map((secret) =>
+      planned.includes(secret)
+        ? { resource: address, secret, verdict: 'refused' }
+        : {
+            resource: address,
+            secret,
+            verdict: 'unchecked',
+            reason: 'apply sets it with the refused one',
+          },
+    );
+  }
+  const found = context.readOnly
+    ? spec.secrets.filter((secret) => known?.checks?.[secret]?.verdict === 'refused')
+    : [];
+  if (found.length > 0) {
+    return spec.secrets.map((secret): SecretCheck => {
+      const at = known?.checks?.[secret]?.at;
+      return found.includes(secret) && at !== undefined
+        ? { resource: address, secret, verdict: 'refused', at }
+        : {
+            resource: address,
+            secret,
+            verdict: 'unchecked',
+            reason: 'apply sets it with the refused one',
+          };
+    });
+  }
+  if (options.verify === false) {
+    return all('unchecked', 'what it requires is yet to be put in place');
+  }
+  // The catalog's tests make every resource with secrets give a verify.
+  if (spec.verify === undefined) return all('unchecked', 'it has no check');
+  const verdict = await spec.verify(api, desired, observed, context);
+  if (verdict === true) return all('passed');
+  if (verdict === false) return all('refused');
+  return all('unchecked', verdict.unchecked);
 }
@@ -414,10 +612,19 @@ export interface PlanWiringOptions {
 
+/** What planWiring found: apply's changes, and what drift found on the way. */
+export interface PlannedWiring {
+  changes: WiringChange[];
+  diagnostics: Diagnostic[];
+  /** What changed in the apps outside Mediaplane since it applied them (spec §6.3). */
+  drift: Drift[];
+  /** How each secret of each resource it looked at was checked. */
+  checks: SecretCheck[];
+}
+
 /**
  * What apply would do to the wiring (spec §5 step 5): for each app with an API, in order,
- * whether it is up and takes Mediaplane's key, then each of its resources. An app that
- * isn't settled is checked after the start. Asks the apps; changes nothing.
+ * whether it is up and takes Mediaplane's key, then each of its resources, and what
+ * changed in them outside Mediaplane (spec §6.3). An app that isn't settled is checked
+ * after the start. Asks the apps; changes nothing but for the marks its checks leave.
  */
-export async function planWiring(
-  options: PlanWiringOptions,
-): Promise<{ changes: WiringChange[]; diagnostics: Diagnostic[] }> {
+export async function planWiring(options: PlanWiringOptions): Promise<PlannedWiring> {
   const order = wiringOrder(options.stack);
@@ -434,2 +641,28 @@ export async function planWiring(
   const diagnostics: Diagnostic[] = [];
+  const drift: Drift[] = [];
+  const checks: SecretCheck[] = [];
+  /** The apps that took Mediaplane's key: what a check may ask of another app. */
+  const checked = new Map<string, AppApi>();
+  const context: VerifyContext = {
+    readOnly: true,
+    peer: (app) => checked.get(app),
+  };
+  /**
+   * A value from an app, and what was said of one Mediaplane can't read, shown without any
+   * secret the run knows of by then.
+   */
+  const shown = (entry: Drift): Drift => {
+    const values = redactionValues([...options.secrets, ...found.values]);
+    const hidden = (text: string | null | Scalar | undefined) =>
+      typeof text === 'string' ? redact(text, values) : text;
+    const actual = hidden(entry.actual);
+    const unreadable = hidden(entry.unreadable);
+    if (actual === entry.actual && unreadable === entry.unreadable) return entry;
+    return {
+      ...entry,
+      ...(actual === undefined ? {} : { actual }),
+      ...(typeof unreadable === 'string' ? { unreadable } : {}),
+      redacted: true,
+    };
+  };
   /**
@@ -480,2 +713,3 @@ export async function planWiring(
     }
+    checked.set(app.def.id, client.api);
     const wanted = wantedResources(ctx);
@@ -505,2 +739,3 @@ export async function planWiring(
           verify: !waiting,
+          context,
         });
@@ -540,2 +775,4 @@ export async function planWiring(
       });
+      drift.push(...result.drift.map(shown));
+      checks.push(...result.checks);
       // Its secrets went unchecked, so it isn't known to be in place either: what
@@ -545,3 +782,3 @@ export async function planWiring(
   }
-  return { changes, diagnostics };
+  return { changes, diagnostics, drift, checks };
 }
```

**Change** `packages/engine/src/plan/plan.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index 8874941..5113399 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -27,2 +27,4 @@ import {
   wiringOrder,
+  type Drift,
+  type SecretCheck,
   type WiringChange,
@@ -80,2 +82,9 @@ export interface PlanResult {
   wiring: WiringChange[];
+  /**
+   * What changed in the apps outside Mediaplane since it applied them (spec §6.3): apply
+   * puts it back, as `wiring` says.
+   */
+  drift: Drift[];
+  /** How each secret of each resource plan looked at was checked: names, never values. */
+  checks: SecretCheck[];
   /** The apps whose first-run setup apply would finish before publishing them. */
@@ -220,2 +229,4 @@ export async function planStack(
   let wiring: WiringChange[] = [];
+  let drift: Drift[] = [];
+  let checks: SecretCheck[] = [];
   const order = wiringOrder(stack);
@@ -264,2 +275,3 @@ export async function planStack(
       });
+      ({ drift, checks } = planned);
       wiring = planned.changes;
@@ -286,2 +298,4 @@ export async function planStack(
       wiring,
+      drift,
+      checks,
       bootstrap,
@@ -303,2 +317,4 @@ function failed(diagnostics: Diagnostic[]): { result: PlanResult; context: undef
       wiring: [],
+      drift: [],
+      checks: [],
       bootstrap: [],
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run packages/cli/src/output.test.ts packages/engine/src/integrations/resources.test.ts packages/engine/src/integrations/wire.test.ts packages/engine/src/integrations/wiring.test.ts packages/engine/src/plan/plan.test.ts`
Expected: PASS.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages
git commit -m "feat(engine): plan compares what the apps hold with what Mediaplane applied, and says what changed outside it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1977 tests pass in 88 files (1960 in 88 files before this slice).

---

### Task 2: Overrides: what the stack wants, with Keep mine's values; the fields that can't be kept; and keys sent only to the stack's own addresses

`overrides:` has been in the schema since Slice 1, unused. This task makes it part of D,
checks it, and makes each catalog resource send the app what D says, so that a value of
yours stays; but never where a key goes, which is fixed, and sent from the stack's own
addresses whatever an override or an app holds.

Decision: overrides are part of D, checked before any app is asked; a field of an
`unmanaged` resource warns, an `unmanaged` one left is quiet (decision 8).
Decision: fixed fields, with why, where a key goes among them (decision 9).
Decision: keys go only to the stack's own addresses, both ways (decision 10).
Decision: a download client's category kept as another is qBittorrent's to have, and a
record of another name isn't drift (decisions 1 and 7).
Decision: every managed field reaches the app from D (decision 18).

**Files:**
- Create: `packages/engine/src/integrations/overrides.ts`
- Modify: `catalog/_shared/secret.ts`, `catalog/_shared/servarr-connection.ts`, `catalog/_shared/servarr-download.ts`, `catalog/_shared/servarr-provider.ts`, `catalog/jellyfin/integration.ts`, `catalog/plex/integration.ts`, `catalog/prowlarr/integration.ts`, `catalog/qbittorrent/integration.ts`, `catalog/seerr/integration.ts`, `packages/engine/src/config/schema.ts`, `packages/engine/src/index.ts`, `packages/engine/src/integrations/types.ts`, `packages/engine/src/integrations/wire.ts`, `packages/engine/src/integrations/wiring.ts`, `packages/engine/src/plan/plan.ts`, `scripts/docs/catalog-facts.ts`
- Test: `catalog/_shared/servarr-connection.test.ts`, `catalog/_shared/servarr-download.test.ts`, `catalog/catalog.test.ts`, `catalog/jellyfin/integration.test.ts`, `catalog/plex/integration.test.ts`, `catalog/prowlarr/integration.test.ts`, `catalog/qbittorrent/integration.test.ts`, `catalog/seerr/integration.test.ts`, `packages/engine/src/integrations/overrides.test.ts`, `packages/engine/src/integrations/wiring.test.ts`, `packages/engine/src/plan/plan.test.ts`, `scripts/docs/catalog-facts.test.ts`
- Generated: `catalog/jellyfin/README.md`, `catalog/plex/README.md`, `catalog/prowlarr/README.md`, `catalog/radarr/README.md`, `catalog/seerr/README.md`, `catalog/sonarr/README.md`, `docs/reference/stack-yaml.md`, `docs/reference/stack.schema.json`

**Interfaces:**
- **Consumes:** Task 1's `examine` and `planWiring`; `didYouMean`; S3b's
  `serviceAddress` and `stackAddress`.
- **Produces:**
  - `ResourceSpec.lists?: readonly string[]`, `ResourceSpec.locked?: Readonly<Record<string, string>>`
    (`{resource}` in a reason stands for the address);
  - `DesiredResource.sendsTo?: Fields`: where the resource has its app send a key;
  - from `@mediaplane/engine`: `UNMANAGED` (`'unmanaged'`), `SENDS_A_KEY` (`'it sets
    where a key is sent (spec §11, Slice 6)'`),
    `isUnmanaged(stack: ResolvedStack, address: string): boolean`,
    `withOverrides(spec, address, desired, overrides): DesiredResource`,
    `desiredOf(spec: ResourceSpec, ctx: WiringContext): DesiredResource | undefined`,
    `interface OverrideTarget { def: AppDefinition; spec: ResourceSpec; field: string | undefined }`,
    `overrideTarget(catalog: Catalog, key: string): { ok: true; target: OverrideTarget } | { ok: false; diagnostic: Diagnostic }`,
    `checkOverrides(stack, catalog, wiring: { admin; keys }): Diagnostic[]` (codes
    `overrides.invalid`, `.unknown`, `.secret`, `.unmanaged-field`, `.locked`, `.type`,
    `.unused`);
  - in `integrations/wiring.ts`: `listItems(value): string[]`,
    `sameValue(spec, field, a, b): boolean`;
  - in `catalog/_shared/secret.ts` (and re-exported by `servarr-provider.ts`):
    `sendsToOf(desired): Fields`; `testProvider(api, kind, id, name, credentials, sendsTo)`.

- [ ] **Step 1: Write the failing tests**

**Change** `catalog/_shared/servarr-connection.test.ts`:

```diff
diff --git a/catalog/_shared/servarr-connection.test.ts b/catalog/_shared/servarr-connection.test.ts
index 4a0f0f4..a138517 100644
--- a/catalog/_shared/servarr-connection.test.ts
+++ b/catalog/_shared/servarr-connection.test.ts
@@ -3,2 +3,3 @@ import {
   planWiring,
+  SENDS_A_KEY,
   wire,
@@ -155,3 +156,6 @@ describe("an arr's connection to Jellyfin", () => {
       secrets: { apiKey: JELLYFIN_KEY },
+      sendsTo: { host: 'jellyfin', port: 8096, useSsl: false, urlBase: '' },
     });
+    // Where the arr sends Jellyfin's key: no override changes it.
+    expect(connection.locked).toEqual({ host: SENDS_A_KEY, port: SENDS_A_KEY });
   });
@@ -348,2 +352,32 @@ describe("an arr's connection to Jellyfin, at another address", () => {
   });
+
+  it("sends Jellyfin's key only to the stack's address, whatever an override or the arr holds", async () => {
+    const { api, apis, state } = await sonarr();
+    // An override that got past the lock, or a resource that took one: it moves nothing.
+    const elsewhere = {
+      ...wanted(),
+      fields: { ...wanted().fields, host: 'elsewhere', port: 1 },
+    };
+    await connection.create(api, elsewhere);
+    const at = () =>
+      state.connections[0]?.fields
+        .filter((f) => ['host', 'port', 'useSsl', 'urlBase'].includes(f.name))
+        .map((f) => `${f.name}=${String(f.value)}`);
+    expect(at()).toEqual(['host=jellyfin', 'port=8096', 'useSsl=false', 'urlBase=']);
+    // Changed in the arr by hand: its test is still aimed at the stack's address.
+    const [made] = state.connections;
+    if (made === undefined) throw new Error('no connection made');
+    made.fields = made.fields.map((f) =>
+      f.name === 'urlBase' ? { ...f, value: '@198.51.100.7' } : f,
+    );
+    const held = await connection.observe(api, undefined);
+    if (held === undefined) throw new Error('the connection is there');
+    expect(await connection.verify?.(api, elsewhere, held)).toBe(true);
+    const test = apis.app.requests.find((r) => r.path === '/api/v3/notification/test');
+    expect(test?.body).toContain('"urlBase","value":""');
+    expect(test?.body).not.toContain('198.51.100.7');
+    expect(test?.body).not.toContain('elsewhere');
+    await connection.update(api, elsewhere, held);
+    expect(at()).toEqual(['host=jellyfin', 'port=8096', 'useSsl=false', 'urlBase=']);
+  });
 });
@@ -392,2 +426,3 @@ describe("an arr's connection to Plex", () => {
       secrets: { authToken: TOKEN },
+      sendsTo: { host: 'plex', port: 32400, useSsl: false, urlBase: '' },
     });
```

**Change** `catalog/_shared/servarr-download.test.ts`:

```diff
diff --git a/catalog/_shared/servarr-download.test.ts b/catalog/_shared/servarr-download.test.ts
index e8dba07..ec5615a 100644
--- a/catalog/_shared/servarr-download.test.ts
+++ b/catalog/_shared/servarr-download.test.ts
@@ -3,2 +3,3 @@ import {
   createAppApi,
+  SENDS_A_KEY,
   type ResolvedStack,
@@ -89,2 +90,3 @@ function template() {
       { name: 'useSsl', value: false },
+      { name: 'urlBase' },
       { name: 'apiKey' },
@@ -137,2 +139,9 @@ describe('servarrDownloadClient', () => {
       secrets: { apiKey: QBT_KEY },
+      sendsTo: { host: 'gluetun', port: 8080, useSsl: false, urlBase: '' },
+    });
+    // Where the arr sends qBittorrent's key: no override changes it.
+    expect(client.locked).toMatchObject({
+      host: SENDS_A_KEY,
+      port: SENDS_A_KEY,
+      useSsl: SENDS_A_KEY,
     });
@@ -205,10 +214,5 @@ describe('servarrDownloadClient', () => {
     await client.create(api, desired);
-    // Aimed elsewhere by hand: the app tests a new client as it saves it.
-    const [held] = state.downloadClients;
-    if (held === undefined) throw new Error('no client made');
-    held.fields = held.fields.map((f) =>
-      f.name === 'host' ? { ...f, value: 'nohost' } : f,
-    );
     const observed = await client.observe(api, undefined);
     if (observed === undefined) throw new Error('no client observed');
+    state.testFailure = 'Unable to connect to qBittorrent';
     const failure = await client
@@ -218,3 +222,3 @@ describe('servarrDownloadClient', () => {
     expect((failure as AppApiError).message).toBe(
-      'Sonarr at http://sonarr:8989 (127.0.0.1) tested qBittorrent (Mediaplane), and it failed: Host: Unable to connect to qBittorrent (Name does not resolve (nohost:8080)) (POST /api/v3/downloadclient/test)',
+      'Sonarr at http://sonarr:8989 (127.0.0.1) tested qBittorrent (Mediaplane), and it failed: Host: Unable to connect to qBittorrent (POST /api/v3/downloadclient/test)',
     );
@@ -222,2 +226,43 @@ describe('servarrDownloadClient', () => {
 
+  it("sends qBittorrent's key only to the stack's address, whatever an override or the arr holds", async () => {
+    const { api, app, state } = await sonarr();
+    // An override that got past the lock, or a resource that took one: it moves nothing.
+    const elsewhere = {
+      ...wanted(),
+      fields: { ...wanted().fields, host: 'elsewhere', port: 1, useSsl: true },
+    };
+    await client.create(api, elsewhere);
+    const at = () =>
+      state.downloadClients[0]?.fields
+        .filter((f) => ['host', 'port', 'useSsl', 'urlBase'].includes(f.name))
+        .map((f) => `${f.name}=${String(f.value)}`);
+    expect(at()).toEqual(['host=gluetun', 'port=8080', 'useSsl=false', 'urlBase=']);
+    // Changed in the arr by hand: its test is still aimed at the stack's address.
+    const [held] = state.downloadClients;
+    if (held === undefined) throw new Error('no client made');
+    held.fields = held.fields.map((f) =>
+      f.name === 'host'
+        ? { ...f, value: 'elsewhere' }
+        : f.name === 'urlBase'
+          ? { ...f, value: '@elsewhere' }
+          : f,
+    );
+    const observed = await client.observe(api, undefined);
+    if (observed === undefined) throw new Error('no client observed');
+    expect(await client.verify?.(api, elsewhere, observed)).toBe(true);
+    const test = app.requests.find((r) => r.path === '/api/v3/downloadclient/test');
+    const sent = JSON.parse(test?.body ?? '{}') as {
+      fields: { name: string; value?: unknown }[];
+    };
+    expect(
+      sent.fields
+        .filter((f) => ['host', 'port', 'useSsl', 'urlBase'].includes(f.name))
+        .map((f) => `${f.name}=${String(f.value)}`),
+    ).toEqual(['host=gluetun', 'port=8080', 'useSsl=false', 'urlBase=']);
+    expect(test?.body).not.toContain('elsewhere');
+    // And an update puts the stack's address back.
+    await client.update(api, elsewhere, observed);
+    expect(at()).toEqual(['host=gluetun', 'port=8080', 'useSsl=false', 'urlBase=']);
+  });
+
   it('refuses a template or a client without a setting it needs, naming it, and sends nothing', async () => {
```

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index feb6566..069ab99 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -1,3 +1,3 @@
 import { readdir, readFile } from 'node:fs/promises';
-import { stackJsonSchema } from '@mediaplane/engine';
+import { overrideTarget, SENDS_A_KEY, stackJsonSchema } from '@mediaplane/engine';
 import {
@@ -28,3 +28,44 @@ function comesAfter(id: string, seen = new Set<string>()): string[] {
 
+/**
+ * Every managed field that says where an app sends a key: the stack's keys go only to its
+ * own addresses (spec §11, Slice 6), so none of them can be kept or overridden.
+ */
+const SENDS_KEYS = [
+  ...['sonarr', 'radarr'].flatMap((arr) => [
+    `${arr}.download_client.host`,
+    `${arr}.download_client.port`,
+    `${arr}.download_client.useSsl`,
+    `${arr}.connection_jellyfin.host`,
+    `${arr}.connection_jellyfin.port`,
+    `${arr}.connection_plex.host`,
+    `${arr}.connection_plex.port`,
+    `prowlarr.application_${arr}.baseUrl`,
+    `prowlarr.application_${arr}.prowlarrUrl`,
+    `seerr.server_${arr}.hostname`,
+    `seerr.server_${arr}.port`,
+  ]),
+  'seerr.media_server.hostname',
+  'seerr.media_server.port',
+  'seerr.media_server_plex.hostname',
+  'seerr.media_server_plex.port',
+];
+
 describe('catalog', () => {
+  it("refuses an override of every field that says where a key goes, as Keep mine's", () => {
+    for (const key of SENDS_KEYS) {
+      const named = overrideTarget(catalog, key);
+      expect(named.ok, key).toBe(false);
+      if (named.ok) continue;
+      expect(named.diagnostic).toMatchObject({
+        code: 'overrides.locked',
+        message: `${key} can't be kept: ${SENDS_A_KEY}`,
+      });
+    }
+    // Prowlarr's indexer proxy, which your indexers' requests go through, is fixed too.
+    expect(overrideTarget(catalog, 'prowlarr.indexer_proxy.host')).toMatchObject({
+      ok: false,
+      diagnostic: { code: 'overrides.locked' },
+    });
+  });
+
   it('registers every app folder exactly once, sorted by id', () => {
@@ -190,2 +231,9 @@ apps:
         for (const needed of resource.requires ?? []) expect(addresses).toContain(needed);
+        // What an override can't change, and what is held as a list, are managed fields.
+        for (const field of [
+          ...Object.keys(resource.locked ?? {}),
+          ...(resource.lists ?? []),
+        ]) {
+          expect(resource.fields, `${app.id}.${resource.name}.${field}`).toContain(field);
+        }
       }
```

**Change** `catalog/jellyfin/integration.test.ts`:

```diff
diff --git a/catalog/jellyfin/integration.test.ts b/catalog/jellyfin/integration.test.ts
index 9a8296c..e75cbe2 100644
--- a/catalog/jellyfin/integration.test.ts
+++ b/catalog/jellyfin/integration.test.ts
@@ -525,3 +525,3 @@ describe("Jellyfin's libraries", () => {
 
-  it('puts back its folder, and takes out one added by hand, each once', async () => {
+  it('puts back its folder, and takes out one added by hand, as often as Jellyfin holds it', async () => {
     const { api, state } = await jellyfin(setUp(), true);
@@ -537,11 +537,5 @@ describe("Jellyfin's libraries", () => {
     if (held === undefined) throw new Error('Shows is there');
+    // Jellyfin keeps a path given twice twice, and takes one out at a time: the update
+    // reads them as Jellyfin lists them.
     await shows.update(api, wanted(shows), held);
-    expect(state.libraries[0]?.Locations).toEqual([
-      '/data/media/other',
-      '/data/media/tv',
-    ]);
-    // Jellyfin keeps a path given twice twice, and takes one out at a time.
-    const again = await shows.observe(api, undefined);
-    if (again === undefined) throw new Error('Shows is there');
-    await shows.update(api, wanted(shows), again);
     expect(state.libraries[0]?.Locations).toEqual(['/data/media/tv']);
@@ -549,2 +543,34 @@ describe("Jellyfin's libraries", () => {
 
+  it('removes a folder with a comma in its name, which `paths` cannot tell apart', async () => {
+    const { api, state } = await jellyfin(setUp(), true);
+    state.folders.push('/data/media/tv', '/data/media/a,b');
+    state.libraries.push({
+      Name: 'Shows',
+      CollectionType: 'tvshows',
+      Locations: ['/data/media/tv', '/data/media/a,b'],
+      LibraryOptions: {},
+    });
+    const held = await shows.observe(api, undefined);
+    if (held === undefined) throw new Error('Shows is there');
+    await shows.update(api, wanted(shows), held);
+    expect(state.libraries[0]?.Locations).toEqual(['/data/media/tv']);
+  });
+
+  it('holds the folders an override names, made in one go or added to', async () => {
+    const { api, state } = await jellyfin(setUp(), true);
+    state.folders.push('/data/media/tv', '/data/media/more');
+    const kept = {
+      ...wanted(shows),
+      fields: { ...wanted(shows).fields, paths: '/data/media/more,/data/media/tv' },
+    };
+    await shows.create(api, kept);
+    expect(state.libraries[0]?.Locations).toEqual(['/data/media/more', '/data/media/tv']);
+    // Taken out by hand: the update adds it again.
+    state.libraries[0]?.Locations.splice(0, 1);
+    const held = await shows.observe(api, undefined);
+    if (held === undefined) throw new Error('Shows is there');
+    await shows.update(api, kept, held);
+    expect(state.libraries[0]?.Locations).toEqual(['/data/media/tv', '/data/media/more']);
+  });
+
   it("says Jellyfin can't change what a library of that name holds", async () => {
```

**Change** `catalog/plex/integration.test.ts`:

```diff
diff --git a/catalog/plex/integration.test.ts b/catalog/plex/integration.test.ts
index d1e93f2..c0bca9a 100644
--- a/catalog/plex/integration.test.ts
+++ b/catalog/plex/integration.test.ts
@@ -267,2 +267,23 @@ describe("Plex's libraries", () => {
 
+  it('holds the folders an override names, made in one go and put back', async () => {
+    const { api, plex } = await plexOf();
+    const movies = resource('library_movies');
+    const kept = {
+      ...wanted('library_movies'),
+      fields: {
+        ...wanted('library_movies').fields,
+        location: '/data/more,/data/media/movies',
+      },
+    };
+    await movies.create(api, kept);
+    expect(plex.sections[0]?.locations).toEqual(['/data/more', '/data/media/movies']);
+    const [made] = plex.sections;
+    if (made === undefined) throw new Error('no library made');
+    made.locations = ['/data/media/movies'];
+    const held = await movies.observe(api, undefined);
+    if (held === undefined) throw new Error('the library is there');
+    await movies.update(api, kept, held);
+    expect(plex.sections[0]?.locations).toEqual(['/data/more', '/data/media/movies']);
+  });
+
   it("refuses to change what a library holds, which Plex can't, saying what to do", async () => {
```

**Change** `catalog/prowlarr/integration.test.ts`:

```diff
diff --git a/catalog/prowlarr/integration.test.ts b/catalog/prowlarr/integration.test.ts
index 9a7cb9a..768cfdf 100644
--- a/catalog/prowlarr/integration.test.ts
+++ b/catalog/prowlarr/integration.test.ts
@@ -4,2 +4,3 @@ import {
   planWiring,
+  SENDS_A_KEY,
   type ResolvedStack,
@@ -128,3 +129,6 @@ describe('a link to Sonarr or Radarr', () => {
       secrets: { apiKey: SONARR_KEY },
+      sendsTo: { prowlarrUrl: 'http://prowlarr:9696', baseUrl: 'http://sonarr:8989' },
     });
+    // Where Prowlarr sends the arr's key, and the arr Prowlarr's: no override changes it.
+    expect(toSonarr.locked).toEqual({ prowlarrUrl: SENDS_A_KEY, baseUrl: SENDS_A_KEY });
     expect(wanted(resource('application_radarr'))).toMatchObject({
@@ -211,13 +215,8 @@ apps:
   it("says Prowlarr's own words when its test fails for another reason", async () => {
-    const { api, state } = await prowlarr();
+    const { api, apps } = await prowlarr();
     const desired = wanted(toSonarr);
     await toSonarr.create(api, desired);
-    // Aimed elsewhere by hand: Prowlarr tests a new link as it saves it.
-    const [held] = state.applications;
-    if (held === undefined) throw new Error('no link made');
-    held.fields = held.fields.map((f) =>
-      f.name === 'baseUrl' ? { ...f, value: 'http://nowhere:8989' } : f,
-    );
     const observed = await toSonarr.observe(api, undefined);
     if (observed === undefined) throw new Error('no link observed');
+    apps.set('sonarr', { ...freshAppState(), key: SONARR_KEY, up: false });
     const failure = await toSonarr
@@ -227,3 +226,3 @@ apps:
     expect((failure as AppApiError).message).toBe(
-      'Prowlarr at http://prowlarr:9696 (127.0.0.1) tested Sonarr (Mediaplane), and it failed: BaseUrl: Unable to complete application test, cannot connect to Sonarr. Resource temporarily unavailable (nowhere:8989) (POST /api/v1/applications/test)',
+      'Prowlarr at http://prowlarr:9696 (127.0.0.1) tested Sonarr (Mediaplane), and it failed: BaseUrl: Unable to complete application test, cannot connect to Sonarr. Resource temporarily unavailable (sonarr:8989) (POST /api/v1/applications/test)',
     );
@@ -231,2 +230,41 @@ apps:
 
+  it("sends the arr's key, and Prowlarr's, only to the stack's addresses, whatever an override or Prowlarr holds", async () => {
+    const { api, app, state } = await prowlarr();
+    // An override that got past the lock, or a resource that took one: it moves nothing.
+    const elsewhere = {
+      ...wanted(toSonarr),
+      fields: {
+        ...wanted(toSonarr).fields,
+        baseUrl: 'http://elsewhere:8989',
+        prowlarrUrl: 'http://elsewhere:9696',
+      },
+    };
+    await toSonarr.create(api, elsewhere);
+    const urls = () =>
+      state.applications[0]?.fields
+        .filter((f) => ['baseUrl', 'prowlarrUrl'].includes(f.name))
+        .map((f) => `${f.name}=${String(f.value)}`);
+    expect(urls()).toEqual([
+      'prowlarrUrl=http://prowlarr:9696',
+      'baseUrl=http://sonarr:8989',
+    ]);
+    // Changed in Prowlarr by hand: its test is still aimed at the stack's addresses.
+    const [held] = state.applications;
+    if (held === undefined) throw new Error('no link made');
+    held.fields = held.fields.map((f) =>
+      f.name === 'baseUrl' ? { ...f, value: 'http://elsewhere:8989' } : f,
+    );
+    const observed = await toSonarr.observe(api, undefined);
+    if (observed === undefined) throw new Error('no link observed');
+    expect(await toSonarr.verify?.(api, elsewhere, observed)).toBe(true);
+    const test = app.requests.find((r) => r.path === '/api/v1/applications/test');
+    expect(test?.body).toContain('"baseUrl","value":"http://sonarr:8989"');
+    expect(test?.body).not.toContain('elsewhere');
+    await toSonarr.update(api, elsewhere, observed);
+    expect(urls()).toEqual([
+      'prowlarrUrl=http://prowlarr:9696',
+      'baseUrl=http://sonarr:8989',
+    ]);
+  });
+
   it('is tested by plan only once the arr is up and takes its key, and plan never tests the proxy or writes to Prowlarr', async () => {
@@ -377,3 +415,6 @@ describe('the indexer proxy', () => {
       secrets: {},
+      sendsTo: { host: 'http://byparr:8191/' },
     });
+    // Prowlarr sends your indexers' requests through it: no override changes it.
+    expect(Object.keys(proxy.locked ?? {})).toEqual(['host']);
     expect(wanted(proxy, contextOf(stack('  flaresolverr: {}\n'))).fields.host).toBe(
@@ -424,2 +465,33 @@ describe('the indexer proxy', () => {
   });
+
+  it('gives the proxy the tags an override names, finding or making each by its label', async () => {
+    const { api, state } = await prowlarr();
+    state.tags.push({ id: 1, label: 'other' });
+    const kept = {
+      ...wanted(proxy),
+      fields: { ...wanted(proxy).fields, tags: 'cloudflare,other' },
+    };
+    await proxy.create(api, kept);
+    expect(state.tags).toEqual([
+      { id: 1, label: 'other' },
+      { id: 2, label: 'cloudflare' },
+    ]);
+    expect(state.proxies[0]?.tags).toEqual([2, 1]);
+    expect((await proxy.observe(api, undefined))?.fields.tags).toBe('cloudflare,other');
+  });
+
+  it("sends your indexers' requests only to the stack's solver, whatever an override says", async () => {
+    const { api, state } = await prowlarr();
+    const elsewhere = {
+      ...wanted(proxy),
+      fields: { ...wanted(proxy).fields, host: 'http://elsewhere:8191/' },
+    };
+    await proxy.create(api, elsewhere);
+    const host = () => state.proxies[0]?.fields.find((f) => f.name === 'host')?.value;
+    expect(host()).toBe('http://byparr:8191/');
+    const observed = await proxy.observe(api, undefined);
+    if (observed === undefined) throw new Error('no proxy observed');
+    await proxy.update(api, elsewhere, observed);
+    expect(host()).toBe('http://byparr:8191/');
+  });
 });
```

**Change** `catalog/qbittorrent/integration.test.ts`:

```diff
diff --git a/catalog/qbittorrent/integration.test.ts b/catalog/qbittorrent/integration.test.ts
index 177320c..a226503 100644
--- a/catalog/qbittorrent/integration.test.ts
+++ b/catalog/qbittorrent/integration.test.ts
@@ -268,2 +268,33 @@ apps:
 
+    it("wants the category Sonarr's download client is kept with, so that apply makes it, never the arr's test", async () => {
+      const kept = stack('overrides:\n  sonarr.download_client.category: television\n');
+      const desired = tv.desired(contextOf(kept));
+      expect(desired).toEqual({
+        name: 'television',
+        fields: { savePath: '/data/torrents/television' },
+        secrets: {},
+      });
+      if (desired === undefined) throw new Error('the tv category is wanted');
+      // Found by that name, and made under it; the category tv stays as it is, yours.
+      const { api, state } = await qbittorrent({
+        categories: { tv: '/data/torrents/tv' },
+      });
+      expect(await tv.observe(api, undefined, desired)).toBeUndefined();
+      expect(await tv.create(api, desired)).toEqual({ id: 'television' });
+      expect(state.categories).toEqual({
+        tv: '/data/torrents/tv',
+        television: '/data/torrents/television',
+      });
+      expect(await tv.observe(api, undefined, desired)).toEqual({
+        id: 'television',
+        name: 'television',
+        fields: { savePath: '/data/torrents/television' },
+      });
+      // Once the client is no longer Mediaplane's, the category is tv again.
+      const unmanaged = stack(
+        'overrides:\n  sonarr.download_client: unmanaged\n  sonarr.download_client.category: television\n',
+      );
+      expect(tv.desired(contextOf(unmanaged))?.name).toBe('tv');
+    });
+
     it("says qBittorrent's own words when it refuses", async () => {
```

**Change** `catalog/seerr/integration.test.ts`:

```diff
diff --git a/catalog/seerr/integration.test.ts b/catalog/seerr/integration.test.ts
index d593449..fba0f74 100644
--- a/catalog/seerr/integration.test.ts
+++ b/catalog/seerr/integration.test.ts
@@ -3,2 +3,3 @@ import {
   createAppApi,
+  SENDS_A_KEY,
   type DesiredResource,
@@ -175,3 +176,6 @@ describe("Seerr's media server, with Plex", () => {
       secrets: {},
+      sendsTo: { ip: 'plex', port: 32400, useSsl: false },
     });
+    // Where Seerr sends its admin's Plex token: no override changes it.
+    expect(spec.locked).toEqual({ hostname: SENDS_A_KEY, port: SENDS_A_KEY });
     expect(spec.desired(contextOf())).toBeUndefined();
@@ -195,2 +199,11 @@ describe("Seerr's media server, with Plex", () => {
     expect(state.seerr.plex).toMatchObject({ ip: 'plex', port: 32400, useSsl: false });
+    // An override that got past the lock, or a resource that took one: it moves nothing.
+    const elsewhere = {
+      ...desired,
+      fields: { ...desired.fields, hostname: 'elsewhere', port: 1 },
+    };
+    const held = await spec.observe(api, undefined, desired);
+    if (held === undefined) throw new Error('Seerr holds a Plex');
+    await spec.update(api, elsewhere, held);
+    expect(state.seerr.plex).toMatchObject({ ip: 'plex', port: 32400, useSsl: false });
     expect(await spec.observe(api, undefined, desired)).toEqual({
@@ -276,3 +289,6 @@ describe("Seerr's media server", () => {
       secrets: { apiKey: JELLYFIN_KEY },
+      sendsTo: { ip: 'jellyfin', port: 8096, useSsl: false, urlBase: '' },
     });
+    // Where Seerr sends the key it holds for Jellyfin: no override changes it.
+    expect(spec.locked).toEqual({ hostname: SENDS_A_KEY, port: SENDS_A_KEY });
     // Its first sign-in set Jellyfin, with a key of Seerr's own, and no library yet.
@@ -304,2 +320,26 @@ describe("Seerr's media server", () => {
 
+  it('enables only the libraries an override names, and leaves the others to you', async () => {
+    const { api, state } = await seerr();
+    const kept = {
+      ...wanted(spec),
+      fields: { ...wanted(spec).fields, libraries: 'Movies' },
+    };
+    const observed = await spec.observe(api, undefined, kept);
+    if (observed === undefined) throw new Error('observed');
+    await spec.update(api, kept, observed);
+    const enabled = () =>
+      state.seerr.jellyfin.libraries.filter((l) => l.enabled).map((l) => l.name);
+    expect(enabled()).toEqual(['Movies']);
+    // Shows turned on by you: not Mediaplane's to look at, or to turn off.
+    const shows = state.seerr.jellyfin.libraries.find((l) => l.name === 'Shows');
+    if (shows === undefined) throw new Error('Shows was synced');
+    shows.enabled = true;
+    expect((await spec.observe(api, undefined, kept))?.fields.libraries).toBe('Movies');
+  });
+
+  it("doesn't have Seerr enable a library Mediaplane no longer manages in Jellyfin", () => {
+    const ctx = contextOf(`${STACK}overrides:\n  jellyfin.library_shows: unmanaged\n`);
+    expect(spec.desired(ctx)?.fields.libraries).toBe('Movies');
+  });
+
   it('reads a link held without the Jellyfin server id Seerr sets when it saves one as not linked, and links it again', async () => {
@@ -363,2 +403,34 @@ describe("Seerr's media server", () => {
 
+  it("sends Mediaplane's Jellyfin key only to the stack's Jellyfin, whatever an override says, and asks Seerr's users only there", async () => {
+    const { api, apis, state } = await seerr();
+    // An override that got past the lock, or a resource that took one: it moves nothing.
+    const elsewhere = {
+      ...wanted(spec),
+      fields: { ...wanted(spec).fields, hostname: 'elsewhere', port: 4444 },
+    };
+    const before = apis.app.requests.length;
+    await spec.create(api, elsewhere);
+    const carrying = apis.app.requests
+      .slice(before)
+      .filter((r) => r.body.includes(JELLYFIN_KEY));
+    expect(carrying).toHaveLength(1);
+    expect(JSON.parse(carrying[0]?.body ?? '{}')).toMatchObject({
+      ip: 'jellyfin',
+      port: 8096,
+    });
+    expect(state.seerr.jellyfin).toMatchObject({ ip: 'jellyfin', port: 8096 });
+    // Held elsewhere: Seerr would send the key it holds there, so it isn't asked.
+    state.seerr.jellyfin.ip = 'elsewhere';
+    const observed = await spec.observe(api, undefined, elsewhere);
+    if (observed === undefined) throw new Error('observed');
+    const asked = apis.app.requests.length;
+    expect(await spec.verify?.(api, elsewhere, observed)).toEqual({
+      unchecked:
+        "Seerr holds another address for Jellyfin than the stack's, where it would send the key it holds: apply gives it the stack's",
+    });
+    expect(
+      apis.app.requests.slice(asked).some((r) => r.path.endsWith('/jellyfin/users')),
+    ).toBe(false);
+  });
+
   it.each([
@@ -455,3 +527,6 @@ describe.each([
       secrets: { apiKey: key },
+      sendsTo: { hostname: arr, port, useSsl: false, baseUrl: '' },
     });
+    // Where Seerr sends the arr's key: no override changes it.
+    expect(spec.locked).toEqual({ hostname: SENDS_A_KEY, port: SENDS_A_KEY });
     const ctx = contextOf();
@@ -592,2 +667,29 @@ describe.each([
 
+  it("never sends the stack's key to a host an override names, in a test, a create or an update", async () => {
+    const { api, apis, state } = await seerr();
+    const resolved =
+      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
+    // An override that got past the lock, or a resource that took one: it moves nothing.
+    const elsewhere = {
+      ...resolved,
+      fields: { ...resolved.fields, hostname: 'elsewhere', port: 4444 },
+    };
+    const before = apis.app.requests.length;
+    expect(
+      (await spec.resolve?.(api, elsewhere, contextOf()))?.fields.activeProfile,
+    ).toBe('HD-1080p');
+    await spec.create(api, elsewhere);
+    const observed = await spec.observe(api, undefined, elsewhere);
+    if (observed === undefined) throw new Error('observed');
+    expect(await spec.verify?.(api, elsewhere, observed)).toBe(true);
+    await spec.update(api, elsewhere, observed);
+    const carrying = apis.app.requests
+      .slice(before)
+      .filter((r) => r.body.includes(key))
+      .map((r) => JSON.parse(r.body) as Record<string, unknown>);
+    expect(carrying.length).toBeGreaterThanOrEqual(3);
+    for (const body of carrying) expect(body).toMatchObject({ hostname: arr, port });
+    expect(state.seerr[arr][0]).toMatchObject({ hostname: arr, port });
+  });
+
   it("sends the stack's key with no URL base, whatever base Seerr holds for the server", async () => {
@@ -662,2 +764,15 @@ describe.each([
 
+  it('keeps it out of default when an override says so', async () => {
+    const { api, state } = await seerr();
+    const desired =
+      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
+    const kept = { ...desired, fields: { ...desired.fields, isDefault: false } };
+    await spec.create(api, kept);
+    expect(state.seerr[arr][0]?.isDefault).toBe(false);
+    const observed = await spec.observe(api, undefined, kept);
+    if (observed === undefined) throw new Error('observed');
+    await spec.update(api, kept, observed);
+    expect(state.seerr[arr][0]?.isDefault).toBe(false);
+  });
+
   it('puts back what was changed by hand: its profile, folder and default', async () => {
```

**Create** `packages/engine/src/integrations/overrides.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../catalog/types';
import { FAKE_LOGIN, WIRED_CATALOG, WIRING_STACK, wiringStack } from '../testing/wiring';
import {
  checkOverrides,
  desiredOf,
  isUnmanaged,
  overrideTarget,
  withOverrides,
} from './overrides';
import type { ResourceSpec, WiringContext } from './types';

/** Sonarr's login, with a field Mediaplane only checks, and one held as a list. */
const LOGIN: ResourceSpec = {
  ...FAKE_LOGIN,
  fields: ['user', 'groups', 'enabled'],
  lists: ['groups'],
  locked: { enabled: 'Sonarr keeps {resource} on' },
  desired: (ctx) => ({
    name: 'login',
    fields: { user: ctx.admin.username, groups: 'admins', enabled: true },
    secrets: { password: ctx.admin.password },
  }),
};

/** A Plex-shaped connection of Sonarr's, which a Jellyfin stack doesn't want. */
const PLEX_ONLY: ResourceSpec = {
  ...FAKE_LOGIN,
  name: 'connection_plex',
  desired: () => undefined,
};

const CATALOG: Catalog = WIRED_CATALOG.map((def) =>
  def.id === 'sonarr'
    ? { ...def, integration: { after: [], resources: [LOGIN, PLEX_ONLY] } }
    : def,
);

const ADMIN = { username: 'admin', password: 'fake-admin-password' };

/** WIRING_STACK with `overrides`, given as YAML lines. */
function stackWith(...overrides: string[]) {
  return wiringStack(
    CATALOG,
    `${WIRING_STACK}overrides:\n${overrides.map((line) => `  ${line}`).join('\n')}\n`,
  );
}

function contextOf(stack: ReturnType<typeof stackWith>): WiringContext {
  const app = stack.apps.find((a) => a.def.id === 'sonarr');
  if (app === undefined) throw new Error('no sonarr');
  return { stack, app, admin: ADMIN, keys: {} };
}

describe('desiredOf', () => {
  it("is the resource's desired(), with the overrides of its fields: Keep mine's values", () => {
    const stack = stackWith('sonarr.login.user: someone', 'sonarr.login.groups: a,b');
    expect(desiredOf(LOGIN, contextOf(stack))).toEqual({
      name: 'login',
      fields: { user: 'someone', groups: 'a,b', enabled: true },
      secrets: { password: ADMIN.password },
    });
  });

  it('leaves a locked field as the resource wants it, and wants nothing it no longer manages', () => {
    const locked = stackWith('sonarr.login.enabled: false');
    expect(desiredOf(LOGIN, contextOf(locked))?.fields.enabled).toBe(true);
    const unmanaged = stackWith('sonarr.login: unmanaged');
    expect(isUnmanaged(unmanaged, 'sonarr.login')).toBe(true);
    expect(desiredOf(LOGIN, contextOf(unmanaged))).toBeUndefined();
  });

  it('gives back what it is given when no override names the resource', () => {
    const desired = { name: 'login', fields: { user: 'admin' }, secrets: {} };
    expect(
      withOverrides(LOGIN, 'sonarr.login', desired, { 'radarr.login.user': 'x' }),
    ).toBe(desired);
  });
});

describe('overrideTarget', () => {
  it('names the resource and field a key names', () => {
    const named = overrideTarget(CATALOG, 'sonarr.login.user');
    expect(
      named.ok && [named.target.def.id, named.target.spec.name, named.target.field],
    ).toEqual(['sonarr', 'login', 'user']);
    const whole = overrideTarget(CATALOG, 'sonarr.login');
    expect(whole.ok && whole.target.field).toBeUndefined();
  });

  it('says what a key names that Mediaplane does not manage, with the closest name', () => {
    const said = (key: string) => {
      const named = overrideTarget(CATALOG, key);
      return named.ok ? 'ok' : named.diagnostic;
    };
    expect(said('sonar.login.user')).toEqual({
      severity: 'error',
      code: 'overrides.unknown',
      message: '"sonar.login.user" names no app: there is no sonar',
      path: 'overrides.sonar.login.user',
      hint: 'did you mean "sonarr"?',
    });
    expect(said('sonarr.logon.user')).toMatchObject({
      code: 'overrides.unknown',
      message:
        '"sonarr.logon.user" names nothing Mediaplane manages in sonarr: it has no logon',
      hint: 'did you mean "login"?',
    });
    expect(said('gluetun.login.user')).toMatchObject({
      code: 'overrides.unknown',
      hint: "gluetun's README lists what Mediaplane manages there",
    });
    // Field names are case-sensitive, as the apps' are: the closest is the hint.
    expect(said('sonarr.login.User')).toMatchObject({
      code: 'overrides.unmanaged-field',
      message:
        "sonarr.login.User is not a field Mediaplane manages: sonarr.login's are user, groups, enabled",
      hint: 'did you mean "user"?',
    });
    expect(said('sonarr.login.priority')).toMatchObject({
      code: 'overrides.unmanaged-field',
      hint: "the others are yours already; sonarr's README lists the managed ones",
    });
    expect(said('sonarr')).toMatchObject({ code: 'overrides.invalid' });
    expect(said('sonarr.login.user.more')).toMatchObject({ code: 'overrides.invalid' });
  });

  it('refuses a secret, and a locked field with why', () => {
    const said = (key: string) => {
      const named = overrideTarget(CATALOG, key);
      return named.ok ? 'ok' : named.diagnostic;
    };
    expect(said('sonarr.login.password')).toMatchObject({
      code: 'overrides.secret',
      message:
        "sonarr.login.password is a secret: Mediaplane checks it with sonarr's own check, and never keeps it",
    });
    expect(said('sonarr.login.enabled')).toMatchObject({
      code: 'overrides.locked',
      message: "sonarr.login.enabled can't be kept: Sonarr keeps sonarr.login on",
    });
  });
});

describe('checkOverrides', () => {
  const check = (...lines: string[]) =>
    checkOverrides(stackWith(...lines), CATALOG, { admin: ADMIN, keys: {} });

  it('takes overrides of the fields Mediaplane manages, and unmanaged resources, wanted or left', () => {
    expect(
      check(
        'sonarr.login.user: someone',
        'sonarr.login.groups: a,b',
        'sonarr.connection_plex: unmanaged',
      ),
    ).toEqual([]);
    expect(check('sonarr.login: unmanaged')).toEqual([]);
    // A field of what the stack doesn't want does nothing.
    expect(check('sonarr.connection_plex.user: someone')).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'overrides.unused',
        message:
          "sonarr.connection_plex.user does nothing: Mediaplane doesn't make sonarr.connection_plex in this stack",
      }),
    ]);
  });

  it('warns of an override of a field of a resource made unmanaged: it does nothing', () => {
    expect(check('sonarr.login: unmanaged', 'sonarr.login.user: someone')).toEqual([
      {
        severity: 'warning',
        code: 'overrides.unused',
        message:
          'sonarr.login.user does nothing: sonarr.login is unmanaged, so Mediaplane neither looks at it nor sets it',
        path: 'overrides.sonarr.login.user',
      },
    ]);
  });

  it('refuses a value of another type than the field, and a resource set to anything but unmanaged', () => {
    expect(check('sonarr.login.user: 7', 'sonarr.login: kept')).toEqual([
      {
        severity: 'error',
        code: 'overrides.type',
        message: 'sonarr.login.user must be text, as sonarr holds it, not a number',
        path: 'overrides.sonarr.login.user',
      },
      {
        severity: 'error',
        code: 'overrides.invalid',
        message:
          'sonarr.login takes only "unmanaged", to stop Mediaplane managing it; a field goes after it, as sonarr.login.<field>',
        path: 'overrides.sonarr.login',
      },
    ]);
    expect(check('sonarr.login.groups: true')).toEqual([
      expect.objectContaining({
        message:
          'sonarr.login.groups must be text, as sonarr holds it, not true or false',
      }),
    ]);
  });

  it("warns of an override for an app the stack doesn't have, and passes on what overrideTarget refuses", () => {
    const radarr = stackWith('sonarr.login.user: someone');
    const withoutSonarr = {
      ...radarr,
      apps: radarr.apps.filter((app) => app.def.id !== 'sonarr'),
    };
    expect(checkOverrides(withoutSonarr, CATALOG, { admin: ADMIN, keys: {} })).toEqual([
      expect.objectContaining({
        code: 'overrides.unused',
        message: 'sonarr.login.user does nothing: the stack has no sonarr',
      }),
    ]);
    expect(check('sonarr.login.password: x')).toEqual([
      expect.objectContaining({ code: 'overrides.secret' }),
    ]);
  });
});
```

**Change** `packages/engine/src/integrations/wiring.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.test.ts b/packages/engine/src/integrations/wiring.test.ts
index 43fc8fa..6e62424 100644
--- a/packages/engine/src/integrations/wiring.test.ts
+++ b/packages/engine/src/integrations/wiring.test.ts
@@ -15,2 +15,3 @@ import {
   WIRING_RUNNING as RUNNING,
+  WIRING_STACK,
   wiringStack as stackOf,
@@ -68,4 +69,7 @@ const RECORDED: KnownResources = {
 
-/** WIRED_CATALOG, with Sonarr's resources replaced by `resources`. */
-function sonarrWith(resources: ResourceSpec[]) {
+/**
+ * WIRED_CATALOG's stack, with Sonarr's resources replaced by `resources`, and the
+ * stack's overrides (spec §4.2) given, one line each.
+ */
+function sonarrWith(resources: ResourceSpec[], ...overrides: string[]) {
   return stackOf(
@@ -74,2 +78,5 @@ function sonarrWith(resources: ResourceSpec[]) {
     ),
+    overrides.length === 0
+      ? undefined
+      : `${WIRING_STACK}overrides:\n${overrides.map((line) => `  ${line}`).join('\n')}\n`,
   );
@@ -210,3 +217,4 @@ describe('planWiring', () => {
         id: null,
-        name: 'first',
+        // As the wire step records it: the name desired() gives.
+        name: 'login',
         fields: { user: 'admin' },
@@ -1078,2 +1086,22 @@ describe('planWiring: drift (spec §6.3)', () => {
 
+  it('finds no drift against a record of another name than the stack now wants: that is its own change', async () => {
+    // qBittorrent's category, once Sonarr's is kept as another: the stack wants another.
+    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
+    const before = {
+      'sonarr.login': { ...RECORDED['sonarr.login'], name: 'before' },
+    } as KnownResources;
+    const planned = await planWiring(options(sonarr, { known: before }));
+    expect(planned.changes).toEqual([
+      { resource: 'sonarr.login', action: 'update', changes: ['user'] },
+    ]);
+    expect(planned.drift).toEqual([]);
+    sonarr.state.user = 'admin';
+    // Not recorded under the name it now has: adopted.
+    expect((await planWiring(options(sonarr, { known: before }))).changes).toEqual([
+      { resource: 'sonarr.login', action: 'adopt' },
+    ]);
+    const missing = await fakeSonarr({ key: KEY });
+    expect((await planWiring(options(missing, { known: before }))).drift).toEqual([]);
+  });
+
   it('says a resource it applied was deleted outside Mediaplane', async () => {
@@ -1289 +1317,64 @@ describe('planWiring: drift (spec §6.3)', () => {
 });
+
+describe('planWiring: overrides (spec §4.2, §6.3)', () => {
+  it("wants the override's value, so that what the app holds now matches", async () => {
+    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
+    const planned = await planWiring(
+      options(sonarr, {
+        stack: sonarrWith([FAKE_LOGIN], 'sonarr.login.user: someone'),
+        known: RECORDED,
+      }),
+    );
+    // Applied as "admin": what the app holds is what the stack now wants, so no drift.
+    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'adopt' }]);
+    expect(planned.drift).toEqual([]);
+  });
+
+  it('lists nothing for a resource it no longer manages, and asks nothing of it', async () => {
+    const sonarr = await fakeSonarr({ key: KEY });
+    const planned = await planWiring(
+      options(sonarr, { stack: sonarrWith([FAKE_LOGIN], 'sonarr.login: unmanaged') }),
+    );
+    expect(planned.changes).toEqual([{ resource: 'sonarr', action: 'unchanged' }]);
+    expect(sonarr.app.requests.map((r) => r.path)).toEqual([
+      '/ping',
+      '/api/v3/system/status',
+    ]);
+  });
+
+  it('keeps the override over what only the app can say', async () => {
+    const resolved: ResourceSpec = {
+      ...FAKE_LOGIN,
+      resolve: (_api, desired) =>
+        Promise.resolve({ ...desired, fields: { ...desired.fields, user: 'chosen' } }),
+    };
+    const sonarr = await fakeSonarr({ key: KEY, user: 'kept', password: PASSWORD });
+    const planned = await planWiring(
+      options(sonarr, {
+        stack: sonarrWith([resolved], 'sonarr.login.user: kept'),
+        known: {
+          'sonarr.login': { ...RECORDED['sonarr.login'], fields: { user: 'kept' } },
+        } as KnownResources,
+      }),
+    );
+    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
+  });
+
+  it('compares a list as a set, whatever its order', async () => {
+    const listed: ResourceSpec = {
+      ...FAKE_LOGIN,
+      lists: ['user'],
+      observe: () =>
+        Promise.resolve({ id: null, name: 'login', fields: { user: 'b,a' } }),
+    };
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const known = {
+      'sonarr.login': { ...RECORDED['sonarr.login'], fields: { user: 'a,b' } },
+    } as KnownResources;
+    const planned = await planWiring(
+      options(sonarr, { stack: sonarrWith([listed], 'sonarr.login.user: a,b'), known }),
+    );
+    expect(planned.changes).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
+    expect(planned.drift).toEqual([]);
+  });
+});
```

**Change** `packages/engine/src/plan/plan.test.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.test.ts b/packages/engine/src/plan/plan.test.ts
index 7b05d5f..c8e9b46 100644
--- a/packages/engine/src/plan/plan.test.ts
+++ b/packages/engine/src/plan/plan.test.ts
@@ -998,2 +998,20 @@ describe('plan: the wiring', () => {
 
+  it('fails, before it asks any app, on an override that names nothing it manages', async () => {
+    const sonarr = await fakeSonarr();
+    const home = await makeHome({
+      stack: `${STACK}overrides:\n  sonarr.login.usr: fake-value\n`,
+    });
+    const result = await planFor(home, { catalog: WIRED_CATALOG, wiring: sonarr.seams });
+    expect(result.ok).toBe(false);
+    expect(result.diagnostics).toContainEqual(
+      expect.objectContaining({
+        severity: 'error',
+        code: 'overrides.unmanaged-field',
+        path: 'overrides.sonarr.login.usr',
+        hint: 'did you mean "user"?',
+      }),
+    );
+    expect(sonarr.app.requests).toEqual([]);
+  });
+
   it('checks the wiring after the start on a first plan, asking no app', async () => {
```

**Change** `scripts/docs/catalog-facts.test.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.test.ts b/scripts/docs/catalog-facts.test.ts
index e0b00c1..0bd5a0e 100644
--- a/scripts/docs/catalog-facts.test.ts
+++ b/scripts/docs/catalog-facts.test.ts
@@ -80,2 +80,8 @@ describe('renderFacts', () => {
 
+  it("marks a managed field an override can't change as fixed", () => {
+    expect(renderFacts(app('sonarr'))).toContain(
+      '`sonarr.root_folder`: fields `sonarr.root_folder.path` (fixed)',
+    );
+  });
+
   it('shows what an app turns on with its default settings', () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog/_shared/servarr-connection.test.ts catalog/_shared/servarr-download.test.ts catalog/catalog.test.ts catalog/jellyfin/integration.test.ts catalog/plex/integration.test.ts catalog/prowlarr/integration.test.ts catalog/qbittorrent/integration.test.ts catalog/seerr/integration.test.ts packages/engine/src/integrations/overrides.test.ts packages/engine/src/integrations/wiring.test.ts packages/engine/src/plan/plan.test.ts scripts/docs/catalog-facts.test.ts`
Expected: FAIL. `overrides.test.ts` doesn't load (`Cannot find module './overrides'`), and 35 tests fail, 387 pass: 12 in Seerr's (every library enabled, `isDefault` always true, no `sendsTo`, a key sent to a host an override names), 5 in Prowlarr's (the proxy's tags are `cloudflare`; no `sendsTo`, nor fixed URLs), 5 in `wiring.test.ts` (overrides ignored; a record of another name read as drift), 3 in the connection's and 2 in the download client's (no `sendsTo` nor fixed host; a key sent where an override says), 3 in Jellyfin's and 1 in Plex's (a library's folders are the one Mediaplane gives it; a folder with a comma in its name fails the update), and 1 each in `catalog.test.ts` (no field is fixed where a key goes), qBittorrent's (its category doesn't follow the one Sonarr's client is kept with), `plan.test.ts` and `catalog-facts.test.ts` (no `(fixed)`).

- [ ] **Step 3: Write the overrides, the fixed fields, the destinations and the catalog's use of them**

**Change** `catalog/_shared/secret.ts`:

```diff
diff --git a/catalog/_shared/secret.ts b/catalog/_shared/secret.ts
index 4a21c30..4ab50c2 100644
--- a/catalog/_shared/secret.ts
+++ b/catalog/_shared/secret.ts
@@ -1,2 +1,2 @@
-import type { DesiredResource } from '@mediaplane/engine';
+import type { DesiredResource, Fields } from '@mediaplane/engine';
 
@@ -12 +12,12 @@ export function secretOf(desired: DesiredResource, name: string): string {
 }
+
+/**
+ * Where `desired` has its app send a key: its `sendsTo`, the stack's own address for the
+ * other app, which desired() gives every resource that holds one.
+ */
+export function sendsToOf(desired: DesiredResource): Fields {
+  if (desired.sendsTo === undefined) {
+    throw new Error(`${desired.name} says nowhere to send its key`);
+  }
+  return desired.sendsTo;
+}
```

**Change** `catalog/_shared/servarr-connection.ts`:

```diff
diff --git a/catalog/_shared/servarr-connection.ts b/catalog/_shared/servarr-connection.ts
index 0c8f2b2..7b91dcd 100644
--- a/catalog/_shared/servarr-connection.ts
+++ b/catalog/_shared/servarr-connection.ts
@@ -1,2 +1,3 @@
 import {
+  SENDS_A_KEY,
   serviceAddress,
@@ -9,2 +10,3 @@ import {
   secretOf,
+  sendsToOf,
   servarrProvider,
@@ -94,2 +96,4 @@ function heldHost(held: Provider): string {
  *   the arr's test of what it holds sends the key it holds only to the stack's address.
+ *   The host and port are fixed (SENDS_A_KEY), and every create, update and test is sent
+ *   to the stack's address (`sendsTo`), whatever an override or the arr holds.
  * - It is made from the arr's own template, with `triggers` on: what makes the arr tell
@@ -110,6 +114,4 @@ function servarrMediaServer(
   const settingsOf = (desired: DesiredResource): Record<string, unknown> => ({
-    host: desired.fields.host,
-    port: desired.fields.port,
-    useSsl: false,
-    urlBase: '',
+    // Where the arr sends the media server's key: the stack's own address for it.
+    ...sendsToOf(desired),
     updateLibrary: desired.fields.updateLibrary,
@@ -121,2 +123,3 @@ function servarrMediaServer(
     fields: ['host', 'port', 'updateLibrary'],
+    locked: { host: SENDS_A_KEY, port: SENDS_A_KEY },
     secrets: [server.keyField],
@@ -136,2 +139,3 @@ function servarrMediaServer(
         secrets: key === undefined ? {} : { [server.keyField]: key },
+        sendsTo: { host: at.host, port: at.port, useSsl: false, urlBase: '' },
       };
```

**Change** `catalog/_shared/servarr-download.ts`:

```diff
diff --git a/catalog/_shared/servarr-download.ts b/catalog/_shared/servarr-download.ts
index d150d16..d03b84c 100644
--- a/catalog/_shared/servarr-download.ts
+++ b/catalog/_shared/servarr-download.ts
@@ -1,2 +1,3 @@
 import {
+  SENDS_A_KEY,
   serviceAddress,
@@ -10,2 +11,3 @@ import {
   secretOf,
+  sendsToOf,
   servarrProvider,
@@ -58,3 +60,4 @@ function fieldsOf(held: Provider, link: DownloadLink): Fields {
  * The desired settings, with qBittorrent's key in clear: the one place one app's key goes
- * to another, in a request body.
+ * to another, in a request body, with where the arr sends it, the stack's own address for
+ * qBittorrent (`sendsTo`).
  */
@@ -65,5 +68,3 @@ function settingsOf(
   return {
-    host: desired.fields.host,
-    port: desired.fields.port,
-    useSsl: desired.fields.useSsl,
+    ...sendsToOf(desired),
     [link.setting]: desired.fields.category,
@@ -83,3 +84,6 @@ function topOf(desired: DesiredResource): Record<string, unknown> {
  * - Its host is how the arr reaches qBittorrent: through Gluetun when qBittorrent shares
- *   Gluetun's network, at qBittorrent's own port, which its Host check needs.
+ *   Gluetun's network, at qBittorrent's own port, which its Host check needs, without TLS
+ *   or a URL base. The arr sends qBittorrent's key there, so the host, port and TLS are
+ *   fixed (SENDS_A_KEY), and every create, update and test is sent there (`sendsTo`),
+ *   whatever an override or the arr holds.
  * - Its key is checked with the app's own test of the client it holds, as it holds it
@@ -96,2 +100,3 @@ export function servarrDownloadClient(link: DownloadLink): ResourceSpec {
     fields: ['host', 'port', 'useSsl', 'category', 'enable'],
+    locked: { host: SENDS_A_KEY, port: SENDS_A_KEY, useSsl: SENDS_A_KEY },
     secrets: ['apiKey'],
@@ -115,2 +120,3 @@ export function servarrDownloadClient(link: DownloadLink): ResourceSpec {
         secrets: { apiKey: key },
+        sendsTo: { host: at.host, port: at.port, useSsl: false, urlBase: '' },
       };
@@ -140,2 +146,5 @@ export function servarrRootFolder(path: string): ResourceSpec {
     fields: ['path'],
+    locked: {
+      path: "the arr knows a root folder by its path, and can't move one: another path would add a second root folder beside this one, which holds your library. To move your library, move it in the arr, then stop Mediaplane managing this one with {resource}: unmanaged",
+    },
     secrets: [],
```

**Change** `catalog/_shared/servarr-provider.ts`:

```diff
diff --git a/catalog/_shared/servarr-provider.ts b/catalog/_shared/servarr-provider.ts
index b74aae5..258c891 100644
--- a/catalog/_shared/servarr-provider.ts
+++ b/catalog/_shared/servarr-provider.ts
@@ -10,2 +10,3 @@ import {
 import { z } from 'zod';
+import { sendsToOf } from './secret';
 
@@ -61,3 +62,3 @@ export function numberOf(value: unknown): number {
 
-export { secretOf } from './secret';
+export { secretOf, sendsToOf } from './secret';
 
@@ -172,7 +173,31 @@ export async function updateProvider(
 
+/**
+ * `body` with `settings` set, and those it lacks added: where a test sends a key.
+ */
+function aimedAt<T extends { fields: z.infer<typeof setting>[] }>(
+  body: T,
+  settings: Readonly<Record<string, unknown>>,
+): T {
+  const added = Object.entries(settings)
+    .filter(([name]) => !body.fields.some((f) => f.name === name))
+    .map(([name, value]) => ({ name, value }));
+  return {
+    ...body,
+    fields: [
+      ...body.fields.map((f) =>
+        Object.hasOwn(settings, f.name) ? { ...f, value: settings[f.name] } : f,
+      ),
+      ...added,
+    ],
+  };
+}
+
 /**
  * The app's own test of the provider it holds as `id`, sent as the app gave it (its
- * secrets masked) and with that id, or the app tests it as a new one and refuses its
- * name. True when it passes; false when it fails on one of `credentials`, a secret the
- * update sets; otherwise the app's own words, thrown.
+ * secrets masked, which the app fills in with those it holds) and with that id, or the
+ * app tests it as a new one and refuses its name; but aimed at `sendsTo`, the stack's own
+ * address for the other app: the key the app holds may be the stack's, and goes nowhere
+ * else, never to an address the app holds, which anyone who can change the app can set.
+ * True when it passes; false when it fails on one of `credentials`, a secret the update
+ * sets; otherwise the app's own words, thrown.
  */
@@ -184,5 +209,6 @@ export async function testProvider(
   credentials: readonly string[],
+  sendsTo: Readonly<Record<string, unknown>>,
 ): Promise<boolean> {
   const held = await api.get(`${kind.path}/${String(id)}`, provider);
-  const result = await api.test(`${kind.path}/test`, held);
+  const result = await api.test(`${kind.path}/test`, aimedAt(held, sendsTo));
   if (result.passed) return true;
@@ -207,3 +233,6 @@ export interface ProviderOptions {
   fieldsOf: (held: Provider) => Fields;
-  /** The settings to set, secrets in clear (this request body only). */
+  /**
+   * The settings to set, secrets in clear (this request body only): where the app sends
+   * a key among them from `desired.sendsTo` (sendsToOf), never from a managed field.
+   */
   settingsOf: (desired: DesiredResource) => Record<string, unknown>;
@@ -237,3 +266,3 @@ export function servarrProvider(
     verify: (api, desired, observed) =>
-      testProvider(api, kind, observed.id, desired.name, credentials),
+      testProvider(api, kind, observed.id, desired.name, credentials, sendsToOf(desired)),
     create: (api, desired) =>
```

**Change** `catalog/jellyfin/integration.ts`:

```diff
diff --git a/catalog/jellyfin/integration.ts b/catalog/jellyfin/integration.ts
index 1ff70c3..c1ce070 100644
--- a/catalog/jellyfin/integration.ts
+++ b/catalog/jellyfin/integration.ts
@@ -3,3 +3,5 @@ import {
   defineIntegration,
+  listItems,
   type AppApi,
+  type DesiredResource,
   type ResourceSpec,
@@ -107,6 +109,15 @@ const available = z.looseObject({
 
+/** A folder without a trailing "/", as Jellyfin may give it. */
+function trimmed(path: string): string {
+  return path.length > 1 ? path.replace(/\/+$/, '') : path;
+}
+
 /** A library's folders as one sorted list, each once and without a trailing "/". */
 function pathsOf(locations: readonly string[]): string {
-  const trimmed = locations.map((p) => (p.length > 1 ? p.replace(/\/+$/, '') : p));
-  return [...new Set(trimmed)].sort().join(',');
+  return [...new Set(locations.map(trimmed))].sort().join(',');
+}
+
+/** The folders a desired library holds: `paths`, one comma-separated list. */
+function wantedPaths(desired: DesiredResource): string[] {
+  return listItems(desired.fields.paths).map(trimmed);
 }
@@ -148,3 +159,5 @@ async function newLibraryOptions(api: AppApi, type: string) {
  * library of one name isn't refused but named "<name>2", so one is made only when none
- * has the name. Jellyfin can't change what a library holds.
+ * has the name. Jellyfin can't change what a library holds. Its folders are its
+ * `paths`, the one Mediaplane gives it unless an override names more, as Keep mine does
+ * for a folder you added in Jellyfin.
  */
@@ -154,2 +167,7 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
     fields: ['name', 'collectionType', 'paths'],
+    lists: ['paths'],
+    locked: {
+      name: `Mediaplane knows the library by its name, and Seerr enables it by its name. Rename it back to ${spec.name} in Jellyfin, or stop Mediaplane managing it with {resource}: unmanaged`,
+      collectionType: "Jellyfin can't change what a library holds",
+    },
     secrets: [],
@@ -177,9 +195,9 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
     },
-    async create(api) {
-      const query = new URLSearchParams({
-        name: spec.name,
-        collectionType: spec.collectionType,
-        paths: spec.path,
-        refreshLibrary: 'true',
-      });
+    async create(api, desired) {
+      const query = new URLSearchParams([
+        ['name', spec.name],
+        ['collectionType', spec.collectionType],
+        ...wantedPaths(desired).map((path): [string, string] => ['paths', path]),
+        ['refreshLibrary', 'true'],
+      ]);
       await api.submit('POST', `${VIRTUAL_FOLDERS}?${query.toString()}`, {
@@ -189,3 +207,3 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
     },
-    async update(api, _desired, observed) {
+    async update(api, desired, observed) {
       const holds = String(observed.fields.collectionType);
@@ -197,13 +215,17 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
       }
-      const held = String(observed.fields.paths)
-        .split(',')
-        .filter((p) => p !== '');
-      // The wanted folder first, so the library never holds none.
-      if (!held.includes(spec.path)) {
+      // Its folders as Jellyfin lists them, each whole: one with a comma in its name
+      // can't be told apart in `paths`.
+      const found = (await api.get(VIRTUAL_FOLDERS, z.array(library))).find(
+        (l) => l.Name === spec.name,
+      );
+      const held = (found?.Locations ?? []).map(trimmed);
+      const wanted = wantedPaths(desired);
+      // The wanted folders first, so the library never holds none.
+      for (const path of wanted.filter((p) => !held.includes(p))) {
         await api.submit('POST', `${VIRTUAL_FOLDERS}/Paths?refreshLibrary=true`, {
           Name: spec.name,
-          Path: spec.path,
+          Path: path,
         });
       }
-      for (const path of held.filter((p) => p !== spec.path)) {
+      for (const path of held.filter((p) => !wanted.includes(p))) {
         const query = new URLSearchParams({
```

**Change** `catalog/plex/integration.ts`:

```diff
diff --git a/catalog/plex/integration.ts b/catalog/plex/integration.ts
index 995ceaa..bfed306 100644
--- a/catalog/plex/integration.ts
+++ b/catalog/plex/integration.ts
@@ -3,3 +3,5 @@ import {
   defineIntegration,
+  listItems,
   type AppApi,
+  type DesiredResource,
   type ResourceSpec,
@@ -116,2 +118,7 @@ function locationsOf(held: z.infer<typeof section>): string {
 
+/** The folders a desired library holds: `location`, one comma-separated list. */
+function wantedLocations(desired: DesiredResource): string[] {
+  return listItems(desired.fields.location);
+}
+
 /**
@@ -129,2 +136,7 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
     fields: ['name', 'type', 'location'],
+    lists: ['location'],
+    locked: {
+      name: `Seerr enables the library by its name, and Mediaplane finds it by its name when state/resources.json is lost. Rename it back to ${spec.name} in Plex, or stop Mediaplane managing it with {resource}: unmanaged`,
+      type: "Plex can't change what a library holds",
+    },
     secrets: [],
@@ -149,11 +161,11 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
     },
-    async create(api) {
-      const query = new URLSearchParams({
-        name: spec.name,
-        type: spec.type,
-        agent: spec.agent,
-        scanner: spec.scanner,
-        language: LANGUAGE,
-        location: spec.path,
-      });
+    async create(api, desired) {
+      const query = new URLSearchParams([
+        ['name', spec.name],
+        ['type', spec.type],
+        ['agent', spec.agent],
+        ['scanner', spec.scanner],
+        ['language', LANGUAGE],
+        ...wantedLocations(desired).map((path): [string, string] => ['location', path]),
+      ]);
       const answer = await api.post(`${SECTIONS}?${query.toString()}`, {}, made);
@@ -171,3 +183,3 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
     },
-    async update(api, _desired, observed) {
+    async update(api, desired, observed) {
       const holds = String(observed.fields.type);
@@ -186,7 +198,8 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
       }
-      const query = new URLSearchParams({
-        agent: held.agent,
-        name: spec.name,
-        location: spec.path,
-      });
+      // Plex takes the folders as one `location` each, and keeps those it is sent.
+      const query = new URLSearchParams([
+        ['agent', held.agent],
+        ['name', spec.name],
+        ...wantedLocations(desired).map((path): [string, string] => ['location', path]),
+      ]);
       await api.put(
```

**Change** `catalog/prowlarr/integration.ts`:

```diff
diff --git a/catalog/prowlarr/integration.ts b/catalog/prowlarr/integration.ts
index 1eaac54..3eb4352 100644
--- a/catalog/prowlarr/integration.ts
+++ b/catalog/prowlarr/integration.ts
@@ -1,3 +1,5 @@
 import {
+  listItems,
   provides,
+  SENDS_A_KEY,
   serviceAddress,
@@ -14,2 +16,3 @@ import {
   secretOf,
+  sendsToOf,
   servarrProvider,
@@ -70,2 +73,5 @@ function categoriesOf(value: unknown): string {
  *   Prowlarr back, each by its service on the stack's network, at its container port.
+ *   Each says where a key goes, so both are fixed (SENDS_A_KEY), and every create, update
+ *   and test is sent with the stack's own (`sendsTo`), whatever an override or Prowlarr
+ *   holds.
  * - Its secret is the arr's key, checked with Prowlarr's own test of the link it holds,
@@ -89,4 +95,4 @@ function application(link: (typeof LINKED)[number]): ResourceSpec {
   const settingsOf = (desired: DesiredResource) => ({
-    prowlarrUrl: desired.fields.prowlarrUrl,
-    baseUrl: desired.fields.baseUrl,
+    // Where Prowlarr sends the arr's key, and where the arr sends Prowlarr's.
+    ...sendsToOf(desired),
     apiKey: secretOf(desired, 'apiKey'),
@@ -101,2 +107,4 @@ function application(link: (typeof LINKED)[number]): ResourceSpec {
     fields: ['prowlarrUrl', 'baseUrl', 'syncLevel', 'syncCategories'],
+    lists: ['syncCategories'],
+    locked: { prowlarrUrl: SENDS_A_KEY, baseUrl: SENDS_A_KEY },
     secrets: ['apiKey'],
@@ -111,2 +119,6 @@ function application(link: (typeof LINKED)[number]): ResourceSpec {
       if (arr === undefined || own === undefined || key === undefined) return undefined;
+      const urls = {
+        prowlarrUrl: `http://${own.host}:${String(own.port)}`,
+        baseUrl: `http://${arr.host}:${String(arr.port)}`,
+      };
       return {
@@ -114,4 +126,3 @@ function application(link: (typeof LINKED)[number]): ResourceSpec {
         fields: {
-          prowlarrUrl: `http://${own.host}:${String(own.port)}`,
-          baseUrl: `http://${arr.host}:${String(arr.port)}`,
+          ...urls,
           syncLevel: 'fullSync',
@@ -120,2 +131,3 @@ function application(link: (typeof LINKED)[number]): ResourceSpec {
         secrets: { apiKey: key },
+        sendsTo: urls,
       };
@@ -138,15 +150,20 @@ function application(link: (typeof LINKED)[number]): ResourceSpec {
 
-/** The id of the tag `cloudflare`: Prowlarr gives back the one it has, or makes it. */
-async function proxyTag(api: AppApi): Promise<number> {
-  return (await api.post(TAGS, { label: PROXY_TAG }, tag)).id;
+/** The id of the tag `label`: Prowlarr gives back the one it has, or makes it. */
+async function tagId(api: AppApi, label: string): Promise<number> {
+  return (await api.post(TAGS, { label }, tag)).id;
 }
 
-/** The proxy's settings, and its own properties: its name, and its tag's id. */
+/**
+ * The proxy's settings, and its own properties: its name, and its tags' ids, `cloudflare`
+ * unless an override names others (`prowlarr.indexer_proxy.tags`).
+ */
 async function proxyBody(api: AppApi, desired: DesiredResource) {
+  const tags: number[] = [];
+  for (const label of listItems(desired.fields.tags)) tags.push(await tagId(api, label));
   return {
     settings: {
-      host: desired.fields.host,
+      ...sendsToOf(desired),
       requestTimeout: desired.fields.requestTimeout,
     },
-    top: { name: desired.name, tags: [await proxyTag(api)] },
+    top: { name: desired.name, tags },
   };
@@ -165,2 +182,6 @@ const indexerProxy: ResourceSpec = {
   fields: ['host', 'requestTimeout', 'tags'],
+  lists: ['tags'],
+  locked: {
+    host: "Prowlarr sends your indexers' requests through it, and the keys in them: it is the stack's own solver (spec §11, Slice 6)",
+  },
   secrets: [],
@@ -180,2 +201,3 @@ const indexerProxy: ResourceSpec = {
       secrets: {},
+      sendsTo: { host: `http://${solver.host}:${String(solver.port)}/` },
     };
```

**Change** `catalog/qbittorrent/integration.ts`:

```diff
diff --git a/catalog/qbittorrent/integration.ts b/catalog/qbittorrent/integration.ts
index edc1b36..8a539df 100644
--- a/catalog/qbittorrent/integration.ts
+++ b/catalog/qbittorrent/integration.ts
@@ -2,4 +2,6 @@ import {
   defineIntegration,
+  isUnmanaged,
   type AppApi,
   type DesiredResource,
+  type ResolvedStack,
   type ResourceSpec,
@@ -14,3 +16,4 @@ export const DEFAULT_SAVE_PATH = '/data/torrents';
  * The category each arr files its torrents under (spec §6.2), made while that arr is in
- * the stack. Its save path is DEFAULT_SAVE_PATH/<name>.
+ * the stack: `name`, unless the arr's download client is kept with another (categoryOf).
+ * Its save path is DEFAULT_SAVE_PATH/<category>.
  */
@@ -123,2 +126,3 @@ const settings: ResourceSpec = {
   fields: ['savePath', 'autoTmm', 'authSubnetWhitelistEnabled', 'authSubnetWhitelist'],
+  lists: ['authSubnetWhitelist'],
   secrets: [],
@@ -171,4 +175,21 @@ async function saveSettings(api: AppApi, desired: DesiredResource): Promise<void
 /**
- * The category `name` (spec §6.2), with its save path under DEFAULT_SAVE_PATH, while
- * `arr` is in the stack. qBittorrent knows a category by its name: it gives it no id.
+ * The category `arr`'s download client files under: `name`, or the one it is kept with
+ * (`<arr>.download_client.category`, Keep mine), so that qBittorrent has the category the
+ * client names, made by apply. Otherwise the arr's own test of the client would make it,
+ * with no save path, which plan and drift never let it do.
+ */
+function categoryOf(stack: ResolvedStack, arr: string, name: string): string {
+  const kept = stack.config.overrides[`${arr}.download_client.category`];
+  return typeof kept === 'string' &&
+    kept !== '' &&
+    !isUnmanaged(stack, `${arr}.download_client`)
+    ? kept
+    : name;
+}
+
+/**
+ * The category `name` (spec §6.2), or the one `arr`'s download client is kept with
+ * (categoryOf), with its save path under DEFAULT_SAVE_PATH, while `arr` is in the stack.
+ * qBittorrent knows a category by its name: it gives it no id. One Mediaplane made before
+ * under another name stays as it is, yours.
  */
@@ -176,3 +197,6 @@ function category(arr: string, name: string): ResourceSpec {
   const save = (api: AppApi, path: string, desired: DesiredResource) =>
-    api.form(path, { category: name, savePath: String(desired.fields.savePath) });
+    api.form(path, {
+      category: desired.name,
+      savePath: String(desired.fields.savePath),
+    });
   return {
@@ -181,11 +205,17 @@ function category(arr: string, name: string): ResourceSpec {
     secrets: [],
-    desired: ({ stack }) =>
-      stack.apps.some((app) => app.def.id === arr)
-        ? { name, fields: { savePath: `${DEFAULT_SAVE_PATH}/${name}` }, secrets: {} }
-        : undefined,
-    async observe(api) {
-      const held = (await api.get(CATEGORIES_PATH, categories))[name];
+    desired: ({ stack }) => {
+      if (!stack.apps.some((app) => app.def.id === arr)) return undefined;
+      const wanted = categoryOf(stack, arr, name);
+      return {
+        name: wanted,
+        fields: { savePath: `${DEFAULT_SAVE_PATH}/${wanted}` },
+        secrets: {},
+      };
+    },
+    async observe(api, _known, desired) {
+      const named = desired?.name ?? name;
+      const held = (await api.get(CATEGORIES_PATH, categories))[named];
       return held === undefined
         ? undefined
-        : { id: name, name, fields: { savePath: asKept(held.savePath) } };
+        : { id: named, name: named, fields: { savePath: asKept(held.savePath) } };
     },
@@ -193,3 +223,3 @@ function category(arr: string, name: string): ResourceSpec {
       await save(api, '/api/v2/torrents/createCategory', desired);
-      return { id: name };
+      return { id: desired.name };
     },
```

**Change** `catalog/seerr/integration.ts`:

```diff
diff --git a/catalog/seerr/integration.ts b/catalog/seerr/integration.ts
index faec96b..ecc2edf 100644
--- a/catalog/seerr/integration.ts
+++ b/catalog/seerr/integration.ts
@@ -3,2 +3,5 @@ import {
   defineIntegration,
+  isUnmanaged,
+  listItems,
+  SENDS_A_KEY,
   stackAddress,
@@ -6,2 +9,4 @@ import {
   type DesiredResource,
+  type ObservedResource,
+  type ResolvedStack,
   type ResourceSpec,
@@ -10,3 +15,3 @@ import {
 import { z } from 'zod';
-import { secretOf } from '../_shared/secret';
+import { secretOf, sendsToOf } from '../_shared/secret';
 import { LIBRARIES } from '../jellyfin/integration';
@@ -26,2 +31,26 @@ const WANTED_PLEX = PLEX_LIBRARIES.map((library) => library.name);
 
+/**
+ * The libraries Seerr has enabled, of those Mediaplane makes in `app` and still manages,
+ * by name: one you stop it managing (`unmanaged`), maybe renamed, is yours in Seerr too.
+ */
+function managedLibraries(
+  stack: ResolvedStack,
+  app: 'jellyfin' | 'plex',
+  libraries: readonly { resource: string; name: string }[],
+): string {
+  return libraries
+    .filter((library) => !isUnmanaged(stack, `${app}.${library.resource}`))
+    .map((library) => library.name)
+    .join(',');
+}
+
+/**
+ * The libraries a desired link has Seerr enable: its `libraries`, those Mediaplane makes
+ * unless an override (Keep mine) names fewer. Those it doesn't name are yours to enable
+ * or not, in Seerr, and Mediaplane neither looks at nor changes them.
+ */
+function librariesIn(desired: DesiredResource | undefined, all: readonly string[]) {
+  return desired === undefined ? all : listItems(desired.fields.libraries);
+}
+
 /**
@@ -58,6 +87,6 @@ const jellyfinSettings = heldJellyfin.extend({
 
-/** Which of Mediaplane's libraries (`wanted`) Seerr has enabled, as one list. */
+/** Which of the libraries `wanted` Seerr has enabled, as one list. */
 function enabledOf(
   libraries: readonly z.infer<typeof library>[],
-  wanted: readonly string[] = WANTED,
+  wanted: readonly string[],
 ): string {
@@ -84,6 +113,6 @@ async function heldKeyWorks(api: AppApi): Promise<boolean> {
 /**
- * Point Seerr at Jellyfin, with no URL base and no TLS, with Mediaplane's key for
- * Jellyfin. Seerr saves it only once it has reached Jellyfin there with that key. `ip` is
- * the setting; a `hostname` would be kept as a stray setting, and is the sign-in's field,
- * which Seerr refuses once set.
+ * Point Seerr at Jellyfin, at the stack's own address for it (`sendsTo`), with no URL base
+ * and no TLS, with Mediaplane's key for Jellyfin. Seerr saves it only once it has reached
+ * Jellyfin there with that key. `ip` is the setting; a `hostname` would be kept as a stray
+ * setting, and is the sign-in's field, which Seerr refuses once set.
  */
@@ -91,6 +120,3 @@ async function saveJellyfin(api: AppApi, desired: DesiredResource): Promise<void
   await api.submit('POST', `${SETTINGS}/jellyfin`, {
-    ip: desired.fields.hostname,
-    port: desired.fields.port,
-    useSsl: false,
-    urlBase: '',
+    ...sendsToOf(desired),
     apiKey: secretOf(desired, 'apiKey'),
@@ -100,3 +126,13 @@ async function saveJellyfin(api: AppApi, desired: DesiredResource): Promise<void
 /**
- * Enable Mediaplane's libraries in Seerr, of Jellyfin or of Plex: Seerr learns the media
+ * Whether Seerr holds the stack's own address for the media server (`sendsTo`), where
+ * the key it holds goes when Seerr asks it: as observed, TLS and a URL base folded into
+ * `hostname`, which then differs.
+ */
+function atStack(desired: DesiredResource, observed: ObservedResource): boolean {
+  const to = sendsToOf(desired);
+  return observed.fields.hostname === to.ip && observed.fields.port === to.port;
+}
+
+/**
+ * Enable the libraries `wanted` in Seerr, of Jellyfin or of Plex: Seerr learns the media
  * server's libraries by syncing them, which keeps those it has enabled, and enables them
@@ -107,6 +143,6 @@ async function enableLibraries(
   api: AppApi,
-  server: { path: 'jellyfin' | 'plex'; name: string; wanted: readonly string[] } = {
+  wanted: readonly string[],
+  server: { path: 'jellyfin' | 'plex'; name: string } = {
     path: 'jellyfin',
     name: 'Jellyfin',
-    wanted: WANTED,
   },
@@ -116,3 +152,3 @@ async function enableLibraries(
   const synced = await api.get(at, z.array(library));
-  for (const name of server.wanted) {
+  for (const name of wanted) {
     const held = synced.find((l) => l.name === name);
@@ -139,2 +175,5 @@ async function enableLibraries(
  * - `libraries` lists which of Mediaplane's are enabled; a library you enable is yours.
+ * - Seerr sends the key it holds to the address it holds: its host and port are fixed
+ *   (SENDS_A_KEY), Mediaplane saves only the stack's own (`sendsTo`), and asks Seerr's
+ *   list of Jellyfin's users only while Seerr holds that address.
  * - It requires Jellyfin's admin and libraries, and Seerr comes after Jellyfin.
@@ -144,2 +183,4 @@ const mediaServer: ResourceSpec = {
   fields: ['hostname', 'port', 'libraries'],
+  lists: ['libraries'],
+  locked: { hostname: SENDS_A_KEY, port: SENDS_A_KEY },
   secrets: ['apiKey'],
@@ -151,7 +192,12 @@ const mediaServer: ResourceSpec = {
       name: 'Jellyfin',
-      fields: { hostname: at.host, port: at.port, libraries: WANTED.join(',') },
+      fields: {
+        hostname: at.host,
+        port: at.port,
+        libraries: managedLibraries(ctx.stack, 'jellyfin', LIBRARIES),
+      },
       secrets: at.secrets,
+      sendsTo: { ip: at.host, port: at.port, useSsl: false, urlBase: '' },
     };
   },
-  async observe(api) {
+  async observe(api, _known, desired) {
     const held = await api.get(`${SETTINGS}/jellyfin`, jellyfinSettings);
@@ -167,3 +213,3 @@ const mediaServer: ResourceSpec = {
             port: held.port,
-            libraries: enabledOf(held.libraries),
+            libraries: enabledOf(held.libraries, librariesIn(desired, WANTED)),
           },
@@ -171,6 +217,12 @@ const mediaServer: ResourceSpec = {
   },
-  verify: (api) => heldKeyWorks(api),
+  verify: (api, desired, observed) =>
+    atStack(desired, observed)
+      ? heldKeyWorks(api)
+      : Promise.resolve({
+          unchecked:
+            "Seerr holds another address for Jellyfin than the stack's, where it would send the key it holds: apply gives it the stack's",
+        }),
   async create(api, desired) {
     await saveJellyfin(api, desired);
-    await enableLibraries(api);
+    await enableLibraries(api, librariesIn(desired, WANTED));
     return { id: null };
@@ -178,5 +230,3 @@ const mediaServer: ResourceSpec = {
   async update(api, desired, observed) {
-    const moved =
-      observed.fields.hostname !== desired.fields.hostname ||
-      observed.fields.port !== desired.fields.port;
+    const moved = !atStack(desired, observed);
     if (moved || !(await heldKeyWorks(api))) await saveJellyfin(api, desired);
@@ -184,3 +234,3 @@ const mediaServer: ResourceSpec = {
     if (moved || observed.fields.libraries !== desired.fields.libraries) {
-      await enableLibraries(api);
+      await enableLibraries(api, librariesIn(desired, WANTED));
     }
@@ -189,3 +239,3 @@ const mediaServer: ResourceSpec = {
 
-const PLEX = { path: 'plex', name: 'Plex', wanted: WANTED_PLEX } as const;
+const PLEX = { path: 'plex', name: 'Plex' } as const;
 
@@ -198,12 +248,9 @@ const plexSettings = heldPlex.extend({
 /**
- * Point Seerr at the stack's Plex, without TLS: Seerr saves it only once it has reached
- * Plex there with its admin's token (your plex.tv account's, from its first sign-in), and
- * asked it who it is. No key goes in these settings: Seerr holds none of Mediaplane's.
+ * Point Seerr at the stack's Plex, at its own address (`sendsTo`), without TLS: Seerr
+ * saves it only once it has reached Plex there with its admin's token (your plex.tv
+ * account's, from its first sign-in), and asked it who it is. No key goes in these
+ * settings, but Seerr sends that token there.
  */
 async function savePlex(api: AppApi, desired: DesiredResource): Promise<void> {
-  await api.submit('POST', `${SETTINGS}/plex`, {
-    ip: desired.fields.hostname,
-    port: desired.fields.port,
-    useSsl: false,
-  });
+  await api.submit('POST', `${SETTINGS}/plex`, sendsToOf(desired));
 }
@@ -218,2 +265,4 @@ async function savePlex(api: AppApi, desired: DesiredResource): Promise<void> {
  * - `libraries` lists which of Mediaplane's are enabled; a library you enable is yours.
+ * - Seerr sends its admin's Plex token to the address it holds: its host and port are
+ *   fixed (SENDS_A_KEY), and Mediaplane saves only the stack's own (`sendsTo`).
  * - It requires Plex's name and libraries, and Seerr comes after Plex.
@@ -223,2 +272,4 @@ const mediaServerPlex: ResourceSpec = {
   fields: ['hostname', 'port', 'libraries'],
+  lists: ['libraries'],
+  locked: { hostname: SENDS_A_KEY, port: SENDS_A_KEY },
   secrets: [],
@@ -230,7 +281,12 @@ const mediaServerPlex: ResourceSpec = {
       name: 'Plex',
-      fields: { hostname: at.host, port: at.port, libraries: WANTED_PLEX.join(',') },
+      fields: {
+        hostname: at.host,
+        port: at.port,
+        libraries: managedLibraries(stack, 'plex', PLEX_LIBRARIES),
+      },
       secrets: {},
+      sendsTo: { ip: at.host, port: at.port, useSsl: false },
     };
   },
-  async observe(api) {
+  async observe(api, _known, desired) {
     const held = await api.get(`${SETTINGS}/plex`, plexSettings);
@@ -244,3 +300,3 @@ const mediaServerPlex: ResourceSpec = {
             port: held.port,
-            libraries: enabledOf(held.libraries, WANTED_PLEX),
+            libraries: enabledOf(held.libraries, librariesIn(desired, WANTED_PLEX)),
           },
@@ -250,3 +306,3 @@ const mediaServerPlex: ResourceSpec = {
     await savePlex(api, desired);
-    await enableLibraries(api, PLEX);
+    await enableLibraries(api, librariesIn(desired, WANTED_PLEX), PLEX);
     return { id: null };
@@ -254,5 +310,3 @@ const mediaServerPlex: ResourceSpec = {
   async update(api, desired, observed) {
-    const moved =
-      observed.fields.hostname !== desired.fields.hostname ||
-      observed.fields.port !== desired.fields.port;
+    const moved = !atStack(desired, observed);
     if (moved) await savePlex(api, desired);
@@ -260,3 +314,3 @@ const mediaServerPlex: ResourceSpec = {
     if (moved || observed.fields.libraries !== desired.fields.libraries) {
-      await enableLibraries(api, PLEX);
+      await enableLibraries(api, librariesIn(desired, WANTED_PLEX), PLEX);
     }
@@ -338,3 +392,5 @@ const offered = z.looseObject({
  * - With TLS or a URL base, `hostname` is observed as the URL Seerr calls, so the server
- *   reads as changed, and the update puts it back at the stack's address.
+ *   reads as changed, and the update puts it back at the stack's address. The host and
+ *   port are fixed (SENDS_A_KEY), and every test, create and update is sent with the
+ *   stack's own address (`sendsTo`), whatever an override or Seerr holds.
  * - Seerr keeps a server whole, its id read-only: an update sends it back as Seerr gave
@@ -357,11 +413,11 @@ function seerrServer(arr: keyof typeof ARRS): ResourceSpec {
   /**
-   * The stack's own address for the arr, without TLS and with no URL base, since Seerr
-   * adds the base after the port (`@<host>` would be a host).
+   * The stack's own address for the arr (`sendsTo`), without TLS and with no URL base,
+   * since Seerr adds the base after the port (`@<host>` would be a host).
    */
-  const stackAt = (desired: DesiredResource) => ({
-    hostname: desired.fields.hostname,
-    port: desired.fields.port,
-    useSsl: false,
-    baseUrl: '',
-  });
+  const stackAt = (desired: DesiredResource) => sendsToOf(desired);
+  /** That address, as Seerr would call it, in messages. */
+  const urlOf = (desired: DesiredResource) => {
+    const to = sendsToOf(desired);
+    return `http://${String(to.hostname)}:${String(to.port)}`;
+  };
   /** Where the stack's key goes: the stack's own address for the arr, and only there. */
@@ -379,6 +435,4 @@ function seerrServer(arr: keyof typeof ARRS): ResourceSpec {
     const found = await test(api, reach(desired));
-    if (found === undefined) {
-      const at = `http://${String(desired.fields.hostname)}:${String(desired.fields.port)}`;
-      throw unreachable(api, at, "with the stack's key");
-    }
+    if (found === undefined)
+      throw unreachable(api, urlOf(desired), "with the stack's key");
     return found.profiles;
@@ -418,2 +472,3 @@ function seerrServer(arr: keyof typeof ARRS): ResourceSpec {
     fields: ['hostname', 'port', 'activeProfile', 'activeDirectory', 'isDefault'],
+    locked: { hostname: SENDS_A_KEY, port: SENDS_A_KEY },
     secrets: ['apiKey'],
@@ -432,2 +487,3 @@ function seerrServer(arr: keyof typeof ARRS): ResourceSpec {
         secrets: at.secrets,
+        sendsTo: { hostname: at.host, port: at.port, useSsl: false, baseUrl: '' },
       };
@@ -482,7 +538,3 @@ function seerrServer(arr: keyof typeof ARRS): ResourceSpec {
       if ((await test(api, { ...held, ...reach(desired) })) !== undefined) return false;
-      throw unreachable(
-        api,
-        `http://${String(desired.fields.hostname)}:${String(desired.fields.port)}`,
-        "with the key it holds, or the stack's",
-      );
+      throw unreachable(api, urlOf(desired), "with the key it holds, or the stack's");
     },
@@ -500,3 +552,3 @@ function seerrServer(arr: keyof typeof ARRS): ResourceSpec {
           is4k: false,
-          isDefault: true,
+          isDefault: desired.fields.isDefault === true,
           syncEnabled: false,
@@ -519,3 +571,3 @@ function seerrServer(arr: keyof typeof ARRS): ResourceSpec {
         activeDirectory: desired.fields.activeDirectory,
-        isDefault: true,
+        isDefault: desired.fields.isDefault === true,
       });
@@ -533,2 +585,5 @@ const setup: ResourceSpec = {
   fields: ['initialized'],
+  locked: {
+    initialized: "Seerr can't be taken back to its setup wizard",
+  },
   secrets: [],
```

**Change** `packages/engine/src/config/schema.ts`:

```diff
diff --git a/packages/engine/src/config/schema.ts b/packages/engine/src/config/schema.ts
index a264164..b1bb9f1 100644
--- a/packages/engine/src/config/schema.ts
+++ b/packages/engine/src/config/schema.ts
@@ -279,3 +279,3 @@ const stackShape = {
     .describe(
-      'Keep mine values, by <app>.<resource>.<field>. Not used yet: drift detection arrives in Slice 8.',
+      "Your own values for what Mediaplane manages in the apps, by <app>.<resource>.<field>, such as sonarr.download_client.category: television: apply sets them instead of its own. Each app's README lists the fields; one marked fixed, and a secret, can't be overridden. <app>.<resource>: unmanaged stops Mediaplane managing that resource.",
     ),
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index edbc025..aaef541 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -36,2 +36,3 @@ export * from './integrations/types';
 export * from './integrations/resources';
+export * from './integrations/overrides';
 export * from './integrations/wiring';
```

**Create** `packages/engine/src/integrations/overrides.ts`:

```ts
import type { AppDefinition, Catalog } from '../catalog/types';
import { error, warning, type Diagnostic } from '../diagnostics';
import type { ResolvedStack } from '../resolver/resolve';
import { didYouMean } from '../util/did-you-mean';
import type { DesiredResource, ResourceSpec, Scalar, WiringContext } from './types';

/** `<app>.<resource>: unmanaged`: Mediaplane no longer manages the resource (spec §6.3). */
export const UNMANAGED = 'unmanaged';

/**
 * Why a field that says where an app sends a key can't be kept (`locked`): the stack's
 * keys go only to its own addresses (spec §11, Slice 6), whatever the app holds.
 */
export const SENDS_A_KEY = 'it sets where a key is sent (spec §11, Slice 6)';

/** The stack's overrides (spec §4.2), by key. */
type Overrides = Readonly<Record<string, Scalar>>;

/** Whether the stack's overrides say Mediaplane no longer manages `address`. */
export function isUnmanaged(stack: ResolvedStack, address: string): boolean {
  return stack.config.overrides[address] === UNMANAGED;
}

/**
 * `desired` with the overrides that name the resource's managed fields, as
 * `<address>.<field>` (spec §4.2): Keep mine's values. A locked field keeps its own.
 */
export function withOverrides(
  spec: ResourceSpec,
  address: string,
  desired: DesiredResource,
  overrides: Overrides,
): DesiredResource {
  const kept = spec.fields.flatMap((field): [string, Scalar][] => {
    const value = overrides[`${address}.${field}`];
    return value === undefined || Object.hasOwn(spec.locked ?? {}, field)
      ? []
      : [[field, value]];
  });
  if (kept.length === 0) return desired;
  return { ...desired, fields: { ...desired.fields, ...Object.fromEntries(kept) } };
}

/**
 * What the stack wants of a resource (spec §6.3: D): stack.yaml, through the resource's
 * desired(), plus its overrides. Undefined when the stack wants none, or no longer has
 * Mediaplane manage it (`unmanaged`).
 */
export function desiredOf(
  spec: ResourceSpec,
  ctx: WiringContext,
): DesiredResource | undefined {
  const address = `${ctx.app.def.id}.${spec.name}`;
  if (isUnmanaged(ctx.stack, address)) return undefined;
  const wanted = spec.desired(ctx);
  return wanted === undefined
    ? undefined
    : withOverrides(spec, address, wanted, ctx.stack.config.overrides);
}

/** What an override key names in the catalog: an app's resource, and maybe its field. */
export interface OverrideTarget {
  def: AppDefinition;
  spec: ResourceSpec;
  /** Undefined for `<app>.<resource>`, which takes only `unmanaged`. */
  field: string | undefined;
}

/**
 * The resource, and field, that the override key `key` names (spec §4.2), or why it
 * names none: an app, a resource or a field that isn't there (with the closest name), a
 * secret, or a field Mediaplane won't let an override change. Field names are
 * case-sensitive, as the apps' are.
 */
export function overrideTarget(
  catalog: Catalog,
  key: string,
): { ok: true; target: OverrideTarget } | { ok: false; diagnostic: Diagnostic } {
  const refuse = (code: string, message: string, hint?: string) => ({
    ok: false as const,
    diagnostic: error(code, message, {
      path: `overrides.${key}`,
      ...(hint === undefined ? {} : { hint }),
    }),
  });
  const closest = (name: string, names: readonly string[]) => {
    const near = didYouMean(name, names);
    return near === undefined ? undefined : `did you mean "${near}"?`;
  };
  const [app = '', resource = '', field, ...rest] = key.split('.');
  if (resource === '' || rest.length > 0) {
    return refuse(
      'overrides.invalid',
      `"${key}" is not an override key: they look like <app>.<resource>.<field>`,
    );
  }
  const def = catalog.find((d) => d.id === app);
  if (def === undefined) {
    return refuse(
      'overrides.unknown',
      `"${key}" names no app: there is no ${app}`,
      closest(
        app,
        catalog.map((d) => d.id),
      ),
    );
  }
  const specs = def.integration?.resources ?? [];
  const spec = specs.find((s) => s.name === resource);
  if (spec === undefined) {
    return refuse(
      'overrides.unknown',
      `"${key}" names nothing Mediaplane manages in ${def.name}: it has no ${resource}`,
      closest(
        resource,
        specs.map((s) => s.name),
      ) ?? `${def.name}'s README lists what Mediaplane manages there`,
    );
  }
  if (field === undefined) return { ok: true, target: { def, spec, field } };
  if (spec.secrets.includes(field)) {
    return refuse(
      'overrides.secret',
      `${key} is a secret: Mediaplane checks it with ${def.name}'s own check, and never keeps it`,
      'take it out of overrides:; apply sets it again, or the runbook says what to do if it was changed in the app',
    );
  }
  if (!spec.fields.includes(field)) {
    return refuse(
      'overrides.unmanaged-field',
      `${key} is not a field Mediaplane manages: ${def.id}.${spec.name}'s are ${spec.fields.join(', ')}`,
      closest(field, spec.fields) ??
        `the others are yours already; ${def.name}'s README lists the managed ones`,
    );
  }
  const locked = spec.locked?.[field];
  if (locked !== undefined) {
    return refuse(
      'overrides.locked',
      `${key} can't be kept: ${locked.replaceAll('{resource}', `${def.id}.${spec.name}`)}`,
    );
  }
  return { ok: true, target: { def, spec, field } };
}

/** "text", "a number", "true or false": what a value of `value`'s type is called. */
function kindOf(value: Scalar): string {
  if (typeof value === 'string') return 'text';
  return typeof value === 'number' ? 'a number' : 'true or false';
}

/**
 * What is wrong with the stack's overrides (spec §4.2): a key that names nothing
 * Mediaplane manages, a secret or a locked field (errors), a value of another type than
 * the field's, `<app>.<resource>` with anything but `unmanaged`, and an override that
 * does nothing (a warning): of something this stack doesn't have, or of a field of a
 * resource made `unmanaged`. `unmanaged` of a resource the stack doesn't want is quiet:
 * it keeps one left in the app yours.
 */
export function checkOverrides(
  stack: ResolvedStack,
  catalog: Catalog,
  wiring: Pick<WiringContext, 'admin' | 'keys'>,
): Diagnostic[] {
  return Object.entries(stack.config.overrides).flatMap(([key, value]): Diagnostic[] => {
    const named = overrideTarget(catalog, key);
    if (!named.ok) return [named.diagnostic];
    const { def, spec, field } = named.target;
    const path = `overrides.${key}`;
    if (field === undefined && value !== UNMANAGED) {
      return [
        error(
          'overrides.invalid',
          `${key} takes only "${UNMANAGED}", to stop Mediaplane managing it; a field goes after it, as ${key}.<field>`,
          { path },
        ),
      ];
    }
    const app = stack.apps.find((a) => a.def.id === def.id);
    if (app === undefined) {
      return [
        warning('overrides.unused', `${key} does nothing: the stack has no ${def.name}`, {
          path,
        }),
      ];
    }
    const wanted = spec.desired({ stack, app, ...wiring });
    // Unmanaged, one the stack doesn't want stays so: one left in the app is yours.
    if (wanted === undefined && value === UNMANAGED) return [];
    const address = `${def.id}.${spec.name}`;
    if (field !== undefined && isUnmanaged(stack, address)) {
      return [
        warning(
          'overrides.unused',
          `${key} does nothing: ${address} is ${UNMANAGED}, so Mediaplane neither looks at it nor sets it`,
          { path },
        ),
      ];
    }
    if (wanted === undefined) {
      return [
        warning(
          'overrides.unused',
          `${key} does nothing: Mediaplane doesn't make ${def.id}.${spec.name} in this stack`,
          { path },
        ),
      ];
    }
    const own = field === undefined ? undefined : wanted.fields[field];
    if (own !== undefined && typeof own !== typeof value) {
      return [
        error(
          'overrides.type',
          `${key} must be ${kindOf(own)}, as ${def.name} holds it, not ${kindOf(value)}`,
          { path },
        ),
      ];
    }
    return [];
  });
}
```

**Change** `packages/engine/src/integrations/types.ts`:

```diff
diff --git a/packages/engine/src/integrations/types.ts b/packages/engine/src/integrations/types.ts
index db2f052..f4b9c45 100644
--- a/packages/engine/src/integrations/types.ts
+++ b/packages/engine/src/integrations/types.ts
@@ -24,2 +24,11 @@ export interface DesiredResource {
   folders?: readonly string[];
+  /**
+   * Where the resource has its app send a key (or, for Prowlarr's indexer proxy, your
+   * indexers' requests): the settings of the stack's own service address for the other
+   * app (spec §11, Slice 6: keys go only to the stack's own addresses). Create, update
+   * and each check send these, never a managed field, which an override could set, nor
+   * what the app holds, which anyone who can change the app can set. Overrides never
+   * change it.
+   */
+  sendsTo?: Fields;
 }
@@ -78,2 +87,13 @@ export interface ResourceSpec {
   fields: readonly string[];
+  /**
+   * Managed fields held as one comma-separated list, such as a library's folders: compared
+   * as sets, whatever their order, so an override in another order still matches.
+   */
+  lists?: readonly string[];
+  /**
+   * Managed fields an override can't change, each with why: what the resource is known
+   * by, or what its app can't change. Override keys (spec §4.2) name only the others.
+   * "{resource}" in a reason stands for the resource's address.
+   */
+  locked?: Readonly<Record<string, string>>;
   /** The secrets it holds, by name: applied and checked with verify, never compared. */
```

**Change** `packages/engine/src/integrations/wire.ts`:

```diff
diff --git a/packages/engine/src/integrations/wire.ts b/packages/engine/src/integrations/wire.ts
index 1c42db7..41e5729 100644
--- a/packages/engine/src/integrations/wire.ts
+++ b/packages/engine/src/integrations/wire.ts
@@ -10,2 +10,3 @@ import { stackKeys } from '../secrets/values';
 import { foundSecrets, redact, type FoundSecrets } from '../util/redact';
+import { desiredOf } from './overrides';
 import { readResources, writeResources, type KnownResources } from './resources';
@@ -216,3 +217,3 @@ export async function wire(options: WireOptions): Promise<string[]> {
       // Wanted, and desired() is pure: only a guard.
-      const desired = spec.desired(ctx);
+      const desired = desiredOf(spec, ctx);
       if (desired === undefined) continue;
```

**Change** `packages/engine/src/integrations/wiring.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index a9735e6..6a8e6b4 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -18,2 +18,3 @@ import { foundSecrets, redact, redactionValues, type FoundSecrets } from '../uti
 import { compare } from '../util/sort';
+import { desiredOf, withOverrides } from './overrides';
 import type { KnownResource, KnownResources } from './resources';
@@ -143,6 +144,9 @@ export function resourceAddress(app: ResolvedApp, spec: ResourceSpec): string {
 
-/** The app's resources that the stack wants: each one whose `desired` gives one. */
+/**
+ * The app's resources that the stack wants: each one whose `desired` gives one, and that
+ * isn't `unmanaged` (desiredOf).
+ */
 export function wantedResources(ctx: WiringContext): ResourceSpec[] {
   return (ctx.app.def.integration?.resources ?? []).filter(
-    (spec) => spec.desired(ctx) !== undefined,
+    (spec) => desiredOf(spec, ctx) !== undefined,
   );
@@ -150,2 +154,27 @@ export function wantedResources(ctx: WiringContext): ResourceSpec[] {
 
+/**
+ * The items of a list field's value (`lists`): one comma-separated list, as the stack and
+ * its overrides give it, without the empty ones. A value that isn't text holds none.
+ */
+export function listItems(value: Scalar | undefined): string[] {
+  return typeof value === 'string' ? value.split(',').filter((item) => item !== '') : [];
+}
+
+/**
+ * Whether two values of `spec`'s managed `field` are the same: a list field (`lists`) as
+ * a set of its items (listItems), whatever their order; any other exactly.
+ */
+export function sameValue(
+  spec: ResourceSpec,
+  field: string,
+  a: Scalar | undefined,
+  b: Scalar | undefined,
+): boolean {
+  if (a === b) return true;
+  if (!(spec.lists ?? []).includes(field)) return false;
+  if (typeof a !== 'string' || typeof b !== 'string') return false;
+  const items = (list: string) => [...new Set(listItems(list))].sort(compare).join(',');
+  return items(a) === items(b);
+}
+
 /**
@@ -348,10 +377,20 @@ export async function examine(
 ): Promise<Examined | undefined> {
-  const wanted = spec.desired(ctx);
+  const wanted = desiredOf(spec, ctx);
   if (wanted === undefined) return undefined;
   const address = resourceAddress(ctx.app, spec);
+  // What only the app can say, then the overrides again: Keep mine's value wins.
   const desired =
     options.verify !== false && spec.resolve !== undefined
-      ? await spec.resolve(api, wanted, ctx)
+      ? withOverrides(
+          spec,
+          address,
+          await spec.resolve(api, wanted, ctx),
+          ctx.stack.config.overrides,
+        )
       : wanted;
   const observed = await spec.observe(api, known, desired);
+  // A record of another name is of what the stack wanted before, such as qBittorrent's
+  // category, once Sonarr's is kept as another: what differs from it is the stack's own
+  // change, which apply makes, not one made in the app.
+  const record = known?.name === desired.name ? known : undefined;
   const unchecked = (reason: string): SecretCheck[] =>
@@ -369,3 +408,3 @@ export async function examine(
       changes: [],
-      drift: known === undefined ? [] : [{ resource: address, kind: 'missing' }],
+      drift: record === undefined ? [] : [{ resource: address, kind: 'missing' }],
       checks: unchecked('the app has none to check: apply makes it with them'),
@@ -380,6 +419,8 @@ export async function examine(
   const changes = compared.filter(
-    (field) => observed.fields[field] !== desired.fields[field],
+    (field) => !sameValue(spec, field, observed.fields[field], desired.fields[field]),
   );
   const drift =
-    known === undefined ? [] : fieldDrift(address, compared, known, desired, observed);
+    record === undefined
+      ? []
+      : fieldDrift(spec, address, compared, record, desired, observed);
   // A field that differs makes it an update, which sets the secrets too: checking them
@@ -395,3 +436,3 @@ export async function examine(
   changes.push(...refused.map((check) => check.secret));
-  if (known !== undefined) {
+  if (record !== undefined) {
     drift.push(
@@ -409,4 +450,6 @@ export async function examine(
   const recorded =
-    known !== undefined &&
-    compared.every((field) => known.fields[field] === desired.fields[field]);
+    record !== undefined &&
+    compared.every((field) =>
+      sameValue(spec, field, record.fields[field], desired.fields[field]),
+    );
   return {
@@ -427,2 +470,3 @@ export async function examine(
 function fieldDrift(
+  spec: ResourceSpec,
   address: string,
@@ -439,3 +483,4 @@ function fieldDrift(
     const expected = wanted ?? applied;
-    const was = wanted === undefined || wanted === applied ? {} : { applied };
+    const was =
+      wanted === undefined || sameValue(spec, field, wanted, applied) ? {} : { applied };
     const unreadable =
@@ -457,3 +502,8 @@ function fieldDrift(
     const actual = observed.fields[field];
-    if (actual === applied || actual === wanted) return [];
+    if (
+      sameValue(spec, field, actual, applied) ||
+      sameValue(spec, field, actual, wanted)
+    ) {
+      return [];
+    }
     return [{ resource: address, kind: 'field', field, expected, ...was, actual }];
@@ -719,3 +769,3 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
       // What the wire step would refuse, before anything is sent: plan says so first.
-      const desired = spec.desired(ctx);
+      const desired = desiredOf(spec, ctx);
       const held =
```

**Change** `packages/engine/src/plan/plan.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index 5113399..c867e1c 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -19,2 +19,3 @@ import { composeToYaml } from '../render/yaml';
 import { resolveStack, type ResolvedStack } from '../resolver/resolve';
+import { checkOverrides } from '../integrations/overrides';
 import { readResources, type KnownResources } from '../integrations/resources';
@@ -246,2 +247,7 @@ export async function planStack(
     const given = await userSecrets(stack, options.env);
+    const keys = stackKeys(stack, preview, given);
+    // Keep mine's values (spec §6.3): an override that names nothing Mediaplane manages,
+    // or can't be applied, fails the plan before any app is asked.
+    diagnostics.push(...checkOverrides(stack, options.catalog, { admin, keys }));
+    if (hasErrors(diagnostics)) return failed(diagnostics);
     // An app to set up is asked once it is: without its key, it can't be asked now.
@@ -269,3 +275,3 @@ export async function planStack(
         runtime: options.runtime,
-        keys: stackKeys(stack, preview, given),
+        keys,
         admin,
```

**Change** `scripts/docs/catalog-facts.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.ts b/scripts/docs/catalog-facts.ts
index ffe4627..a604a88 100644
--- a/scripts/docs/catalog-facts.ts
+++ b/scripts/docs/catalog-facts.ts
@@ -82,3 +82,6 @@ function api(def: AppDefinition): string {
 
-/** What Mediaplane manages in the app, as override keys name it (spec §4.2, §6.3). */
+/**
+ * What Mediaplane manages in the app, as override keys name it (spec §4.2, §6.3): a field
+ * an override can't change is marked "fixed".
+ */
 function managed(def: AppDefinition): string {
@@ -88,4 +91,5 @@ function managed(def: AppDefinition): string {
     .map((resource) => {
-      const fields = resource.fields.map((field) =>
-        code(`${def.id}.${resource.name}.${field}`),
+      const fields = resource.fields.map(
+        (field) =>
+          `${code(`${def.id}.${resource.name}.${field}`)}${Object.hasOwn(resource.locked ?? {}, field) ? ' (fixed)' : ''}`,
       );
```

- [ ] **Step 4: Run them to see them pass, and regenerate the references and facts**

```bash
pnpm vitest run catalog/_shared/servarr-connection.test.ts catalog/_shared/servarr-download.test.ts catalog/catalog.test.ts catalog/jellyfin/integration.test.ts catalog/plex/integration.test.ts catalog/prowlarr/integration.test.ts catalog/qbittorrent/integration.test.ts catalog/seerr/integration.test.ts packages/engine/src/integrations/overrides.test.ts packages/engine/src/integrations/wiring.test.ts packages/engine/src/plan/plan.test.ts scripts/docs/catalog-facts.test.ts
pnpm docs:generate
```

Expected: PASS. `docs:generate` rewrites `docs/reference/stack-yaml.md` and
`docs/reference/stack.schema.json` (the `overrides` description), and the facts of the
Jellyfin, Plex, Prowlarr, Radarr, Seerr and Sonarr READMEs (`(fixed)` after each fixed
field).

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages catalog scripts docs/reference
git commit -m "feat: overrides set what apply sets in the apps, and unmanaged stops Mediaplane managing a resource" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 2011 tests pass in 89 files.

---

### Task 3: The catalog: what an app holds that Mediaplane can't read, a root folder's folder, a renamed library, and `plan`'s marks as the owner decided

Decision: a value Mediaplane can't read is said to be, in every observe (decision 12).
Decision: a root folder's `accessible` (decision 11); a renamed library is never made again
on its folder (decision 9).
Decision: the arr's test isn't run by `plan` while qBittorrent lacks a category the client
names, or can't be asked (decision 6); Seerr's key once (decision 26).
Decision: fakes no kinder (decision 22).

**Files:**
- Create: `packages/engine/src/integrations/read.ts`
- Modify: `catalog/_shared/servarr-connection.ts`, `catalog/_shared/servarr-download.ts`, `catalog/_shared/servarr-provider.ts`, `catalog/_shared/servarr.ts`, `catalog/jellyfin/integration.ts`, `catalog/plex/integration.ts`, `catalog/prowlarr/integration.ts`, `catalog/qbittorrent/integration.ts`, `catalog/radarr/integration.ts`, `catalog/seerr/integration.ts`, `catalog/sonarr/integration.ts`, `packages/engine/src/index.ts`, `packages/engine/src/testing/wiring.ts`
- Test: `catalog/_shared/servarr-connection.test.ts`, `catalog/_shared/servarr-download.test.ts`, `catalog/jellyfin/integration.test.ts`, `catalog/plex/integration.test.ts`, `catalog/prowlarr/integration.test.ts`, `catalog/qbittorrent/integration.test.ts`, `catalog/seerr/integration.test.ts`, `packages/cli/src/run.test.ts`, `packages/engine/src/integrations/read.test.ts`
- Generated: `catalog/radarr/README.md`, `catalog/sonarr/README.md`

**Interfaces:**
- **Consumes:** Task 1's `VerifyContext`, `Unchecked`, `ObservedResource.unreadable` and
  `update`'s `changes`; Task 2's `locked`, `sendsToOf`, `testProvider`'s `sendsTo`.
- **Produces:**
  - from `@mediaplane/engine`: `interface FieldReader { text(field, value): string | undefined; number(field, value): number | undefined; flag(field, value): boolean | undefined; numbers(field, value): string | undefined; refuse(field, why): Scalar | undefined; observed(id, name, fields): ObservedResource }`,
    `fieldReader(): FieldReader`;
  - in `catalog/_shared/servarr-provider.ts`: `optionalText(value): string | undefined`
    (in place of `textOf` and `numberOf`; undefined for a value of another type),
    `providerOf(api, kind, id): Promise<Provider>`;
    `ProviderOptions.fieldsOf(held, read: FieldReader)`;
  - `DownloadLink.imported: 'tvImportedCategory' | 'movieImportedCategory'`;
  - the root folder's managed fields: `path`, `accessible`;
  - `FakeAppState`'s root folders say `accessible` from `folders`, and the fake arrs'
    test of a client makes each category it names that qBittorrent lacks.

- [ ] **Step 1: Write the failing tests**

**Change** `catalog/_shared/servarr-connection.test.ts`:

```diff
diff --git a/catalog/_shared/servarr-connection.test.ts b/catalog/_shared/servarr-connection.test.ts
index a138517..824f5e1 100644
--- a/catalog/_shared/servarr-connection.test.ts
+++ b/catalog/_shared/servarr-connection.test.ts
@@ -382,2 +382,42 @@ describe("an arr's connection to Jellyfin, at another address", () => {
   });
+
+  it("reads a host or a setting it can't as one it can't, never as empty", async () => {
+    const { api, state } = await sonarr();
+    await connection.create(api, wanted());
+    const [made] = state.connections;
+    if (made === undefined) throw new Error('no connection made');
+    made.fields = made.fields.map((f) =>
+      f.name === 'host'
+        ? { ...f, value: 8096 }
+        : f.name === 'updateLibrary'
+          ? { name: 'updateLibrary' }
+          : f,
+    );
+    expect(await connection.observe(api, undefined)).toMatchObject({
+      fields: { port: 8096 },
+      unreadable: {
+        host: 'a number, not text',
+        updateLibrary: 'nothing, not true or false',
+      },
+    });
+    // A TLS or URL base setting of another type: where the key goes can't be told.
+    for (const [name, value, why] of [
+      ['useSsl', 'yes', 'useSsl is not true or false'],
+      ['urlBase', 7, 'urlBase is not text'],
+    ] as const) {
+      made.fields = made.fields.map((f) =>
+        f.name === 'host'
+          ? { ...f, value: 'jellyfin' }
+          : f.name === 'useSsl'
+            ? { ...f, value: false }
+            : f.name === 'urlBase'
+              ? { ...f, value: '' }
+              : f,
+      );
+      made.fields = made.fields.map((f) => (f.name === name ? { ...f, value } : f));
+      expect((await connection.observe(api, undefined))?.unreadable?.host).toBe(
+        `its ${why}, so where the arr sends the key can't be told`,
+      );
+    }
+  });
 });
```

**Change** `catalog/_shared/servarr-download.test.ts`:

```diff
diff --git a/catalog/_shared/servarr-download.test.ts b/catalog/_shared/servarr-download.test.ts
index ec5615a..f69af84 100644
--- a/catalog/_shared/servarr-download.test.ts
+++ b/catalog/_shared/servarr-download.test.ts
@@ -51,3 +51,7 @@ function contextOf(resolved: ResolvedStack = stack()): WiringContext {
 
-const client = servarrDownloadClient({ category: 'tv', setting: 'tvCategory' });
+const client = servarrDownloadClient({
+  category: 'tv',
+  setting: 'tvCategory',
+  imported: 'tvImportedCategory',
+});
 
@@ -68,3 +72,13 @@ async function sonarr() {
   });
-  return { api, app: apis.app, state };
+  // qBittorrent, as plan reaches it: what a check may ask of another app.
+  const qbittorrent = createAppApi({
+    name: 'qBittorrent',
+    service: 'qbittorrent',
+    port: 8080,
+    endpoint: { host: '127.0.0.1', port: apis.app.port },
+    key: { scheme: 'bearer', value: QBT_KEY },
+    secrets: [SONARR_KEY, QBT_KEY],
+    retry: { deadlineMs: 0 },
+  });
+  return { api, app: apis.app, state, qbittorrent, apis };
 }
@@ -210,2 +224,159 @@ describe('servarrDownloadClient', () => {
 
+  it("leaves the key unchecked in plan when the arr's test would make a missing post-import category", async () => {
+    const { api, app, state, qbittorrent, apis } = await sonarr();
+    const desired = wanted();
+    await client.create(api, desired);
+    const qbt = apis.apps.get('qbittorrent');
+    if (qbt === undefined) throw new Error('no qBittorrent faked');
+    qbt.categories = { tv: '/data/torrents/tv' };
+    const [held] = state.downloadClients;
+    if (held === undefined) throw new Error('no client made');
+    held.fields = held.fields.map((f) =>
+      f.name === 'tvImportedCategory' ? { ...f, value: 'tv-imported' } : f,
+    );
+    const observed = await client.observe(api, undefined);
+    if (observed === undefined) throw new Error('no client observed');
+    const tests = () =>
+      app.requests.filter((r) => r.path === '/api/v3/downloadclient/test').length;
+    const before = tests();
+    const plan = {
+      readOnly: true,
+      peer: (id: string) => (id === 'qbittorrent' ? qbittorrent : undefined),
+    };
+    expect(await client.verify?.(api, desired, observed, plan)).toEqual({
+      unchecked:
+        "qBittorrent has no category tv-imported (tvImportedCategory), which Sonarr's download client names, and Sonarr's own test of it would make it with no save path, so it isn't run: make it in qBittorrent, or name one in Sonarr that qBittorrent has, then run drift again",
+    });
+    expect(tests()).toBe(before);
+    expect(Object.keys(qbt.categories)).toEqual(['tv']);
+    // qBittorrent out of reach: unchecked too.
+    expect(
+      await client.verify?.(api, desired, observed, {
+        readOnly: true,
+        peer: () => undefined,
+      }),
+    ).toEqual({
+      unchecked:
+        "Sonarr's own test of its download client would make any of tv (tvCategory) and tv-imported (tvImportedCategory) that qBittorrent lacks, with no save path, so it isn't run while qBittorrent can't be asked which it has: run drift again once it answers",
+    });
+    // Apply's check runs the test, which makes the category, as the arr's own does.
+    expect(await client.verify?.(api, desired, observed)).toBe(true);
+    expect(qbt.categories['tv-imported']).toBe('');
+    // Once qBittorrent has it, plan runs the test.
+    expect(await client.verify?.(api, desired, observed, plan)).toBe(true);
+    expect(tests()).toBe(before + 2);
+  });
+
+  it('leaves the key unchecked in plan while qBittorrent lacks the category the client files under', async () => {
+    // No longer Mediaplane's in qBittorrent (unmanaged), and deleted there.
+    const { api, app, state, qbittorrent, apis } = await sonarr();
+    const desired = wanted();
+    await client.create(api, desired);
+    const qbt = apis.apps.get('qbittorrent');
+    if (qbt === undefined) throw new Error('no qBittorrent faked');
+    qbt.categories = {};
+    const observed = await client.observe(api, undefined);
+    if (observed === undefined) throw new Error('no client observed');
+    const tests = () =>
+      app.requests.filter((r) => r.path === '/api/v3/downloadclient/test').length;
+    const before = tests();
+    const plan = { readOnly: true, peer: () => qbittorrent };
+    expect(await client.verify?.(api, desired, observed, plan)).toEqual({
+      unchecked:
+        "qBittorrent has no category tv (tvCategory), which Sonarr's download client names, and Sonarr's own test of it would make it with no save path, so it isn't run: make it in qBittorrent, or name one in Sonarr that qBittorrent has, then run drift again",
+    });
+    expect(tests()).toBe(before);
+    expect(qbt.categories).toEqual({});
+    // Apply's check runs the test, which makes it, with no save path, as the arr's does.
+    expect(state.downloadClients).toHaveLength(1);
+    expect(await client.verify?.(api, desired, observed)).toBe(true);
+    expect(qbt.categories).toEqual({ tv: '' });
+  });
+
+  it("leaves the key unchecked in plan while qBittorrent can't say which categories it has", async () => {
+    const { api, app } = await sonarr();
+    const desired = wanted();
+    await client.create(api, desired);
+    const observed = await client.observe(api, undefined);
+    if (observed === undefined) throw new Error('no client observed');
+    const broken = await fakeHttpApp(() => ({ status: 500 }));
+    const failing = createAppApi({
+      name: 'qBittorrent',
+      service: 'qbittorrent',
+      port: 8080,
+      endpoint: { host: '127.0.0.1', port: broken.port },
+      key: { scheme: 'bearer', value: QBT_KEY },
+      secrets: [QBT_KEY],
+      retry: { deadlineMs: 0 },
+    });
+    const tests = () =>
+      app.requests.filter((r) => r.path === '/api/v3/downloadclient/test').length;
+    const before = tests();
+    const verdict = await client.verify?.(api, desired, observed, {
+      readOnly: true,
+      peer: () => failing,
+    });
+    expect(verdict).toEqual({
+      unchecked: expect.stringMatching(
+        /^Sonarr's own test of its download client would make any of tv \(tvCategory\) that qBittorrent lacks, with no save path, so it isn't run while qBittorrent can't be asked which it has \(qBittorrent at .*\/api\/v2\/torrents\/categories\)\): run drift again once it answers$/,
+      ) as string,
+    });
+    expect(tests()).toBe(before);
+  });
+
+  it("leaves the key unchecked in plan while the client's post-import category isn't text", async () => {
+    const { api, app, state, qbittorrent } = await sonarr();
+    const desired = wanted();
+    await client.create(api, desired);
+    const [held] = state.downloadClients;
+    if (held === undefined) throw new Error('no client made');
+    held.fields = held.fields.map((f) =>
+      f.name === 'tvImportedCategory' ? { ...f, value: 7 } : f,
+    );
+    const observed = await client.observe(api, undefined);
+    if (observed === undefined) throw new Error('no client observed');
+    const before = app.requests.length;
+    expect(
+      await client.verify?.(api, desired, observed, {
+        readOnly: true,
+        peer: () => qbittorrent,
+      }),
+    ).toEqual({
+      unchecked:
+        "Sonarr's download client holds a tvImportedCategory that isn't text, so its own test of it, which could make a category in qBittorrent, isn't run: set tvImportedCategory in Sonarr, then run drift again",
+    });
+    expect(app.requests.slice(before).some((r) => r.path.endsWith('/test'))).toBe(false);
+  });
+
+  it("reads a client setting it can't, of another type or missing, as one it can't, never as empty", async () => {
+    const { api } = await sonarrAnswering({
+      'GET /api/v3/downloadclient': {
+        status: 200,
+        body: [
+          {
+            id: 1,
+            name: DOWNLOAD_CLIENT_NAME,
+            implementation: 'QBittorrent',
+            fields: [
+              { name: 'host', value: 'gluetun' },
+              { name: 'port', value: '8080' },
+              { name: 'useSsl', value: false },
+              { name: 'tvCategory' },
+            ],
+          },
+        ],
+      },
+    });
+    expect(await client.observe(api, undefined)).toEqual({
+      id: 1,
+      name: DOWNLOAD_CLIENT_NAME,
+      fields: { host: 'gluetun', useSsl: false },
+      unreadable: {
+        category: 'nothing, not text',
+        enable: 'nothing, not true or false',
+        port: 'text, not a number',
+      },
+    });
+  });
+
   it("says the app's own words when its test fails for another reason", async () => {
@@ -372,3 +543,3 @@ describe('servarrRootFolder', () => {
       name: '/data/media/tv',
-      fields: { path: '/data/media/tv' },
+      fields: { path: '/data/media/tv', accessible: true },
       secrets: {},
@@ -386,2 +557,25 @@ describe('servarrRootFolder', () => {
     state.rootFolders = [{ id: 1, path: '/data/media/tv/' }];
+    expect(await folder.observe(api, undefined)).toEqual({
+      id: 1,
+      name: '/data/media/tv',
+      fields: { path: '/data/media/tv', accessible: true },
+    });
+  });
+
+  it('says the arr can no longer reach its folder, deleted by hand, so apply makes it again', async () => {
+    const { api, state } = await sonarr();
+    state.rootFolders = [{ id: 1, path: '/data/media/tv' }];
+    expect((await folder.observe(api, undefined))?.fields).toEqual({
+      path: '/data/media/tv',
+      accessible: false,
+    });
+  });
+
+  it("says when the arr doesn't say whether it reaches the folder, rather than guess", async () => {
+    const { api } = await sonarrAnswering({
+      'GET /api/v3/rootfolder': {
+        status: 200,
+        body: [{ id: 1, path: '/data/media/tv' }],
+      },
+    });
     expect(await folder.observe(api, undefined)).toEqual({
@@ -390,2 +584,3 @@ describe('servarrRootFolder', () => {
       fields: { path: '/data/media/tv' },
+      unreadable: { accessible: 'nothing, not true or false' },
     });
```

**Change** `catalog/jellyfin/integration.test.ts`:

```diff
diff --git a/catalog/jellyfin/integration.test.ts b/catalog/jellyfin/integration.test.ts
index e75cbe2..53290fc 100644
--- a/catalog/jellyfin/integration.test.ts
+++ b/catalog/jellyfin/integration.test.ts
@@ -543,2 +543,18 @@ describe("Jellyfin's libraries", () => {
 
+  it('says a library of another name holds its folder, rather than put it in two', async () => {
+    const { api, state } = await jellyfin(setUp(), true);
+    state.folders.push('/data/media/tv');
+    state.libraries.push({
+      Name: 'Series',
+      CollectionType: 'tvshows',
+      Locations: ['/data/media/tv/'],
+      LibraryOptions: {},
+    });
+    expect(await shows.observe(api, undefined)).toBeUndefined();
+    expect((await failure(shows.create(api, wanted(shows)))).message).toBe(
+      'Jellyfin at http://jellyfin:8096 (127.0.0.1) has no library named Shows, but its library Series holds its folder: if it is Shows renamed, rename it back in Jellyfin; to keep it as it is, stop Mediaplane managing Shows with jellyfin.library_shows: unmanaged under overrides: (GET /Library/VirtualFolders)',
+    );
+    expect(state.libraries.map((l) => l.Name)).toEqual(['Series']);
+  });
+
   it('removes a folder with a comma in its name, which `paths` cannot tell apart', async () => {
@@ -554,2 +570,6 @@ describe("Jellyfin's libraries", () => {
     if (held === undefined) throw new Error('Shows is there');
+    // It can't be listed in `paths`, so it is said to be.
+    expect(held.unreadable).toEqual({
+      paths: 'a folder with a comma in its name, /data/media/a,b',
+    });
     await shows.update(api, wanted(shows), held);
@@ -584,5 +604,7 @@ describe("Jellyfin's libraries", () => {
     if (held === undefined) throw new Error('Shows is there');
-    expect(held.fields.collectionType).toBe('');
+    // Jellyfin gives none for mixed content: read as one Mediaplane can't, never empty.
+    expect(held.fields.collectionType).toBeUndefined();
+    expect(held.unreadable).toEqual({ collectionType: 'nothing, not text' });
     expect((await failure(shows.update(api, wanted(shows), held))).message).toBe(
-      "Jellyfin at http://jellyfin:8096 (127.0.0.1) has a library named Shows that holds mixed content, not tvshows, and Jellyfin can't change what a library holds: rename or remove it in Jellyfin, and the next apply makes Shows (GET /Library/VirtualFolders)",
+      "Jellyfin at http://jellyfin:8096 (127.0.0.1) has a library named Shows that holds mixed content, or a kind Mediaplane can't read, not tvshows, and Jellyfin can't change what a library holds: rename or remove it in Jellyfin, and the next apply makes Shows (GET /Library/VirtualFolders)",
     );
```

**Change** `catalog/plex/integration.test.ts`:

```diff
diff --git a/catalog/plex/integration.test.ts b/catalog/plex/integration.test.ts
index c0bca9a..fb25625 100644
--- a/catalog/plex/integration.test.ts
+++ b/catalog/plex/integration.test.ts
@@ -267,2 +267,49 @@ describe("Plex's libraries", () => {
 
+  it('says a library of another name holds its folder, rather than put it in two', async () => {
+    const { api, plex } = await plexOf();
+    plex.sections.push({
+      key: '3',
+      title: 'Series',
+      type: 'show',
+      agent: 'tv.plex.agents.series',
+      scanner: 'Plex TV Series',
+      language: 'en-US',
+      locations: ['/data/media/tv'],
+    });
+    const tv = resource('library_tv');
+    expect(await tv.observe(api, undefined)).toBeUndefined();
+    expect(await thrown(tv.create(api, wanted('library_tv')))).toMatchObject({
+      kind: 'rejected',
+      message:
+        'Plex at http://plex:32400 (127.0.0.1) has no library named TV Shows, but its library Series holds its folder: if it is TV Shows renamed, rename it back in Plex; to keep it as it is, stop Mediaplane managing TV Shows with plex.library_tv: unmanaged under overrides: (GET /library/sections)',
+    });
+    expect(plex.sections.map((s) => s.title)).toEqual(['Series']);
+    // Known by its key, renamed is found, and its name put back.
+    const movies = resource('library_movies');
+    await movies.create(api, wanted('library_movies'));
+    const made = plex.sections.find((s) => s.title === 'Movies');
+    if (made === undefined) throw new Error('no library made');
+    made.title = 'Films';
+    const known = {
+      id: made.key,
+      name: 'Movies',
+      fields: {},
+      secrets: [],
+      appliedAt: '2026-10-20T08:00:00.000Z',
+    };
+    expect((await movies.observe(api, known))?.fields.name).toBe('Films');
+  });
+
+  it("reads a folder with a comma in its name, and a name it can't, as such", async () => {
+    const { api, plex } = await plexOf();
+    const movies = resource('library_movies');
+    await movies.create(api, wanted('library_movies'));
+    const [made] = plex.sections;
+    if (made === undefined) throw new Error('no library made');
+    made.locations = ['/data/media/movies', '/data/a,b'];
+    expect((await movies.observe(api, undefined))?.unreadable).toEqual({
+      location: 'a folder with a comma in its name, /data/a,b',
+    });
+  });
+
   it('holds the folders an override names, made in one go and put back', async () => {
```

**Change** `catalog/prowlarr/integration.test.ts`:

```diff
diff --git a/catalog/prowlarr/integration.test.ts b/catalog/prowlarr/integration.test.ts
index 768cfdf..51a4a8d 100644
--- a/catalog/prowlarr/integration.test.ts
+++ b/catalog/prowlarr/integration.test.ts
@@ -382,2 +382,15 @@ apps:
 
+  it("reads categories it can't as such, never as none", async () => {
+    const { api, state } = await prowlarr();
+    await toSonarr.create(api, wanted(toSonarr));
+    const [held] = state.applications;
+    if (held === undefined) throw new Error('no link made');
+    held.fields = held.fields.map((f) =>
+      f.name === 'syncCategories' ? { ...f, value: '5000' } : f,
+    );
+    expect((await toSonarr.observe(api, undefined))?.unreadable).toEqual({
+      syncCategories: 'text, not a list of numbers',
+    });
+  });
+
   it('refuses a Prowlarr that offers no link to the arr, and sends nothing', async () => {
@@ -466,2 +479,14 @@ describe('the indexer proxy', () => {
 
+  it("reads tags it can't as such, never as none", async () => {
+    const { api, state } = await prowlarr();
+    await proxy.create(api, wanted(proxy));
+    const [held] = state.proxies;
+    if (held === undefined) throw new Error('no proxy made');
+    held.tags = 'cloudflare' as unknown as number[];
+    expect(await proxy.observe(api, undefined)).toMatchObject({
+      fields: { host: 'http://byparr:8191/', requestTimeout: 60 },
+      unreadable: { tags: 'not a list of tag ids' },
+    });
+  });
+
   it('gives the proxy the tags an override names, finding or making each by its label', async () => {
```

**Change** `catalog/qbittorrent/integration.test.ts`:

```diff
diff --git a/catalog/qbittorrent/integration.test.ts b/catalog/qbittorrent/integration.test.ts
index a226503..3effeaa 100644
--- a/catalog/qbittorrent/integration.test.ts
+++ b/catalog/qbittorrent/integration.test.ts
@@ -230,2 +230,21 @@ apps:
     });
+
+    it("reads a setting held in another shape as one it can't, never as false or empty", async () => {
+      const { api, state } = await qbittorrent();
+      state.preferences = {
+        ...state.preferences,
+        auto_tmm_enabled: 'yes',
+        save_path: '',
+      };
+      expect(await settings.observe(api, undefined)).toEqual({
+        id: null,
+        name: 'preferences',
+        fields: {
+          savePath: '',
+          authSubnetWhitelistEnabled: false,
+          authSubnetWhitelist: '',
+        },
+        unreadable: { autoTmm: 'text, not true or false' },
+      });
+    });
   });
```

**Change** `catalog/seerr/integration.test.ts`:

```diff
diff --git a/catalog/seerr/integration.test.ts b/catalog/seerr/integration.test.ts
index fba0f74..b455203 100644
--- a/catalog/seerr/integration.test.ts
+++ b/catalog/seerr/integration.test.ts
@@ -384,2 +384,16 @@ describe("Seerr's media server", () => {
 
+  it('gives Seerr the key at once when the check found it refused: one failed check per apply', async () => {
+    const { api, state, jellyfin, calls } = await seerr();
+    const desired = wanted(spec);
+    jellyfin.apiKeys = jellyfin.apiKeys.filter((k) => k.AppName !== 'Seerr');
+    const observed = await spec.observe(api, undefined, desired);
+    if (observed === undefined) throw new Error('observed');
+    expect(await spec.verify?.(api, desired, observed)).toBe(false);
+    const before = calls().length;
+    await spec.update(api, desired, observed, ['apiKey']);
+    expect(calls(before)).not.toContain('GET /api/v1/settings/jellyfin/users');
+    expect(state.seerr.jellyfin).toMatchObject({ apiKey: JELLYFIN_KEY });
+    expect(state.seerr.errors).toHaveLength(1);
+  });
+
   it("sends Mediaplane's Jellyfin key only to the stack's Jellyfin, whatever Seerr holds", async () => {
@@ -777,2 +791,17 @@ describe.each([
 
+  it("reads a setting Seerr holds in another shape as one it can't, never as false or empty", async () => {
+    const { api, state } = await seerr();
+    const desired =
+      (await spec.resolve?.(api, wanted(spec), contextOf())) ?? wanted(spec);
+    await spec.create(api, desired);
+    const held = state.seerr[arr][0];
+    if (held === undefined) throw new Error('held');
+    Object.assign(held, { isDefault: 'yes', useSsl: 'no' });
+    expect((await spec.observe(api, undefined, desired))?.unreadable).toEqual({
+      hostname:
+        "its TLS, URL base or port is held in a shape Mediaplane can't read, so where Seerr sends the key it holds can't be told",
+      isDefault: 'text, not true or false',
+    });
+  });
+
   it('puts back what was changed by hand: its profile, folder and default', async () => {
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index f889ee7..5d5a2b9 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -24,2 +24,3 @@ import {
   type KnownResources,
+  type PlanResult,
   type Runtime,
@@ -151,3 +152,3 @@ const WIRED: KnownResources = {
     name: '/data/media/tv',
-    fields: { path: '/data/media/tv' },
+    fields: { path: '/data/media/tv', accessible: true },
     secrets: [],
@@ -247,2 +248,3 @@ async function currentHome(
     rootFolders: [{ id: 1, path: '/data/media/tv' }],
+    folders: ['/data/media/tv'],
     connections: [
@@ -478,2 +480,35 @@ describe('mediaplane plan', () => {
 
+  it('asks no arr to test its download client while the post-import category it names is missing', async () => {
+    // Sonarr's own test would make it in qBittorrent, which Mediaplane doesn't manage:
+    // plan leaves the key unchecked (the owner's decision of 2026-10-17).
+    const runtime = fakeRuntime({
+      hashes: { ok: true, hashes: HASHES },
+      containers: running(HASHES),
+    });
+    const home = await currentHome(runtime);
+    const sonarr = apis.apps.get('sonarr');
+    const qbittorrent = apis.apps.get('qbittorrent');
+    if (sonarr === undefined || qbittorrent === undefined)
+      throw new Error('no apps faked');
+    sonarr.downloadClients[0]?.fields.push({
+      name: 'tvImportedCategory',
+      value: 'tv-done',
+    });
+    const tested = () =>
+      apis.app.requests.filter((r) => r.path === '/api/v3/downloadclient/test').length;
+    const json = capture();
+    expect(await run(['plan', '--home', home, '--json'], json.io, deps(runtime))).toBe(0);
+    expect(tested()).toBe(0);
+    expect(Object.keys(qbittorrent.categories)).toEqual(['tv']);
+    expect(
+      (JSON.parse(json.stdout()) as PlanResult).checks.find(
+        (c) => c.resource === 'sonarr.download_client',
+      ),
+    ).toMatchObject({ secret: 'apiKey', verdict: 'unchecked' });
+    // Once qBittorrent has it, plan runs the test.
+    qbittorrent.categories['tv-done'] = '/data/torrents/tv-done';
+    expect(await run(['plan', '--home', home], capture().io, deps(runtime))).toBe(0);
+    expect(tested()).toBe(1);
+  });
+
   it("keeps qBittorrent's key out of what an arr's own test of its download client says", async () => {
```

**Create** `packages/engine/src/integrations/read.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fieldReader } from './read';

describe('fieldReader', () => {
  it('reads each kind of field, a list of numbers sorted', () => {
    const read = fieldReader();
    expect(
      read.observed(1, 'client', {
        host: read.text('host', 'gluetun'),
        port: read.number('port', 8080),
        on: read.flag('on', false),
        categories: read.numbers('categories', [5010, 5000]),
      }),
    ).toEqual({
      id: 1,
      name: 'client',
      fields: {
        host: 'gluetun',
        port: 8080,
        on: false,
        categories: '5000,5010',
      },
    });
  });

  it("says what it found in place of each field it can't read, and leaves it out", () => {
    const read = fieldReader();
    expect(
      read.observed(null, 'odd', {
        host: read.text('host', { at: 'x' }),
        port: read.number('port', '8080'),
        on: read.flag('on', null),
        categories: read.numbers('categories', [5000, '5010']),
        tags: read.refuse('tags', 'not a list of tag ids'),
        name: read.text('name', ['a']),
        enabled: read.flag('enabled', 1),
        missing: read.text('missing', undefined),
        yes: read.number('yes', true),
      }),
    ).toEqual({
      id: null,
      name: 'odd',
      fields: {},
      unreadable: {
        categories: 'a list, not a list of numbers',
        enabled: 'a number, not true or false',
        host: 'an object, not text',
        missing: 'nothing, not text',
        name: 'a list, not text',
        on: 'nothing, not true or false',
        port: 'text, not a number',
        tags: 'not a list of tag ids',
        yes: 'true or false, not a number',
      },
    });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog/_shared/servarr-connection.test.ts catalog/_shared/servarr-download.test.ts catalog/jellyfin/integration.test.ts catalog/plex/integration.test.ts catalog/prowlarr/integration.test.ts catalog/qbittorrent/integration.test.ts catalog/seerr/integration.test.ts packages/cli/src/run.test.ts packages/engine/src/integrations/read.test.ts`
Expected: FAIL. `read.test.ts` doesn't load (`Cannot find module './read'`), and 21 tests fail, 200 pass: 8 in `servarr-download.test.ts` (the arr's test runs while qBittorrent lacks the post-import category, or the client's own, or can't say which it has, or while the setting isn't text; no `unreadable`; no `accessible`), 3 in Jellyfin's and 2 in Plex's (a second library is made on the renamed one's folder; a comma, a missing `CollectionType` or a name of another type isn't reported), 3 in Seerr's (Seerr's list of Jellyfin's users is asked again; a setting of another type fails the whole resource), 2 in Prowlarr's, and 1 each in `servarr-connection.test.ts`, qBittorrent's and `run.test.ts` (`plan` runs Sonarr's test while its post-import category is missing).

- [ ] **Step 3: Write the reader, `accessible`, the library guards and the marks**

**Change** `catalog/_shared/servarr-connection.ts`:

```diff
diff --git a/catalog/_shared/servarr-connection.ts b/catalog/_shared/servarr-connection.ts
index 7b91dcd..a80c143 100644
--- a/catalog/_shared/servarr-connection.ts
+++ b/catalog/_shared/servarr-connection.ts
@@ -4,2 +4,3 @@ import {
   type DesiredResource,
+  type FieldReader,
   type ResourceSpec,
@@ -8,3 +9,3 @@ import {
 import {
-  numberOf,
+  optionalText,
   secretOf,
@@ -13,3 +14,2 @@ import {
   settingOf,
-  textOf,
   type Provider,
@@ -79,9 +79,18 @@ const PLEX: MediaServer = {
  */
-function heldHost(held: Provider): string {
-  const host = textOf(settingOf(held, 'host'));
-  const tls = settingOf(held, 'useSsl') === true;
-  const base = textOf(settingOf(held, 'urlBase'));
+function heldHost(held: Provider, read: FieldReader): string | undefined {
+  const host = read.text('host', settingOf(held, 'host'));
+  if (host === undefined) return undefined;
+  const tls = settingOf(held, 'useSsl');
+  const base = optionalText(settingOf(held, 'urlBase'));
+  // Where the arr sends the key can't be told from a setting of another type.
+  if (typeof tls !== 'boolean' || base === undefined) {
+    read.refuse(
+      'host',
+      `its ${typeof tls !== 'boolean' ? 'useSsl is not true or false' : 'urlBase is not text'}, so where the arr sends the key can't be told`,
+    );
+    return undefined;
+  }
   if (!tls && base === '') return host;
-  const port = String(numberOf(settingOf(held, 'port')));
-  return `${tls ? 'https' : 'http'}://${host}:${port}${base}`;
+  const port = settingOf(held, 'port');
+  return `${tls ? 'https' : 'http'}://${host}:${typeof port === 'number' ? String(port) : '?'}${base}`;
 }
@@ -146,6 +155,6 @@ function servarrMediaServer(
       credentials: server.credentials,
-      fieldsOf: (held) => ({
-        host: heldHost(held),
-        port: numberOf(settingOf(held, 'port')),
-        updateLibrary: settingOf(held, 'updateLibrary') === true,
+      fieldsOf: (held, read) => ({
+        host: heldHost(held, read),
+        port: read.number('port', settingOf(held, 'port')),
+        updateLibrary: read.flag('updateLibrary', settingOf(held, 'updateLibrary')),
       }),
```

**Change** `catalog/_shared/servarr-download.ts`:

```diff
diff --git a/catalog/_shared/servarr-download.ts b/catalog/_shared/servarr-download.ts
index d03b84c..35ef767 100644
--- a/catalog/_shared/servarr-download.ts
+++ b/catalog/_shared/servarr-download.ts
@@ -1,7 +1,13 @@
 import {
+  AppApiError,
+  fieldReader,
   SENDS_A_KEY,
   serviceAddress,
+  type AppApi,
   type DesiredResource,
-  type Fields,
+  type FieldReader,
+  type ObservedResource,
   type ResourceSpec,
+  type Scalar,
+  type VerifyContext,
 } from '@mediaplane/engine';
@@ -9,3 +15,4 @@ import { z } from 'zod';
 import {
-  numberOf,
+  optionalText,
+  providerOf,
   secretOf,
@@ -14,3 +21,3 @@ import {
   settingOf,
-  textOf,
+  testProvider,
   type Provider,
@@ -45,12 +52,70 @@ export interface DownloadLink {
   setting: 'tvCategory' | 'movieCategory';
+  /**
+   * The arr's setting of the category it moves a download to once imported, which
+   * Mediaplane doesn't manage: Sonarr's tvImportedCategory, Radarr's
+   * movieImportedCategory.
+   */
+  imported: 'tvImportedCategory' | 'movieImportedCategory';
 }
 
-/** The managed fields of a download client, from the app's settings. */
-function fieldsOf(held: Provider, link: DownloadLink): Fields {
+const QBT_CATEGORIES = '/api/v2/torrents/categories';
+
+/**
+ * Why plan and drift leave the client's key unchecked, if they do: the arr's own test
+ * makes in qBittorrent each category the client names that qBittorrent lacks, with no
+ * save path (probed), and they change nothing (spec §5.2). That is its post-import one,
+ * which Mediaplane doesn't manage (the owner's decision of 2026-10-17, which this widens
+ * in its direction), or its own, once qBittorrent's is no longer Mediaplane's
+ * (`unmanaged`) and deleted. (One kept as another, Keep mine, is qBittorrent's category to
+ * make, by apply: the client waits for it.) A setting it can't read, or a qBittorrent it
+ * can't ask, leaves the key unchecked too. With qBittorrent holding each, undefined: the
+ * test is run.
+ */
+async function testWouldMake(
+  api: AppApi,
+  link: DownloadLink,
+  observed: ObservedResource,
+  ctx: VerifyContext,
+): Promise<string | undefined> {
+  const held = await providerOf(api, CLIENTS, observed.id);
+  const named: { setting: string; category: string }[] = [];
+  for (const setting of [link.setting, link.imported]) {
+    // Unset, the arr leaves a setting out; cleared, it holds "" (probed).
+    const category = optionalText(settingOf(held, setting));
+    if (category === undefined) {
+      return `${api.name}'s download client holds a ${setting} that isn't text, so its own test of it, which could make a category in qBittorrent, isn't run: set ${setting} in ${api.name}, then run drift again`;
+    }
+    if (category !== '') named.push({ setting, category });
+  }
+  if (named.length === 0) return undefined;
+  const which = (list: typeof named) =>
+    list.map(({ setting, category }) => `${category} (${setting})`).join(' and ');
+  const cannot = `${api.name}'s own test of its download client would make any of ${which(named)} that qBittorrent lacks, with no save path, so it isn't run while qBittorrent can't be asked which it has`;
+  const qbittorrent = ctx.peer('qbittorrent');
+  if (qbittorrent === undefined) return `${cannot}: run drift again once it answers`;
+  let categories: Record<string, unknown>;
+  try {
+    categories = await qbittorrent.get(QBT_CATEGORIES, z.record(z.string(), z.unknown()));
+  } catch (cause) {
+    if (!(cause instanceof AppApiError)) throw cause;
+    return `${cannot} (${cause.message}): run drift again once it answers`;
+  }
+  const missing = named.filter(({ category }) => !Object.hasOwn(categories, category));
+  return missing.length === 0
+    ? undefined
+    : `qBittorrent has no category ${which(missing)}, which ${api.name}'s download client names, and ${api.name}'s own test of it would make it with no save path, so it isn't run: make it in qBittorrent, or name one in ${api.name} that qBittorrent has, then run drift again`;
+}
+
+/** The managed fields of a download client, read from the app's settings. */
+function fieldsOf(
+  held: Provider,
+  link: DownloadLink,
+  read: FieldReader,
+): Record<string, Scalar | undefined> {
   return {
-    host: textOf(settingOf(held, 'host')),
-    port: numberOf(settingOf(held, 'port')),
-    useSsl: settingOf(held, 'useSsl') === true,
-    category: textOf(settingOf(held, link.setting)),
-    enable: held.enable === true,
+    host: read.text('host', settingOf(held, 'host')),
+    port: read.number('port', settingOf(held, 'port')),
+    useSsl: read.flag('useSsl', settingOf(held, 'useSsl')),
+    category: read.text('category', settingOf(held, link.setting)),
+    enable: read.flag('enable', held.enable),
   };
@@ -127,3 +192,3 @@ export function servarrDownloadClient(link: DownloadLink): ResourceSpec {
       credentials: CREDENTIALS,
-      fieldsOf: (held) => fieldsOf(held, link),
+      fieldsOf: (held, read) => fieldsOf(held, link, read),
       settingsOf: (desired) => settingsOf(desired, link),
@@ -131,2 +196,16 @@ export function servarrDownloadClient(link: DownloadLink): ResourceSpec {
     }),
+    async verify(api, desired, observed, ctx) {
+      if (ctx?.readOnly === true) {
+        const unchecked = await testWouldMake(api, link, observed, ctx);
+        if (unchecked !== undefined) return { unchecked };
+      }
+      return testProvider(
+        api,
+        CLIENTS,
+        observed.id,
+        desired.name,
+        CREDENTIALS,
+        sendsToOf(desired),
+      );
+    },
   };
@@ -134,3 +213,7 @@ export function servarrDownloadClient(link: DownloadLink): ResourceSpec {
 
-const rootFolder = z.looseObject({ id: z.number(), path: z.string() });
+const rootFolder = z.looseObject({
+  id: z.number(),
+  path: z.string(),
+  accessible: z.unknown().optional(),
+});
 
@@ -139,4 +222,6 @@ const rootFolder = z.looseObject({ id: z.number(), path: z.string() });
  * folder, which the downloads share, so that an import is a hard link. The app needs the
- * folder to exist: the wire step makes it first. A root folder is known by its path, and
- * the app can't change one (a PUT answers 405), so a found one is always as wanted.
+ * folder to exist: the wire step makes it first, and again when the arr says it can't
+ * reach it (`accessible`, which the arr reads from the disk each time it is asked:
+ * probed). A root folder is known by its path, and the app can't change one (a PUT
+ * answers 405), so there is nothing else to update.
  */
@@ -145,8 +230,15 @@ export function servarrRootFolder(path: string): ResourceSpec {
     name: 'root_folder',
-    fields: ['path'],
+    fields: ['path', 'accessible'],
     locked: {
       path: "the arr knows a root folder by its path, and can't move one: another path would add a second root folder beside this one, which holds your library. To move your library, move it in the arr, then stop Mediaplane managing this one with {resource}: unmanaged",
+      accessible:
+        'the arr says whether it can reach the folder, from the disk: apply makes the folder again',
     },
     secrets: [],
-    desired: () => ({ name: path, fields: { path }, secrets: {}, folders: [path] }),
+    desired: () => ({
+      name: path,
+      fields: { path, accessible: true },
+      secrets: {},
+      folders: [path],
+    }),
     async observe(api) {
@@ -155,5 +247,8 @@ export function servarrRootFolder(path: string): ResourceSpec {
       );
-      return held === undefined
-        ? undefined
-        : { id: held.id, name: path, fields: { path } };
+      if (held === undefined) return undefined;
+      const read = fieldReader();
+      return read.observed(held.id, path, {
+        path,
+        accessible: read.flag('accessible', held.accessible),
+      });
     },
@@ -163,3 +258,3 @@ export function servarrRootFolder(path: string): ResourceSpec {
     },
-    // Found by its path, it never differs from the one wanted: there is nothing to update.
+    // The wire step made its folder again first, which is all an update can do.
     update: () => Promise.resolve(),
```

**Change** `catalog/_shared/servarr-provider.ts`:

```diff
diff --git a/catalog/_shared/servarr-provider.ts b/catalog/_shared/servarr-provider.ts
index 258c891..2862be0 100644
--- a/catalog/_shared/servarr-provider.ts
+++ b/catalog/_shared/servarr-provider.ts
@@ -2,5 +2,6 @@ import {
   AppApiError,
+  fieldReader,
   type AppApi,
   type DesiredResource,
-  type Fields,
+  type FieldReader,
   type KnownResource,
@@ -8,2 +9,3 @@ import {
   type ResourceSpec,
+  type Scalar,
 } from '@mediaplane/engine';
@@ -52,10 +54,10 @@ export function settingOf(held: Provider, name: string): unknown {
 
-/** A setting's text, or "" when it holds none. */
-export function textOf(value: unknown): string {
-  return typeof value === 'string' ? value : '';
-}
-
-/** A setting's number, or 0 when it holds none. */
-export function numberOf(value: unknown): number {
-  return typeof value === 'number' ? value : 0;
+/**
+ * A setting the app leaves out while it is unset, such as a URL base: its text, "" when
+ * it holds none (left out, or cleared), or undefined when it holds a value of another
+ * type, which is never read as empty. A managed field is read with a FieldReader instead.
+ */
+export function optionalText(value: unknown): string | undefined {
+  if (value === undefined || value === null) return '';
+  return typeof value === 'string' ? value : undefined;
 }
@@ -83,2 +85,11 @@ export async function findProvider(
 
+/** The provider the app holds as `id`, as it gives it: its secrets masked. */
+export function providerOf(
+  api: AppApi,
+  kind: ProviderKind,
+  id: ObservedResource['id'],
+): Promise<Provider> {
+  return api.get(`${kind.path}/${String(id)}`, provider);
+}
+
 /**
@@ -231,4 +242,4 @@ export interface ProviderOptions {
   credentials: readonly string[];
-  /** Its managed fields, from what the app holds. */
-  fieldsOf: (held: Provider) => Fields;
+  /** Its managed fields, read from what the app holds: one it can't read is noted. */
+  fieldsOf: (held: Provider, read: FieldReader) => Record<string, Scalar | undefined>;
   /**
@@ -261,5 +272,5 @@ export function servarrProvider(
       const held = await findProvider(api, kind, known, name);
-      return held === undefined
-        ? undefined
-        : { id: held.id, name: held.name, fields: fieldsOf(held) };
+      if (held === undefined) return undefined;
+      const read = fieldReader();
+      return read.observed(held.id, held.name, fieldsOf(held, read));
     },
```

**Change** `catalog/_shared/servarr.ts`:

```diff
diff --git a/catalog/_shared/servarr.ts b/catalog/_shared/servarr.ts
index 5ecd55d..9978e3a 100644
--- a/catalog/_shared/servarr.ts
+++ b/catalog/_shared/servarr.ts
@@ -2,2 +2,3 @@ import {
   defineIntegration,
+  fieldReader,
   type ApiSpec,
@@ -59,3 +60,3 @@ export function servarrApi(version: 'v1' | 'v3'): ApiSpec {
 /** What Mediaplane reads of the app's host settings; the rest goes back as it came. */
-const hostSettings = z.looseObject({ id: z.number(), username: z.string() });
+const hostSettings = z.looseObject({ id: z.number(), username: z.unknown() });
 
@@ -93,5 +94,5 @@ export function servarrAdmin(version: 'v1' | 'v3'): ResourceSpec {
       // No user yet: the app asks for a login that nobody can give.
-      return username === ''
-        ? undefined
-        : { id: null, name: 'admin', fields: { username } };
+      if (username === '') return undefined;
+      const read = fieldReader();
+      return read.observed(null, 'admin', { username: read.text('username', username) });
     },
```

**Change** `catalog/jellyfin/integration.ts`:

```diff
diff --git a/catalog/jellyfin/integration.ts b/catalog/jellyfin/integration.ts
index c1ce070..33af065 100644
--- a/catalog/jellyfin/integration.ts
+++ b/catalog/jellyfin/integration.ts
@@ -3,2 +3,3 @@ import {
   defineIntegration,
+  fieldReader,
   listItems,
@@ -12,3 +13,3 @@ import { signIn } from './bootstrap';
 
-const user = z.looseObject({ Id: z.string(), Name: z.string() });
+const user = z.looseObject({ Id: z.string(), Name: z.unknown() });
 
@@ -36,5 +37,7 @@ const admin: ResourceSpec = {
       users.find((u) => u.Name === desired?.fields.username);
-    return held === undefined
-      ? undefined
-      : { id: held.Id, name: 'admin', fields: { username: held.Name } };
+    if (held === undefined) return undefined;
+    const read = fieldReader();
+    return read.observed(held.Id, 'admin', {
+      username: read.text('username', held.Name),
+    });
   },
@@ -92,4 +95,4 @@ const library = z.looseObject({
   Name: z.string(),
-  /** Absent for mixed content. */
-  CollectionType: z.string().optional(),
+  /** Absent for mixed content: read as one Mediaplane can't, never as empty. */
+  CollectionType: z.unknown().optional(),
   Locations: z.array(z.string()),
@@ -183,15 +186,29 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
       );
-      return held === undefined
-        ? undefined
-        : {
-            id: spec.name,
-            name: spec.name,
-            fields: {
-              name: held.Name,
-              collectionType: held.CollectionType ?? '',
-              paths: pathsOf(held.Locations),
-            },
-          };
+      if (held === undefined) return undefined;
+      const read = fieldReader();
+      // `paths` is one comma-separated list: a folder with a comma in its name can't be
+      // told apart in it, so it is said to be, and the update reads the folders again.
+      const odd = held.Locations.find((path) => path.includes(','));
+      return read.observed(spec.name, spec.name, {
+        name: held.Name,
+        collectionType: read.text('collectionType', held.CollectionType),
+        paths:
+          odd === undefined
+            ? pathsOf(held.Locations)
+            : read.refuse('paths', `a folder with a comma in its name, ${odd}`),
+      });
     },
     async create(api, desired) {
+      // A library of another name may hold the folder already: this one renamed by hand,
+      // which Jellyfin keys by its name. Another would put the folder in two libraries.
+      const wanted = wantedPaths(desired);
+      const holder = (await api.get(VIRTUAL_FOLDERS, z.array(library))).find((l) =>
+        l.Locations.some((path) => wanted.includes(trimmed(path))),
+      );
+      if (holder !== undefined) {
+        throw new AppApiError(
+          `${api.name} at ${api.where} has no library named ${spec.name}, but its library ${holder.Name} holds its folder: if it is ${spec.name} renamed, rename it back in Jellyfin; to keep it as it is, stop Mediaplane managing ${spec.name} with jellyfin.${spec.resource}: unmanaged under overrides: (GET ${VIRTUAL_FOLDERS})`,
+          { kind: 'rejected' },
+        );
+      }
       const query = new URLSearchParams([
@@ -208,6 +225,6 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
     async update(api, desired, observed) {
-      const holds = String(observed.fields.collectionType);
+      const holds = observed.fields.collectionType;
       if (holds !== spec.collectionType) {
         throw new AppApiError(
-          `${api.name} at ${api.where} has a library named ${spec.name} that holds ${holds === '' ? 'mixed content' : holds}, not ${spec.collectionType}, and Jellyfin can't change what a library holds: rename or remove it in Jellyfin, and the next apply makes ${spec.name} (GET ${VIRTUAL_FOLDERS})`,
+          `${api.name} at ${api.where} has a library named ${spec.name} that holds ${holds === undefined ? "mixed content, or a kind Mediaplane can't read" : String(holds)}, not ${spec.collectionType}, and Jellyfin can't change what a library holds: rename or remove it in Jellyfin, and the next apply makes ${spec.name} (GET ${VIRTUAL_FOLDERS})`,
           { kind: 'rejected' },
```

**Change** `catalog/plex/integration.ts`:

```diff
diff --git a/catalog/plex/integration.ts b/catalog/plex/integration.ts
index bfed306..5520216 100644
--- a/catalog/plex/integration.ts
+++ b/catalog/plex/integration.ts
@@ -3,2 +3,3 @@ import {
   defineIntegration,
+  fieldReader,
   listItems,
@@ -41,8 +42,6 @@ const server: ResourceSpec = {
     const { Setting } = (await api.get('/:/prefs', prefs)).MediaContainer;
-    const name = Setting.find((s) => s.id === 'FriendlyName')?.value;
-    return {
-      id: null,
-      name: 'server',
-      fields: { name: typeof name === 'string' ? name : '' },
-    };
+    const read = fieldReader();
+    return read.observed(null, 'server', {
+      name: read.text('name', Setting.find((s) => s.id === 'FriendlyName')?.value),
+    });
   },
@@ -92,3 +91,3 @@ const section = z.looseObject({
   title: z.string(),
-  type: z.string(),
+  type: z.unknown(),
   agent: z.string(),
@@ -110,8 +109,12 @@ async function sectionsOf(api: AppApi): Promise<z.infer<typeof section>[]> {
 
-/** A library's folders as one sorted list, each once and without a trailing "/". */
-function locationsOf(held: z.infer<typeof section>): string {
-  const trimmed = (held.Location ?? []).map(({ path }) =>
+/** A library's folders, each without a trailing "/". */
+function foldersOf(held: z.infer<typeof section>): string[] {
+  return (held.Location ?? []).map(({ path }) =>
     path.length > 1 ? path.replace(/\/+$/, '') : path,
   );
-  return [...new Set(trimmed)].sort().join(',');
+}
+
+/** A library's folders as one sorted list, each once. */
+function locationsOf(held: z.infer<typeof section>): string {
+  return [...new Set(foldersOf(held))].sort().join(',');
 }
@@ -153,11 +156,29 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
         held.find((s) => s.title === spec.name);
-      return found === undefined
-        ? undefined
-        : {
-            id: found.key,
-            name: found.title,
-            fields: { name: found.title, type: found.type, location: locationsOf(found) },
-          };
+      if (found === undefined) return undefined;
+      const read = fieldReader();
+      // `location` is one comma-separated list: a folder with a comma in its name can't be
+      // told apart in it, so it is said to be. The update sends the folders wanted.
+      const odd = foldersOf(found).find((path) => path.includes(','));
+      return read.observed(found.key, found.title, {
+        name: found.title,
+        type: read.text('type', found.type),
+        location:
+          odd === undefined
+            ? locationsOf(found)
+            : read.refuse('location', `a folder with a comma in its name, ${odd}`),
+      });
     },
     async create(api, desired) {
+      // A library of another name may hold the folder already: this one renamed by hand,
+      // and lost from state/resources.json. Another would put the folder in two libraries.
+      const wanted = wantedLocations(desired);
+      const holder = (await sectionsOf(api)).find((s) =>
+        foldersOf(s).some((path) => wanted.includes(path)),
+      );
+      if (holder !== undefined) {
+        throw new AppApiError(
+          `${api.name} at ${api.where} has no library named ${spec.name}, but its library ${holder.title} holds its folder: if it is ${spec.name} renamed, rename it back in Plex; to keep it as it is, stop Mediaplane managing ${spec.name} with plex.${spec.resource}: unmanaged under overrides: (GET ${SECTIONS})`,
+          { kind: 'rejected' },
+        );
+      }
       const query = new URLSearchParams([
@@ -184,6 +205,6 @@ function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
     async update(api, desired, observed) {
-      const holds = String(observed.fields.type);
+      const holds = observed.fields.type;
       if (holds !== spec.type) {
         throw new AppApiError(
-          `${api.name} at ${api.where} has a library named ${String(observed.fields.name)} that holds ${holds}, not ${spec.type}, and Plex can't change what a library holds: rename or remove it in Plex, and the next apply makes ${spec.name} (GET ${SECTIONS})`,
+          `${api.name} at ${api.where} has a library named ${String(observed.fields.name)} that holds ${holds === undefined ? "a kind Mediaplane can't read" : String(holds)}, not ${spec.type}, and Plex can't change what a library holds: rename or remove it in Plex, and the next apply makes ${spec.name} (GET ${SECTIONS})`,
           { kind: 'rejected' },
```

**Change** `catalog/prowlarr/integration.ts`:

```diff
diff --git a/catalog/prowlarr/integration.ts b/catalog/prowlarr/integration.ts
index 3eb4352..11a2bb8 100644
--- a/catalog/prowlarr/integration.ts
+++ b/catalog/prowlarr/integration.ts
@@ -1,2 +1,3 @@
 import {
+  fieldReader,
   listItems,
@@ -14,3 +15,2 @@ import {
   findProvider,
-  numberOf,
   secretOf,
@@ -19,3 +19,2 @@ import {
   settingOf,
-  textOf,
   updateProvider,
@@ -138,7 +137,7 @@ function application(link: (typeof LINKED)[number]): ResourceSpec {
       credentials: ['ApiKey'],
-      fieldsOf: (held) => ({
-        prowlarrUrl: textOf(settingOf(held, 'prowlarrUrl')),
-        baseUrl: textOf(settingOf(held, 'baseUrl')),
-        syncLevel: textOf(held.syncLevel),
-        syncCategories: categoriesOf(settingOf(held, 'syncCategories')),
+      fieldsOf: (held, read) => ({
+        prowlarrUrl: read.text('prowlarrUrl', settingOf(held, 'prowlarrUrl')),
+        baseUrl: read.text('baseUrl', settingOf(held, 'baseUrl')),
+        syncLevel: read.text('syncLevel', held.syncLevel),
+        syncCategories: read.numbers('syncCategories', settingOf(held, 'syncCategories')),
       }),
@@ -211,14 +210,13 @@ const indexerProxy: ResourceSpec = {
     const ids = tagIds.safeParse(held.tags);
-    return {
-      id: held.id,
-      name: held.name,
-      fields: {
-        host: textOf(settingOf(held, 'host')),
-        requestTimeout: numberOf(settingOf(held, 'requestTimeout')),
-        tags: (ids.success ? ids.data : [])
-          .map((id) => labels.get(id) ?? String(id))
-          .sort()
-          .join(','),
-      },
-    };
+    const read = fieldReader();
+    return read.observed(held.id, held.name, {
+      host: read.text('host', settingOf(held, 'host')),
+      requestTimeout: read.number('requestTimeout', settingOf(held, 'requestTimeout')),
+      tags: ids.success
+        ? ids.data
+            .map((id) => labels.get(id) ?? String(id))
+            .sort()
+            .join(',')
+        : read.refuse('tags', 'not a list of tag ids'),
+    });
   },
```

**Change** `catalog/qbittorrent/integration.ts`:

```diff
diff --git a/catalog/qbittorrent/integration.ts b/catalog/qbittorrent/integration.ts
index 8a539df..2ee331e 100644
--- a/catalog/qbittorrent/integration.ts
+++ b/catalog/qbittorrent/integration.ts
@@ -2,2 +2,3 @@ import {
   defineIntegration,
+  fieldReader,
   isUnmanaged,
@@ -29,11 +30,11 @@ const CATEGORIES_PATH = '/api/v2/torrents/categories';
 /**
- * What Mediaplane reads of qBittorrent's preferences. They hold its API key too: z.object
- * drops every other field, so nothing else is kept.
+ * What Mediaplane reads of qBittorrent's preferences, each read with a FieldReader. They
+ * hold its API key too: z.object drops every other field, so nothing else is kept.
  */
 const preferences = z.object({
-  web_ui_username: z.string(),
-  save_path: z.string(),
-  auto_tmm_enabled: z.boolean(),
-  bypass_auth_subnet_whitelist_enabled: z.boolean(),
-  bypass_auth_subnet_whitelist: z.string(),
+  web_ui_username: z.unknown(),
+  save_path: z.unknown(),
+  auto_tmm_enabled: z.unknown(),
+  bypass_auth_subnet_whitelist_enabled: z.unknown(),
+  bypass_auth_subnet_whitelist: z.unknown(),
 });
@@ -41,6 +42,7 @@ const preferences = z.object({
 /** qBittorrent's categories, by name. */
-const categories = z.record(z.string(), z.object({ savePath: z.string() }));
+const categories = z.record(z.string(), z.looseObject({ savePath: z.unknown() }));
 
 /** A path as qBittorrent gives it back: without a trailing "/". */
-function asKept(path: string): string {
+function asKept(path: string | undefined): string | undefined {
+  if (path === undefined) return undefined;
   return path.length > 1 ? path.replace(/\/+$/, '') : path;
@@ -85,3 +87,6 @@ const admin: ResourceSpec = {
     const held = await api.get(PREFERENCES, preferences);
-    return { id: null, name: 'admin', fields: { username: held.web_ui_username } };
+    const read = fieldReader();
+    return read.observed(null, 'admin', {
+      username: read.text('username', held.web_ui_username),
+    });
   },
@@ -145,12 +150,13 @@ const settings: ResourceSpec = {
     const held = await api.get(PREFERENCES, preferences);
-    return {
-      id: null,
-      name: 'preferences',
-      fields: {
-        savePath: asKept(held.save_path),
-        autoTmm: held.auto_tmm_enabled,
-        authSubnetWhitelistEnabled: held.bypass_auth_subnet_whitelist_enabled,
-        authSubnetWhitelist: subnetList(held.bypass_auth_subnet_whitelist),
-      },
-    };
+    const read = fieldReader();
+    const whitelist = read.text('authSubnetWhitelist', held.bypass_auth_subnet_whitelist);
+    return read.observed(null, 'preferences', {
+      savePath: asKept(read.text('savePath', held.save_path)),
+      autoTmm: read.flag('autoTmm', held.auto_tmm_enabled),
+      authSubnetWhitelistEnabled: read.flag(
+        'authSubnetWhitelistEnabled',
+        held.bypass_auth_subnet_whitelist_enabled,
+      ),
+      authSubnetWhitelist: whitelist === undefined ? undefined : subnetList(whitelist),
+    });
   },
@@ -217,5 +223,7 @@ function category(arr: string, name: string): ResourceSpec {
       const held = (await api.get(CATEGORIES_PATH, categories))[named];
-      return held === undefined
-        ? undefined
-        : { id: named, name: named, fields: { savePath: asKept(held.savePath) } };
+      if (held === undefined) return undefined;
+      const read = fieldReader();
+      return read.observed(named, named, {
+        savePath: asKept(read.text('savePath', held.savePath)),
+      });
     },
```

**Change** `catalog/radarr/integration.ts`:

```diff
diff --git a/catalog/radarr/integration.ts b/catalog/radarr/integration.ts
index 13ffe50..1a8315a 100644
--- a/catalog/radarr/integration.ts
+++ b/catalog/radarr/integration.ts
@@ -32,3 +32,7 @@ export default servarrIntegration(
   [
-    servarrDownloadClient({ category: 'movies', setting: 'movieCategory' }),
+    servarrDownloadClient({
+      category: 'movies',
+      setting: 'movieCategory',
+      imported: 'movieImportedCategory',
+    }),
     servarrRootFolder(ROOT_FOLDER),
```

**Change** `catalog/seerr/integration.ts`:

```diff
diff --git a/catalog/seerr/integration.ts b/catalog/seerr/integration.ts
index ecc2edf..987e213 100644
--- a/catalog/seerr/integration.ts
+++ b/catalog/seerr/integration.ts
@@ -3,2 +3,3 @@ import {
   defineIntegration,
+  fieldReader,
   isUnmanaged,
@@ -9,2 +10,3 @@ import {
   type DesiredResource,
+  type FieldReader,
   type ObservedResource,
@@ -20,4 +22,4 @@ import { ROOT_FOLDER as MOVIES } from '../radarr/integration';
 import { ROOT_FOLDER as TV } from '../sonarr/integration';
-import { heldHost, jellyfinSettings as heldJellyfin } from './jellyfin';
-import { heldPlexHost, plexSettings as heldPlex } from './plex';
+import { heldHost } from './jellyfin';
+import { heldPlexHost } from './plex';
 
@@ -75,10 +77,17 @@ function stackApp(
 
-const library = z.looseObject({ id: z.string(), name: z.string(), enabled: z.boolean() });
+const library = z.looseObject({ id: z.string(), name: z.string(), enabled: z.unknown() });
 /**
- * `serverId` is the server's own identifier, which Seerr sets at its first sign-in
- * through Jellyfin and on each link to Jellyfin it saves (read from Seerr's code): without
- * one, the link reads as not saved, as Plex's does without `machineId` (probed: a failed
- * save to Plex still leaves the address in Seerr's settings).
+ * Seerr's Jellyfin settings (`GET /api/v1/settings/jellyfin`), its key in clear, and the
+ * managed ones read with a FieldReader. `serverId` is the server's own identifier, which
+ * Seerr sets at its first sign-in through Jellyfin and on each link to Jellyfin it saves
+ * (read from Seerr's code): without one, the link reads as not saved, as Plex's does
+ * without `machineId` (probed: a failed save to Plex still leaves the address in Seerr's
+ * settings).
  */
-const jellyfinSettings = heldJellyfin.extend({
+const jellyfinSettings = z.looseObject({
+  ip: z.unknown(),
+  port: z.unknown(),
+  useSsl: z.unknown(),
+  urlBase: z.unknown(),
+  apiKey: z.string(),
   libraries: z.array(library),
@@ -87,9 +96,22 @@ const jellyfinSettings = heldJellyfin.extend({
 
-/** Which of the libraries `wanted` Seerr has enabled, as one list. */
+/**
+ * Which of the libraries `wanted` Seerr has enabled, as one list; none, said to be, when
+ * one of them is held as neither enabled nor not.
+ */
 function enabledOf(
+  read: FieldReader,
   libraries: readonly z.infer<typeof library>[],
   wanted: readonly string[],
-): string {
+): string | undefined {
+  const odd = libraries.find(
+    (held) => wanted.includes(held.name) && typeof held.enabled !== 'boolean',
+  );
+  if (odd !== undefined) {
+    read.refuse('libraries', `${odd.name} is held as neither enabled nor not`);
+    return undefined;
+  }
   return wanted
-    .filter((name) => libraries.some((held) => held.name === name && held.enabled))
+    .filter((name) =>
+      libraries.some((held) => held.name === name && held.enabled === true),
+    )
     .join(',');
@@ -97,2 +119,31 @@ function enabledOf(
 
+/**
+ * Where Seerr reaches a media server or an arr, read: its host as `fold` makes it of the
+ * settings (the URL Seerr calls, with TLS or a URL base), and its port. A setting of
+ * another type says the host can't be read: where Seerr sends the key it holds can't be
+ * told then.
+ */
+function addressOf(
+  read: FieldReader,
+  held: { host: unknown; port: unknown; useSsl: unknown; base: unknown },
+  fold: (at: { host: string; port: number; useSsl: boolean; base: string }) => string,
+): { hostname: string | undefined; port: number | undefined } {
+  const port = read.number('port', held.port);
+  const host = read.text('hostname', held.host);
+  if (host === undefined) return { hostname: undefined, port };
+  const base = held.base ?? '';
+  if (
+    typeof held.useSsl !== 'boolean' ||
+    typeof base !== 'string' ||
+    port === undefined
+  ) {
+    read.refuse(
+      'hostname',
+      "its TLS, URL base or port is held in a shape Mediaplane can't read, so where Seerr sends the key it holds can't be told",
+    );
+    return { hostname: undefined, port };
+  }
+  return { hostname: fold({ host, port, useSsl: held.useSsl, base }), port };
+}
+
 /**
@@ -160,3 +211,3 @@ async function enableLibraries(
     }
-    if (!held.enabled) {
+    if (held.enabled !== true) {
       await api.put(`${at}/${encodeURIComponent(held.id)}`, { enabled: true });
@@ -204,14 +255,15 @@ const mediaServer: ResourceSpec = {
     api.addSecret(held.apiKey);
-    return held.ip === '' || (held.serverId ?? '') === ''
-      ? undefined
-      : {
-          id: null,
-          name: 'Jellyfin',
-          fields: {
-            // With TLS or a URL base, the URL Seerr calls: another host than the stack's.
-            hostname: heldHost(held),
-            port: held.port,
-            libraries: enabledOf(held.libraries, librariesIn(desired, WANTED)),
-          },
-        };
+    if (held.ip === '' || (held.serverId ?? '') === '') return undefined;
+    const read = fieldReader();
+    // With TLS or a URL base, the URL Seerr calls: another host than the stack's.
+    const at = addressOf(
+      read,
+      { host: held.ip, port: held.port, useSsl: held.useSsl, base: held.urlBase },
+      ({ host, port, useSsl, base }) =>
+        heldHost({ ip: host, port, useSsl, urlBase: base }),
+    );
+    return read.observed(null, 'Jellyfin', {
+      ...at,
+      libraries: enabledOf(read, held.libraries, librariesIn(desired, WANTED)),
+    });
   },
@@ -229,5 +281,10 @@ const mediaServer: ResourceSpec = {
   },
-  async update(api, desired, observed) {
+  async update(api, desired, observed, changes = []) {
     const moved = !atStack(desired, observed);
-    if (moved || !(await heldKeyWorks(api))) await saveJellyfin(api, desired);
+    // A key the check found refused is given at once: each check that fails logs a line
+    // in Seerr's log, so one is enough (the owner's decision of 2026-10-17). One left
+    // unchecked, because a field differs, is checked here, once.
+    if (moved || changes.includes('apiKey') || !(await heldKeyWorks(api))) {
+      await saveJellyfin(api, desired);
+    }
     // Another Jellyfin has other library ids, though the names match: sync them again.
@@ -241,4 +298,10 @@ const PLEX = { path: 'plex', name: 'Plex' } as const;
 
-/** `machineId` is Plex's own identifier, which Seerr sets only once it has saved a link. */
-const plexSettings = heldPlex.extend({
+/**
+ * Seerr's Plex settings, the managed ones read with a FieldReader. `machineId` is Plex's
+ * own identifier, which Seerr sets only once it has saved a link.
+ */
+const plexSettings = z.looseObject({
+  ip: z.unknown(),
+  port: z.unknown(),
+  useSsl: z.unknown(),
   libraries: z.array(library),
@@ -292,13 +355,13 @@ const mediaServerPlex: ResourceSpec = {
     const held = await api.get(`${SETTINGS}/plex`, plexSettings);
-    return held.ip === '' || (held.machineId ?? '') === ''
-      ? undefined
-      : {
-          id: null,
-          name: 'Plex',
-          fields: {
-            hostname: heldPlexHost(held),
-            port: held.port,
-            libraries: enabledOf(held.libraries, librariesIn(desired, WANTED_PLEX)),
-          },
-        };
+    if (held.ip === '' || (held.machineId ?? '') === '') return undefined;
+    const read = fieldReader();
+    const at = addressOf(
+      read,
+      { host: held.ip, port: held.port, useSsl: held.useSsl, base: '' },
+      ({ host, port, useSsl }) => heldPlexHost({ ip: host, port, useSsl }),
+    );
+    return read.observed(null, 'Plex', {
+      ...at,
+      libraries: enabledOf(read, held.libraries, librariesIn(desired, WANTED_PLEX)),
+    });
   },
@@ -348,2 +411,3 @@ const ARRS = {
 
+/** A server as Seerr holds it, its key in clear, the managed fields read with a FieldReader. */
 const server = z.looseObject({
@@ -351,10 +415,10 @@ const server = z.looseObject({
   name: z.string(),
-  hostname: z.string(),
-  port: z.number(),
+  hostname: z.unknown(),
+  port: z.unknown(),
   apiKey: z.string(),
-  useSsl: z.boolean(),
-  baseUrl: z.string().optional(),
-  activeProfileName: z.string(),
-  activeDirectory: z.string(),
-  isDefault: z.boolean(),
+  useSsl: z.unknown(),
+  baseUrl: z.unknown().optional(),
+  activeProfileName: z.unknown(),
+  activeDirectory: z.unknown(),
+  isDefault: z.unknown(),
 });
@@ -365,6 +429,5 @@ const server = z.looseObject({
  */
-function serverHost(held: z.infer<typeof server>): string {
-  const base = held.baseUrl ?? '';
-  if (!held.useSsl && base === '') return held.hostname;
-  return `${held.useSsl ? 'https' : 'http'}://${held.hostname}:${String(held.port)}${base}`;
+function serverHost(at: { host: string; port: number; useSsl: boolean; base: string }) {
+  if (!at.useSsl && at.base === '') return at.host;
+  return `${at.useSsl ? 'https' : 'http'}://${at.host}:${String(at.port)}${at.base}`;
 }
@@ -516,16 +579,20 @@ function seerrServer(arr: keyof typeof ARRS): ResourceSpec {
         held.find((s) => s.name === name);
-      return found === undefined
-        ? undefined
-        : {
-            id: found.id,
-            name: found.name,
-            fields: {
-              // With TLS or a URL base, the URL Seerr calls: not the stack's host.
-              hostname: serverHost(found),
-              port: found.port,
-              activeProfile: found.activeProfileName,
-              activeDirectory: found.activeDirectory,
-              isDefault: found.isDefault,
-            },
-          };
+      if (found === undefined) return undefined;
+      const read = fieldReader();
+      return read.observed(found.id, found.name, {
+        // With TLS or a URL base, the URL Seerr calls: not the stack's host.
+        ...addressOf(
+          read,
+          {
+            host: found.hostname,
+            port: found.port,
+            useSsl: found.useSsl,
+            base: found.baseUrl,
+          },
+          serverHost,
+        ),
+        activeProfile: read.text('activeProfile', found.activeProfileName),
+        activeDirectory: read.text('activeDirectory', found.activeDirectory),
+        isDefault: read.flag('isDefault', found.isDefault),
+      });
     },
@@ -599,5 +666,8 @@ const setup: ResourceSpec = {
       `${SETTINGS}/public`,
-      z.looseObject({ initialized: z.boolean() }),
+      z.looseObject({ initialized: z.unknown() }),
     );
-    return { id: null, name: 'setup', fields: { initialized } };
+    const read = fieldReader();
+    return read.observed(null, 'setup', {
+      initialized: read.flag('initialized', initialized),
+    });
   },
```

**Change** `catalog/sonarr/integration.ts`:

```diff
diff --git a/catalog/sonarr/integration.ts b/catalog/sonarr/integration.ts
index 2f9f46c..54bece6 100644
--- a/catalog/sonarr/integration.ts
+++ b/catalog/sonarr/integration.ts
@@ -32,3 +32,7 @@ export default servarrIntegration(
   [
-    servarrDownloadClient({ category: 'tv', setting: 'tvCategory' }),
+    servarrDownloadClient({
+      category: 'tv',
+      setting: 'tvCategory',
+      imported: 'tvImportedCategory',
+    }),
     servarrRootFolder(ROOT_FOLDER),
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index aaef541..a6807d1 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -37,2 +37,3 @@ export * from './integrations/resources';
 export * from './integrations/overrides';
+export * from './integrations/read';
 export * from './integrations/wiring';
```

**Create** `packages/engine/src/integrations/read.ts`:

```ts
import { compare } from '../util/sort';
import type { ObservedResource, Scalar } from './types';

/** What kind of value `value` is: what an app held instead of what was expected. */
function kindOf(value: unknown): string {
  if (value === undefined || value === null) return 'nothing';
  if (typeof value === 'string') return 'text';
  if (typeof value === 'number') return 'a number';
  if (typeof value === 'boolean') return 'true or false';
  return Array.isArray(value) ? 'a list' : 'an object';
}

/**
 * Reads a resource's managed fields from what its app holds, and notes each one it can't
 * read, of another type or missing, rather than take it as empty (spec §6.3): `observed`
 * leaves such a field out, so it differs, and names it in `unreadable`, so that plan and
 * drift say what was found.
 */
export interface FieldReader {
  text(field: string, value: unknown): string | undefined;
  number(field: string, value: unknown): number | undefined;
  flag(field: string, value: unknown): boolean | undefined;
  /** A list of numbers, as one sorted, comma-separated list: "5000,5010". */
  numbers(field: string, value: unknown): string | undefined;
  /** Note `field` as one Mediaplane can't read, and why: its value is then none. */
  refuse(field: string, why: string): Scalar | undefined;
  /** The resource as read: `fields` without those it couldn't read. */
  observed(
    id: ObservedResource['id'],
    name: string,
    fields: Readonly<Record<string, Scalar | undefined>>,
  ): ObservedResource;
}

/** A new FieldReader, for one resource. */
export function fieldReader(): FieldReader {
  const unreadable: Record<string, string> = {};
  const note = (field: string, why: string) => {
    unreadable[field] = why;
  };
  return {
    text(field, value) {
      if (typeof value === 'string') return value;
      note(field, `${kindOf(value)}, not text`);
      return undefined;
    },
    number(field, value) {
      if (typeof value === 'number') return value;
      note(field, `${kindOf(value)}, not a number`);
      return undefined;
    },
    flag(field, value) {
      if (typeof value === 'boolean') return value;
      note(field, `${kindOf(value)}, not true or false`);
      return undefined;
    },
    numbers(field, value) {
      if (Array.isArray(value) && value.every((item) => typeof item === 'number')) {
        return [...value].sort((a: number, b: number) => a - b).join(',');
      }
      note(field, `${kindOf(value)}, not a list of numbers`);
      return undefined;
    },
    refuse(field, why) {
      note(field, why);
      return undefined;
    },
    observed(id, name, fields) {
      const read = Object.fromEntries(
        Object.entries(fields).flatMap(([field, value]): [string, Scalar][] =>
          value === undefined ? [] : [[field, value]],
        ),
      );
      const odd = Object.entries(unreadable).sort(([a], [b]) => compare(a, b));
      return {
        id,
        name,
        fields: read,
        ...(odd.length === 0 ? {} : { unreadable: Object.fromEntries(odd) }),
      };
    },
  };
}
```

**Change** `packages/engine/src/testing/wiring.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index b2354c8..ba874e8 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -254,2 +254,4 @@ function qbittorrentTemplate(service: string): Omit<FakeDownloadClient, 'id'> &
       { name: category, value: service === 'radarr' ? 'radarr' : 'tv-sonarr' },
+      // Unset, the arrs leave it out (probed).
+      { name: service === 'radarr' ? 'movieImportedCategory' : 'tvImportedCategory' },
     ],
@@ -258,2 +260,10 @@ function qbittorrentTemplate(service: string): Omit<FakeDownloadClient, 'id'> &
 
+/** The settings of an arr's download client that name a qBittorrent category. */
+const CLIENT_CATEGORIES = [
+  'tvCategory',
+  'movieCategory',
+  'tvImportedCategory',
+  'movieImportedCategory',
+];
+
 /**
@@ -288,5 +298,15 @@ function testClient(
     (qbittorrent.key === '' || key === qbittorrent.key);
-  return right
-    ? undefined
-    : refusal('ApiKey', 'Authentication Failure', 'Please verify your credentials.');
+  if (!right) {
+    return refusal('ApiKey', 'Authentication Failure', 'Please verify your credentials.');
+  }
+  // A test that reaches qBittorrent makes each category the client names that
+  // qBittorrent lacks, its own and its post-import one, with no save path (probed on
+  // Sonarr 4 and Radarr 6).
+  for (const setting of CLIENT_CATEGORIES) {
+    const category = value(setting);
+    if (typeof category === 'string' && category !== '') {
+      qbittorrent.categories[category] ??= '';
+    }
+  }
+  return undefined;
 }
@@ -319,3 +339,8 @@ function fakeServarrDownloads(
       status: 200,
-      body: state.rootFolders.map((f) => ({ ...f, accessible: true, freeSpace: 1 })),
+      // The arrs read `accessible` from the disk each time they are asked (probed).
+      body: state.rootFolders.map((f) => ({
+        ...f,
+        accessible: state.folders.includes(withoutSlash(f.path)),
+        freeSpace: 1,
+      })),
     };
```

- [ ] **Step 4: Run them to see them pass, and regenerate the facts**

```bash
pnpm vitest run catalog/_shared/servarr-connection.test.ts catalog/_shared/servarr-download.test.ts catalog/jellyfin/integration.test.ts catalog/plex/integration.test.ts catalog/prowlarr/integration.test.ts catalog/qbittorrent/integration.test.ts catalog/seerr/integration.test.ts packages/cli/src/run.test.ts packages/engine/src/integrations/read.test.ts
pnpm docs:generate
```

Expected: PASS. `docs:generate` rewrites the facts of the Radarr and Sonarr READMEs (the
root folder's `accessible`, fixed).

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages catalog
git commit -m "feat(catalog): say what an app holds that Mediaplane can't read, make a root folder's folder again, and leave plan's marks to the owner's decisions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 2031 tests pass in 90 files.

---

### Task 4: `mediaplane drift`

Decision: `drift` is `plan`, looking only, under the lock; clear only when every resource
and secret was checked (decision 2).
Decision: its one write, `checks` (decision 3); Jellyfin's admin once a day, and a verdict
taken from then said to be (decision 5).
Decision: a shared key changed at its source is reported on the source and each consumer
(decision 14); what is left in an app is reported, and one its app can't say about isn't
checked (decision 15).
Decision: the CLI says what puts each kind right (decision 16).
Decision: Prowlarr's proxy is read through Prowlarr's health check (decision 17).
Decision: the lock names its command (decision 20).

**Files:**
- Create: `packages/engine/src/drift.ts`, `packages/engine/src/testing/home.ts`
- Modify: `catalog/jellyfin/integration.ts`, `catalog/prowlarr/integration.ts`, `packages/cli/src/output.ts`, `packages/cli/src/run.ts`, `packages/engine/src/index.ts`, `packages/engine/src/integrations/types.ts`, `packages/engine/src/integrations/wiring.ts`, `packages/engine/src/plan/plan.ts`, `packages/engine/src/runbooks.ts`, `packages/engine/src/state/lock.ts`, `packages/engine/src/testing/index.ts`, `packages/engine/src/testing/prowlarr.ts`, `packages/engine/src/testing/wiring.ts`
- Test: `catalog/jellyfin/integration.test.ts`, `catalog/prowlarr/integration.test.ts`, `packages/cli/src/output.test.ts`, `packages/cli/src/run.test.ts`, `packages/engine/src/drift.test.ts`, `packages/engine/src/integrations/wiring.test.ts`, `packages/engine/src/state/lock.test.ts`
- Generated: `docs/reference/cli.md`

**Interfaces:**
- **Consumes:** Tasks 1 to 3: `examine`, `planWiring`, `Drift`, `SecretCheck`, `checks`,
  `desiredOf`, `isUnmanaged`.
- **Produces:**
  - `ResourceSpec.checkEvery?: number` (ms), `ResourceSpec.health?(api, observed): Promise<string | undefined>`;
  - `Drift.kind` gains `'key' | 'left'`, and `Drift.source?: string`;
    `PlanWiringOptions.drift?: { now: () => Date }`, `ExamineOptions.drift?`;
    `DRIFT_RUNBOOK`; warnings `drift.health`, `drift.left-unknown` (with an `unknown`
    wiring change);
  - `PlanOptions.drift?: { now: () => Date }`;
  - from `@mediaplane/engine`: `interface DriftOptions extends PlanOptions { now? }`,
    `interface DriftResult { ok; clear; drift: Drift[]; checks: SecretCheck[]; unchecked: { resource: string; reason: string }[]; diagnostics }`,
    `drift(options: DriftOptions): Promise<DriftResult>` (errors `drift.locked`; warning
    `drift.checks-not-kept`); `clear` is false while a secret went unchecked;
  - `LockInfo.command?: string`, `acquireLock(home, now?, command = 'apply')`;
  - `CHECK_ADMIN_EVERY` in `catalog/jellyfin/integration.ts`;
  - the CLI: `mediaplane drift [--home] [--json]` (exit 0, 2 or 1),
    `DRIFT_JSON_SCHEMA` (`'mediaplane.drift/v1'`), `printDrift(result, options, io)`,
    `driftAdvice(drift): string[]`;
  - `FakeAppState.health`, which the fake Prowlarr answers at `GET /api/v1/health`;
  - from `@mediaplane/engine/testing`: `wiredHome(options): Promise<string>`,
    `wiredRuntime(addresses): Runtime`.

- [ ] **Step 1: Write the failing tests**

**Change** `catalog/jellyfin/integration.test.ts`:

```diff
diff --git a/catalog/jellyfin/integration.test.ts b/catalog/jellyfin/integration.test.ts
index 53290fc..c55020d 100644
--- a/catalog/jellyfin/integration.test.ts
+++ b/catalog/jellyfin/integration.test.ts
@@ -4,2 +4,3 @@ import {
   createAppApi,
+  examine,
   type ResourceSpec,
@@ -595,2 +596,39 @@ describe("Jellyfin's libraries", () => {
 
+  it("is checked by drift once a day at most, while it passes: each check is in Jellyfin's activity log", async () => {
+    const { api, app } = await jellyfin(setUp(), true);
+    const spec = resource('admin');
+    const observed = await spec.observe(api, undefined, wanted(spec));
+    if (observed === undefined) throw new Error('no admin');
+    const at = '2026-10-20T08:00:00.000Z';
+    const known = {
+      id: observed.id,
+      name: 'admin',
+      fields: { username: 'admin' },
+      secrets: ['password'],
+      appliedAt: at,
+      checks: { password: { verdict: 'passed' as const, at } },
+    };
+    const signIns = () =>
+      calls(app).filter((call) => call === 'POST /Users/AuthenticateByName').length;
+    const look = { readOnly: true, peer: () => undefined };
+    const driftAfter = (hours: number) =>
+      examine(spec, api, contextOf(), known, {
+        context: look,
+        drift: { now: () => new Date(Date.parse(at) + hours * 60 * 60 * 1000) },
+      });
+    // Within a day of the check that passed: taken from then, without signing in.
+    expect((await driftAfter(23))?.checks).toEqual([
+      { resource: 'jellyfin.admin', secret: 'password', verdict: 'passed', at },
+    ]);
+    expect(signIns()).toBe(0);
+    // A day on, it signs in again.
+    expect((await driftAfter(25))?.checks).toEqual([
+      { resource: 'jellyfin.admin', secret: 'password', verdict: 'passed' },
+    ]);
+    expect(signIns()).toBe(1);
+    // plan checks it every time.
+    await examine(spec, api, contextOf(), known, { context: look });
+    expect(signIns()).toBe(2);
+  });
+
   it("says Jellyfin can't change what a library of that name holds", async () => {
```

**Change** `catalog/prowlarr/integration.test.ts`:

```diff
diff --git a/catalog/prowlarr/integration.test.ts b/catalog/prowlarr/integration.test.ts
index 51a4a8d..216b3ba 100644
--- a/catalog/prowlarr/integration.test.ts
+++ b/catalog/prowlarr/integration.test.ts
@@ -479,2 +479,28 @@ describe('the indexer proxy', () => {
 
+  it("reads what Prowlarr's own health check found of its proxies, and tests none itself", async () => {
+    const { api, app, state } = await prowlarr();
+    await proxy.create(api, wanted(proxy));
+    const observed = await proxy.observe(api, undefined);
+    if (observed === undefined) throw new Error('no proxy observed');
+    expect(await proxy.health?.(api, observed)).toBeUndefined();
+    // As Prowlarr says it after its check found the solver down (probed).
+    state.health.push(
+      { source: 'IndexerCheck', type: 'error', message: 'No indexers enabled' },
+      {
+        source: 'IndexerProxyStatusCheck',
+        type: 'error',
+        message: 'All indexer proxies are unavailable due to failures',
+      },
+    );
+    const tests = app.requests.filter(
+      (r) => r.path === '/api/v1/indexerproxy/test',
+    ).length;
+    expect(await proxy.health?.(api, observed)).toBe(
+      "Prowlarr's own health check, which runs every six hours, says: All indexer proxies are unavailable due to failures (GET /api/v1/health)",
+    );
+    expect(
+      app.requests.filter((r) => r.path === '/api/v1/indexerproxy/test').length,
+    ).toBe(tests);
+  });
+
   it("reads tags it can't as such, never as none", async () => {
```

**Change** `packages/cli/src/output.test.ts`:

```diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index fa587ce..83e5ffe 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -1,2 +1,7 @@
-import type { ActionResult, ChangeRecord, PlanResult } from '@mediaplane/engine';
+import type {
+  ActionResult,
+  ChangeRecord,
+  DriftResult,
+  PlanResult,
+} from '@mediaplane/engine';
 import { describe, expect, it } from 'vitest';
@@ -5,2 +10,3 @@ import {
   printApply,
+  printDrift,
   printHistory,
@@ -148,3 +154,3 @@ describe('printPlan: drift', () => {
         "  ! qbittorrent.admin.password: refused by the app's own check (found by drift at 2026-10-20T08:00:00.000Z; not checked again until apply sets it)",
-        '  apply puts each back.',
+        '  apply puts back each field, resource and secret changed in the apps.',
         'Wiring:',
@@ -157,2 +163,36 @@ describe('printPlan: drift', () => {
 
+  it('says an app refuses its own key, which those that hold it hold too, and what is left, and that apply puts back neither', () => {
+    const term = capture();
+    printPlan(
+      {
+        ...PLAN,
+        files: [],
+        drift: [
+          { resource: 'qbittorrent', kind: 'key', secret: 'apiKey' },
+          {
+            resource: 'sonarr.download_client',
+            kind: 'key',
+            secret: 'apiKey',
+            source: 'qbittorrent',
+          },
+          { resource: 'prowlarr.application_radarr', kind: 'left' },
+        ],
+      },
+      { json: false },
+      term.io,
+    );
+    expect(term.stdout()).toBe(
+      [
+        'Drift, changed outside Mediaplane since it was applied:',
+        '  ! qbittorrent: refuses the key Mediaplane holds for it (apiKey), as if it was changed in the app',
+        "  ! sonarr.download_client.apiKey: holds qbittorrent's key, which qbittorrent refuses",
+        '  ? prowlarr.application_radarr: still in the app, though the stack no longer wants it; apply leaves it',
+        "  apply doesn't give an app back its own key: put back the key Mediaplane holds, as https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md shows.",
+        "  apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it.",
+        'No changes.',
+        '',
+      ].join('\n'),
+    );
+  });
+
   it('gives the drift and the checks in JSON', () => {
@@ -165,2 +205,102 @@ describe('printPlan: drift', () => {
 
+describe('printDrift', () => {
+  const FOUND: DriftResult = {
+    ok: true,
+    clear: false,
+    drift: [
+      {
+        resource: 'sonarr.download_client',
+        kind: 'field',
+        field: 'category',
+        expected: 'tv',
+        actual: 'television',
+      },
+    ],
+    checks: [
+      { resource: 'sonarr.admin', secret: 'password', verdict: 'passed' },
+      {
+        resource: 'sonarr.download_client',
+        secret: 'apiKey',
+        verdict: 'unchecked',
+        reason: 'a managed field differs: apply sets the secrets with it',
+      },
+    ],
+    unchecked: [{ resource: 'radarr.admin', reason: "its app isn't running" }],
+    diagnostics: [],
+  };
+
+  it('says what changed, what it could not check, and how the secrets fared, by name', () => {
+    const term = capture();
+    printDrift(FOUND, { json: false }, term.io);
+    expect(term.stdout()).toBe(
+      [
+        'Changed outside Mediaplane since it was applied:',
+        '  ~ sonarr.download_client.category: expected "tv", actual "television"',
+        'Not checked:',
+        "  ? radarr.admin: its app isn't running",
+        "Secrets, checked with each app's own check: 1 passed, 1 not checked.",
+        '  - sonarr.download_client.apiKey: a managed field differs: apply sets the secrets with it',
+        'Drift found.',
+        '  apply puts back each field, resource and secret changed in the apps.',
+        '',
+      ].join('\n'),
+    );
+  });
+
+  it('says when it found none, and when it found none only where it could look', () => {
+    const clear = capture();
+    printDrift(
+      { ...FOUND, clear: true, drift: [], unchecked: [], checks: [] },
+      { json: false },
+      clear.io,
+    );
+    expect(clear.stdout()).toBe('No drift: the apps hold what Mediaplane applied.\n');
+    const partly = capture();
+    printDrift({ ...FOUND, drift: [], checks: [] }, { json: false }, partly.io);
+    expect(partly.stdout()).toContain(
+      'No drift found where Mediaplane could look, but it could not look at everything, or check every secret: see above.\n',
+    );
+  });
+
+  it('says which secrets passed when drift last checked them, and when, rather than now', () => {
+    const term = capture();
+    printDrift(
+      {
+        ...FOUND,
+        clear: true,
+        drift: [],
+        unchecked: [],
+        checks: [
+          { resource: 'sonarr.admin', secret: 'password', verdict: 'passed' },
+          {
+            resource: 'jellyfin.admin',
+            secret: 'password',
+            verdict: 'passed',
+            at: '2026-10-20T08:00:00.000Z',
+          },
+        ],
+      },
+      { json: false },
+      term.io,
+    );
+    expect(term.stdout()).toBe(
+      [
+        "Secrets, checked with each app's own check: 2 passed (1 as last checked).",
+        "  = jellyfin.admin.password: passed when drift last checked it, at 2026-10-20T08:00:00.000Z; it isn't checked again until its time is up",
+        'No drift: the apps hold what Mediaplane applied.',
+        '',
+      ].join('\n'),
+    );
+  });
+
+  it('gives all of it in JSON, versioned', () => {
+    const term = capture();
+    printDrift(FOUND, { json: true }, term.io);
+    expect(JSON.parse(term.stdout())).toEqual({
+      schema: 'mediaplane.drift/v1',
+      ...FOUND,
+    });
+  });
+});
+
 describe('printPlan', () => {
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 5d5a2b9..0b67f8a 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -1695,2 +1695,106 @@ apps:
 
+describe('mediaplane drift', () => {
+  const current = () =>
+    fakeRuntime({ hashes: { ok: true, hashes: HASHES }, containers: running(HASHES) });
+
+  it('exits 0, saying so, when the apps hold what Mediaplane applied', async () => {
+    const runtime = current();
+    const home = await currentHome(runtime);
+    const term = capture();
+    expect(await run(['drift', '--home', home], term.io, deps(runtime))).toBe(0);
+    expect(term.stdout()).toBe(
+      "Secrets, checked with each app's own check: 5 passed.\nNo drift: the apps hold what Mediaplane applied.\n",
+    );
+    // What each check found is kept, by name: none is checked again sooner than it may be.
+    const known = await readResources(home);
+    expect(known['jellyfin.admin']?.checks?.password?.verdict).toBe('passed');
+    expect(JSON.stringify(known)).not.toContain(
+      (await readSecretStore(home)).shared?.adminPassword ?? '',
+    );
+  });
+
+  it('exits 2 with what changed in an app, what was applied and what it holds, and no secret', async () => {
+    const runtime = current();
+    const home = await currentHome(runtime);
+    const client = apis.apps.get('sonarr')?.downloadClients[0];
+    if (client === undefined) throw new Error('no download client faked');
+    client.fields = client.fields.map((f) =>
+      f.name === 'tvCategory' ? { ...f, value: 'television' } : f,
+    );
+    const term = capture();
+    expect(await run(['drift', '--home', home], term.io, deps(runtime))).toBe(2);
+    expect(term.stdout()).toContain(
+      'Changed outside Mediaplane since it was applied:\n  ~ sonarr.download_client.category: expected "tv", actual "television"\n',
+    );
+    expect(term.stdout()).toContain(
+      'Drift found.\n  apply puts back each field, resource and secret changed in the apps.\n',
+    );
+    const json = capture();
+    expect(await run(['drift', '--home', home, '--json'], json.io, deps(runtime))).toBe(
+      2,
+    );
+    expect(JSON.parse(json.stdout())).toMatchObject({
+      schema: 'mediaplane.drift/v1',
+      ok: true,
+      clear: false,
+      drift: [
+        {
+          resource: 'sonarr.download_client',
+          kind: 'field',
+          field: 'category',
+          expected: 'tv',
+          actual: 'television',
+        },
+      ],
+    });
+    expectNoSecrets(term.stdout() + term.stderr() + json.stdout(), await secretsIn(home));
+    // plan shows it too, as what apply would put back.
+    const plan = capture();
+    expect(await run(['plan', '--home', home], plan.io, deps(runtime))).toBe(2);
+    expect(plan.stdout()).toContain(
+      '  ~ sonarr.download_client.category: expected "tv", actual "television"\n',
+    );
+  });
+
+  it('signs in to qBittorrent no more once it found its password refused, and to Jellyfin once a day', async () => {
+    // The owner's decisions of 2026-10-17: five failed sign-ins in a row ban Mediaplane
+    // from qBittorrent, and each check of Jellyfin's admin is in its activity log.
+    const runtime = current();
+    const home = await currentHome(runtime);
+    const qbittorrent = apis.apps.get('qbittorrent');
+    if (qbittorrent === undefined) throw new Error('no qBittorrent faked');
+    qbittorrent.password = 'fake-changed-by-hand';
+    const signIns = (path: string) =>
+      apis.app.requests.filter((r) => r.path === path && r.method === 'POST').length;
+    const term = capture();
+    expect(await run(['drift', '--home', home], term.io, deps(runtime))).toBe(2);
+    expect(term.stdout()).toContain(
+      "  ! qbittorrent.admin.password: refused by the app's own check\n",
+    );
+    expect([signIns('/api/v2/auth/login'), signIns('/Users/AuthenticateByName')]).toEqual(
+      [1, 1],
+    );
+    for (let more = 0; more < 5; more++) {
+      expect(await run(['drift', '--home', home], capture().io, deps(runtime))).toBe(2);
+    }
+    expect([signIns('/api/v2/auth/login'), signIns('/Users/AuthenticateByName')]).toEqual(
+      [1, 1],
+    );
+    expect(qbittorrent.signInFailures).toBe(1);
+    // plan takes it as refused too, without signing in: apply sets it.
+    const plan = capture();
+    expect(await run(['plan', '--home', home], plan.io, deps(runtime))).toBe(2);
+    expect(plan.stdout()).toContain('  ~ update      qbittorrent.admin (password)\n');
+    expect(signIns('/api/v2/auth/login')).toBe(1);
+  });
+
+  it('exits 1 when it cannot look, changing nothing', async () => {
+    const home = await tempDir('mediaplane-cli-');
+    const term = capture();
+    expect(await run(['drift', '--home', home, '--json'], term.io, deps())).toBe(1);
+    expect(JSON.parse(term.stdout())).toMatchObject({ ok: false, clear: false });
+    expect(await readdir(home)).toEqual([]);
+  });
+});
+
 describe('mediaplane status', () => {
```

**Create** `packages/engine/src/drift.test.ts`:

```ts
import { readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { drift } from './drift';
import { AppApiError } from './http/client';
import { readResources, writeResources } from './integrations/resources';
import type { ResourceSpec } from './integrations/types';
import { LOCK_PATH, RESOURCES_PATH } from './paths';
import type { HostProbe } from './preflight/probe';
import type { Runtime } from './runtime/types';
import { fakeProbe, fakeRuntime } from './testing/fakes';
import { FIXTURE_HOST } from './testing/fixtures';
import { wiredHome, wiredRuntime } from './testing/home';
import { tempDir } from './testing/temp';
import { FAKE_LOGIN, fakeSonarr, WIRED_CATALOG } from './testing/wiring';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;
const KEY = '0'.repeat(32);
const PASSWORD = 'fake-admin-password';
const AT = new Date('2026-10-20T08:00:00.000Z');
const RECORD = {
  id: null,
  name: 'login',
  fields: { user: 'admin' },
  secrets: ['password'],
  appliedAt: '2026-10-10T12:00:00.000Z',
};

/** A home of the wired fixture stack, with Sonarr's key stored and its login recorded. */
function home(): Promise<string> {
  return wiredHome({
    prefix: 'mediaplane-drift-',
    stack: STACK,
    key: KEY,
    password: PASSWORD,
    known: { 'sonarr.login': RECORD },
  });
}

/** The stack's Sonarr, running and healthy, on the wiring network. */
const runtimeFor = wiredRuntime;

async function driftOf(
  dir: string,
  fake: Awaited<ReturnType<typeof fakeSonarr>>,
  probe: HostProbe = fakeProbe(),
) {
  return drift({
    home: dir,
    catalog: WIRED_CATALOG,
    host: FIXTURE_HOST,
    env: {},
    runtime: runtimeFor(fake.addresses),
    probe,
    wiring: fake.seams,
    now: () => AT,
  });
}

describe('drift', () => {
  it('finds nothing changed where the app holds what Mediaplane applied, and keeps each check', async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    expect(await driftOf(dir, sonarr)).toEqual({
      ok: true,
      clear: true,
      drift: [],
      checks: [{ resource: 'sonarr.login', secret: 'password', verdict: 'passed' }],
      unchecked: [],
      diagnostics: [],
    });
    expect((await readResources(dir))['sonarr.login']?.checks).toEqual({
      password: { verdict: 'passed', at: AT.toISOString() },
    });
    // The lock is released.
    await expect(stat(join(dir, LOCK_PATH))).rejects.toThrow();
  });

  it('reports what changed, and a secret it finds refused it keeps, and checks no more', async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({
      key: KEY,
      user: 'admin',
      password: 'fake-changed',
    });
    const first = await driftOf(dir, sonarr);
    expect(first).toMatchObject({
      ok: true,
      clear: false,
      drift: [{ resource: 'sonarr.login', kind: 'secret', secret: 'password' }],
    });
    const signIns = () => sonarr.app.requests.filter((r) => r.path === '/login').length;
    const before = signIns();
    const second = await driftOf(dir, sonarr);
    expect(second.drift).toEqual([
      {
        resource: 'sonarr.login',
        kind: 'secret',
        secret: 'password',
        since: AT.toISOString(),
      },
    ]);
    expect(signIns()).toBe(before);
    expect(JSON.stringify([first, second])).not.toContain(PASSWORD);
  });

  it("says what it couldn't look at, and isn't clear then", async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY });
    const result = await drift({
      home: dir,
      catalog: WIRED_CATALOG,
      host: FIXTURE_HOST,
      env: {},
      runtime: fakeRuntime({ hashes: { ok: true, hashes: {} } }),
      probe: fakeProbe(),
      wiring: sonarr.seams,
    });
    expect(result).toMatchObject({
      ok: true,
      clear: false,
      drift: [],
      unchecked: [
        {
          resource: 'sonarr.login',
          reason:
            "its app isn't running and healthy, or is to be set up first: run apply, then drift again",
        },
      ],
    });
  });

  it("isn't clear while a secret goes unchecked, though nothing is found", async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const careful: ResourceSpec = {
      ...FAKE_LOGIN,
      verify: () => Promise.resolve({ unchecked: 'it would make a category' }),
    };
    const catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [careful] } }
        : def,
    );
    const result = await drift({
      home: dir,
      catalog,
      host: FIXTURE_HOST,
      env: {},
      runtime: runtimeFor(sonarr.addresses),
      probe: fakeProbe(),
      wiring: sonarr.seams,
      now: () => AT,
    });
    expect(result).toMatchObject({ ok: true, clear: false, drift: [], unchecked: [] });
  });

  it("isn't clear while it can't tell whether an app still holds what Mediaplane made there", async () => {
    const dir = await home();
    await writeResources(dir, {
      'sonarr.login': RECORD,
      'sonarr.gone': { ...RECORD, name: 'gone' },
    });
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const gone: ResourceSpec = {
      ...FAKE_LOGIN,
      name: 'gone',
      desired: () => undefined,
      observe: () => Promise.reject(new AppApiError('no', { kind: 'rejected' })),
    };
    const catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [FAKE_LOGIN, gone] } }
        : def,
    );
    const result = await drift({
      home: dir,
      catalog,
      host: FIXTURE_HOST,
      env: {},
      runtime: runtimeFor(sonarr.addresses),
      probe: fakeProbe(),
      wiring: sonarr.seams,
      now: () => AT,
    });
    expect(result).toMatchObject({
      ok: true,
      clear: false,
      drift: [],
      unchecked: [
        {
          resource: 'sonarr.gone',
          reason:
            "Mediaplane made sonarr.gone, which the stack no longer wants, and couldn't tell whether sonarr still holds it: no",
        },
      ],
    });
  });

  it("asks no more of the host than it needs: the host's ports and folders aren't drift", async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const busy = fakeProbe({ freeBytes: 0 });
    expect((await driftOf(dir, sonarr, busy)).ok).toBe(true);
  });

  it('waits for no other command: one that holds the lock is named', async () => {
    const dir = await home();
    await writeFile(
      join(dir, LOCK_PATH),
      JSON.stringify({ pid: process.pid, host: 'here', startedAt: AT.toISOString() }),
    );
    const result = await driftOf(dir, await fakeSonarr({ key: KEY }));
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [
        expect.objectContaining({
          code: 'drift.locked',
          message: expect.stringContaining('another apply is running') as string,
        }),
      ],
    });
  });

  it('makes no state/ where there is no stack.yaml, and says why', async () => {
    const dir = await tempDir('mediaplane-drift-');
    const result = await driftOf(dir, await fakeSonarr({ key: KEY }));
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'config.missing' })],
    });
    expect(await readdir(dir)).toEqual([]);
  });

  it('fails as plan fails, and warns when it cannot keep its checks', async () => {
    const dir = await home();
    await writeFile(join(dir, 'stack.yaml'), `${STACK}  sonar: {}\n`);
    const failed = await driftOf(dir, await fakeSonarr({ key: KEY }));
    expect(failed.ok).toBe(false);
    const ok = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    // state/resources.json spoilt while drift looks: it can't be read to keep the checks.
    const runtime = runtimeFor(sonarr.addresses);
    const spoiling: Runtime = {
      ...runtime,
      wiringAddresses: async (ids) => {
        await writeFile(join(ok, RESOURCES_PATH), '{');
        return runtime.wiringAddresses(ids);
      },
    };
    const result = await drift({
      home: ok,
      catalog: WIRED_CATALOG,
      host: FIXTURE_HOST,
      env: {},
      runtime: spoiling,
      probe: fakeProbe(),
      wiring: sonarr.seams,
      now: () => AT,
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'drift.checks-not-kept' }),
    ]);
  });
});
```

**Change** `packages/engine/src/integrations/wiring.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.test.ts b/packages/engine/src/integrations/wiring.test.ts
index 6e62424..3a9aebc 100644
--- a/packages/engine/src/integrations/wiring.test.ts
+++ b/packages/engine/src/integrations/wiring.test.ts
@@ -1380 +1380,164 @@ describe('planWiring: overrides (spec §4.2, §6.3)', () => {
 });
+
+describe('planWiring: what drift adds (spec §6.3)', () => {
+  const AT = '2026-10-20T08:00:00.000Z';
+  const DAY = 24 * 60 * 60 * 1000;
+  const passed = {
+    'sonarr.login': {
+      ...RECORDED['sonarr.login'],
+      checks: { password: { verdict: 'passed', at: AT } },
+    },
+  } as KnownResources;
+
+  it('checks a secret that passed again only once its resource says it may', async () => {
+    const seldom: ResourceSpec = { ...FAKE_LOGIN, checkEvery: DAY };
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const at = (iso: string) => ({ now: () => new Date(iso) });
+    const soon = await planWiring(
+      options(sonarr, {
+        stack: sonarrWith([seldom]),
+        known: passed,
+        drift: at('2026-10-20T20:00:00.000Z'),
+      }),
+    );
+    expect(soon.checks).toEqual([
+      { resource: 'sonarr.login', secret: 'password', verdict: 'passed', at: AT },
+    ]);
+    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
+    // A day on, it signs in again; and plan always does.
+    const later = await planWiring(
+      options(sonarr, {
+        stack: sonarrWith([seldom]),
+        known: passed,
+        drift: at('2026-10-21T08:00:00.000Z'),
+      }),
+    );
+    expect(later.checks).toEqual([
+      { resource: 'sonarr.login', secret: 'password', verdict: 'passed' },
+    ]);
+    const signIns = sonarr.app.requests.filter((r) => r.path === '/login').length;
+    await planWiring(options(sonarr, { stack: sonarrWith([seldom]), known: passed }));
+    expect(sonarr.app.requests.filter((r) => r.path === '/login').length).toBe(
+      signIns + 1,
+    );
+  });
+
+  it('says an app refuses the key Mediaplane holds for it, and which resources hold that key', async () => {
+    // Sonarr refuses its key, changed in Sonarr; qBittorrent's resource holds it.
+    const holds: ResourceSpec = {
+      ...FAKE_LOGIN,
+      name: 'link',
+      desired: (ctx) => ({
+        name: 'link',
+        fields: { user: 'admin' },
+        secrets: { password: ctx.keys.sonarr?.apiKey ?? '' },
+      }),
+    };
+    const catalog: Catalog = WIRED_CATALOG.map((def) =>
+      def.id === 'qbittorrent'
+        ? {
+            ...def,
+            api: FIXTURE_API,
+            integration: { after: ['sonarr'], resources: [holds] },
+          }
+        : def,
+    );
+    const QBT = '7'.repeat(32);
+    const sonarr = await fakeSonarr({ key: QBT, user: 'admin', password: KEY });
+    const planned = await planWiring(
+      options(sonarr, {
+        stack: stackOf(catalog),
+        keys: { sonarr: { apiKey: KEY }, qbittorrent: { apiKey: QBT } },
+        secrets: [KEY, QBT, PASSWORD],
+      }),
+    );
+    expect(planned.drift).toEqual([
+      { resource: 'sonarr', kind: 'key', secret: 'apiKey' },
+      {
+        resource: 'qbittorrent.link',
+        kind: 'key',
+        secret: 'password',
+        source: 'sonarr',
+      },
+    ]);
+    expect(planned.changes[0]).toMatchObject({
+      resource: 'sonarr.login',
+      action: 'unknown',
+    });
+    expect(JSON.stringify(planned)).not.toContain(KEY);
+  });
+
+  it('says what Mediaplane made that the stack no longer wants is still in the app', async () => {
+    const gone: ResourceSpec = { ...FAKE_LOGIN, name: 'gone', desired: () => undefined };
+    const vanished: ResourceSpec = {
+      ...FAKE_LOGIN,
+      name: 'vanished',
+      desired: () => undefined,
+      observe: () => Promise.resolve(undefined),
+    };
+    const failing: ResourceSpec = {
+      ...FAKE_LOGIN,
+      name: 'failing',
+      desired: () => undefined,
+      observe: () => Promise.reject(new AppApiError('no', { kind: 'rejected' })),
+    };
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const record = (name: string) => ({ ...RECORDED['sonarr.login'], name }) as never;
+    const planned = await planWiring(
+      options(sonarr, {
+        stack: sonarrWith([FAKE_LOGIN, gone, vanished, failing]),
+        known: {
+          ...RECORDED,
+          'sonarr.gone': record('gone'),
+          'sonarr.vanished': record('vanished'),
+          'sonarr.failing': record('failing'),
+        },
+      }),
+    );
+    expect(planned.drift).toEqual([{ resource: 'sonarr.gone', kind: 'left' }]);
+    // One the app can't say about is never said to be gone: it couldn't be looked at.
+    const said =
+      "Mediaplane made sonarr.failing, which the stack no longer wants, and couldn't tell whether sonarr still holds it: no";
+    expect(planned.changes).toEqual([
+      { resource: 'sonarr.login', action: 'unchanged' },
+      { resource: 'sonarr.failing', action: 'unknown', reason: said },
+    ]);
+    expect(planned.diagnostics).toEqual([
+      expect.objectContaining({
+        severity: 'warning',
+        code: 'drift.left-unknown',
+        message: said,
+      }),
+    ]);
+  });
+
+  it("reads the app's own health check in drift only, and says what it found", async () => {
+    const watched: ResourceSpec = {
+      ...FAKE_LOGIN,
+      health: () => Promise.resolve(`the proxy is down, ${PASSWORD}`),
+    };
+    const failing: ResourceSpec = {
+      ...FAKE_LOGIN,
+      name: 'other',
+      health: () => Promise.reject(new AppApiError('no', { kind: 'server' })),
+    };
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const stack = sonarrWith([watched, failing]);
+    expect((await planWiring(options(sonarr, { stack }))).diagnostics).toEqual([]);
+    const found = await planWiring(
+      options(sonarr, { stack, drift: { now: () => new Date(AT) } }),
+    );
+    expect(found.diagnostics).toEqual([
+      expect.objectContaining({
+        severity: 'warning',
+        code: 'drift.health',
+        message: 'sonarr.login: the proxy is down, ***',
+      }),
+      // One it can't read is said to be, never taken as healthy.
+      expect.objectContaining({
+        code: 'drift.health',
+        message: "sonarr.other: its app's own health check could not be read: no",
+      }),
+    ]);
+  });
+});
```

**Change** `packages/engine/src/state/lock.test.ts`:

```diff
diff --git a/packages/engine/src/state/lock.test.ts b/packages/engine/src/state/lock.test.ts
index 234cf82..e483e6f 100644
--- a/packages/engine/src/state/lock.test.ts
+++ b/packages/engine/src/state/lock.test.ts
@@ -87,2 +87,21 @@ describe('acquireLock', () => {
 
+  it('says which command holds it, and records its own', async () => {
+    const holder = {
+      pid: process.pid,
+      host: hostname(),
+      startedAt: '2026-10-09T09:00:00.000Z',
+      command: 'drift',
+    };
+    const home = await homeWithLock(JSON.stringify(holder));
+    await expect(acquireLock(home, NOW, 'keep')).rejects.toThrow(
+      `mediaplane drift is running (pid ${String(process.pid)} on ${hostname()}, started 2026-10-09T09:00:00.000Z)`,
+    );
+    const free = await tempDir('mediaplane-lock-');
+    const lock = await acquireLock(free, NOW, 'drift');
+    expect(JSON.parse(await readFile(join(free, LOCK_PATH), 'utf8'))).toMatchObject({
+      command: 'drift',
+    });
+    await lock.release();
+  });
+
   it('clears a lock left by a process that has died', async () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog/jellyfin/integration.test.ts catalog/prowlarr/integration.test.ts packages/cli/src/output.test.ts packages/cli/src/run.test.ts packages/engine/src/drift.test.ts packages/engine/src/integrations/wiring.test.ts packages/engine/src/state/lock.test.ts`
Expected: FAIL. `drift.test.ts` doesn't load (`Cannot find module './drift'`), and 17 tests fail, 196 pass: 6 in `output.test.ts` (`printDrift is not a function`; `apply puts each back` printed for a key and what is left), 4 in `run.test.ts` (`unknown command 'drift'`), 4 in `wiring.test.ts` (no `checkEvery`, `key`, `left`, nor `health`; no unknown change for a left resource its app can't say about), and 1 each in `lock.test.ts` (no `command`), Jellyfin's (its admin signed in to within a day) and Prowlarr's (no `health`).

- [ ] **Step 3: Write `drift`, its checks, and what it adds to `plan`'s look**

**Change** `catalog/jellyfin/integration.ts`:

```diff
diff --git a/catalog/jellyfin/integration.ts b/catalog/jellyfin/integration.ts
index 33af065..42e910f 100644
--- a/catalog/jellyfin/integration.ts
+++ b/catalog/jellyfin/integration.ts
@@ -15,2 +15,5 @@ const user = z.looseObject({ Id: z.string(), Name: z.unknown() });
 
+/** How often drift checks the admin's password at most, while it passes: once a day. */
+export const CHECK_ADMIN_EVERY = 24 * 60 * 60 * 1000;
+
 /**
@@ -21,3 +24,5 @@ const user = z.looseObject({ Id: z.string(), Name: z.unknown() });
  * doesn't lock its admin out after failed sign-ins (probed: none after seven), but its
- * activity log records each sign-in, as it records any.
+ * activity log records each sign-in, as it records any: three lines for each check that
+ * passes, one for each that fails (probed). So drift checks it once a day at most, while
+ * it passes (the owner's decision of 2026-10-17); plan and apply check it every time.
  */
@@ -27,2 +32,3 @@ const admin: ResourceSpec = {
   secrets: ['password'],
+  checkEvery: CHECK_ADMIN_EVERY,
   desired: ({ admin: login }) => ({
```

**Change** `catalog/prowlarr/integration.ts`:

```diff
diff --git a/catalog/prowlarr/integration.ts b/catalog/prowlarr/integration.ts
index 11a2bb8..c01e1fa 100644
--- a/catalog/prowlarr/integration.ts
+++ b/catalog/prowlarr/integration.ts
@@ -58,2 +58,4 @@ const REQUEST_TIMEOUT = 60;
 const TAGS = '/api/v1/tag';
+const HEALTH = '/api/v1/health';
+const health = z.array(z.looseObject({ source: z.string(), message: z.string() }));
 const tag = z.looseObject({ id: z.number(), label: z.string() });
@@ -222,2 +224,12 @@ const indexerProxy: ResourceSpec = {
   },
+  // Prowlarr's own health check tests its proxies, every six hours (probed): drift reads
+  // what it found, and never tests the proxy itself, which would need the internet.
+  async health(api) {
+    const found = (await api.get(HEALTH, health)).find(
+      (item) => item.source === 'IndexerProxyStatusCheck',
+    );
+    return found === undefined
+      ? undefined
+      : `Prowlarr's own health check, which runs every six hours, says: ${found.message} (GET ${HEALTH})`;
+  },
   async create(api, desired) {
```

**Change** `packages/cli/src/output.ts`:

```diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index cba88c7..e326965 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -3,2 +3,3 @@ import {
   unhealthyServices,
+  WIRING_RUNBOOK,
   type ActionResult,
@@ -10,2 +11,3 @@ import {
   type Drift,
+  type DriftResult,
   type PlanResult,
@@ -23,2 +25,3 @@ export const STATUS_JSON_SCHEMA = 'mediaplane.status/v1';
 export const HISTORY_JSON_SCHEMA = 'mediaplane.history/v1';
+export const DRIFT_JSON_SCHEMA = 'mediaplane.drift/v1';
 
@@ -70,2 +73,8 @@ export function driftLine(drift: Drift): string {
       return `  ! ${drift.resource}.${drift.secret ?? ''}: refused by the app's own check${drift.since === undefined ? '' : ` (found by drift at ${drift.since}; not checked again until apply sets it)`}`;
+    case 'key':
+      return drift.source === undefined
+        ? `  ! ${drift.resource}: refuses the key Mediaplane holds for it (${drift.secret ?? ''}), as if it was changed in the app`
+        : `  ! ${drift.resource}.${drift.secret ?? ''}: holds ${drift.source}'s key, which ${drift.source} refuses`;
+    case 'left':
+      return `  ? ${drift.resource}: still in the app, though the stack no longer wants it; apply leaves it`;
   }
@@ -73,2 +82,26 @@ export function driftLine(drift: Drift): string {
 
+/**
+ * What puts right the drift found, one line for each kind of it there is: apply puts back
+ * a field, a resource or a secret changed in an app; it gives no app back a key changed
+ * there, and removes nothing the stack no longer wants, so it is never said to.
+ */
+export function driftAdvice(drift: readonly Drift[]): string[] {
+  const has = (...kinds: Drift['kind'][]) => drift.some((d) => kinds.includes(d.kind));
+  return [
+    ...(has('field', 'missing', 'secret')
+      ? ['apply puts back each field, resource and secret changed in the apps']
+      : []),
+    ...(has('key')
+      ? [
+          `apply doesn't give an app back its own key: put back the key Mediaplane holds, as ${WIRING_RUNBOOK} shows`,
+        ]
+      : []),
+    ...(has('left')
+      ? [
+          "apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it",
+        ]
+      : []),
+  ];
+}
+
 export function formatDiagnostic(diagnostic: Diagnostic): string {
@@ -153,3 +186,3 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
     for (const drift of result.drift) io.stdout(`${driftLine(drift)}\n`);
-    io.stdout('  apply puts each back.\n');
+    for (const line of driftAdvice(result.drift)) io.stdout(`  ${line}.\n`);
   }
@@ -177,2 +210,69 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
 
+/**
+ * What `mediaplane drift` found: each change made outside Mediaplane, what it couldn't
+ * check, and how the secrets fared, by name only.
+ */
+export function printDrift(
+  result: DriftResult,
+  options: { json: boolean },
+  io: Io,
+): void {
+  if (options.json) {
+    io.stdout(`${JSON.stringify({ schema: DRIFT_JSON_SCHEMA, ...result }, null, 2)}\n`);
+    return;
+  }
+  for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
+  if (!result.ok) {
+    io.stderr('\nDrift could not look. Fix the errors above and run it again.\n');
+    return;
+  }
+  if (result.drift.length > 0) {
+    io.stdout('Changed outside Mediaplane since it was applied:\n');
+    for (const drift of result.drift) io.stdout(`${driftLine(drift)}\n`);
+  }
+  if (result.unchecked.length > 0) {
+    io.stdout('Not checked:\n');
+    for (const { resource, reason } of result.unchecked) {
+      io.stdout(`  ? ${resource}: ${reason}\n`);
+    }
+  }
+  const verdicts = (verdict: string) =>
+    result.checks.filter((check) => check.verdict === verdict);
+  const unchecked = verdicts('unchecked');
+  // A secret that passed lately isn't checked again until its time is up (checkEvery).
+  const recalled = verdicts('passed').filter((check) => check.at !== undefined);
+  const passed = verdicts('passed').length;
+  const secrets = [
+    [
+      passed,
+      recalled.length === 0
+        ? 'passed'
+        : `passed (${String(recalled.length)} as last checked)`,
+    ] as const,
+    [verdicts('refused').length, 'refused'] as const,
+    [unchecked.length, 'not checked'] as const,
+  ].flatMap(([n, what]) => (n === 0 ? [] : [`${String(n)} ${what}`]));
+  if (secrets.length > 0) {
+    io.stdout(`Secrets, checked with each app's own check: ${secrets.join(', ')}.\n`);
+    for (const { resource, secret, at } of recalled) {
+      io.stdout(
+        `  = ${resource}.${secret}: passed when drift last checked it, at ${at ?? ''}; it isn't checked again until its time is up\n`,
+      );
+    }
+    for (const { resource, secret, reason } of unchecked) {
+      io.stdout(`  - ${resource}.${secret}: ${reason ?? 'not checked'}\n`);
+    }
+  }
+  if (result.clear) {
+    io.stdout('No drift: the apps hold what Mediaplane applied.\n');
+  } else if (result.drift.length > 0) {
+    io.stdout('Drift found.\n');
+    for (const line of driftAdvice(result.drift)) io.stdout(`  ${line}.\n`);
+  } else {
+    io.stdout(
+      'No drift found where Mediaplane could look, but it could not look at everything, or check every secret: see above.\n',
+    );
+  }
+}
+
 function count(n: number, noun: string, verb: string): string | undefined {
```

**Change** `packages/cli/src/run.ts`:

```diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index f955d79..a6cc32d 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -10,2 +10,3 @@ import {
   detectHostFacts,
+  drift,
   EGRESS_TIMEOUT_MS,
@@ -42,2 +43,3 @@ import {
   printDiagnostics,
+  printDrift,
   printError,
@@ -106,2 +108,7 @@ export const EXIT_CODES: Readonly<Record<string, readonly string[]>> = {
   status: ['0: the containers were listed', '1: an error, or no container for that app'],
+  drift: [
+    '0: nothing changed outside Mediaplane, and every resource was checked',
+    '2: drift found, or a resource or secret was not checked',
+    '1: an error; nothing was changed',
+  ],
   history: ['0: the records were listed or shown', '1: an error, or no such record'],
@@ -327,2 +334,26 @@ export function createProgram(
 
+  program
+    .command('drift')
+    .description(
+      'Report what changed in the apps outside Mediaplane since it applied them, without putting it back; it changes nothing in the apps but for the marks its checks leave (see docs/security/threat-model.md), and keeps what its checks found in state/resources.json, so it checks a secret it found refused no more until apply sets it',
+    )
+    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
+    .option('--json', 'print machine-readable JSON')
+    .addHelpText('after', exitCodesHelp('drift'))
+    .action(async (options: { home: string; json?: boolean }) => {
+      const home = resolve(options.home);
+      const runtime = deps.runtime(home, project);
+      const result = await drift({
+        home,
+        catalog,
+        host: () => deps.host(runtime),
+        env: io.env,
+        runtime,
+        probe: deps.probe(runtime, home),
+        ...(deps.wiring === undefined ? {} : { wiring: deps.wiring }),
+      });
+      printDrift(result, { json: options.json === true }, io);
+      setExitCode(result.ok ? (result.clear ? 0 : 2) : 1);
+    });
+
   program
```

**Create** `packages/engine/src/drift.ts`:

```ts
import { join, resolve } from 'node:path';
import { error, warning, type Diagnostic } from './diagnostics';
import { readResources, writeResources } from './integrations/resources';
import {
  DRIFT_RUNBOOK,
  type Drift,
  type SecretCheck,
  type WiringChange,
} from './integrations/wiring';
import { STACK_PATH } from './paths';
import { planStack, type PlanOptions } from './plan/plan';
import { acquireLock, LockedError, type Lock } from './state/lock';
import { readIfExists } from './util/fs';

export interface DriftOptions extends PlanOptions {
  now?: () => Date;
}

/** What `mediaplane drift` found (spec §6.3): never a secret's value. */
export interface DriftResult {
  /** False when it couldn't look: an error diagnostic says why. */
  ok: boolean;
  /** Nothing changed outside Mediaplane, as far as it could see, and it saw everything. */
  clear: boolean;
  /** What changed in the apps outside Mediaplane since it applied them. */
  drift: Drift[];
  /** How each secret was checked: passed, refused, or unchecked and why. */
  checks: SecretCheck[];
  /** The resources it couldn't look at, and why: the drift there is unknown. */
  unchecked: { resource: string; reason: string }[];
  diagnostics: Diagnostic[];
}

/** Why a resource checked after the start, in plan, isn't looked at by drift. */
const NOT_RUNNING =
  "its app isn't running and healthy, or is to be set up first: run apply, then drift again";

/**
 * Report what changed in the apps outside Mediaplane since it applied them (spec §5.2,
 * §6.3): `plan`, in observe-only mode, under apply's lock, so neither runs while the
 * other does. It changes nothing in the apps but for the marks its checks leave, which
 * it keeps few: a secret it finds refused isn't checked again until apply sets it, and
 * one that passed only once its resource's `checkEvery` has gone by. To know that, it
 * keeps each check's verdict and time in state/resources.json, its one write. A schedule
 * can call it as it is (M2).
 */
export async function drift(options: DriftOptions): Promise<DriftResult> {
  const home = resolve(options.home);
  const now = options.now ?? (() => new Date());
  // Never create state/ in a folder that isn't a Mediaplane home; plan explains why.
  if ((await readIfExists(join(home, STACK_PATH))) === undefined) {
    return failedDrift((await planStack({ ...options, home })).result.diagnostics);
  }
  let lock: Lock;
  try {
    lock = await acquireLock(home, now, 'drift');
  } catch (cause) {
    if (!(cause instanceof LockedError)) throw cause;
    return failedDrift([
      error('drift.locked', cause.message, {
        hint: 'wait for it to finish, then run drift again; if nothing is running, delete state/lock',
      }),
    ]);
  }
  try {
    const { result } = await planStack({ ...options, home, drift: { now } });
    if (!result.ok) return failedDrift(result.diagnostics);
    const diagnostics = [...result.diagnostics];
    try {
      await keepChecks(home, result.checks, now());
    } catch (cause) {
      diagnostics.push(
        warning(
          'drift.checks-not-kept',
          `what drift found of each secret could not be kept in state/resources.json: ${cause instanceof Error ? cause.message : String(cause)}`,
          {
            hint: `the next drift checks them again; check that this user can write to state/. See ${DRIFT_RUNBOOK}`,
          },
        ),
      );
    }
    const unchecked = result.wiring.flatMap(notLooked);
    return {
      ok: true,
      clear:
        result.drift.length === 0 &&
        unchecked.length === 0 &&
        result.checks.every((check) => check.verdict !== 'unchecked'),
      drift: result.drift,
      checks: result.checks,
      unchecked,
      diagnostics,
    };
  } finally {
    await lock.release();
  }
}

/** A resource drift couldn't look at, and why; none for one it did. */
function notLooked(change: WiringChange): { resource: string; reason: string }[] {
  if (change.action === 'after-start') {
    return [{ resource: change.resource, reason: NOT_RUNNING }];
  }
  if (change.action === 'unknown') {
    return [
      {
        resource: change.resource,
        reason: change.reason ?? 'the app could not be asked',
      },
    ];
  }
  return [];
}

/**
 * Keep the verdict and time of each check drift ran now, in the record of its resource:
 * what lets the next drift leave a refused secret, or one that passed lately, unchecked.
 * Written only when something changed, and only for resources Mediaplane recorded.
 */
async function keepChecks(
  home: string,
  checks: readonly SecretCheck[],
  at: Date,
): Promise<void> {
  const ran = checks.filter(
    (check) => check.at === undefined && check.verdict !== 'unchecked',
  );
  if (ran.length === 0) return;
  const known = await readResources(home);
  let changed = false;
  for (const check of ran) {
    const record = known[check.resource];
    if (record === undefined || check.verdict === 'unchecked') continue;
    record.checks = {
      ...record.checks,
      [check.secret]: { verdict: check.verdict, at: at.toISOString() },
    };
    changed = true;
  }
  if (changed) await writeResources(home, known);
}

function failedDrift(diagnostics: Diagnostic[]): DriftResult {
  return { ok: false, clear: false, drift: [], checks: [], unchecked: [], diagnostics };
}
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index a6807d1..38045e7 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -52,2 +52,3 @@ export * from './apply/apply';
 export * from './status';
+export * from './drift';
 export * from './credentials';
```

**Change** `packages/engine/src/integrations/types.ts`:

```diff
diff --git a/packages/engine/src/integrations/types.ts b/packages/engine/src/integrations/types.ts
index f4b9c45..f0f30a6 100644
--- a/packages/engine/src/integrations/types.ts
+++ b/packages/engine/src/integrations/types.ts
@@ -100,2 +100,8 @@ export interface ResourceSpec {
   secrets: readonly string[];
+  /**
+   * At most how often `mediaplane drift` checks its secrets, in ms, when they last passed:
+   * a check that leaves a mark in the app each time, such as Jellyfin's sign-in, in its
+   * activity log. Plan and apply check every time.
+   */
+  checkEvery?: number;
   /** Resources ("<app>.<name>") that must be in place first: one that failed skips this. */
@@ -140,2 +146,7 @@ export interface ResourceSpec {
   ): Promise<boolean | Unchecked>;
+  /**
+   * What the app's own health check says is wrong with it, read and never run: drift warns
+   * of it. Prowlarr's tests its indexer proxies itself (probed). Throws AppApiError.
+   */
+  health?(api: AppApi, observed: ObservedResource): Promise<string | undefined>;
   /** Make it. The id the app gave it, or null for a singleton. */
```

**Change** `packages/engine/src/integrations/wiring.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index 6a8e6b4..0d5d05d 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -18,3 +18,3 @@ import { foundSecrets, redact, redactionValues, type FoundSecrets } from '../uti
 import { compare } from '../util/sort';
-import { desiredOf, withOverrides } from './overrides';
+import { desiredOf, isUnmanaged, withOverrides } from './overrides';
 import type { KnownResource, KnownResources } from './resources';
@@ -32,2 +32,5 @@ export const WIRING_RUNBOOK = runbookUrl('wiring-failed');
 
+/** Where drift found in the apps sends you. */
+export const DRIFT_RUNBOOK = runbookUrl('drift-reported');
+
 /** How long plan waits for an app that is starting, in ms: apply waits APP_DEADLINE_MS. */
@@ -66,8 +69,13 @@ export interface WiringChange {
  * - `secret`: the app's own check refuses one of its secrets (`since`: when drift found
- *   it, for one it doesn't check again).
+ *   it, for one it doesn't check again);
+ * - `key`: an app refuses its own key, which Mediaplane holds (`resource` is the app, and
+ *   `secret` the key's name), or a resource holds that key (`source`): a shared key
+ *   changed at its source;
+ * - `left`: the app still holds a resource Mediaplane made that the stack no longer
+ *   wants, such as Prowlarr's link to an arr taken out of the stack.
  */
 export interface Drift {
-  /** "<app>.<resource>". */
+  /** "<app>.<resource>", or "<app>" for an app that refuses its key. */
   resource: string;
-  kind: 'field' | 'missing' | 'secret';
+  kind: 'field' | 'missing' | 'secret' | 'key' | 'left';
   field?: string;
@@ -83,2 +91,4 @@ export interface Drift {
   since?: string;
+  /** key: the app whose key the resource holds. */
+  source?: string;
 }
@@ -358,2 +368,7 @@ export interface ExamineOptions {
   context?: VerifyContext;
+  /**
+   * `mediaplane drift`'s, which checks again a secret that passed only once the resource's
+   * `checkEvery` has gone by, from `now`.
+   */
+  drift?: { now: () => Date };
 }
@@ -567,2 +582,22 @@ async function checkSecrets(
   }
+  // Drift checks again what passed only once its time has gone by: each check of
+  // Jellyfin's admin signs in, which its activity log keeps (the owner's decision).
+  const every = spec.checkEvery;
+  if (options.drift !== undefined && every !== undefined) {
+    const now = options.drift.now().getTime();
+    const passed = spec.secrets.map((secret) => known?.checks?.[secret]);
+    if (
+      passed.every(
+        (check) =>
+          check?.verdict === 'passed' && now - new Date(check.at).getTime() < every,
+      )
+    ) {
+      return spec.secrets.map((secret, i) => ({
+        resource: address,
+        secret,
+        verdict: 'passed',
+        at: passed[i]?.at ?? '',
+      }));
+    }
+  }
   // The catalog's tests make every resource with secrets give a verify.
@@ -659,2 +694,7 @@ export interface PlanWiringOptions {
   known: KnownResources;
+  /**
+   * `mediaplane drift`'s, which checks a secret that passed again only once its resource's
+   * `checkEvery` has gone by, and reads the apps' own health checks (`health`).
+   */
+  drift?: { now: () => Date };
   seams?: WiringSeams;
@@ -717,2 +757,4 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
   };
+  /** The keys of the apps that refuse their own, as Mediaplane holds them: by value. */
+  const refusedKeys = new Map<string, string>();
   /**
@@ -737,2 +779,5 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
     const targets = wiringTargets(ctx);
+    // A resource that holds the key of an app that refuses it: drift on the consumer
+    // too (§6.3), whether or not its own app can be asked.
+    drift.push(...holdingRefused(ctx, refusedKeys));
     const client = reached.get(app.def.id);
@@ -761,2 +806,9 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
       }
+      // The app refuses the key Mediaplane holds for it: changed at its source (§6.3).
+      const name = app.def.api?.key.secret;
+      const key = name === undefined ? undefined : options.keys[app.def.id]?.[name];
+      if (cause.kind === 'auth' && name !== undefined && key !== undefined) {
+        drift.push({ resource: app.def.id, kind: 'key', secret: name });
+        refusedKeys.set(key, app.def.id);
+      }
       continue;
@@ -790,2 +842,3 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
           context,
+          ...(options.drift === undefined ? {} : { drift: options.drift }),
         });
@@ -830,3 +883,27 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
       if (waiting) pending.add(address);
+      if (options.drift !== undefined && spec.health !== undefined && result.observed) {
+        const said = await healthOf(spec, client.api, result.observed);
+        if (said !== undefined) {
+          diagnostics.push(
+            warning(
+              'drift.health',
+              redact(
+                `${address}: ${said}`,
+                redactionValues([...options.secrets, ...found.values]),
+              ),
+              {
+                hint: `the app's own health check found it, and apply can't put it right: see the app's own health page, and ${DRIFT_RUNBOOK}`,
+              },
+            ),
+          );
+        }
+      }
     }
+    const left = await leftIn(ctx, client.api, options.known, [
+      ...options.secrets,
+      ...found.values,
+    ]);
+    drift.push(...left.drift);
+    diagnostics.push(...left.diagnostics);
+    for (const change of left.unknown) add(change);
   }
@@ -834 +911,75 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
 }
+
+/**
+ * The resources of `ctx`'s app that the stack wants with a key that its source app
+ * refuses (`refused`, by value), as `key` drift that names the source.
+ */
+function holdingRefused(
+  ctx: WiringContext,
+  refused: ReadonlyMap<string, string>,
+): Drift[] {
+  if (refused.size === 0) return [];
+  return wantedResources(ctx).flatMap((spec) =>
+    Object.entries(desiredOf(spec, ctx)?.secrets ?? {}).flatMap(
+      ([secret, value]): Drift[] => {
+        const source = refused.get(value);
+        return source === undefined
+          ? []
+          : [{ resource: resourceAddress(ctx.app, spec), kind: 'key', secret, source }];
+      },
+    ),
+  );
+}
+
+/** What the app's own health check says of a resource, or undefined if it can't say. */
+async function healthOf(
+  spec: ResourceSpec,
+  api: AppApi,
+  observed: ObservedResource,
+): Promise<string | undefined> {
+  try {
+    return await spec.health?.(api, observed);
+  } catch (cause) {
+    if (!(cause instanceof AppApiError)) throw cause;
+    return `its app's own health check could not be read: ${cause.message}`;
+  }
+}
+
+/**
+ * The resources Mediaplane made in `ctx`'s app, by its record, that the stack no longer
+ * wants and the app still holds (`left`): apply doesn't remove them. One you stopped it
+ * managing (`unmanaged`) is yours. One the app can't say about is a warning, and a change
+ * it couldn't check (`unknown`), never said to be gone: drift isn't clear then.
+ */
+async function leftIn(
+  ctx: WiringContext,
+  api: AppApi,
+  known: KnownResources,
+  secrets: readonly string[],
+): Promise<{ drift: Drift[]; diagnostics: Diagnostic[]; unknown: WiringChange[] }> {
+  const drift: Drift[] = [];
+  const diagnostics: Diagnostic[] = [];
+  const unknown: WiringChange[] = [];
+  for (const spec of ctx.app.def.integration?.resources ?? []) {
+    const address = resourceAddress(ctx.app, spec);
+    const record = known[address];
+    if (record === undefined || isUnmanaged(ctx.stack, address)) continue;
+    if (desiredOf(spec, ctx) !== undefined) continue;
+    try {
+      if ((await spec.observe(api, record)) !== undefined) {
+        drift.push({ resource: address, kind: 'left' });
+      }
+    } catch (cause) {
+      if (!(cause instanceof AppApiError)) throw cause;
+      const said = redact(
+        `Mediaplane made ${address}, which the stack no longer wants, and couldn't tell whether ${ctx.app.def.name} still holds it: ${cause.message}`,
+        redactionValues(secrets),
+      );
+      diagnostics.push(
+        warning('drift.left-unknown', said, { hint: `see ${DRIFT_RUNBOOK}` }),
+      );
+      unknown.push({ resource: address, action: 'unknown', reason: said });
+    }
+  }
+  return { drift, diagnostics, unknown };
+}
```

**Change** `packages/engine/src/plan/plan.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index c867e1c..a829978 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -66,2 +66,9 @@ export interface PlanOptions {
   wiring?: WiringSeams;
+  /**
+   * `mediaplane drift`'s plan (spec §6.3, "the planner in observe-only mode"), from
+   * `now`: no preflight, every running and healthy app asked, even one apply would
+   * change, a secret that passed checked again only once its `checkEvery` has gone by,
+   * and the apps' own health checks read.
+   */
+  drift?: { now: () => Date };
 }
@@ -148,9 +155,12 @@ export async function planStack(
   diagnostics.push(...otherHomes(current, home));
+  // Drift asks what the apps hold now: the host's ports and folders don't change that.
   try {
-    diagnostics.push(
-      ...(await runPreflight(
-        { stack, versions, ownPorts: ownPorts(current) },
-        options.probe,
-      )),
-    );
+    if (options.drift === undefined) {
+      diagnostics.push(
+        ...(await runPreflight(
+          { stack, versions, ownPorts: ownPorts(current) },
+          options.probe,
+        )),
+      );
+    }
   } catch (cause) {
@@ -253,4 +263,7 @@ export async function planStack(
     // An app to set up is asked once it is: without its key, it can't be asked now.
+    // Drift asks the others as they run now, even one apply would change.
     const changing = new Set([
-      ...containers.filter((c) => c.action !== 'unchanged').map((c) => c.service),
+      ...(options.drift === undefined
+        ? containers.filter((c) => c.action !== 'unchanged').map((c) => c.service)
+        : []),
       ...bootstrap.map((b) => b.app),
@@ -279,2 +292,3 @@ export async function planStack(
         known,
+        ...(options.drift === undefined ? {} : { drift: options.drift }),
         ...(options.wiring === undefined ? {} : { seams: options.wiring }),
```

**Change** `packages/engine/src/runbooks.ts`:

```diff
diff --git a/packages/engine/src/runbooks.ts b/packages/engine/src/runbooks.ts
index 2cd1514..dbf0349 100644
--- a/packages/engine/src/runbooks.ts
+++ b/packages/engine/src/runbooks.ts
@@ -8,3 +8,3 @@ export const RUNBOOKS_URL =
 /** The runbooks (docs/runbooks/<name>.md). */
-export type Runbook = 'app-wont-start' | 'vpn-down' | 'wiring-failed';
+export type Runbook = 'app-wont-start' | 'drift-reported' | 'vpn-down' | 'wiring-failed';
 
```

**Change** `packages/engine/src/state/lock.ts`:

```diff
diff --git a/packages/engine/src/state/lock.ts b/packages/engine/src/state/lock.ts
index ba707d5..c5fdb26 100644
--- a/packages/engine/src/state/lock.ts
+++ b/packages/engine/src/state/lock.ts
@@ -11,2 +11,4 @@ export interface LockInfo {
   startedAt: string;
+  /** The command that holds it, such as "drift"; apply's, in a lock that doesn't say. */
+  command?: string;
 }
@@ -17,3 +19,3 @@ export interface Lock {
 
-/** Another apply holds the lock; `holder` says who, when the lock file can be read. */
+/** Another command holds the lock; `holder` says who, when the lock file can be read. */
 export class LockedError extends Error {
@@ -23,2 +25,6 @@ export class LockedError extends Error {
   constructor(holder: LockInfo | undefined) {
+    const who =
+      holder?.command === undefined || holder.command === 'apply'
+        ? 'another apply'
+        : `mediaplane ${holder.command}`;
     super(
@@ -26,3 +32,3 @@ export class LockedError extends Error {
         ? `${LOCK_PATH} exists but cannot be read`
-        : `another apply is running (pid ${String(holder.pid)} on ${holder.host}, started ${holder.startedAt})`,
+        : `${who} is running (pid ${String(holder.pid)} on ${holder.host}, started ${holder.startedAt})`,
     );
@@ -37,3 +43,4 @@ const MAX_ATTEMPTS = 3;
  * Take the single-writer lock (spec §5, stage 1): create state/lock exclusively, recording
- * the pid, host and start time. A lock left by a dead process on this host is cleared.
+ * the pid, host, start time and `command` (apply's, `drift`'s, `keep`'s). A lock left by
+ * a dead process on this host is cleared.
  */
@@ -42,2 +49,3 @@ export async function acquireLock(
   now: () => Date = () => new Date(),
+  command = 'apply',
 ): Promise<Lock> {
@@ -49,2 +57,3 @@ export async function acquireLock(
     startedAt: now().toISOString(),
+    ...(command === 'apply' ? {} : { command }),
   };
@@ -109,3 +118,8 @@ async function readHolder(path: string): Promise<LockInfo | undefined | 'gone'>
     ) {
-      return { pid: data.pid, host: data.host, startedAt: data.startedAt };
+      return {
+        pid: data.pid,
+        host: data.host,
+        startedAt: data.startedAt,
+        ...(typeof data.command === 'string' ? { command: data.command } : {}),
+      };
     }
```

**Create** `packages/engine/src/testing/home.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeResources, type KnownResources } from '../integrations/resources';
import { SECRETS_PATH } from '../paths';
import type { Runtime } from '../runtime/types';
import { fakeRuntime, running } from './fakes';
import { tempDir } from './temp';

/**
 * A Mediaplane home of a stack wired to the fakes (fakeSonarr), for drift's and keep's
 * tests: `stack` as its stack.yaml, Sonarr's `key` and the shared admin's `password` in
 * its secrets store, and `known` as what Mediaplane last applied, in
 * state/resources.json.
 */
export async function wiredHome(options: {
  prefix: string;
  stack: string;
  key: string;
  password: string;
  known: KnownResources;
}): Promise<string> {
  const dir = await tempDir(options.prefix);
  await writeFile(join(dir, 'stack.yaml'), options.stack);
  await mkdir(join(dir, 'state'));
  await writeFile(
    join(dir, SECRETS_PATH),
    JSON.stringify({
      version: 1,
      apps: { sonarr: { apiKey: options.key } },
      shared: { adminPassword: options.password },
    }),
  );
  await writeResources(dir, options.known);
  return dir;
}

/**
 * The containers of a stack of Jellyfin, qBittorrent and Sonarr, running and healthy, at
 * `addresses` on the wiring network: what wiredHome's stack runs.
 */
export function wiredRuntime(addresses: Record<string, string>): Runtime {
  return fakeRuntime({
    hashes: { ok: true, hashes: {} },
    containers: running({
      jellyfin: 'a'.repeat(64),
      qbittorrent: 'c'.repeat(64),
      sonarr: 'b'.repeat(64),
    }),
    addresses,
  });
}
```

**Change** `packages/engine/src/testing/index.ts`:

```diff
diff --git a/packages/engine/src/testing/index.ts b/packages/engine/src/testing/index.ts
index 385c4de..246ad10 100644
--- a/packages/engine/src/testing/index.ts
+++ b/packages/engine/src/testing/index.ts
@@ -4,2 +4,3 @@ export * from './fixtures';
 export * from './fakes';
+export * from './home';
 export * from './http';
```

**Change** `packages/engine/src/testing/prowlarr.ts`:

```diff
diff --git a/packages/engine/src/testing/prowlarr.ts b/packages/engine/src/testing/prowlarr.ts
index c55a515..1566e55 100644
--- a/packages/engine/src/testing/prowlarr.ts
+++ b/packages/engine/src/testing/prowlarr.ts
@@ -195,2 +195,6 @@ export function fakeProwlarr(
   if (answered !== undefined) return answered;
+  // What its own health check found when it last ran, every six hours (probed).
+  if (request.path === '/api/v1/health' && request.method === 'GET') {
+    return { status: 200, body: state.health };
+  }
   if (request.path === '/api/v1/tag' && request.method === 'GET') {
```

**Change** `packages/engine/src/testing/wiring.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index ba874e8..750719d 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -156,2 +156,4 @@ export interface FakeAppState {
   tags: { id: number; label: string }[];
+  /** What Prowlarr's own health check found when it last ran: `GET /api/v1/health`. */
+  health: { source: string; type: string; message: string }[];
   /**
@@ -223,2 +225,3 @@ export function freshAppState(): FakeAppState {
     tags: [],
+    health: [],
     wizard: 'new',
```

- [ ] **Step 4: Run them to see them pass, and regenerate the CLI reference**

```bash
pnpm vitest run catalog/jellyfin/integration.test.ts catalog/prowlarr/integration.test.ts packages/cli/src/output.test.ts packages/cli/src/run.test.ts packages/engine/src/drift.test.ts packages/engine/src/integrations/wiring.test.ts packages/engine/src/state/lock.test.ts
pnpm docs:generate
```

Expected: PASS. `docs:generate` rewrites `docs/reference/cli.md` (`mediaplane drift`).

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages catalog docs/reference
git commit -m "feat: mediaplane drift reports what changed in the apps outside Mediaplane, and checks each secret no more than it must" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 2056 tests pass in 91 files.

---

### Task 5: `mediaplane keep`

Decision: Keep mine writes one line, checked, keeping the file's mode and group, and
refuses what it can't write safely (decision 13).
Decision: keep looks at one resource, asking the app only to read it (decision 13); a
resource deleted or left becomes `unmanaged` (decisions 8 and 15).
Decision: the CLI's advice names Keep mine (decision 16).

**Files:**
- Create: `packages/engine/src/config/overrides-file.ts`, `packages/engine/src/keep.ts`
- Modify: `packages/cli/src/output.ts`, `packages/cli/src/run.ts`, `packages/engine/src/config/schema.ts`, `packages/engine/src/drift.ts`, `packages/engine/src/index.ts`, `packages/engine/src/integrations/wiring.ts`, `packages/engine/src/plan/plan.ts`, `packages/engine/src/util/atomic.ts`
- Test: `packages/cli/src/output.test.ts`, `packages/cli/src/run.test.ts`, `packages/engine/src/config/overrides-file.test.ts`, `packages/engine/src/keep.test.ts`, `packages/engine/src/util/atomic.test.ts`
- Generated: `docs/reference/cli.md`, `docs/reference/stack-yaml.md`, `docs/reference/stack.schema.json`

**Interfaces:**
- **Consumes:** Task 2's `overrideTarget`, `isUnmanaged`, `UNMANAGED`; Task 4's `drift`
  mode, `leftIn`, `DRIFT_RUNBOOK`, `acquireLock`'s command, `driftAdvice`, `wiredHome`
  and `wiredRuntime`; `writeFileAtomic`.
- **Produces:**
  - from `@mediaplane/engine`: `overrideLine(key: string, value: Scalar): string`,
    `withOverride(source: string, key: string, value: Scalar): { ok: true; text: string } | { ok: false; reason: string }`,
    `stackFileProblem(path: string, uid?: number, groups?: readonly number[]): Promise<string | undefined>`;
    `interface KeepOptions extends PlanOptions { path: string; now? }`,
    `interface KeepResult { ok; key: string; value: Scalar | undefined; diagnostics }`,
    `keep(options: KeepOptions): Promise<KeepResult>` (errors `keep.locked`,
    `keep.unmanaged`, `keep.no-drift`, `keep.unreadable`, `keep.secret`, `keep.external`,
    `keep.stack-file`; warning `keep.record`);
  - `writeFileAtomic(path, content, mode?, group?)`;
  - `PlanOptions.only?: string`, `PlanWiringOptions.only?`, `ExamineOptions.secrets?: boolean`
    (false: no secret checked, and `resolve`'s fields taken from the record);
  - the CLI: `mediaplane keep <path> [--home] [--json]` (exit 0 or 1),
    `KEEP_JSON_SCHEMA` (`'mediaplane.keep/v1'`), `printKeep(result, options, io)`, and
    Keep mine's hint in `driftAdvice`.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/cli/src/output.test.ts`:

```diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index 83e5ffe..05e7b76 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -154,3 +154,3 @@ describe('printPlan: drift', () => {
         "  ! qbittorrent.admin.password: refused by the app's own check (found by drift at 2026-10-20T08:00:00.000Z; not checked again until apply sets it)",
-        '  apply puts back each field, resource and secret changed in the apps.',
+        '  apply puts back each field, resource and secret changed in the apps; mediaplane keep <app>.<resource>.<field> keeps what the app holds instead, and <app>.<resource> stops Mediaplane managing one deleted.',
         'Wiring:',
@@ -190,3 +190,3 @@ describe('printPlan: drift', () => {
         "  apply doesn't give an app back its own key: put back the key Mediaplane holds, as https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md shows.",
-        "  apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it.",
+        "  apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it, or keep it as yours with mediaplane keep <app>.<resource>, which stops the report.",
         'No changes.',
@@ -243,3 +243,3 @@ describe('printDrift', () => {
         'Drift found.',
-        '  apply puts back each field, resource and secret changed in the apps.',
+        '  apply puts back each field, resource and secret changed in the apps; mediaplane keep <app>.<resource>.<field> keeps what the app holds instead, and <app>.<resource> stops Mediaplane managing one deleted.',
         '',
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 0b67f8a..0c69545 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -1,2 +1,2 @@
-import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
+import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
 import { join } from 'node:path';
@@ -1729,3 +1729,3 @@ describe('mediaplane drift', () => {
     expect(term.stdout()).toContain(
-      'Drift found.\n  apply puts back each field, resource and secret changed in the apps.\n',
+      'Drift found.\n  apply puts back each field, resource and secret changed in the apps; mediaplane keep <app>.<resource>.<field> keeps what the app holds instead, and <app>.<resource> stops Mediaplane managing one deleted.\n',
     );
@@ -1799,2 +1799,106 @@ describe('mediaplane drift', () => {
 
+describe('mediaplane keep', () => {
+  const current = () =>
+    fakeRuntime({ hashes: { ok: true, hashes: HASHES }, containers: running(HASHES) });
+
+  it("writes what an app holds as an override in stack.yaml, its mode kept; qBittorrent's category follows, and drift is then clear", async () => {
+    const runtime = current();
+    const home = await currentHome(runtime);
+    const before = await readFile(join(home, 'stack.yaml'), 'utf8');
+    await chmod(join(home, 'stack.yaml'), 0o640);
+    const client = apis.apps.get('sonarr')?.downloadClients[0];
+    if (client === undefined) throw new Error('no download client faked');
+    client.fields = client.fields.map((f) =>
+      f.name === 'tvCategory' ? { ...f, value: 'television' } : f,
+    );
+    // As Sonarr's own test made it, with no save path.
+    const qbittorrent = apis.apps.get('qbittorrent');
+    if (qbittorrent === undefined) throw new Error('no qBittorrent faked');
+    qbittorrent.categories.television = '';
+    const term = capture();
+    expect(
+      await run(
+        ['keep', 'sonarr.download_client.category', '--home', home],
+        term.io,
+        deps(runtime),
+      ),
+    ).toBe(0);
+    expect(term.stdout()).toBe(
+      'Wrote sonarr.download_client.category: "television" under overrides: in stack.yaml. apply now leaves it as the app holds it, and drift no longer reports it.\n',
+    );
+    expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe(
+      `${before}overrides:\n  sonarr.download_client.category: television\n`,
+    );
+    expect((await stat(join(home, 'stack.yaml'))).mode & 0o777).toBe(0o640);
+    // qBittorrent's category is now the one kept: plan shows apply putting it in place,
+    // with its save path, and drift waits for it before it checks the client's key.
+    const planned = capture();
+    expect(await run(['plan', '--home', home], planned.io, deps(runtime))).toBe(2);
+    expect(planned.stdout()).toContain(
+      '  ~ update      qbittorrent.category_tv (savePath)\n',
+    );
+    const waiting = capture();
+    expect(await run(['drift', '--home', home], waiting.io, deps(runtime))).toBe(2);
+    expect(waiting.stdout()).toContain(
+      '  - sonarr.download_client.apiKey: what it requires is yet to be put in place, which apply does first\n',
+    );
+    expect(waiting.stdout()).not.toContain('Changed outside Mediaplane');
+    // Put in place, as apply does: drift is clear, with the client's key checked.
+    qbittorrent.categories.television = '/data/torrents/television';
+    expect(await run(['drift', '--home', home], capture().io, deps(runtime))).toBe(0);
+  });
+
+  it('refuses to keep where an app sends a key, saying why, and writes nothing', async () => {
+    const runtime = current();
+    const home = await currentHome(runtime);
+    const before = await readFile(join(home, 'stack.yaml'), 'utf8');
+    const term = capture();
+    expect(
+      await run(
+        ['keep', 'seerr.server_sonarr.hostname', '--home', home],
+        term.io,
+        deps(runtime),
+      ),
+    ).toBe(1);
+    expect(term.stderr()).toContain(
+      "error: seerr.server_sonarr.hostname can't be kept: it sets where a key is sent (spec §11, Slice 6)\n",
+    );
+    expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe(before);
+  });
+
+  it('exits 1, writing nothing, for what has not drifted, saying why, in JSON too', async () => {
+    const runtime = current();
+    const home = await currentHome(runtime);
+    const before = await readFile(join(home, 'stack.yaml'), 'utf8');
+    const term = capture();
+    expect(
+      await run(
+        ['keep', 'sonarr.download_client.category', '--home', home, '--json'],
+        term.io,
+        deps(runtime),
+      ),
+    ).toBe(1);
+    expect(JSON.parse(term.stdout())).toMatchObject({
+      schema: 'mediaplane.keep/v1',
+      ok: false,
+      key: 'sonarr.download_client.category',
+      value: null,
+      diagnostics: [{ code: 'keep.no-drift' }],
+    });
+    const human = capture();
+    expect(
+      await run(
+        ['keep', 'sonarr.download_client.apiKey', '--home', home],
+        human.io,
+        deps(runtime),
+      ),
+    ).toBe(1);
+    expect(human.stderr()).toContain(
+      "error: sonarr.download_client.apiKey is a secret: Mediaplane checks it with Sonarr's own check, and never keeps it\n",
+    );
+    expect(human.stderr()).toContain('Nothing was kept; stack.yaml is as it was.\n');
+    expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe(before);
+  });
+});
+
 describe('mediaplane status', () => {
```

**Create** `packages/engine/src/config/overrides-file.test.ts`:

```ts
import { chmod, link, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../testing/temp';
import { overrideLine, stackFileProblem, withOverride } from './overrides-file';
import { starterStack } from './starter';

const KEY = 'sonarr.download_client.category';

/** The stack of spec §4.2's example: comments lined up after values, and a blank line. */
const SPEC = `# yaml-language-server: $schema=https://example.invalid/stack.schema.json
version: 1
timezone: Europe/London
user: { uid: 1000, gid: 1000 }
paths: { data: /srv/data }
network: { bind: lan, lan_subnet: 192.168.1.0/24 }   # lan | localhost | all
media_server: jellyfin                                 # jellyfin | plex

apps:
  sonarr: {}
  radarr: { port: 7879 }        # escape hatches: port, version, env
  qbittorrent: { vpn: false }
overrides:                      # written by "Keep mine"
  radarr.download_client.category: films   # mine
# managed_by: external          # Mediaplane never writes this file
`;

/** `source` with `line` inserted after its line number `after` (1 based). */
function inserted(source: string, after: number, line: string): string {
  const lines = source.split('\n');
  lines.splice(after, 0, line);
  return lines.join('\n');
}

function written(
  source: string,
  key = KEY,
  value: string | number | boolean = 'television',
) {
  const result = withOverride(source, key, value);
  if (!result.ok) throw new Error(result.reason);
  return result.text;
}

describe('withOverride', () => {
  it('adds the line after the last override, changing nothing else, its comments neither', () => {
    expect(written(SPEC)).toBe(
      inserted(SPEC, 14, '  sonarr.download_client.category: television'),
    );
  });

  it("adds overrides: at the end of init's starter file, which has none", () => {
    const starter = starterStack({
      mediaServer: 'jellyfin',
      dataPath: '/srv/data',
      vpnProvider: 'mullvad',
      vpnAddresses: '10.64.0.2/32',
      loginOnLan: true,
      timezone: 'Europe/London',
      user: { uid: 1000, gid: 1000 },
      bind: 'lan',
      lanSubnet: undefined,
      adminUser: 'admin',
      adminPasswordFile: undefined,
    });
    expect(written(starter)).toBe(
      `${starter}overrides:\n  sonarr.download_client.category: television\n`,
    );
    // Without a last line end, and with Windows line ends, as the file has them.
    const bare =
      'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\napps: { sonarr: {}, qbittorrent: { vpn: false } }';
    expect(written(bare)).toBe(`${bare}\noverrides:\n  ${KEY}: television\n`);
    const crlf =
      'version: 1\r\npaths: { data: /srv/data }\r\nmedia_server: jellyfin\r\napps:\r\n  sonarr: {}\r\n  qbittorrent: { vpn: false }\r\n';
    expect(written(crlf)).toBe(`${crlf}overrides:\r\n  ${KEY}: television\r\n`);
  });

  it('keeps the indentation of the overrides there are, and their line ends', () => {
    const deep =
      'version: 1\npaths:\n    data: /srv/data\nmedia_server: jellyfin\napps:\n    sonarr: {}\n    qbittorrent: { vpn: false }\noverrides:\n    a.b.c: 1\n';
    expect(written(deep)).toBe(`${deep.slice(0, -1)}\n    ${KEY}: television\n`);
    const crlf =
      'version: 1\r\npaths: { data: /srv/data }\r\nmedia_server: jellyfin\r\napps: { sonarr: {}, qbittorrent: { vpn: false } }\r\noverrides:\r\n  a.b.c: 1 # one\r\n# end\r\n';
    expect(written(crlf)).toBe(
      'version: 1\r\npaths: { data: /srv/data }\r\nmedia_server: jellyfin\r\napps: { sonarr: {}, qbittorrent: { vpn: false } }\r\noverrides:\r\n  a.b.c: 1 # one\r\n  sonarr.download_client.category: television\r\n# end\r\n',
    );
  });

  it('adds the line after an override written as a block of lines', () => {
    const head =
      'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\napps: { sonarr: {}, qbittorrent: { vpn: false } }\n';
    expect(
      written(
        `${head}overrides:\n  a.b.c: |-\n    two\n    lines\nmanaged_by: mediaplane\n`,
      ),
    ).toBe(
      `${head}overrides:\n  a.b.c: |-\n    two\n    lines\n  ${KEY}: television\nmanaged_by: mediaplane\n`,
    );
    expect(written(`${head}overrides:\n  a.b.c: >\n    folded\n`)).toBe(
      `${head}overrides:\n  a.b.c: >\n    folded\n  ${KEY}: television\n`,
    );
  });

  it('replaces the value of a key kept before, where it is', () => {
    const kept = SPEC.replace(
      '  radarr.download_client.category: films   # mine',
      '  sonarr.download_client.category: "tv-old"   # mine',
    );
    expect(written(kept)).toBe(kept.replace('"tv-old"', 'television'));
  });

  it('writes into overrides: given as a flow of keys, or empty', () => {
    const head =
      'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\napps: { sonarr: {}, qbittorrent: { vpn: false } }\n';
    expect(written(`${head}overrides: {}\n`)).toBe(
      `${head}overrides: { ${KEY}: television }\n`,
    );
    expect(written(`${head}overrides: { a.b.c: 1 } # mine\n`)).toBe(
      `${head}overrides: { a.b.c: 1, ${KEY}: television } # mine\n`,
    );
  });

  it('writes numbers and true or false as such, and text YAML would misread quoted', () => {
    const head =
      'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\napps: { sonarr: {}, qbittorrent: { vpn: false } }\n';
    expect(written(head, 'sonarr.download_client.port', 8090)).toContain(
      'sonarr.download_client.port: 8090\n',
    );
    expect(written(head, 'sonarr.download_client.enable', false)).toContain(
      'sonarr.download_client.enable: false\n',
    );
    expect(written(head, KEY, 'true')).toContain(`${KEY}: "true"\n`);
    expect(overrideLine(KEY, 'two\nlines')).toBe(`${KEY}: "two\\nlines"`);
  });

  it("refuses a file it can't add to without changing more, saying why", () => {
    const reasons = (source: string) => {
      const result = withOverride(source, KEY, 'television');
      return result.ok ? 'written' : result.reason;
    };
    expect(reasons('version: [')).toBe('it is not a valid stack.yaml');
    expect(
      reasons(
        '{ version: 1, paths: { data: /srv/data }, media_server: jellyfin, apps: { sonarr: {}, qbittorrent: { vpn: false } } }\n',
      ),
    ).toBe('its top level is not a YAML block of keys, one per line');
    const head =
      'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\napps: { sonarr: {}, qbittorrent: { vpn: false } }\n';
    expect(reasons(`${head}---\nversion: 1\n`)).toBe('it is not a valid stack.yaml');
    // A key YAML writes as an explicit "? key", which its line can't follow as it is.
    expect(reasons(`${head}overrides:\n  ? a.b.c\n  : 1\n`)).toBe(
      "Mediaplane can't add the line there without changing more than it",
    );
    // A stack.yaml with overrides: that YAML reads as a value of its own.
    expect(reasons(`${head}overrides: &kept { a.b.c: 1 }\n`)).toBe('written');
    expect(reasons(`${head}overrides: { ${KEY}: [tv] }\n`)).toBe(
      'it is not a valid stack.yaml',
    );
  });
});

describe('stackFileProblem', () => {
  it("has none for a stack.yaml of this user's own", async () => {
    const dir = await tempDir('mediaplane-keep-');
    await writeFile(join(dir, 'stack.yaml'), 'version: 1\n');
    expect(await stackFileProblem(join(dir, 'stack.yaml'))).toBeUndefined();
  });

  it("says why it won't rewrite a link, a folder, a file with other names, or another user's", async () => {
    const dir = await tempDir('mediaplane-keep-');
    await writeFile(join(dir, 'real.yaml'), 'version: 1\n');
    await symlink(join(dir, 'real.yaml'), join(dir, 'link.yaml'));
    await link(join(dir, 'real.yaml'), join(dir, 'other.yaml'));
    await mkdir(join(dir, 'folder.yaml'));
    expect(await stackFileProblem(join(dir, 'link.yaml'))).toMatch(/^it is a link/);
    expect(await stackFileProblem(join(dir, 'folder.yaml'))).toBe(
      'it is not a regular file',
    );
    expect(await stackFileProblem(join(dir, 'real.yaml'))).toBe(
      'it has other names (hard links), which a rewrite would part from it',
    );
    await writeFile(join(dir, 'theirs.yaml'), 'version: 1\n');
    await chmod(join(dir, 'theirs.yaml'), 0o644);
    expect(await stackFileProblem(join(dir, 'theirs.yaml'), 4242)).toMatch(
      /^it belongs to uid \d+, and Mediaplane runs as uid 4242/,
    );
    // Of a group this user isn't in: the rewrite couldn't keep it.
    expect(
      await stackFileProblem(join(dir, 'theirs.yaml'), process.getuid?.(), [4242]),
    ).toMatch(/^it belongs to group \d+, which Mediaplane's user isn't in/);
  });
});
```

**Create** `packages/engine/src/keep.test.ts`:

```ts
import { readdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Catalog } from './catalog/types';
import { readResources, writeResources } from './integrations/resources';
import type { ResourceSpec } from './integrations/types';
import { keep } from './keep';
import { LOCK_PATH, RESOURCES_PATH } from './paths';
import { plan } from './plan/plan';
import type { Runtime } from './runtime/types';
import { fakeProbe, fakeRuntime } from './testing/fakes';
import { FIXTURE_HOST } from './testing/fixtures';
import { wiredHome, wiredRuntime } from './testing/home';
import { tempDir } from './testing/temp';
import { FAKE_LOGIN, fakeSonarr, WIRED_CATALOG } from './testing/wiring';

/** A stack.yaml written by hand: comments, a blank line and spacing keep must keep. */
const STACK = `# My media stack.
version: 1
paths: { data: /srv/data }      # the disk
network: { bind: localhost }
media_server: jellyfin

apps:
  sonarr: {}                    # TV
  qbittorrent: { vpn: false }
`;
const KEY = '0'.repeat(32);
const PASSWORD = 'fake-admin-password';
const AT = new Date('2026-10-20T08:00:00.000Z');
const RECORD = {
  id: null,
  name: 'login',
  fields: { user: 'admin' },
  secrets: ['password'],
  appliedAt: '2026-10-10T12:00:00.000Z',
};

function home(stack = STACK): Promise<string> {
  return wiredHome({
    prefix: 'mediaplane-keep-',
    stack,
    key: KEY,
    password: PASSWORD,
    known: { 'sonarr.login': RECORD },
  });
}

const runtimeFor = wiredRuntime;

type Fake = Awaited<ReturnType<typeof fakeSonarr>>;

function options(
  dir: string,
  fake: Fake,
  path: string,
  extra: { catalog?: Catalog; runtime?: Runtime } = {},
) {
  return {
    home: dir,
    catalog: extra.catalog ?? WIRED_CATALOG,
    host: FIXTURE_HOST,
    env: {},
    runtime: extra.runtime ?? runtimeFor(fake.addresses),
    probe: fakeProbe(),
    wiring: fake.seams,
    path,
    now: () => AT,
  };
}

const codes = (result: { diagnostics: { code: string }[] }) =>
  result.diagnostics.map((d) => d.code);

describe('keep', () => {
  it('writes what the app holds as an override, keeping the rest of stack.yaml, and records it as applied', async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const kept = await keep(options(dir, sonarr, 'sonarr.login.user'));
    expect(kept).toEqual({
      ok: true,
      key: 'sonarr.login.user',
      value: 'someone',
      diagnostics: [],
    });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(
      `${STACK}overrides:\n  sonarr.login.user: someone\n`,
    );
    expect((await readResources(dir))['sonarr.login']?.fields).toEqual({
      user: 'someone',
    });
    // It signed in to nothing: keep checks no secret.
    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
    // Nothing for apply to do, and nothing changed outside Mediaplane.
    // As drift asks the apps (plan would check them after the start: their hashes differ).
    const after = await plan({ ...options(dir, sonarr, ''), drift: { now: () => AT } });
    expect(after.wiring).toEqual([{ resource: 'sonarr.login', action: 'unchanged' }]);
    expect(after.drift).toEqual([]);
    await expect(readFile(join(dir, LOCK_PATH))).rejects.toThrow();
  });

  it('asks the app nothing but to read the resource: what only the app can say is what was applied', async () => {
    const dir = await home();
    const asked: string[] = [];
    // A login whose profile only the app can say, through its own test (as Seerr's).
    const profiled: ResourceSpec = {
      ...FAKE_LOGIN,
      fields: ['user', 'profile'],
      resolve: (_api, desired) => {
        asked.push('resolve');
        return Promise.resolve({
          ...desired,
          fields: { ...desired.fields, profile: 'HD' },
        });
      },
      observe: () =>
        Promise.resolve({
          id: null,
          name: 'login',
          fields: { user: 'someone', profile: 'Any' },
        }),
    };
    await writeResources(dir, {
      'sonarr.login': { ...RECORD, fields: { user: 'admin', profile: 'HD' } },
    });
    const catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [profiled] } }
        : def,
    );
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const kept = await keep(options(dir, sonarr, 'sonarr.login.profile', { catalog }));
    expect([kept.ok, kept.value]).toEqual([true, 'Any']);
    expect(asked).toEqual([]);
  });

  it('stops managing a resource deleted outside Mediaplane, and forgets its record', async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY });
    const kept = await keep(options(dir, sonarr, 'sonarr.login'));
    expect(kept).toMatchObject({ ok: true, value: 'unmanaged' });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(
      `${STACK}overrides:\n  sonarr.login: unmanaged\n`,
    );
    expect(await readResources(dir)).toEqual({});
    // As drift asks the apps (plan would check them after the start: their hashes differ).
    const after = await plan({ ...options(dir, sonarr, ''), drift: { now: () => AT } });
    expect(after.wiring).toEqual([{ resource: 'sonarr', action: 'unchanged' }]);
    // Kept already: refused, saying so.
    expect(codes(await keep(options(dir, sonarr, 'sonarr.login')))).toEqual([
      'keep.unmanaged',
    ]);
  });

  it('stops managing a resource left in the app that the stack no longer wants', async () => {
    const gone: ResourceSpec = { ...FAKE_LOGIN, name: 'gone', desired: () => undefined };
    const catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [FAKE_LOGIN, gone] } }
        : def,
    );
    const dir = await home();
    await writeResources(dir, {
      'sonarr.login': RECORD,
      'sonarr.gone': { ...RECORD, name: 'gone' },
    });
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const kept = await keep(options(dir, sonarr, 'sonarr.gone', { catalog }));
    expect(kept).toMatchObject({ ok: true, value: 'unmanaged', diagnostics: [] });
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(
      `${STACK}overrides:\n  sonarr.gone: unmanaged\n`,
    );
    expect(Object.keys(await readResources(dir))).toEqual(['sonarr.login']);
    const after = await plan({
      ...options(dir, sonarr, '', { catalog }),
      drift: { now: () => AT },
    });
    expect([after.ok, after.drift, after.diagnostics]).toEqual([true, [], []]);
  });

  it("keeps nothing that hasn't drifted, or that it couldn't look at, and says so", async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
    const same = await keep(options(dir, sonarr, 'sonarr.login.user'));
    expect(same).toMatchObject({
      ok: false,
      diagnostics: [
        {
          code: 'keep.no-drift',
          message:
            'sonarr.login.user has not changed outside Mediaplane: sonarr holds what Mediaplane applied, or the stack now wants what it holds',
        },
      ],
    });
    expect(codes(await keep(options(dir, sonarr, 'sonarr.login')))).toEqual([
      'keep.no-drift',
    ]);
    const stopped = await keep(
      options(dir, sonarr, 'sonarr.login.user', {
        runtime: fakeRuntime({ hashes: { ok: true, hashes: {} } }),
      }),
    );
    expect(stopped.diagnostics[0]?.message).toMatch(/Mediaplane couldn't look at it: /);
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(STACK);
  });

  it('refuses a secret, a field it does not manage, and a value that holds a secret', async () => {
    const dir = await home();
    const holds = await fakeSonarr({
      key: KEY,
      user: `x${PASSWORD}`,
      password: PASSWORD,
    });
    expect(codes(await keep(options(dir, holds, 'sonarr.login.password')))).toEqual([
      'overrides.secret',
    ]);
    expect(codes(await keep(options(dir, holds, 'sonarr.login.usr')))).toEqual([
      'overrides.unmanaged-field',
    ]);
    const secret = await keep(options(dir, holds, 'sonarr.login.user'));
    expect(codes(secret)).toEqual(['keep.secret']);
    expect(JSON.stringify(secret)).not.toContain(PASSWORD);
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toBe(STACK);
  });

  it("refuses a value it can't read", async () => {
    const odd: ResourceSpec = {
      ...FAKE_LOGIN,
      observe: () =>
        Promise.resolve({
          id: null,
          name: 'login',
          fields: {},
          unreadable: { user: 'a list, not text' },
        }),
    };
    const catalog = WIRED_CATALOG.map((def) =>
      def.id === 'sonarr'
        ? { ...def, integration: { after: [], resources: [odd] } }
        : def,
    );
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY });
    const result = await keep(options(dir, sonarr, 'sonarr.login.user', { catalog }));
    expect(result.diagnostics[0]).toMatchObject({
      code: 'keep.unreadable',
      message:
        "sonarr.login.user holds what Mediaplane can't read (a list, not text), so it can't keep it",
    });
  });

  it("gives the line to add instead when it won't write stack.yaml", async () => {
    const line =
      'add this line under overrides: in stack.yaml yourself: sonarr.login.user: someone';
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    // Owned by automation.
    const external = await home(`${STACK}managed_by: external\n`);
    const result = await keep(options(external, sonarr, 'sonarr.login.user'));
    expect(result.diagnostics[0]).toMatchObject({
      code: 'keep.external',
      hint: `${line}, where it is kept, such as your playbook`,
    });
    // A link to the file, which a rewrite would replace.
    const linked = await home();
    await rename(join(linked, 'stack.yaml'), join(linked, 'real.yaml'));
    await symlink(join(linked, 'real.yaml'), join(linked, 'stack.yaml'));
    expect(
      (await keep(options(linked, sonarr, 'sonarr.login.user'))).diagnostics[0],
    ).toMatchObject({
      code: 'keep.stack-file',
      message: expect.stringMatching(
        /^Mediaplane won't write stack.yaml: it is a link/,
      ) as string,
      hint: line,
    });
    // A file it can't add the line to without changing more of it.
    const flow = await home(
      '{ version: 1, paths: { data: /srv/data }, network: { bind: localhost }, media_server: jellyfin, apps: { sonarr: {}, qbittorrent: { vpn: false } } }\n',
    );
    expect(
      (await keep(options(flow, sonarr, 'sonarr.login.user'))).diagnostics[0],
    ).toMatchObject({
      code: 'keep.stack-file',
      message:
        "Mediaplane won't write stack.yaml: its top level is not a YAML block of keys, one per line",
      hint: line,
    });
  });

  it('waits for no other command, and makes no state/ where there is no stack.yaml', async () => {
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const dir = await home();
    await writeFile(
      join(dir, LOCK_PATH),
      JSON.stringify({
        pid: process.pid,
        host: 'here',
        startedAt: AT.toISOString(),
        command: 'drift',
      }),
    );
    const locked = await keep(options(dir, sonarr, 'sonarr.login.user'));
    expect(locked.diagnostics[0]).toMatchObject({
      code: 'keep.locked',
      message: expect.stringContaining('mediaplane drift is running') as string,
    });
    const empty = await tempDir('mediaplane-keep-');
    expect(codes(await keep(options(empty, sonarr, 'sonarr.login.user')))).toEqual([
      'config.missing',
    ]);
    expect(await readdir(empty)).toEqual([]);
  });

  it('keeps stack.yaml as written when its record cannot be updated, and says the next apply records it', async () => {
    const dir = await home();
    const sonarr = await fakeSonarr({ key: KEY, user: 'someone', password: PASSWORD });
    const runtime = runtimeFor(sonarr.addresses);
    const spoiling: Runtime = {
      ...runtime,
      wiringAddresses: async (ids) => {
        await writeFile(join(dir, RESOURCES_PATH), '{');
        return runtime.wiringAddresses(ids);
      },
    };
    const result = await keep(
      options(dir, sonarr, 'sonarr.login.user', { runtime: spoiling }),
    );
    expect(result).toMatchObject({ ok: true, value: 'someone' });
    expect(codes(result)).toEqual(['keep.record']);
    expect(await readFile(join(dir, 'stack.yaml'), 'utf8')).toContain(
      'sonarr.login.user: someone',
    );
  });
});
```

**Change** `packages/engine/src/util/atomic.test.ts`:

```diff
diff --git a/packages/engine/src/util/atomic.test.ts b/packages/engine/src/util/atomic.test.ts
index 26504ea..2aa1322 100644
--- a/packages/engine/src/util/atomic.test.ts
+++ b/packages/engine/src/util/atomic.test.ts
@@ -17,2 +17,14 @@ describe('writeFileAtomic', () => {
 
+  it('gives the new file the group it is given', async () => {
+    const dir = await tempDir('mediaplane-atomic-');
+    const path = join(dir, 'stack.yaml');
+    await writeFile(path, 'old\n');
+    // One of this user's other groups, where there is one, else its own.
+    const own = process.getgid?.() ?? 0;
+    const group = (process.getgroups?.() ?? []).find((g) => g !== own) ?? own;
+    await writeFileAtomic(path, 'new\n', 0o640, group);
+    expect((await stat(path)).gid).toBe(group);
+    expect(await modeOf(path)).toBe(0o640);
+  });
+
   it('replaces an existing file and leaves no temporary file behind', async () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/cli/src/output.test.ts packages/cli/src/run.test.ts packages/engine/src/config/overrides-file.test.ts packages/engine/src/keep.test.ts packages/engine/src/util/atomic.test.ts`
Expected: FAIL. `keep.test.ts` and `overrides-file.test.ts` don't load (`Cannot find module './keep'`, `'./overrides-file'`), and 8 tests fail, 100 pass: 4 in `run.test.ts` (no `mediaplane keep` hint after drift; `unknown command 'keep'`), 3 in `output.test.ts` (no `mediaplane keep` hint) and 1 in `atomic.test.ts` (the new file doesn't get the group it is given).

- [ ] **Step 3: Write the writer, `keep`, and its one-resource look**

**Change** `packages/cli/src/output.ts`:

```diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index e326965..f411aa1 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -12,2 +12,3 @@ import {
   type DriftResult,
+  type KeepResult,
   type PlanResult,
@@ -26,2 +27,7 @@ export const HISTORY_JSON_SCHEMA = 'mediaplane.history/v1';
 export const DRIFT_JSON_SCHEMA = 'mediaplane.drift/v1';
+export const KEEP_JSON_SCHEMA = 'mediaplane.keep/v1';
+
+/** What keep takes, where drift shows a change: the field's address, or the resource's. */
+const KEEP_HINT =
+  'mediaplane keep <app>.<resource>.<field> keeps what the app holds instead, and <app>.<resource> stops Mediaplane managing one deleted';
 
@@ -91,3 +97,5 @@ export function driftAdvice(drift: readonly Drift[]): string[] {
     ...(has('field', 'missing', 'secret')
-      ? ['apply puts back each field, resource and secret changed in the apps']
+      ? [
+          `apply puts back each field, resource and secret changed in the apps; ${KEEP_HINT}`,
+        ]
       : []),
@@ -100,3 +108,3 @@ export function driftAdvice(drift: readonly Drift[]): string[] {
       ? [
-          "apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it",
+          "apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it, or keep it as yours with mediaplane keep <app>.<resource>, which stops the report",
         ]
@@ -277,2 +285,22 @@ export function printDrift(
 
+/** What `mediaplane keep` kept, or why it kept nothing. */
+export function printKeep(result: KeepResult, options: { json: boolean }, io: Io): void {
+  if (options.json) {
+    io.stdout(
+      `${JSON.stringify({ schema: KEEP_JSON_SCHEMA, ...result, value: result.value ?? null }, null, 2)}\n`,
+    );
+    return;
+  }
+  for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
+  if (!result.ok || result.value === undefined) {
+    io.stderr('\nNothing was kept; stack.yaml is as it was.\n');
+    return;
+  }
+  io.stdout(
+    result.value === 'unmanaged' && result.key.split('.').length === 2
+      ? `Wrote ${result.key}: unmanaged under overrides: in stack.yaml. Mediaplane no longer manages it, and apply doesn't make it again.\n`
+      : `Wrote ${result.key}: ${JSON.stringify(result.value)} under overrides: in stack.yaml. apply now leaves it as the app holds it, and drift no longer reports it.\n`,
+  );
+}
+
 function count(n: number, noun: string, verb: string): string | undefined {
```

**Change** `packages/cli/src/run.ts`:

```diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index a6cc32d..3ff76c3 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -11,2 +11,3 @@ import {
   drift,
+  keep,
   EGRESS_TIMEOUT_MS,
@@ -45,2 +46,3 @@ import {
   printError,
+  printKeep,
   printHistory,
@@ -113,2 +115,6 @@ export const EXIT_CODES: Readonly<Record<string, readonly string[]>> = {
   ],
+  keep: [
+    '0: stack.yaml keeps what the app holds, or stops managing what was deleted',
+    "1: nothing was kept: it hasn't drifted, can't be kept, or an error",
+  ],
   history: ['0: the records were listed or shown', '1: an error, or no such record'],
@@ -358,2 +364,31 @@ export function createProgram(
 
+  program
+    .command('keep')
+    .description(
+      'Keep mine: take what an app holds now, changed outside Mediaplane, as what you want, written as an override in stack.yaml, keeping the rest of the file as it is; or, for a resource deleted outside Mediaplane, stop managing it',
+    )
+    .argument(
+      '<path>',
+      'what to keep, as drift shows it: <app>.<resource>.<field>, or <app>.<resource> for one deleted',
+    )
+    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
+    .option('--json', 'print machine-readable JSON')
+    .addHelpText('after', exitCodesHelp('keep'))
+    .action(async (path: string, options: { home: string; json?: boolean }) => {
+      const home = resolve(options.home);
+      const runtime = deps.runtime(home, project);
+      const result = await keep({
+        home,
+        catalog,
+        host: () => deps.host(runtime),
+        env: io.env,
+        runtime,
+        probe: deps.probe(runtime, home),
+        path,
+        ...(deps.wiring === undefined ? {} : { wiring: deps.wiring }),
+      });
+      printKeep(result, { json: options.json === true }, io);
+      setExitCode(result.ok ? 0 : 1);
+    });
+
   program
```

**Create** `packages/engine/src/config/overrides-file.ts`:

```ts
import { lstat } from 'node:fs/promises';
import {
  isMap,
  isScalar,
  parseAllDocuments,
  parseDocument,
  stringify,
  type Pair,
} from 'yaml';
import type { Scalar } from '../integrations/types';
import { parseConfig } from './load';

/**
 * The line an override takes under `overrides:`, as Keep mine writes it and as you can
 * add it yourself: `sonarr.download_client.category: television`.
 */
export function overrideLine(key: string, value: Scalar): string {
  const text = stringify(value, { lineWidth: 0 }).trimEnd();
  // A value YAML would write on several lines goes as one JSON string, valid YAML too.
  return `${key}: ${text.includes('\n') ? JSON.stringify(value) : text}`;
}

/** Where a key's value ends in the source: its value's end, or its key's when it has none. */
function valueEnd(pair: Pair): number {
  const { key, value } = pair;
  if ((isScalar(value) || isMap(value)) && value.range) return value.range[1];
  return isScalar(key) ? (key.range?.[1] ?? 0) : 0;
}

/**
 * `source`, a stack.yaml, with the override `key: value` set under `overrides:`, and
 * nothing else of it changed: its comments, key order, quoting, spacing and line ends
 * stay as they are (spec §3.3, §6.3). The line goes after the last override, in their
 * indentation; one that sets `key` already has its value replaced; `overrides:` is added
 * at the end when the file has none. The result is checked: it must parse to the same
 * stack with that override, or why not is said and nothing is changed.
 */
export function withOverride(
  source: string,
  key: string,
  value: Scalar,
): { ok: true; text: string } | { ok: false; reason: string } {
  const refuse = (reason: string) => ({ ok: false as const, reason });
  const before = parseConfig(source);
  if (!before.ok) return refuse('it is not a valid stack.yaml');
  if (parseAllDocuments(source).length !== 1) {
    return refuse('it holds more than one YAML document');
  }
  const doc = parseDocument(source);
  const root = doc.contents;
  if (!isMap(root) || root.flow === true) {
    return refuse('its top level is not a YAML block of keys, one per line');
  }
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const line = overrideLine(key, value);
  const valueText = line.slice(key.length + 2);
  /** Where the line that holds `offset` ends, before its line end. */
  const lineEnd = (offset: number) => {
    const at = source.indexOf('\n', offset);
    if (at < 0) return source.length;
    return source[at - 1] === '\r' ? at - 1 : at;
  };
  const insert = (at: number, text: string) =>
    `${source.slice(0, at)}${text}${source.slice(at)}`;
  const pair = root.items.find((p) => isScalar(p.key) && p.key.value === 'overrides');
  let text: string;
  if (pair === undefined) {
    const ended = source === '' || source.endsWith('\n') ? source : `${source}${eol}`;
    text = `${ended}overrides:${eol}  ${line}${eol}`;
  } else if (isMap(pair.value)) {
    const map = pair.value;
    const held = map.items.find((p) => isScalar(p.key) && p.key.value === key);
    if (held !== undefined) {
      // Kept before: its value is replaced, where it is.
      if (!isScalar(held.value)) {
        return refuse(`its ${key} under overrides: is not a single value`);
      }
      const [start, end] = held.value.range;
      text = `${source.slice(0, start)}${valueText}${source.slice(end)}`;
    } else if (map.flow === true) {
      // `overrides: { … }`: after the last one, or in place of `{}`.
      const last = map.items.at(-1);
      if (last === undefined) {
        const [start, end] = map.range;
        text = `${source.slice(0, start)}{ ${line} }${source.slice(source.lastIndexOf('}', end) + 1)}`;
      } else {
        text = insert(valueEnd(last), `, ${line}`);
      }
    } else {
      // A line of its own, after the last override's, as they are indented.
      const [first] = map.items;
      const last = map.items.at(-1);
      if (first === undefined || last === undefined || !isScalar(first.key)) {
        return refuse('its overrides: is not a list of keys');
      }
      const [firstStart] = first.key.range;
      const indent = firstStart - (source.lastIndexOf('\n', firstStart - 1) + 1);
      // From the value's last character: a block value ends after its line end.
      text = insert(lineEnd(valueEnd(last) - 1), `${eol}${' '.repeat(indent)}${line}`);
    }
  } else {
    return refuse('its overrides: is not a list of keys');
  }
  // The stack it gives must be the same, with the override.
  const after = parseConfig(text);
  const wanted = {
    ...before.config,
    overrides: { ...before.config.overrides, [key]: value },
  };
  if (!after.ok || JSON.stringify(after.config) !== JSON.stringify(wanted)) {
    return refuse("Mediaplane can't add the line there without changing more than it");
  }
  return { ok: true, text };
}

/** The groups this user is in: its own, and the others. */
function userGroups(): number[] {
  const own = process.getgid?.();
  return [...(own === undefined ? [] : [own]), ...(process.getgroups?.() ?? [])];
}

/**
 * Why `path`, a stack.yaml, can't be written safely, or undefined when it can: a link
 * (Mediaplane would replace the link, not the file it leads to), not a regular file,
 * a file with other names (hard links, which a rewrite would part from it), one that
 * belongs to another user (a rewrite would take it over), or one of a group this user
 * isn't in (the rewrite couldn't keep it). Its mode and group are kept; an ACL isn't.
 */
export async function stackFileProblem(
  path: string,
  uid: number | undefined = process.getuid?.(),
  groups: readonly number[] = userGroups(),
): Promise<string | undefined> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    return 'it is a link, which Mediaplane would replace with a file, rather than change the file it leads to';
  }
  if (!stats.isFile()) return 'it is not a regular file';
  if (stats.nlink > 1) {
    return 'it has other names (hard links), which a rewrite would part from it';
  }
  if (uid !== undefined && stats.uid !== uid) {
    return `it belongs to uid ${String(stats.uid)}, and Mediaplane runs as uid ${String(uid)}: a rewrite would make it Mediaplane's`;
  }
  if (groups.length > 0 && !groups.includes(stats.gid)) {
    return `it belongs to group ${String(stats.gid)}, which Mediaplane's user isn't in: a rewrite would give it Mediaplane's group`;
  }
  return undefined;
}
```

**Change** `packages/engine/src/config/schema.ts`:

```diff
diff --git a/packages/engine/src/config/schema.ts b/packages/engine/src/config/schema.ts
index b1bb9f1..7a5f6f5 100644
--- a/packages/engine/src/config/schema.ts
+++ b/packages/engine/src/config/schema.ts
@@ -279,3 +279,3 @@ const stackShape = {
     .describe(
-      "Your own values for what Mediaplane manages in the apps, by <app>.<resource>.<field>, such as sonarr.download_client.category: television: apply sets them instead of its own. Each app's README lists the fields; one marked fixed, and a secret, can't be overridden. <app>.<resource>: unmanaged stops Mediaplane managing that resource.",
+      'Your own values for what Mediaplane manages in the apps, by <app>.<resource>.<field>, such as sonarr.download_client.category: television: apply sets them instead of its own. "mediaplane keep" writes them, from what an app holds. Each app\'s README lists the fields; one marked fixed, and a secret, can\'t be overridden. <app>.<resource>: unmanaged stops Mediaplane managing that resource.',
     ),
@@ -285,3 +285,3 @@ const stackShape = {
     .describe(
-      'external: Mediaplane never writes this file, for when automation such as Ansible owns it. Today only init writes it, and init never overwrites. Matters from Slice 8.',
+      'external: Mediaplane never writes this file, for when automation such as Ansible owns it. init never overwrites it, and keep, which writes overrides, gives you the line to add instead.',
     ),
```

**Change** `packages/engine/src/drift.ts`:

```diff
diff --git a/packages/engine/src/drift.ts b/packages/engine/src/drift.ts
index 829b724..2f58bf9 100644
--- a/packages/engine/src/drift.ts
+++ b/packages/engine/src/drift.ts
@@ -22,3 +22,6 @@ export interface DriftResult {
   ok: boolean;
-  /** Nothing changed outside Mediaplane, as far as it could see, and it saw everything. */
+  /**
+   * Nothing changed outside Mediaplane, and it saw everything: every resource looked at,
+   * and every secret checked.
+   */
   clear: boolean;
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index 38045e7..75091a4 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -53,2 +53,4 @@ export * from './status';
 export * from './drift';
+export * from './keep';
+export * from './config/overrides-file';
 export * from './credentials';
```

**Change** `packages/engine/src/integrations/wiring.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index 0d5d05d..049fe02 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -373,2 +373,8 @@ export interface ExamineOptions {
   drift?: { now: () => Date };
+  /**
+   * false: check none of its secrets, and ask the app nothing but to read the resource
+   * (`mediaplane keep`, which needs only its fields): what only the app can say
+   * (`resolve`, which may use the app's own test, as Seerr's does) is what was applied.
+   */
+  secrets?: boolean;
 }
@@ -395,5 +401,13 @@ export async function examine(
   const address = resourceAddress(ctx.app, spec);
-  // What only the app can say, then the overrides again: Keep mine's value wins.
-  const desired =
-    options.verify !== false && spec.resolve !== undefined
+  // What only the app can say, then the overrides again: Keep mine's value wins. Keep
+  // takes it from what was applied instead, and so asks the app nothing more.
+  const keeping = options.secrets === false && spec.resolve !== undefined;
+  const desired = keeping
+    ? withOverrides(
+        spec,
+        address,
+        { ...wanted, fields: { ...known?.fields, ...wanted.fields } },
+        ctx.stack.config.overrides,
+      )
+    : options.verify !== false && spec.resolve !== undefined
       ? withOverrides(
@@ -429,3 +443,3 @@ export async function examine(
   // Every other field is, set or not.
-  const unresolved = spec.resolve !== undefined && options.verify === false;
+  const unresolved = spec.resolve !== undefined && options.verify === false && !keeping;
   const compared = unresolved
@@ -550,2 +564,3 @@ async function checkSecrets(
     }));
+  if (options.secrets === false) return all('unchecked', 'keep checks no secret');
   const planned = (options.refused ?? []).filter((name) => spec.secrets.includes(name));
@@ -580,3 +595,6 @@ async function checkSecrets(
   if (options.verify === false) {
-    return all('unchecked', 'what it requires is yet to be put in place');
+    return all(
+      'unchecked',
+      'what it requires is yet to be put in place, which apply does first',
+    );
   }
@@ -699,2 +717,7 @@ export interface PlanWiringOptions {
   drift?: { now: () => Date };
+  /**
+   * `mediaplane keep`'s: look at this one resource ("<app>.<resource>") and its app only,
+   * checking none of its secrets.
+   */
+  only?: string;
   seams?: WiringSeams;
@@ -770,3 +793,5 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
   };
+  const { only } = options;
   for (const app of order) {
+    if (only !== undefined && !only.startsWith(`${app.def.id}.`)) continue;
     const ctx: WiringContext = {
@@ -778,3 +803,6 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
     // Only what the stack wants is listed: a resource it doesn't want isn't wiring.
-    const targets = wiringTargets(ctx);
+    const targets =
+      only === undefined
+        ? wiringTargets(ctx)
+        : wiringTargets(ctx).filter((target) => target === only);
     // A resource that holds the key of an app that refuses it: drift on the consumer
@@ -816,3 +844,5 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
     checked.set(app.def.id, client.api);
-    const wanted = wantedResources(ctx);
+    const wanted = wantedResources(ctx).filter(
+      (spec) => only === undefined || resourceAddress(app, spec) === only,
+    );
     if (wanted.length === 0) add({ resource: app.def.id, action: 'unchanged' });
@@ -843,2 +873,3 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
           ...(options.drift === undefined ? {} : { drift: options.drift }),
+          ...(only === undefined ? {} : { secrets: false }),
         });
@@ -901,9 +932,15 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
     }
-    const left = await leftIn(ctx, client.api, options.known, [
-      ...options.secrets,
-      ...found.values,
-    ]);
-    drift.push(...left.drift);
-    diagnostics.push(...left.diagnostics);
-    for (const change of left.unknown) add(change);
+    // Keep looks for its one resource among those left, when the stack doesn't want it.
+    if (only === undefined || wanted.length === 0) {
+      const left = await leftIn(
+        ctx,
+        client.api,
+        options.known,
+        [...options.secrets, ...found.values],
+        only,
+      );
+      drift.push(...left.drift);
+      diagnostics.push(...left.diagnostics);
+      for (const change of left.unknown) add(change);
+    }
   }
@@ -958,2 +995,3 @@ async function leftIn(
   secrets: readonly string[],
+  only?: string,
 ): Promise<{ drift: Drift[]; diagnostics: Diagnostic[]; unknown: WiringChange[] }> {
@@ -964,2 +1002,3 @@ async function leftIn(
     const address = resourceAddress(ctx.app, spec);
+    if (only !== undefined && address !== only) continue;
     const record = known[address];
```

**Create** `packages/engine/src/keep.ts`:

```ts
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { overrideLine, stackFileProblem, withOverride } from './config/overrides-file';
import { error, warning, type Diagnostic } from './diagnostics';
import { isUnmanaged, overrideTarget, UNMANAGED } from './integrations/overrides';
import { readResources, writeResources } from './integrations/resources';
import type { Scalar } from './integrations/types';
import { DRIFT_RUNBOOK } from './integrations/wiring';
import { STACK_PATH } from './paths';
import { planStack, type PlanOptions } from './plan/plan';
import { acquireLock, LockedError, type Lock } from './state/lock';
import { writeFileAtomic } from './util/atomic';
import { readIfExists } from './util/fs';

export interface KeepOptions extends PlanOptions {
  /** What to keep: `<app>.<resource>.<field>`, or `<app>.<resource>` for one deleted. */
  path: string;
  now?: () => Date;
}

/** What `mediaplane keep` did (spec §6.3, Keep mine): never a secret's value. */
export interface KeepResult {
  ok: boolean;
  /** The override key it wrote under `overrides:`. */
  key: string;
  /** Its value: the app's, or `unmanaged` for a resource deleted outside Mediaplane. */
  value: Scalar | undefined;
  diagnostics: Diagnostic[];
}

/**
 * Keep mine (spec §6.3): take the app's own value of a managed field changed outside
 * Mediaplane as the stack's, written as an override in stack.yaml, or stop managing a
 * resource deleted outside it (`<app>.<resource>: unmanaged`). Only what drift finds
 * there is kept: a managed field that drifted, or a resource that is missing. It looks
 * at that resource alone: it checks that its app takes Mediaplane's key, reads the
 * resource, and checks none of its secrets, so every request it makes goes to the app's
 * own address on the stack; what only the app can say (Seerr's profile) is what was
 * applied. It writes stack.yaml by adding one line, keeping the rest as it is, its mode
 * and its group (not an ACL), and never a secret, and then records the value as applied
 * in state/resources.json, so that drift is clear and apply has nothing to do for it. It
 * runs under apply's lock.
 */
export async function keep(options: KeepOptions): Promise<KeepResult> {
  const home = resolve(options.home);
  const now = options.now ?? (() => new Date());
  const key = options.path;
  const refused = (diagnostics: Diagnostic[]): KeepResult => ({
    ok: false,
    key,
    value: undefined,
    diagnostics,
  });
  const named = overrideTarget(options.catalog, key);
  if (!named.ok) return refused([named.diagnostic]);
  const { spec, def, field } = named.target;
  const address = `${def.id}.${spec.name}`;
  const stackPath = join(home, STACK_PATH);
  // Never create state/ in a folder that isn't a Mediaplane home; plan explains why.
  if ((await readIfExists(stackPath)) === undefined) {
    return refused((await planStack({ ...options, home })).result.diagnostics);
  }
  let lock: Lock;
  try {
    lock = await acquireLock(home, now, 'keep');
  } catch (cause) {
    if (!(cause instanceof LockedError)) throw cause;
    return refused([
      error('keep.locked', cause.message, {
        hint: 'wait for it to finish, then run keep again; if nothing is running, delete state/lock',
      }),
    ]);
  }
  try {
    const { result, context } = await planStack({
      ...options,
      home,
      drift: { now },
      only: address,
    });
    if (!result.ok || context === undefined) return refused(result.diagnostics);
    if (isUnmanaged(context.stack, address)) {
      return refused([
        error(
          'keep.unmanaged',
          `${address} is not Mediaplane's to keep: stack.yaml says it is ${UNMANAGED}`,
        ),
      ]);
    }
    // A resource deleted outside Mediaplane, or left in the app though the stack no
    // longer wants it: either way, it is yours from now on.
    const found = result.drift.find(
      (d) =>
        d.resource === address &&
        (field === undefined
          ? d.kind === 'missing' || d.kind === 'left'
          : d.kind === 'field' && d.field === field),
    );
    if (found === undefined) {
      const looked = result.wiring.find((w) => w.resource === address);
      const couldNot =
        looked?.action === 'unknown' || looked?.action === 'after-start'
          ? `Mediaplane couldn't look at it: ${looked.reason ?? "its app isn't running and healthy"}`
          : field === undefined
            ? `${def.name} holds it as the stack wants it, or it was never applied`
            : `${def.name} holds what Mediaplane applied, or the stack now wants what it holds`;
      return refused([
        error('keep.no-drift', `${key} has not changed outside Mediaplane: ${couldNot}`, {
          hint: `"mediaplane drift" shows what has, and what keep takes; see ${DRIFT_RUNBOOK}`,
        }),
      ]);
    }
    if (found.unreadable !== undefined) {
      return refused([
        error(
          'keep.unreadable',
          `${key} holds what Mediaplane can't read (${found.unreadable}), so it can't keep it`,
          { hint: `set it in ${def.name} to what you want, or run apply to put it back` },
        ),
      ]);
    }
    if (found.redacted === true) {
      return refused([
        error(
          'keep.secret',
          `${key} holds one of the stack's secrets, which stack.yaml must never hold`,
          {
            hint: `set it in ${def.name} to something else, or run apply to put it back`,
          },
        ),
      ]);
    }
    const value: Scalar = field === undefined ? UNMANAGED : (found.actual ?? '');
    const line = overrideLine(key, value);
    const byHand = `add this line under overrides: in stack.yaml yourself: ${line}`;
    if (context.stack.config.managed_by === 'external') {
      return refused([
        error(
          'keep.external',
          `stack.yaml is managed outside Mediaplane (managed_by: external), so Mediaplane doesn't write it`,
          { hint: `${byHand}, where it is kept, such as your playbook` },
        ),
      ]);
    }
    const problem = await stackFileProblem(stackPath);
    const source = await readFile(stackPath, 'utf8');
    const written = problem === undefined ? withOverride(source, key, value) : undefined;
    if (written === undefined || !written.ok) {
      return refused([
        error(
          'keep.stack-file',
          `Mediaplane won't write stack.yaml: ${problem ?? (written?.ok === false ? written.reason : '')}`,
          { hint: byHand },
        ),
      ]);
    }
    // Its mode and group as they were (stackFileProblem refused a group it couldn't keep).
    const held = await stat(stackPath);
    await writeFileAtomic(stackPath, written.text, held.mode & 0o777, held.gid);
    const diagnostics = [...result.diagnostics];
    try {
      // As applied now: drift is clear, and apply finds the resource as it should be.
      const known = await readResources(home);
      const record = known[address];
      if (field === undefined) {
        Reflect.deleteProperty(known, address);
      } else if (record !== undefined) {
        known[address] = { ...record, fields: { ...record.fields, [field]: value } };
      }
      await writeResources(home, known);
    } catch (cause) {
      diagnostics.push(
        warning(
          'keep.record',
          `stack.yaml keeps ${key}, but state/resources.json could not be updated: ${cause instanceof Error ? cause.message : String(cause)}`,
          { hint: 'the next apply records it, changing nothing in the app' },
        ),
      );
    }
    return { ok: true, key, value, diagnostics };
  } finally {
    await lock.release();
  }
}
```

**Change** `packages/engine/src/plan/plan.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index a829978..6a2841a 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -73,2 +73,7 @@ export interface PlanOptions {
   drift?: { now: () => Date };
+  /**
+   * `mediaplane keep`'s: look at this one resource ("<app>.<resource>"), and check none of
+   * its secrets.
+   */
+  only?: string;
 }
@@ -293,2 +298,3 @@ export async function planStack(
         ...(options.drift === undefined ? {} : { drift: options.drift }),
+        ...(options.only === undefined ? {} : { only: options.only }),
         ...(options.wiring === undefined ? {} : { seams: options.wiring }),
```

**Change** `packages/engine/src/util/atomic.ts`:

```diff
diff --git a/packages/engine/src/util/atomic.ts b/packages/engine/src/util/atomic.ts
index 49a1bff..bcdfeb1 100644
--- a/packages/engine/src/util/atomic.ts
+++ b/packages/engine/src/util/atomic.ts
@@ -1,3 +1,3 @@
 import { randomBytes } from 'node:crypto';
-import { chmod, link, mkdir, open, rename, rm } from 'node:fs/promises';
+import { chmod, chown, link, mkdir, open, rename, rm } from 'node:fs/promises';
 import { dirname } from 'node:path';
@@ -8,3 +8,4 @@ import { codeOf } from './error-code';
  * to disk, then rename it over the original. Readers see the old file or the new one,
- * never half of either.
+ * never half of either. With `group`, the new file has that group (the old file's, say),
+ * or nothing is replaced. An ACL or extended attribute of the old file isn't kept.
  */
@@ -14,2 +15,3 @@ export async function writeFileAtomic(
   mode = 0o644,
+  group?: number,
 ): Promise<void> {
@@ -27,2 +29,4 @@ export async function writeFileAtomic(
     await chmod(temp, mode);
+    // -1 leaves the owner as it is: the user running Mediaplane.
+    if (group !== undefined) await chown(temp, -1, group);
     await rename(temp, path);
```

- [ ] **Step 4: Run them to see them pass, and regenerate the references**

```bash
pnpm vitest run packages/cli/src/output.test.ts packages/cli/src/run.test.ts packages/engine/src/config/overrides-file.test.ts packages/engine/src/keep.test.ts packages/engine/src/util/atomic.test.ts
pnpm docs:generate
```

Expected: PASS. `docs:generate` rewrites `docs/reference/cli.md` (`mediaplane keep`), and
`docs/reference/stack-yaml.md` and `docs/reference/stack.schema.json` (the `overrides` and
`managed_by` descriptions).

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages catalog docs/reference
git commit -m "feat: mediaplane keep writes what an app holds as an override in stack.yaml, changing nothing else in the file" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 2080 tests pass in 93 files.

---

### Task 6: End-to-end: success criterion 4 on the real apps, and from the image

Decision: the end-to-end test of success criterion 4, a kept category made by `apply`
among it (decision 23).
Decision: no new socket-proxy permission: `drift` and `keep` run from the image through the
proxy as it is (decision 24).

**Files:**
- Modify: `test/e2e/helpers.ts`
- Test: `test/e2e/deploy.e2e.test.ts`, `test/e2e/drift.e2e.test.ts`

**Interfaces:**
- **Consumes:** Tasks 1 to 5: `apply`, `drift`, `keep`, `readSecretStore`; the e2e
  helpers (`makeHome`, `composeDown`, `expectWiringRemoved`, `getJson`, `api`,
  `servarrFailure`, `runTeardown`).
- **Produces:** in `test/e2e/helpers.ts`:
  `setServarrSetting(port, path, key, setting: { name; value }, secrets): Promise<void>`,
  `qbittorrentForm(port, path, key, fields): Promise<void>`: the apps changed by hand, as
  their web UIs do, saying nothing of a secret when they fail.

- [ ] **Step 1: Write the end-to-end tests**

**Change** `test/e2e/deploy.e2e.test.ts`:

```diff
diff --git a/test/e2e/deploy.e2e.test.ts b/test/e2e/deploy.e2e.test.ts
index 6f5c0b5..432ba6d 100644
--- a/test/e2e/deploy.e2e.test.ts
+++ b/test/e2e/deploy.e2e.test.ts
@@ -21,2 +21,3 @@ import {
   parseRevealed,
+  qbittorrentForm,
   removeAsRoot,
@@ -24,2 +25,3 @@ import {
   REPO,
+  setServarrSetting,
   TEARDOWN_MS,
@@ -376,2 +378,46 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
 
+    // Slice 8, from the image: drift finds nothing changed; a category changed in Sonarr
+    // by hand, it reports it; keep writes it in stack.yaml there, as Mediaplane's user,
+    // keeping the file's mode; and drift is clear again.
+    const clear = await mediaplane('drift', '--json');
+    expect(clear.code, clear.stdout + clear.stderr).toBe(0);
+    // Sonarr's download client changed by hand: it files under "television", a category
+    // made in qBittorrent first, with the save path Mediaplane gives one of that name.
+    await qbittorrentForm(
+      8080,
+      '/api/v2/torrents/createCategory',
+      store.apps.qbittorrent?.apiKey ?? '',
+      {
+        category: 'television',
+        savePath: '/data/torrents/television',
+      },
+    );
+    await setServarrSetting(
+      8989,
+      '/api/v3/downloadclient',
+      store.apps.sonarr?.apiKey ?? '',
+      { name: 'tvCategory', value: 'television' },
+      Object.values(store.apps).flatMap((held) => Object.values(held)),
+    );
+    const drifted = await mediaplane('drift', '--json');
+    expect(drifted.code, drifted.stderr).toBe(2);
+    expect((JSON.parse(drifted.stdout) as { drift: unknown }).drift).toEqual([
+      {
+        resource: 'sonarr.download_client',
+        kind: 'field',
+        field: 'category',
+        expected: 'tv',
+        actual: 'television',
+      },
+    ]);
+    const mode = (await stat(join(home, 'stack.yaml'))).mode & 0o777;
+    const kept = await mediaplane('keep', 'sonarr.download_client.category', '--json');
+    expect(kept.code, kept.stdout + kept.stderr).toBe(0);
+    expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe(
+      `${smallStack(data)}overrides:\n  sonarr.download_client.category: television\n`,
+    );
+    expect((await stat(join(home, 'stack.yaml'))).mode & 0o777).toBe(mode);
+    const cleared = await mediaplane('drift', '--json');
+    expect(cleared.code, cleared.stdout + cleared.stderr).toBe(0);
+
     // Slice 3b, through the proxy: Mediaplane joined the stack's wiring network to set
```

**Create** `test/e2e/drift.e2e.test.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  drift,
  keep,
  nodeProbe,
  readSecretStore,
  type ApplyOptions,
  type DriftResult,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  api,
  composeDown,
  expectWiringRemoved,
  getJson,
  makeHome,
  qbittorrentForm,
  runTeardown,
  setServarrSetting,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-drift`;
const SONARR = 8989;
const RADARR = 7878;
const QBITTORRENT = 8080;
const JELLYFIN = 8096;
/** A key that isn't Jellyfin's: what a hand-made change leaves in Radarr's connection. */
const WRONG_KEY = '9'.repeat(32);

/** A Servarr provider as its API gives it: its settings, a key among them, masked. */
interface Provider {
  id: number;
  fields: { name: string; value?: unknown }[];
}

/** The stack, written by hand: its comments and spacing are what keep must keep. */
function stackOf(data: string): string {
  return `# The stack of the drift test.
version: 1
user: { uid: ${String(process.getuid?.() ?? 1000)}, gid: ${String(process.getgid?.() ?? 1000)} }
paths: { data: ${data} }      # the data folder
network: { bind: localhost }
media_server: jellyfin

apps:
  sonarr: {}                    # TV
  radarr: {}
  qbittorrent: { vpn: false }
`;
}

/**
 * What drift found, as the test compares it: each change by its address, kind and, for a
 * field, what was applied and what the app holds. A secret is named, never shown.
 */
function found(result: DriftResult): string[] {
  return result.drift.map((d) =>
    d.kind === 'field'
      ? `${d.resource}.${d.field ?? ''}: ${JSON.stringify(d.expected)} → ${JSON.stringify(d.actual)}`
      : `${d.resource}${d.secret === undefined ? '' : `.${d.secret}`}: ${d.kind}${d.since === undefined ? '' : ' (since)'}`,
  );
}

/** That none of `secrets` is in `text`: a yes/no check, which never prints either. */
function expectNoSecret(what: string, text: string, secrets: readonly string[]): void {
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(text.includes(secret), `${what} holds a secret`).toBe(false);
  }
}

describe('drift, Re-apply and Keep mine (success criterion 4)', () => {
  it('reports a managed field changed in an app with what was applied and what it holds; apply puts it back; keep keeps it', async () => {
    const home = await makeHome();
    const data = join(home, 'data');
    const stack = stackOf(data);
    await writeFile(join(home, 'stack.yaml'), stack);
    const removeAll = () =>
      runTeardown([
        async () => {
          const down = await composeDown(PROJECT);
          expect(down.code, down.stderr).toBe(0);
        },
        () => expectWiringRemoved(PROJECT),
      ]);
    try {
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
      const unconfirmed: ApplyOptions = {
        ...options,
        confirm: () => Promise.reject(new Error('nothing should need confirming')),
      };
      const driftNow = () => drift(options);
      const keepNow = (path: string) => keep({ ...options, path });

      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      const clear = await driftNow();
      expect(found(clear)).toEqual([]);
      expect([clear.ok, clear.clear], 'drift is clear after apply').toEqual([true, true]);

      const store = await readSecretStore(home);
      const keyOf = (app: string) => store.apps[app]?.apiKey ?? '';
      const secrets = [
        ...Object.values(store.apps).flatMap((held) => Object.values(held)),
        store.shared?.adminPassword ?? '',
        WRONG_KEY,
      ];
      const sonarrKey = { 'X-Api-Key': keyOf('sonarr') };
      const bearer = { Authorization: `Bearer ${keyOf('qbittorrent')}` };
      const jellyfinKey = {
        Authorization: `MediaBrowser Client="Mediaplane e2e", Device="e2e", DeviceId="mediaplane-e2e", Version="1", Token="${keyOf('jellyfin')}"`,
      };
      const television = { name: 'tvCategory', value: 'television' };
      const qbtForm = (path: string, fields: Record<string, string>) =>
        qbittorrentForm(QBITTORRENT, path, keyOf('qbittorrent'), fields);
      const categoryOf = async () => {
        const [held] = await getJson<Provider[]>(
          SONARR,
          '/api/v3/downloadclient',
          sonarrKey,
        );
        return held?.fields.find((f) => f.name === 'tvCategory')?.value;
      };
      const qbt = async () => ({
        savePath: (
          await getJson<{ save_path: string }>(
            QBITTORRENT,
            '/api/v2/app/preferences',
            bearer,
          )
        ).save_path,
        categories: Object.keys(
          await getJson<Record<string, unknown>>(
            QBITTORRENT,
            '/api/v2/torrents/categories',
            bearer,
          ),
        ).sort(),
      });
      const moviesFolders = async () =>
        (
          await getJson<{ Name: string; Locations: string[] }[]>(
            JELLYFIN,
            '/Library/VirtualFolders',
            jellyfinKey,
          )
        )
          .find((l) => l.Name === 'Movies')
          ?.Locations.sort();
      const addMoviesFolder = async () => {
        await mkdir(join(data, 'media', 'extra'), { recursive: true });
        const added = await api(
          JELLYFIN,
          '/Library/VirtualFolders/Paths?refreshLibrary=false',
          jellyfinKey,
          {
            method: 'POST',
            body: JSON.stringify({ Name: 'Movies', Path: '/data/media/extra' }),
            type: 'application/json',
          },
        );
        expect(added.status, 'a folder added to Movies by hand').toBe(204);
      };

      // Changed by hand in each app, through its API, as its web UI would.
      const downloadClients = '/api/v3/downloadclient';
      await setServarrSetting(
        SONARR,
        downloadClients,
        keyOf('sonarr'),
        television,
        secrets,
      );
      await setServarrSetting(
        RADARR,
        '/api/v3/notification',
        keyOf('radarr'),
        { name: 'apiKey', value: WRONG_KEY },
        secrets,
      );
      await qbtForm('/api/v2/app/setPreferences', {
        json: JSON.stringify({ save_path: '/data/torrents/other' }),
      });
      await qbtForm('/api/v2/torrents/removeCategories', { categories: 'movies' });
      await addMoviesFolder();

      // drift reports each, with what was applied and what the app holds; a secret by
      // its name and the app's own check only.
      const changed = await driftNow();
      expect(found(changed)).toEqual([
        'jellyfin.library_movies.paths: "/data/media/movies" → "/data/media/extra,/data/media/movies"',
        'qbittorrent.preferences.savePath: "/data/torrents" → "/data/torrents/other"',
        'qbittorrent.category_movies: missing',
        'radarr.connection_jellyfin.apiKey: secret',
        'sonarr.download_client.category: "tv" → "television"',
      ]);
      expect([changed.ok, changed.clear]).toEqual([true, false]);
      expectNoSecret('what drift found', JSON.stringify(changed), secrets);
      // A secret it found refused isn't checked again until apply sets it.
      const again = await driftNow();
      expect(found(again)).toContain('radarr.connection_jellyfin.apiKey: secret (since)');
      // plan shows the same drift, as what apply would put back.
      const restored = await apply(options);
      expect(restored.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(restored.outcome).toBe('success');
      expect(restored.plan.drift.map((d) => `${d.resource} ${d.kind}`)).toEqual([
        'jellyfin.library_movies field',
        'qbittorrent.preferences field',
        'qbittorrent.category_movies missing',
        'radarr.connection_jellyfin secret',
        'sonarr.download_client field',
      ]);
      expectNoSecret("the restoring apply's result", JSON.stringify(restored), secrets);
      // Re-apply put each back.
      expect(await categoryOf()).toBe('tv');
      expect(await qbt()).toEqual({
        savePath: '/data/torrents',
        categories: ['movies', 'tv'],
      });
      expect(await moviesFolders()).toEqual(['/data/media/movies']);
      const afterApply = await driftNow();
      expect(found(afterApply)).toEqual([]);
      expect(afterApply.clear).toBe(true);

      // Changed by hand again, and kept: the category, which qBittorrent doesn't have,
      // the folder added to Movies, and Sonarr's root folder deleted, which Mediaplane
      // then no longer manages.
      await setServarrSetting(
        SONARR,
        downloadClients,
        keyOf('sonarr'),
        television,
        secrets,
      );
      await addMoviesFolder();
      const [root] = await getJson<{ id: number }[]>(
        SONARR,
        '/api/v3/rootfolder',
        sonarrKey,
      );
      if (root === undefined) throw new Error('no root folder in Sonarr');
      const gone = await api(SONARR, `/api/v3/rootfolder/${String(root.id)}`, sonarrKey, {
        method: 'DELETE',
      });
      expect(gone.status).toBe(200);
      expect(found(await driftNow())).toEqual([
        'jellyfin.library_movies.paths: "/data/media/movies" → "/data/media/extra,/data/media/movies"',
        'sonarr.download_client.category: "tv" → "television"',
        'sonarr.root_folder: missing',
      ]);
      // What can't be kept is refused, and stack.yaml stays as it was.
      for (const [path, code] of [
        ['sonarr.download_client.apiKey', 'overrides.secret'],
        ['sonarr.download_client.priority', 'overrides.unmanaged-field'],
        ['jellyfin.library_movies.name', 'overrides.locked'],
        // Where Sonarr sends qBittorrent's key.
        ['sonarr.download_client.host', 'overrides.locked'],
        ['radarr.download_client.category', 'keep.no-drift'],
      ] as const) {
        const refused = await keepNow(path);
        expect([path, refused.ok, refused.diagnostics.map((d) => d.code)]).toEqual([
          path,
          false,
          [code],
        ]);
      }
      expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe(stack);
      for (const path of [
        'sonarr.download_client.category',
        'jellyfin.library_movies.paths',
        'sonarr.root_folder',
      ]) {
        const kept = await keepNow(path);
        expect([
          path,
          kept.ok,
          kept.diagnostics.filter((d) => d.severity === 'error'),
        ]).toEqual([path, true, []]);
      }
      // Written under overrides:, the rest of the file as it was, its comments too.
      expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe(
        `${stack}overrides:\n  sonarr.download_client.category: television\n  jellyfin.library_movies.paths: /data/media/extra,/data/media/movies\n  sonarr.root_folder: unmanaged\n`,
      );
      // Nothing changed outside Mediaplane now; but qBittorrent is to have the kept
      // category, which apply makes, and Sonarr's own test of its client would make it
      // with no save path: drift leaves the client's key unchecked until then.
      const kept = await driftNow();
      expect(found(kept)).toEqual([]);
      expect(kept.clear, 'drift waits for the kept category').toBe(false);
      expect(
        kept.checks
          .filter((c) => c.verdict === 'unchecked')
          .map((c) => `${c.resource}.${c.secret}: ${c.reason ?? ''}`),
      ).toEqual([
        'sonarr.download_client.apiKey: what it requires is yet to be put in place, which apply does first',
      ]);
      expect((await qbt()).categories).toEqual(['movies', 'tv']);
      // apply makes it, and changes nothing else; then drift is clear, and apply has
      // nothing more to do: what was kept stays as the apps hold it.
      const made = await apply(options);
      expect(
        made.plan.wiring
          .filter((w) => w.action !== 'unchanged')
          .map((w) => `${w.resource} ${w.action} ${(w.changes ?? []).join(',')}`),
        'apply after keep',
      ).toEqual(['qbittorrent.category_tv create ']);
      expect(made.outcome).toBe('success');
      expect((await qbt()).categories).toEqual(['movies', 'television', 'tv']);
      const cleared = await driftNow();
      expect(found(cleared)).toEqual([]);
      expect(cleared.clear, 'drift is clear once apply made it').toBe(true);
      const settled = await apply(unconfirmed);
      expect(
        settled.plan.wiring
          .filter((w) => w.action !== 'unchanged')
          .map((w) => `${w.resource} ${w.action} ${(w.changes ?? []).join(',')}`),
        'apply again',
      ).toEqual([]);
      expect(settled.outcome).toBe('no-changes');
      expect(await categoryOf()).toBe('television');
      expect(await moviesFolders()).toEqual(['/data/media/extra', '/data/media/movies']);
      expect(await getJson<unknown[]>(SONARR, '/api/v3/rootfolder', sonarrKey)).toEqual(
        [],
      );
      const records = await readFile(join(home, 'state', 'resources.json'), 'utf8');
      expectNoSecret('resources.json', records, secrets);
      expectNoSecret(
        'stack.yaml',
        await readFile(join(home, 'stack.yaml'), 'utf8'),
        secrets,
      );
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

- [ ] **Step 2: Run them to see them fail**

With nothing else running on Docker:

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/drift.e2e.test.ts test/e2e/deploy.e2e.test.ts`
Expected: FAIL. 2 tests fail, 5 pass: the drift test, once its stack is applied and drift is clear, with `TypeError: setServarrSetting is not a function`; and the deploy test's apply test, at its drift part, with `TypeError: qbittorrentForm is not a function`. Their teardowns leave nothing behind.

- [ ] **Step 3: Write the helpers**

**Change** `test/e2e/helpers.ts`:

```diff
diff --git a/test/e2e/helpers.ts b/test/e2e/helpers.ts
index d48a460..6ee2839 100644
--- a/test/e2e/helpers.ts
+++ b/test/e2e/helpers.ts
@@ -275,2 +275,57 @@ export async function servarrFailure(
 
+/**
+ * Change one setting of the first provider at `path` of a Servarr app by hand, with its
+ * key, as its web UI does: the provider sent back whole, with forceSave, so the arr saves
+ * it untested. A failure gives the status and the arr's own messages, with every one of
+ * `secrets` replaced (servarrFailure).
+ */
+export async function setServarrSetting(
+  port: number,
+  path: string,
+  key: string,
+  setting: { name: string; value: unknown },
+  secrets: readonly string[],
+): Promise<void> {
+  const keyed = { 'X-Api-Key': key };
+  const [held] = await getJson<
+    { id: number; fields: { name: string; value?: unknown }[] }[]
+  >(port, path, keyed);
+  if (held === undefined) throw new Error(`nothing at ${path} on port ${String(port)}`);
+  const saved = await api(port, `${path}/${String(held.id)}?forceSave=true`, keyed, {
+    method: 'PUT',
+    body: JSON.stringify({
+      ...held,
+      fields: held.fields.map((f) =>
+        f.name === setting.name ? { ...f, value: setting.value } : f,
+      ),
+    }),
+    type: 'application/json',
+  });
+  expect(saved.status, await servarrFailure(saved, secrets)).toBe(202);
+}
+
+/**
+ * POST a form to qBittorrent's API by hand, with its key, as its web UI does: a category
+ * made or removed, its preferences set. A failure gives the status only: qBittorrent's
+ * answer to a refused form is plain text that could repeat what it was sent.
+ */
+export async function qbittorrentForm(
+  port: number,
+  path: string,
+  key: string,
+  fields: Record<string, string>,
+): Promise<void> {
+  const sent = await api(
+    port,
+    path,
+    { Authorization: `Bearer ${key}` },
+    {
+      method: 'POST',
+      body: new URLSearchParams(fields).toString(),
+      type: 'application/x-www-form-urlencoded',
+    },
+  );
+  expect(sent.status, `POST ${path} on port ${String(port)}`).toBe(200);
+}
+
 /** What `apply --json` says, and `apply` returns: its outcome, and each action. */
```

- [ ] **Step 4: Run them to see them pass, and nothing left behind**

With nothing else running on Docker:

```bash
pnpm vitest run --config vitest.e2e.config.ts test/e2e/drift.e2e.test.ts test/e2e/deploy.e2e.test.ts
docker ps -a --filter name=mediaplane-e2e- --format '{{.Names}}'
docker network ls --filter name=mediaplane-e2e- --format '{{.Name}}'
```

Expected: PASS (7 tests, about three minutes warm). The last two print nothing.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add test/e2e
git commit -m "test(e2e): drift, Re-apply and Keep mine against the real apps, and from the image (success criterion 4)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 2080 tests pass in 93 files (the e2e files aren't among them).

---

### Task 7: Docs

The §9 set for what Tasks 1 to 6 built (decision 25). Each block below is a hand-written
doc; the generated parts were regenerated in Tasks 2 to 5.

- [ ] **Step 1: See the docs still promise Slice 8**

Run: `grep -rnE 'Slice 8 (does|adds|automates|decides|restores)|comes in Slice 8|\(Slice 8( adds|\))|\*\*Slice 8:\*\*|S8 \(drift detection\)' README.md catalog/*/README.md deploy/README.md docs/architecture.md docs/security docs/runbooks docs/design`
Expected: 25 lines, in the README, the app READMEs, the architecture, the threat model, the wiring failed runbook and the spec (ruling M1), such as `README.md:553:- **Next:** S8 (drift detection).` and `docs/design/m1-engine-cli.md:1011:  counts as seeded, because there is no way to tell. Slice 8 automates the fix, with`.

- [ ] **Step 2: The runbooks**

**Create** `docs/runbooks/drift-reported.md`:

````markdown
# Runbook: drift reported

Drift is a change made in an app, outside Mediaplane, to something Mediaplane manages
there: a download client's category changed in Sonarr's web UI, a folder added to a
Jellyfin library, a qBittorrent category deleted, a key changed in Radarr's connection.
Mediaplane reports it, and never puts it back by itself: you choose whether `apply` puts
it back, or `mediaplane keep` keeps it as yours.

What Mediaplane manages in each app is listed in that app's README, under "Managed in
the app". Everything else in the apps is yours, and is never drift.

## Symptoms

- **`mediaplane drift` exits 2,** with each change on its own line (from a run with
  Sonarr, Radarr, qBittorrent and Jellyfin, trimmed):

  ```console
  $ mediaplane drift
  Changed outside Mediaplane since it was applied:
    - qbittorrent.category_movies: deleted outside Mediaplane
    ! radarr.connection_jellyfin.apiKey: refused by the app's own check
    ~ sonarr.download_client.category: expected "tv", actual "television"
  Secrets, checked with each app's own check: 11 passed, 1 refused, 2 not checked.
    - radarr.download_client.apiKey: what it requires is yet to be put in place, which apply does first
    - sonarr.download_client.apiKey: a managed field differs: apply sets the secrets with it
  Drift found.
    apply puts back each field, resource and secret changed in the apps; mediaplane keep <app>.<resource>.<field> keeps what the app holds instead, and <app>.<resource> stops Mediaplane managing one deleted.
  ```

  The last lines say what puts each kind right: `apply` for a field, a resource or a
  secret; for a key changed at its source, or what is left in an app, they say what does
  instead, and never that `apply` puts it back.

- **`mediaplane plan` shows the same lines,** under
  `Drift, changed outside Mediaplane since it was applied:`, before the wiring that would
  put each back.
- **`mediaplane drift` exits 2 with no drift,** saying it could not look at everything,
  or check every secret: an app wasn't running and healthy, or didn't answer; a resource
  Mediaplane made that the stack no longer wants, whose app couldn't say whether it still
  holds it (`drift.left-unknown`); or a secret went unchecked. Those are listed under
  `Not checked:`, and under the secrets, each with why. A warning from an app's own
  health check (`drift.health`) doesn't change the exit code.
- **`passed (1 as last checked)`** in the secrets line, with a line starting `=`: drift
  took that verdict from its last check, at the time it names, rather than check again
  now. Jellyfin's admin password is checked once a day at most, while it passes: a
  password changed in Jellyfin since shows up within a day, and at once in `plan`.

Each line says what kind of drift it is:

- `~` **a field changed:** the value `apply` sets (`expected`), what Mediaplane last
  applied when that is another (`Mediaplane applied …; stack.yaml has changed it since`),
  and what the app holds now (`actual`). `actual one Mediaplane can't read` means the app
  holds the field in a shape Mediaplane doesn't understand, such as a number where it
  expects text.
- `-` **deleted outside Mediaplane:** the app no longer holds the resource.
- `!` **a secret refused by the app's own check:** a key or password that no longer
  works. Mediaplane never compares or shows a secret: it uses it, with the app's own test
  or sign-in. `found by drift at …; not checked again until apply sets it` says drift
  found it earlier, and doesn't check it again, so that the check leaves no more marks
  in the app.
- `!` **refuses the key Mediaplane holds for it:** the app's own key was changed in the
  app, such as qBittorrent's made anew in its web UI. Each resource that holds that key,
  in another app, is listed too, as `holds qbittorrent's key, which qbittorrent refuses`.
- `?` **still in the app, though the stack no longer wants it:** Mediaplane made it, such
  as Prowlarr's link to Sonarr, and Sonarr has since left the stack. `apply` leaves it:
  remove it in the app, or keep it as yours with `mediaplane keep <app>.<resource>`.
  Removing it for you comes in Slice 10.

## Checks

1. **Run `mediaplane drift --json`** for the same, with each change's fields, and how
   each secret was checked (`checks`): `passed`, `refused`, or `unchecked` with why.
2. **Look at the app's own web UI** for the change. A field's line names the setting:
   `sonarr.download_client.category` is the category of Sonarr's download client
   `qBittorrent (Mediaplane)`. The app's README lists each.
3. **For a secret refused,** think whether you changed it in `stack.yaml` or in
   `secrets/`, such as `admin.password`. Drift can't tell that from a change made in the
   app: the app refuses the secret the stack has either way. `apply` sets it in both
   cases.
4. **For `refuses the key Mediaplane holds for it`,** check the app's own settings for its
   API key: it was made anew, or set by hand.

## Fix

Choose, for each change, which side wins.

- **Put it back: run `mediaplane apply`.** It shows the plan first, with the drift, and
  asks. It makes each resource what the stack wants again, makes a deleted one again,
  and sets each refused secret. A root folder whose folder was deleted gets its folder
  again.
- **Keep what the app holds: `mediaplane keep <app>.<resource>.<field>`,** as the drift
  line names it:

  ```console
  $ mediaplane keep sonarr.download_client.category
  Wrote sonarr.download_client.category: "television" under overrides: in stack.yaml. apply now leaves it as the app holds it, and drift no longer reports it.
  ```

  It adds one line under `overrides:` in `stack.yaml`, and changes nothing else in the
  file, its comments neither, and keeps its mode and its group (not an ACL or extended
  attributes, which a rewrite drops). `apply` then sets that value, as it would any other
  setting of the stack, so the change stays, and drift is clear. To undo it, take the
  line out of `overrides:`, and run `apply`.

  What `keep` asks: it checks that the app takes Mediaplane's key, and reads that one
  resource. It checks none of its secrets and runs no test of the app's, so each request
  it makes goes to the app's own address on the stack; a value only the app can say,
  such as Seerr's quality profile, is the one last applied. Keeping a download client's
  category makes qBittorrent's category follow it: `apply` makes it.

- **Stop managing a resource deleted outside Mediaplane, or left in an app:**
  `mediaplane keep <app>.<resource>` writes `<app>.<resource>: unmanaged`. Mediaplane
  doesn't make it again, look at it, or report it. A library of Seerr's that is no longer
  managed in Jellyfin or Plex is no longer enabled by Mediaplane in Seerr either.
- **A key changed at its source** (`refuses the key Mediaplane holds for it`): put the
  stored key back in the app, as the
  [wiring failed runbook](wiring-failed.md#fix) shows for each app, then run `apply`.
  Mediaplane doesn't do it for you yet (Slice 10).
- **A download client's key not checked, because qBittorrent lacks a category it
  names.** Sonarr's or Radarr's own test of its download client makes each such
  category in qBittorrent, with no save path, so `plan` and drift don't run it:
  - a category you kept (`keep sonarr.download_client.category`) is qBittorrent's to
    have: `plan` shows `qbittorrent.category_tv`, and `apply` makes it, with its save
    path, then checks the key. The reason says `what it requires is yet to be put in
place, which apply does first`;
  - its post-import category, which Mediaplane doesn't manage, or a category you stopped
    Mediaplane managing (`qbittorrent.category_tv: unmanaged`) and deleted: make it in
    qBittorrent, or name one in the arr that qBittorrent has, then run drift again. The
    reason names the category and the setting;
  - qBittorrent didn't answer: run drift again once it does.

`keep` refuses, saying why, and changes nothing:

- **a secret** (`sonarr.download_client.apiKey`): Mediaplane never keeps one. `apply`
  sets it;
- **a field it doesn't manage**, with the closest name it does: the other settings are
  yours already;
- **a fixed field**, which the app's README marks `(fixed)`: a root folder's path, a
  library's name or what it holds, whether an arr reaches its root folder, Seerr's setup,
  and every field that says where an app sends a key (a host, a port, TLS, a URL), as
  the stack's keys go only to its own addresses. Changing one changes what the resource
  is, or where a key goes. `apply` puts such a field back. To keep a library you renamed, for
  instance, stop Mediaplane managing it: `mediaplane keep jellyfin.library_movies` once
  drift says it was deleted, or add `jellyfin.library_movies: unmanaged` under
  `overrides:` yourself;
- **something that hasn't drifted**, or that drift couldn't look at: run
  `mediaplane drift` first;
- **a value Mediaplane can't read,** or one that holds one of the stack's secrets: set
  it in the app to what you want, then keep it, or run `apply`;
- **a `stack.yaml` it won't write:** a link, a file with other names (hard links), one
  that belongs to another user, or to a group Mediaplane's user isn't in, one written as
  a single `{ … }` block, or one managed by automation (`managed_by: external`). The
  error gives the line to add under `overrides:` yourself.

Two warnings come from drift itself:

- **`drift.health`:** an app's own health check says something is wrong with a resource
  of Mediaplane's. Prowlarr's checks its indexer proxy every six hours: `All indexer
proxies are unavailable due to failures` means the Cloudflare solver (Byparr or
  FlareSolverr) is down or can't reach the internet. `apply` can't put that right. Check
  the solver with `mediaplane status`; Prowlarr's next health check clears it. A health
  check Mediaplane can't read is a warning too. Neither changes drift's exit code.
- **`drift.locked`:** another `apply`, `drift` or `keep` is running. Wait for it, then run
  drift again. If nothing is running, delete `state/lock`.

## Prevention

- **Change what Mediaplane manages in `stack.yaml`,** not in the apps: an override
  under `overrides:` is the same as Keep mine, written by hand. Each app's README lists
  the fields.
- **Run `mediaplane drift` before `apply`** after working in the apps' web UIs, to see
  what `apply` would put back.
- **Keep a secret right in one place.** After changing `admin.password`, or a key in
  `secrets/`, run `apply` soon: until then, the apps refuse the new one, and drift and
  `plan` report it.
- **Drift's checks leave few marks.** A check of a secret uses it, and some apps record
  each that fails: a failure in an arr's status of its download client, a line in Seerr's
  log. Drift checks a secret it found refused no more, until `apply` sets it, and
  Jellyfin's admin password once a day at most, so running it often costs little.
  Running it on a schedule comes in M2.
````

**Change** `docs/runbooks/wiring-failed.md`:

```diff
diff --git a/docs/runbooks/wiring-failed.md b/docs/runbooks/wiring-failed.md
index 0c6adec..66f8e3b 100644
--- a/docs/runbooks/wiring-failed.md
+++ b/docs/runbooks/wiring-failed.md
@@ -292,3 +292,5 @@ differ, and a `reason` when it is `unknown`.
     restarts: `docker restart mediaplane-seerr-1` puts the stored one back.
-  - Slice 8 restores a key at its source for you, and makes Jellyfin's anew.
+  - `mediaplane drift` reports a key changed at its source, on the app and on each
+    resource that holds it. Slice 10 restores a key at its source for you, and makes
+    Jellyfin's anew.
 - **`refused the request (HTTP 403)`, with
@@ -309,3 +311,5 @@ differ, and a `reason` when it is `unknown`.
   then run `apply` again: it sets the password if it hasn't yet, and its check then
-  passes.
+  passes. Once `mediaplane drift` has found the password refused, neither drift nor `plan`
+  signs in again until `apply` sets it, so running `mediaplane drift` first spares the
+  failures.
 - **`Host: Unable to connect to qBittorrent`.** Sonarr or Radarr can't reach qBittorrent.
```

- [ ] **Step 3: The architecture, the threat model and ADR 0003**

**Change** `docs/architecture.md`:

````diff
diff --git a/docs/architecture.md b/docs/architecture.md
index c948d18..1adde83 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -3,3 +3,3 @@
 This page is a condensed version of the [M1 design](design/m1-engine-cli.md), §3 to §6,
-covering what is built so far (Slices 1 to 7). The design describes the whole of M1;
+covering what is built so far (Slices 1 to 8). The design describes the whole of M1;
 this page describes what exists.
@@ -13,10 +13,13 @@ You describe the stack you want in one file, `stack.yaml`. Mediaplane then works
   it joins the stack's wiring network, to ask the apps: see [The wiring](#the-wiring)).
-  Checking a key or a password can leave small marks in an app: a post-import category
-  made in qBittorrent, a failure recorded in an app's status of a client, link or
-  connection, a sign-in in Jellyfin's activity log, a line in Seerr's log for each of
-  its checks that fails (and one in the arr's, for a key the arr refuses), and an arr
-  listed among Plex's devices, by the arr's first test of its connection to Plex. It
-  never runs an app's first-run setup, nor finishes Seerr's, and never calls plex.tv. The
-  [threat model](security/threat-model.md#what-runs-and-who-can-reach-it) says more;
-- `apply` makes those changes, then plans again to check that nothing is left.
+  Checking a key or a password can leave small marks in an app: a failure recorded in an
+  app's status of a client, link or connection, a sign-in in Jellyfin's activity log, a
+  line in Seerr's log for each of its checks that fails (and one in the arr's, for a key
+  the arr refuses), and an arr listed among Plex's devices, by the arr's first test of
+  its connection to Plex. It never runs an app's first-run setup, nor finishes Seerr's,
+  and never calls plex.tv. The
+  [threat model](security/threat-model.md#what-runs-and-who-can-reach-it) says more. It
+  also says what changed in the apps outside Mediaplane since it applied them: drift;
+- `apply` makes those changes, then plans again to check that nothing is left;
+- `drift` reports only what changed outside Mediaplane, and `keep` keeps a change of
+  yours (see [Drift and Keep mine](#drift-and-keep-mine)).
 
@@ -151,2 +154,6 @@ Each part, and where its code is:
   leave from (see [`vpn-check`](#vpn-check)).
+- **drift and keep** (`packages/engine/src/drift.ts`, `packages/engine/src/keep.ts`, the
+  overrides in `packages/engine/src/integrations/overrides.ts`, and the writer of
+  `stack.yaml` in `packages/engine/src/config/overrides-file.ts`): what changed in the
+  apps outside Mediaplane, and Keep mine (see [Drift and Keep mine](#drift-and-keep-mine)).
 - **CLI** (`packages/cli`): the commands, human and `--json` output, and exit codes
@@ -154,4 +161,2 @@ Each part, and where its code is:
 
-Not built yet: drift detection, with Keep mine (Slice 8).
-
 ## `plan`
@@ -186,3 +191,5 @@ ask the apps
   update, adopt, unchanged,
-  or after the start
+  or after the start; and
+  what changed outside
+  Mediaplane: drift
 ```
@@ -558,3 +565,4 @@ mediaplane (the stack)
     Mediaplane never runs that test, and `plan` never sends it; `plan` does compare the
-    proxy's host, timeout and tags on every run.
+    proxy's host, timeout and tags on every run. `drift` reads what Prowlarr's own health
+    check, which tests its proxies every six hours, last found.
   - The indexers are yours: you add them in Prowlarr, which syncs them to the arrs, and
@@ -710,2 +718,70 @@ mediaplane (the stack)
 
+## Drift and Keep mine
+
+```text
+stack.yaml, overrides: (D)
+  what the stack wants
+state/resources.json (L)
+  what was last applied
+the app's API (O)
+  what it holds now
+
+D ≠ L: you changed stack.yaml
+O ≠ L, O ≠ D: drift, changed
+  in the app, outside
+  Mediaplane
+```
+
+- **`mediaplane drift`** is `plan`, looking only (spec §6.3): no host checks, and every
+  app that runs and is healthy is asked, even one `apply` would change. It runs under
+  apply's lock. It reports, for each resource Mediaplane recorded:
+  - a managed field the app holds otherwise than it was applied, and than the stack wants
+    now, with both values; one the app holds in a shape Mediaplane can't read is said to
+    be, never read as empty (`unreadable`);
+  - a resource deleted outside Mediaplane;
+  - a secret the app's own check refuses, by name only: secrets are checked by using
+    them, never compared or shown;
+  - an app that refuses the key Mediaplane holds for it, and each resource of another app
+    that holds that key: a shared key changed at its source;
+  - a resource Mediaplane made that the stack no longer wants, still in the app; one
+    whose app can't say counts as not looked at.
+
+  `plan` shows the same drift. What puts each right is said by its kind: `apply` puts
+  back a field, a resource or a secret; a key changed at its source, and what is left in
+  an app, are put right by hand, or kept, until Slice 10. Its exit code is 0 when
+  nothing changed and every resource and secret was checked, and 2 otherwise.
+
+- **Its checks leave few marks** (the owner's decisions of 2026-10-17). A secret it finds
+  refused isn't checked again, by drift or `plan`, until `apply` sets it: qBittorrent bans
+  an address after five failed sign-ins, and the arrs and Seerr record each failed test.
+  Jellyfin's admin password is checked once a day at most while it passes (a resource's
+  `checkEvery`): each check is in Jellyfin's activity log. `plan` and drift leave an
+  arr's download client key unchecked while qBittorrent lacks a category the client
+  names, which the arr's own test would make. Drift keeps each check's verdict and time,
+  by the secret's name, in `state/resources.json`: its one write. It reads an app's own
+  health check where one tests a resource (Prowlarr's, of its indexer proxy), and warns
+  of what it found.
+- **Overrides** (`overrides:` in `stack.yaml`, spec §4.2) are part of what the stack
+  wants: `<app>.<resource>.<field>: <value>` sets a managed field, and
+  `<app>.<resource>: unmanaged` stops Mediaplane managing a resource. `plan` checks each:
+  a field that isn't managed, a secret, a fixed field or a value of another type fails
+  it, with the closest name. A few fields are fixed (a resource's `locked`): what it is
+  known by, what its app can't change, what Mediaplane only checks, and every field that
+  says where an app sends a key. Every request that carries a key is built from the
+  stack's own address for the other app (a resource's `sendsTo`), never from a field an
+  override could set or from what the app holds.
+- **`mediaplane keep <app>.<resource>.<field>`** takes what the app holds, where drift
+  found a change, as an override: it adds one line under `overrides:` in `stack.yaml`,
+  changing nothing else in the file (its mode and group kept, not an ACL), and records
+  the value as applied, so drift is clear and `apply` has nothing to do for it. It checks
+  that the app takes Mediaplane's key and reads the one resource, and checks no secret.
+  For a resource deleted, or left in the app, `mediaplane keep <app>.<resource>` writes
+  `unmanaged`. It never writes a secret, and refuses a `stack.yaml` it can't write
+  safely, giving the line to add instead
+  ([ADR 0003](adr/0003-drift-detect-and-warn-with-keep-mine.md)). Keeping a download
+  client's category gives qBittorrent's category that name: `apply` makes it.
+- **Not yet:** putting back a key at its source, or giving a new one to every app that
+  holds it, and removing what Mediaplane made when its app leaves the stack (Slice 10);
+  drift on a schedule (M2).
+
 ## `vpn-check`
@@ -767,3 +843,2 @@ The [roadmap](plans/m1-roadmap.md) has the order:
 
-- drift detection (Slice 8);
 - releases and safe updates (Slice 9);
````

**Change** `docs/security/threat-model.md`:

```diff
diff --git a/docs/security/threat-model.md b/docs/security/threat-model.md
index 39475b8..0aa392a 100644
--- a/docs/security/threat-model.md
+++ b/docs/security/threat-model.md
@@ -2,3 +2,3 @@
 
-This is the threat model for Mediaplane as built today: M1, up to and including Slice 7.
+This is the threat model for Mediaplane as built today: M1, up to and including Slice 8.
 It makes spec §7 concrete. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).
@@ -149,6 +149,8 @@ mounts ──► plex.tv
   out at once: Seerr's own key works after that.
-  `plan` checks a download client with the arr's own test, which also makes a missing
-  post-import category in qBittorrent, a setting Mediaplane doesn't manage: one you set
-  in the arr (`tvImportedCategory`, `movieImportedCategory`) and later deleted in
-  qBittorrent. It checks Prowlarr's links with Prowlarr's own test, which calls the arr
+  `plan` checks a download client with the arr's own test, which would make in
+  qBittorrent each category the client names that qBittorrent lacks: its own, or a
+  post-import one you set in the arr (`tvImportedCategory`, `movieImportedCategory`). So
+  `plan` asks qBittorrent first, and leaves the key unchecked while one is missing, or
+  qBittorrent can't be asked; a category you kept is made by `apply` first, and one you
+  no longer have Mediaplane manage is yours to make (see the drift reported runbook). It checks Prowlarr's links with Prowlarr's own test, which calls the arr
   with its key, and has the arr call Prowlarr back, and an arr's connection to Jellyfin
@@ -164,2 +166,16 @@ mounts ──► plex.tv
   arr's web UI does.
+- **Drift and Keep mine.** `mediaplane drift` asks the apps what `plan` asks them, and
+  changes nothing in them: its checks leave the marks above, fewer. A secret it found
+  refused isn't checked again, by drift or `plan`, until `apply` sets it, so a key or
+  password that changed costs one failed check, not one per run (qBittorrent bans an
+  address after five); Jellyfin's admin password is checked once a day at most, while it
+  passes. Drift keeps what it found of each secret in `state/resources.json`: its name,
+  `passed` or `refused`, and when. It reads Prowlarr's own health check of its indexer
+  proxy, and never tests the proxy. `mediaplane keep` checks that the app takes
+  Mediaplane's key and reads the one resource it keeps, checking none of its secrets and
+  running no test of the app's, and writes `stack.yaml`: one line under `overrides:`,
+  the rest as it was, its mode and group kept (not an ACL), never a secret. It refuses a
+  `stack.yaml` that is a link, has other names, belongs to another user or to a group
+  its user isn't in, or is managed by automation. Both run under apply's lock
+  (`state/lock`), so none of the three runs while another does.
 - **The Cloudflare solver.** Byparr, or FlareSolverr, runs a browser for Prowlarr on the
@@ -333,4 +349,4 @@ What remains:
 - A link stays in Prowlarr when its arr leaves the stack, and keeps that arr's key,
-  until it is removed by hand (in Prowlarr's web UI) or, if Slice 8 does that, by drift
-  detection.
+  until it is removed by hand (in Prowlarr's web UI). `mediaplane drift` reports it, as
+  still in the app though the stack no longer wants it; removing it for you is Slice 10.
 - The apps' calls to each other, and Mediaplane's to them, are plain HTTP on Docker's own
@@ -433,2 +449,7 @@ Controls today:
   errors, and kept out of change records, `state/resources.json` and `plan`'s output.
+- `drift` and `plan` show a managed field's values, what was applied and what the app
+  holds, never a secret's: a value an app holds that contains one of the run's secrets is
+  shown with `***`, and marked so. `mediaplane keep` refuses to keep such a value, or a
+  secret, so `stack.yaml` never holds one (ADR 0009). What drift keeps of a secret in
+  `state/resources.json` is its name, a verdict and a time.
 - Gluetun's control key reaches vpn-check's probe on its standard input, and the probe
@@ -884,2 +905,49 @@ What remains:
 
+### T17. A change made in an app by someone else is kept
+
+Anyone with an app's admin login, or its key, can change what Mediaplane manages there:
+point Sonarr's download client at another host, add a folder to a Jellyfin library, or
+turn a library off in Seerr.
+
+Controls today:
+
+- `mediaplane drift` reports each change to a managed field, with what was applied and
+  what the app holds, a resource deleted, and a secret the app refuses. `plan` shows the
+  same, and `apply`, which asks first, puts each back.
+- A change is never kept by itself: only `mediaplane keep`, run by you, makes it the
+  stack's, one field at a time.
+- Every field that says where an app sends a key is fixed, and can't be kept or
+  overridden: the host, port and TLS of an arr's download client and of its connections
+  to Jellyfin and Plex, the URLs of Prowlarr's links to the arrs (and its indexer
+  proxy's, which your indexers' requests go through), and the host and port of Seerr's
+  media server and of its Sonarr and Radarr servers. Drift still reports a change to
+  one, and `apply` puts the stack's own address back.
+- Every request that carries a key, Mediaplane's own and each test it has an app run
+  with a key the app holds (an arr's test of its download client or connection,
+  Prowlarr's of a link, Seerr's of a server), is built from the stack's own service
+  address for the other app (`sendsTo`), never from a managed field an override could
+  set, nor from what the app holds: a host, port, TLS or URL base changed in the app
+  doesn't move where the key goes. Seerr's list of Jellyfin's users, which Seerr asks
+  with the key it holds at the address it holds, is asked only while Seerr holds the
+  stack's. Each catalog resource has a test of it. A key goes only to the stack's own
+  address for an app (T5).
+- While a managed field differs, `plan` checks none of the resource's secrets.
+- What a resource is known by can't be kept: a root folder's path, a library's name and
+  what it holds.
+- `mediaplane keep` checks that the app takes Mediaplane's key and reads one resource;
+  it checks no secret and runs no test of the app's, so it sends no key but Mediaplane's
+  own, to the app's own address.
+
+What remains:
+
+- Keep only what you changed yourself. A kept value is what the app holds from then on:
+  a category, a folder, a tag, a library left to you.
+- An app's admin can still point the app itself somewhere else between two `apply`s:
+  the app then uses the key it holds there, as it would without Mediaplane. Drift reports
+  it, and only `apply` puts it back.
+- Drift sees only what Mediaplane manages. A change to anything else in an app, its
+  indexers, profiles or users, is yours, and never reported.
+- Drift runs only when you run it, or `plan` or `apply` does. Running it on a schedule
+  comes in M2.
+
 ## What the proxy does not stop
```

**Create** `docs/adr/0003-drift-detect-and-warn-with-keep-mine.md`:

```markdown
# 0003. Drift: detect and warn, with Keep mine

- **Status:** Accepted
- **Date:** 2026-10-25

## Context

Mediaplane makes resources in the apps through their APIs: download clients, root
folders, Prowlarr's links, libraries, Seerr's servers, and the shared admin login. You
can change any of them in the app's own web UI afterwards. Before Slice 8, `plan`
compared only what the stack wants with what the app holds, so a change made by hand
showed as an update, and the next `apply` undid it, without saying that someone had
changed it, and without a way to keep the change.

Three things can differ, and each means something else:

- **What the stack wants** (D): `stack.yaml`, with its `overrides:`;
- **what Mediaplane last applied** (L): its record in `state/resources.json`;
- **what the app holds** (O): read through its API.

D against L is a change you made in `stack.yaml`. O against L is a change made in the
app, outside Mediaplane: drift. A secret can't be compared: the apps show their keys
masked, and Mediaplane keeps no hash of one. Checking a secret means using it, with the
app's own test, and some of those tests leave a mark in the app: a failure in its status
of a client, a line in its log, a sign-in in Jellyfin's activity log. qBittorrent bans an
address after five failed sign-ins in a row.

## Decision

- **`mediaplane drift` reports, and never writes to an app.** It is `plan` in
  observe-only mode, under apply's lock: what changed outside Mediaplane since the last
  apply, with what was applied and what the app holds for each managed field; a resource
  deleted; a secret the app's own check refuses; an app that refuses its own key, and
  the resources that hold that key; and a resource Mediaplane made that the stack no
  longer wants. A field the app holds in a shape Mediaplane can't read is said to be,
  never read as empty. `plan` shows the same drift, as what `apply` would put back.
- **Re-apply is `apply`.** It makes each resource what the stack wants again.
- **Keep mine is `mediaplane keep <app>.<resource>.<field>`.** It writes the app's value
  under `overrides:` in `stack.yaml`, so the stack wants what the app holds, and records
  it as applied: drift is clear, and `apply` has nothing to do. For a resource deleted
  outside Mediaplane, or left in the app though the stack no longer wants it,
  `mediaplane keep <app>.<resource>` writes `<app>.<resource>: unmanaged`, and
  Mediaplane stops managing it.
- **Keep mine writes one line.** It adds the line under `overrides:`, or replaces a value
  it wrote before, and changes nothing else in the file: comments, key order, quoting,
  spacing and line ends stay. The new file must parse to the same stack with that
  override, or nothing is written. It keeps the file's mode and group, not an ACL. It
  refuses a `stack.yaml` that is a link, has other names, belongs to another user or to
  a group its user isn't in, or is managed by automation (`managed_by: external`), and
  gives the line to add by hand instead.
- **Only managed fields can be kept.** Each resource declares them; a few are fixed: what
  the resource is known by (a root folder's path, a library's name), what its app can't
  change (what a library holds), what Mediaplane only checks (whether an arr reaches its
  root folder's folder), and where an app sends a key (a host, a port, TLS, a URL): the
  stack's keys go only to its own addresses, and every request that carries one is built
  from them, whatever an override or the app holds. A secret is never kept, nor a value
  that holds one.
- **Drift keeps its marks few** (the owner's decisions of 2026-10-17):
  - a secret it finds refused isn't checked again, by drift or `plan`, until `apply`
    sets it. That spares qBittorrent's sign-in ban, and leaves one failure in an app's
    status, and one line in Seerr's log, for each change;
  - Jellyfin's admin password is checked by drift once a day at most, while it passes;
  - `plan` and drift leave an arr's download client key unchecked while qBittorrent
    lacks a category the client names, which the arr's own test would make;
  - Seerr's Jellyfin key, found refused, isn't checked again by the update that gives
    Seerr the stack's: one failed check, and one line in Seerr's log, per `apply`.

  To know what it found, drift keeps each check's verdict and time, by the secret's name,
  in `state/resources.json`: its one write.

- **Shared keys are reported, not repaired, in S8.** A key changed at its source, such
  as qBittorrent's made anew in its web UI, is drift on qBittorrent and on each resource
  that holds it. Putting the old key back at the source, or taking the new one and giving
  it to every consumer, needs the key read from the app's own files, which is key
  recovery: Slice 10 brings both. The wiring failed runbook gives the steps by hand.

## Consequences

- **A change by hand is never silently undone.** `plan` shows it as drift before
  `apply` puts it back, and `apply` asks first.
- **`drift` writes `state/resources.json`,** never `stack.yaml` and never an app. A
  secret it found refused stays so until `apply` sets it, even if you put it right in
  the app yourself: `apply` then sets it again, which changes nothing.
- **Drift can't tell a secret changed in the app from one you changed in the stack:**
  either way, the app refuses the secret the stack has. Its message says both.
- **A resource left in an app is reported, never removed.** Removing what Mediaplane made
  when its app leaves the stack needs a delete for every kind of resource: Slice 10.
- **After upgrading to Slice 8, `plan` adopts each root folder once,** changing nothing
  in the apps: it now also records whether the arr reaches the folder.
- **Drift runs only when you run it** in M1. M2 can run it on a schedule as it is: it
  takes the lock, and checks no more than it must.
```

- [ ] **Step 4: The READMEs and the deploy guide**

**Change** `README.md`:

````diff
diff --git a/README.md b/README.md
index 10e1031..a742be5 100644
--- a/README.md
+++ b/README.md
@@ -31,5 +31,8 @@ Compose and wires the apps together for you.**
 >   `mediaplane vpn-check` confirms that qBittorrent reaches the internet only through
->   the VPN. Mediaplane runs in its own hardened container, behind a Docker socket
->   proxy, and reaches the apps over a private network with no route out.
-> - **Next:** drift detection: `plan` will report what was changed by hand.
+>   the VPN. `mediaplane drift` reports what was changed by hand in the apps, with what
+>   Mediaplane set and what the app holds now; `apply` puts it back, and
+>   `mediaplane keep` keeps it as yours instead, in `stack.yaml`. Mediaplane runs in its
+>   own hardened container, behind a Docker socket proxy, and reaches the apps over a
+>   private network with no route out.
+> - **Next:** releases, and updating Mediaplane without touching the stack.
 > - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
@@ -82,3 +85,3 @@ Mediaplane does that part for you:
 | Hardware transcoding for Plex or Jellyfin (`hardware_transcoding`)                | Done    |
-| Detect manual changes and offer Re-apply or "Keep mine"                           | Planned |
+| Detect manual changes and offer Re-apply or "Keep mine" (`drift`, `keep`)         | Done    |
 | Releases, and updating Mediaplane without touching the stack                      | Planned |
@@ -124,8 +127,10 @@ the host, renders the Compose project and diffs it against what is running. It s
 the changes and touches nothing in your stack, apart from small marks that checking a key
-or a password can leave in an app: a category in qBittorrent, a failure in an app's own
-status of a client, link or connection, a sign-in in Jellyfin's activity log, a line in
-Seerr's log (and an arr's) for a check of Seerr's that fails, and an arr listed among
-Plex's devices by its first test of its connection to Plex. The
+or a password can leave in an app: a failure in an app's own status of a client, link or
+connection, a sign-in in Jellyfin's activity log, a line in Seerr's log (and an arr's)
+for a check of Seerr's that fails, and an arr listed among Plex's devices by its first
+test of its connection to Plex. The
 [threat model](docs/security/threat-model.md#what-runs-and-who-can-reach-it) says more.
-`apply` does the same, then makes those changes.
+It also shows what was changed by hand in the apps since Mediaplane set it: drift.
+`apply` does the same, then makes those changes. `drift` reports only what was changed
+by hand, and `keep` keeps a change of yours as the stack's.
 
@@ -172,4 +177,5 @@ A few principles hold throughout:
 - **You stay in control.** Container-level changes go in your own
-  `compose.override.yaml`, which Mediaplane never writes. Mediaplane will only manage
-  what it created, and it reports manual changes instead of reverting them.
+  `compose.override.yaml`, which Mediaplane never writes. Mediaplane manages only what it
+  created, and reports a change made by hand to it before `apply` puts it back: you
+  choose, and `mediaplane keep` keeps yours.
 - **Safe by default.** On a cloud VM, a private address is often reachable from the
@@ -350,6 +356,6 @@ including your own admin password if you'd rather type one, and with Plex signs
 It changes nothing in your stack, apart from small marks that checking a key or a
-password can leave in an app: a category in qBittorrent, a failure in an app's own
-status of a client, link or connection, a sign-in in Jellyfin's activity log, a line in
-Seerr's log (and an arr's) for a check of Seerr's that fails, and an arr listed among
-Plex's devices by its first test of its connection to Plex. The
+password can leave in an app: a failure in an app's own status of a client, link or
+connection, a sign-in in Jellyfin's activity log, a line in Seerr's log (and an arr's)
+for a check of Seerr's that fails, and an arr listed among Plex's devices by its first
+test of its connection to Plex. The
 [threat model](docs/security/threat-model.md#what-runs-and-who-can-reach-it) says more.
@@ -401,2 +407,15 @@ command shows the admin login, which qBittorrent, Sonarr, Radarr, Prowlarr and J
 use, and Seerr through Jellyfin, and each app's address.
+
+Then change something Mediaplane manages in an app's web UI, such as the category of the
+download client `qBittorrent (Mediaplane)` in Sonarr (Settings, Download Clients), and
+see what `drift` says:
+
+```bash
+MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane drift --home .mediaplane-dev
+MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane keep sonarr.download_client.category --home .mediaplane-dev
+```
+
+`drift` shows what Mediaplane set and what Sonarr holds now, and exits `2`. `apply` puts
+it back; `keep` instead adds it under `overrides:` in `stack.yaml`, and `drift` is
+clear. The [drift runbook](docs/runbooks/drift-reported.md) says more.
 The first `apply` downloads several GB of images, so it can take a while. To remove the
@@ -549,8 +568,7 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
   test and `vpn-check`), S3b (the wiring framework), S3c (the download path), S4
-  (indexers), S5 (Jellyfin), S6 (requests) and S7 (Plex). Since S7, smaller changes
-  have added a guided install (`deploy/install.sh`, and `init` asking for your own admin
-  password and signing you in to Plex) and hardware transcoding.
-- **Next:** S8 (drift detection).
-- **After that:** S9 (releases and safe updates), then S10 (recovery and automation),
-  which completes M1.
+  (indexers), S5 (Jellyfin), S6 (requests), S7 (Plex) and S8 (drift). Between S7 and
+  S8, smaller changes added a guided install (`deploy/install.sh`, and `init` asking for
+  your own admin password and signing you in to Plex) and hardware transcoding.
+- **Next:** S9 (releases and safe updates).
+- **After that:** S10 (recovery and automation), which completes M1.
 
@@ -579,2 +597,5 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
   or Mediaplane can't reach an app.
+- **[Runbook: drift reported](docs/runbooks/drift-reported.md):** something Mediaplane
+  manages was changed in an app: put it back with `apply`, or keep it with
+  `mediaplane keep`.
 - **[Threat model](docs/security/threat-model.md):** what is protected, how, and what
````

**Change** `catalog/jellyfin/README.md`:

```diff
diff --git a/catalog/jellyfin/README.md b/catalog/jellyfin/README.md
index ffe378f..dbdba80 100644
--- a/catalog/jellyfin/README.md
+++ b/catalog/jellyfin/README.md
@@ -96,8 +96,24 @@ upstream LinuxServer.io image, unmodified, when `media_server` is `jellyfin`.
 
-## Not built yet
-
-- **Slice 8:** drift: reporting a setting changed by hand, rather than putting it back,
-  and Keep mine.
-
-See the [roadmap](../../docs/plans/m1-roadmap.md).
+## Drift and Keep mine
+
+- **What drift reports.** `mediaplane drift`, and `plan`, report a change made in
+  Jellyfin's web UI to what Mediaplane manages here, listed above under "Managed in the
+  app": what Mediaplane set, and what Jellyfin holds now. A secret is checked with
+  Jellyfin's own test, and named, never shown. `apply` puts each back.
+- **Keeping yours.** `mediaplane keep jellyfin.<resource>.<field>`, as drift names it,
+  keeps what Jellyfin holds instead: it adds the line under `overrides:` in `stack.yaml`,
+  and `apply` then leaves it. A field marked `(fixed)` above, and a secret, can't be
+  kept. `mediaplane keep jellyfin.library_movies` stops Mediaplane managing a resource deleted
+  in Jellyfin. The [drift runbook](../../docs/runbooks/drift-reported.md) says more.
+- **A folder added to `Movies` or `Shows`,** kept (`jellyfin.library_movies.paths`):
+  the library then holds each folder kept, one comma-separated list. A folder with a
+  comma in its name can't be listed: drift says so, and `apply` takes it out.
+- **A library renamed in Jellyfin** is no longer found by its name: drift reports it
+  deleted, and `apply` refuses to make it again while the renamed one holds its folder,
+  saying what to do. Rename it back, or keep it as yours with
+  `mediaplane keep jellyfin.library_movies` (or `library_shows`). Seerr then no longer
+  enables it either.
+- **Its admin password** is checked by drift once a day at most, while it passes: each
+  check signs in, which Jellyfin's activity log keeps. `plan` and `apply` check it every
+  time.
 
@@ -113,4 +129,3 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
   Mediaplane's. A folder you add to one, or one of them you remove, is put back by the
-  next `apply` (Slice 8 adds Keep mine). Add a library of your own instead. A library you
-  rename is no longer Mediaplane's: the next `apply` makes `Movies` or `Shows` again.
+  next `apply`, unless you keep it (see above). Add a library of your own instead.
   Everything else in them, such as their metadata language, is yours.
@@ -159,3 +174,3 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
   `state/secrets.json`, keeping the file valid JSON, and apply: Mediaplane signs in as the
-  admin, makes a new key, and gives it to Sonarr and Radarr. Slice 8 does this for you.
+  admin, makes a new key, and gives it to Sonarr and Radarr. Slice 10 does this for you.
   The [wiring failed runbook](../../docs/runbooks/wiring-failed.md) has the details.
```

**Change** `catalog/plex/README.md`:

```diff
diff --git a/catalog/plex/README.md b/catalog/plex/README.md
index 864b935..28538f7 100644
--- a/catalog/plex/README.md
+++ b/catalog/plex/README.md
@@ -128,7 +128,20 @@ LinuxServer.io image, unmodified, when `media_server` is `plex`.
 
-## Not built yet
-
-- **Slice 8:** drift detection and Keep mine for what it manages here.
-
-See the [roadmap](../../docs/plans/m1-roadmap.md).
+## Drift and Keep mine
+
+- **What drift reports.** `mediaplane drift`, and `plan`, report a change made in
+  Plex's web UI to what Mediaplane manages here, listed above under "Managed in the
+  app": what Mediaplane set, and what Plex holds now. A secret is checked with
+  Plex's own test, and named, never shown. `apply` puts each back.
+- **Keeping yours.** `mediaplane keep plex.<resource>.<field>`, as drift names it,
+  keeps what Plex holds instead: it adds the line under `overrides:` in `stack.yaml`,
+  and `apply` then leaves it. A field marked `(fixed)` above, and a secret, can't be
+  kept. `mediaplane keep plex.library_movies` stops Mediaplane managing a resource deleted
+  in Plex. The [drift runbook](../../docs/runbooks/drift-reported.md) says more.
+- **Its name,** kept as another (`plex.server.name`), stays.
+- **A folder added to `Movies` or `TV Shows`,** kept (`plex.library_movies.location`):
+  the library then holds each folder kept, one comma-separated list.
+- **A library renamed in Plex** is still found, by Plex's key for it: drift reports its
+  name, and `apply` renames it back. Its name is fixed, as Seerr enables it by its name.
+  To keep the new name, stop Mediaplane managing it with `plex.library_movies: unmanaged`
+  (or `library_tv`) under `overrides:`; Seerr then no longer enables it either.
 
@@ -142,3 +155,3 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 - **What Mediaplane manages** (its name, and its libraries' names, kinds and folders) is
-  put back by the next `apply` when changed in Plex. Keep mine comes in Slice 8.
+  put back by the next `apply` when changed in Plex, unless you keep it (see above).
 - **Hardware transcoding** (Intel Quick Sync, or AMD): set
@@ -172,3 +185,3 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
   next `apply` when Plex refuses theirs. Seerr keeps the token it signed in with, and
-  Mediaplane can't give it another yet (Slice 8).
+  Mediaplane can't give it another yet (Slice 10).
 - **A Plex claimed outside `apply`,** with another account, stays unpublished: see the
```

**Change** `catalog/prowlarr/README.md`:

```diff
diff --git a/catalog/prowlarr/README.md b/catalog/prowlarr/README.md
index 267679d..e2ad79a 100644
--- a/catalog/prowlarr/README.md
+++ b/catalog/prowlarr/README.md
@@ -90,10 +90,27 @@ to the solver only when the site answers with a Cloudflare challenge.
 
-## Not built yet
-
-- **Slice 8:** keeping a setting of your own in place of one Mediaplane manages ("Keep
-  mine"). Until then, the next `apply` puts back a link's addresses, sync level or
-  categories, or the proxy's host, timeout or tags, changed in Prowlarr's web UI. `plan`
-  shows it first.
-
-See the [roadmap](../../docs/plans/m1-roadmap.md).
+## Drift and Keep mine
+
+- **What drift reports.** `mediaplane drift`, and `plan`, report a change made in
+  Prowlarr's web UI to what Mediaplane manages here, listed above under "Managed in the
+  app": what Mediaplane set, and what Prowlarr holds now. A secret is checked with
+  Prowlarr's own test, and named, never shown. `apply` puts each back.
+- **Keeping yours.** `mediaplane keep prowlarr.<resource>.<field>`, as drift names it,
+  keeps what Prowlarr holds instead: it adds the line under `overrides:` in `stack.yaml`,
+  and `apply` then leaves it. A field marked `(fixed)` above, and a secret, can't be
+  kept. `mediaplane keep prowlarr.indexer_proxy` stops Mediaplane managing a resource deleted
+  in Prowlarr. The [drift runbook](../../docs/runbooks/drift-reported.md) says more.
+- **Where Prowlarr sends a key** is fixed: each link's `baseUrl` and `prowlarrUrl`, and
+  the proxy's host, which your indexers' requests go through. Drift reports a change to
+  one, and `apply` puts the stack's own address back; Prowlarr's test of a link is
+  always aimed there.
+- **The proxy's tags,** kept with other labels than `cloudflare`
+  (`prowlarr.indexer_proxy.tags`): Mediaplane gives the proxy each, making a tag it
+  lacks.
+- **The proxy's health.** Mediaplane never tests the proxy itself, which needs the
+  internet: drift reads Prowlarr's own health check, which tests it every six hours, and
+  warns (`drift.health`) when it says the proxy is unavailable. `apply` can't put that
+  right: check the Cloudflare solver.
+- **A link to an arr taken out of the stack** stays in Prowlarr, with that arr's key, and
+  drift reports it as still in the app. Remove it in Prowlarr, or stop the report with
+  `mediaplane keep prowlarr.application_sonarr` (or `_radarr`).
 
@@ -155,4 +172,4 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
   Use your own home, and the container name `docker ps` shows. If `mv` is refused, use
-  `sudo mv`. The old file keeps your settings, to enter again in Prowlarr. Slice 8 does
-  this for you.
+  `sudo mv`. The old file keeps your settings, to enter again in Prowlarr. Slice 10
+  does this for you.
 
```

**Change** `catalog/qbittorrent/README.md`:

```diff
diff --git a/catalog/qbittorrent/README.md b/catalog/qbittorrent/README.md
index d83125c..137a6b8 100644
--- a/catalog/qbittorrent/README.md
+++ b/catalog/qbittorrent/README.md
@@ -85,7 +85,28 @@ unmodified, and by default puts it behind Gluetun's VPN.
 
-## Not built yet
-
-Nothing for qBittorrent itself. Keeping a setting of your own in place of one Mediaplane
-manages ("Keep mine") comes in Slice 8. See the
-[roadmap](../../docs/plans/m1-roadmap.md).
+## Drift and Keep mine
+
+- **What drift reports.** `mediaplane drift`, and `plan`, report a change made in
+  qBittorrent's web UI to what Mediaplane manages here, listed above under "Managed in the
+  app": what Mediaplane set, and what qBittorrent holds now. A secret is checked with
+  qBittorrent's own test, and named, never shown. `apply` puts each back.
+- **Keeping yours.** `mediaplane keep qbittorrent.<resource>.<field>`, as drift names it,
+  keeps what qBittorrent holds instead: it adds the line under `overrides:` in `stack.yaml`,
+  and `apply` then leaves it. A field marked `(fixed)` above, and a secret, can't be
+  kept. `mediaplane keep qbittorrent.category_movies` stops Mediaplane managing a resource deleted
+  in qBittorrent. The [drift runbook](../../docs/runbooks/drift-reported.md) says more.
+- **Its password, changed in qBittorrent,** is checked by signing in, once per `plan`.
+  Once drift has found it refused, neither drift nor `plan` signs in again until `apply`
+  sets it, which spares Mediaplane the ban below.
+- **A download client's category, kept as another** (`mediaplane keep
+sonarr.download_client.category`), becomes this category's name too: the category
+  `qbittorrent.category_tv` makes is then the kept one, with its save path under
+  `/data/torrents`, and `apply` makes it. Until it does, drift leaves Sonarr's client's
+  key unchecked, saying `apply` puts what it requires in place first. The category made
+  before stays, yours.
+- **A category you stop Mediaplane managing** (`qbittorrent.category_tv: unmanaged`, or
+  `_movies`) is yours, and stays the category Sonarr's or Radarr's download client files
+  under: while qBittorrent lacks it, `plan` and drift leave that client's key unchecked,
+  as the arr's own test would make it, with no save path. To clear it, make the category
+  in qBittorrent, or name one in the arr that qBittorrent has (and keep that), then run
+  drift again.
 
@@ -108,4 +129,4 @@ manages ("Keep mine") comes in Slice 8. See the
   next `apply`: the login, the save path, Automatic Torrent Management, who may skip the
-  login, and the two categories' save paths. `plan` shows it first. Slice 8 adds "Keep
-  mine".
+  login, and the two categories' save paths. `plan` and `mediaplane drift` show it first,
+  and `mediaplane keep` keeps it instead (see above).
 - **Five failed sign-ins in a row ban an address for an hour.** Mediaplane checks the
@@ -147,3 +168,3 @@ manages ("Keep mine") comes in Slice 8. See the
   sign in with what `mediaplane credentials` shows. The old file keeps your settings,
-  to enter again in qBittorrent. Slice 8 does this for you.
+  to enter again in qBittorrent. Slice 10 does this for you.
 
```

**Change** `catalog/radarr/README.md`:

```diff
diff --git a/catalog/radarr/README.md b/catalog/radarr/README.md
index 5149b88..2c0a85c 100644
--- a/catalog/radarr/README.md
+++ b/catalog/radarr/README.md
@@ -107,6 +107,31 @@ LinuxServer.io image, unmodified.
 
-## Not built yet
-
-- **Slice 8:** drift detection and Keep mine for what it manages here. See the
-  [roadmap](../../docs/plans/m1-roadmap.md).
+## Drift and Keep mine
+
+- **What drift reports.** `mediaplane drift`, and `plan`, report a change made in
+  Radarr's web UI to what Mediaplane manages here, listed above under "Managed in the
+  app": what Mediaplane set, and what Radarr holds now. A secret is checked with
+  Radarr's own test, and named, never shown. `apply` puts each back.
+- **Keeping yours.** `mediaplane keep radarr.<resource>.<field>`, as drift names it,
+  keeps what Radarr holds instead: it adds the line under `overrides:` in `stack.yaml`,
+  and `apply` then leaves it. A field marked `(fixed)` above, and a secret, can't be
+  kept. `mediaplane keep radarr.root_folder` stops Mediaplane managing a resource deleted
+  in Radarr. The [drift runbook](../../docs/runbooks/drift-reported.md) says more.
+- **Its download client's category,** kept as another (`radarr.download_client.category`):
+  qBittorrent's category (`qbittorrent.category_movies`) then has that name, and `apply`
+  makes it, with its save path. Radarr's own test of the client makes a category
+  qBittorrent lacks, with no save path, so `plan` and drift leave the client's key
+  unchecked while one is missing, saying what clears it: the kept one until `apply`
+  makes it, or the post-import one you set in Radarr (`movieImportedCategory`), which stays yours
+  to make in qBittorrent.
+- **Where Radarr sends a key** is fixed: its download client's host, port and TLS, and its
+  connections' host and port. Drift reports a change to one, and `apply` puts the
+  stack's own address back; every test Mediaplane has Radarr run is aimed there, whatever
+  Radarr holds.
+- **Its root folder's folder, deleted by hand:** drift says Radarr can't reach it
+  (`radarr.root_folder.accessible`), and `apply` makes the folder again. Its path is
+  fixed: Radarr knows a root folder by its path. To move your library, move it in
+  Radarr, then stop Mediaplane managing the root folder with
+  `radarr.root_folder: unmanaged` under `overrides:`.
+- **A connection's events,** which change files it tells the media server of, are yours:
+  drift doesn't report them.
 
@@ -155,4 +180,4 @@ LinuxServer.io image, unmodified.
   Use your own home, and the container name `docker ps` shows. If `mv` is refused, use
-  `sudo mv`. The old file keeps your settings, to enter again in Radarr. Slice 8 does
-  this for you.
+  `sudo mv`. The old file keeps your settings, to enter again in Radarr. Slice 10
+  does this for you.
 
```

**Change** `catalog/seerr/README.md`:

```diff
diff --git a/catalog/seerr/README.md b/catalog/seerr/README.md
index 8762eed..081c2d0 100644
--- a/catalog/seerr/README.md
+++ b/catalog/seerr/README.md
@@ -111,6 +111,29 @@ With Jellyfin as the media server (with Plex, see below):
 
+## Drift and Keep mine
+
+- **What drift reports.** `mediaplane drift`, and `plan`, report a change made in
+  Seerr's web UI to what Mediaplane manages here, listed above under "Managed in the
+  app": what Mediaplane set, and what Seerr holds now. A secret is checked with
+  Seerr's own test, and named, never shown. `apply` puts each back.
+- **Keeping yours.** `mediaplane keep seerr.<resource>.<field>`, as drift names it,
+  keeps what Seerr holds instead: it adds the line under `overrides:` in `stack.yaml`,
+  and `apply` then leaves it. A field marked `(fixed)` above, and a secret, can't be
+  kept. `mediaplane keep seerr.server_radarr` stops Mediaplane managing a resource deleted
+  in Seerr. The [drift runbook](../../docs/runbooks/drift-reported.md) says more.
+- **A library turned off in Seerr,** kept (`seerr.media_server.libraries`, or
+  `media_server_plex`): Mediaplane then enables only the libraries kept, and the others
+  are yours, to turn on or off. A library Mediaplane no longer manages in Jellyfin or
+  Plex is never enabled by it.
+- **Where Seerr sends a key** is fixed: the host and port of its media server and of its
+  Sonarr and Radarr servers. Drift reports a change to one, and `apply` puts the stack's
+  own address back; Mediaplane's tests of a server are aimed there, and Seerr's list of
+  Jellyfin's users is asked only while Seerr holds the stack's address. `keep` reads a
+  server's profile from what was applied, rather than run Seerr's test.
+- **A server's profile, root folder or default,** kept
+  (`seerr.server_sonarr.activeProfile`, `activeDirectory`, `isDefault`), stays. Its setup
+  (`seerr.setup.initialized`) is fixed: Seerr can't be taken back to its setup wizard.
+
 ## Not built yet
 
-- **Slice 8:** drift detection and Keep mine for what it manages here, and a way to give
-  Seerr a new Plex token: it keeps the one it signed in with.
+- **Slice 10:** a way to give Seerr a new Plex token: it keeps the one it signed in with.
 
@@ -128,3 +151,3 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
   changed in Seerr: its Jellyfin or Plex, its libraries, and each server's host, port,
-  profile, root folder and default. Keep mine comes in Slice 8.
+  profile, root folder and default, unless you keep it (see above).
 - **Anything else** goes in `compose.override.yaml` in the Mediaplane home.
```

**Change** `catalog/sonarr/README.md`:

```diff
diff --git a/catalog/sonarr/README.md b/catalog/sonarr/README.md
index 3562961..a7c61f8 100644
--- a/catalog/sonarr/README.md
+++ b/catalog/sonarr/README.md
@@ -109,6 +109,31 @@ LinuxServer.io image, unmodified.
 
-## Not built yet
-
-- **Slice 8:** drift detection and Keep mine for what it manages here. See the
-  [roadmap](../../docs/plans/m1-roadmap.md).
+## Drift and Keep mine
+
+- **What drift reports.** `mediaplane drift`, and `plan`, report a change made in
+  Sonarr's web UI to what Mediaplane manages here, listed above under "Managed in the
+  app": what Mediaplane set, and what Sonarr holds now. A secret is checked with
+  Sonarr's own test, and named, never shown. `apply` puts each back.
+- **Keeping yours.** `mediaplane keep sonarr.<resource>.<field>`, as drift names it,
+  keeps what Sonarr holds instead: it adds the line under `overrides:` in `stack.yaml`,
+  and `apply` then leaves it. A field marked `(fixed)` above, and a secret, can't be
+  kept. `mediaplane keep sonarr.root_folder` stops Mediaplane managing a resource deleted
+  in Sonarr. The [drift runbook](../../docs/runbooks/drift-reported.md) says more.
+- **Its download client's category,** kept as another (`sonarr.download_client.category`):
+  qBittorrent's category (`qbittorrent.category_tv`) then has that name, and `apply`
+  makes it, with its save path. Sonarr's own test of the client makes a category
+  qBittorrent lacks, with no save path, so `plan` and drift leave the client's key
+  unchecked while one is missing, saying what clears it: the kept one until `apply`
+  makes it, or the post-import one you set in Sonarr (`tvImportedCategory`), which stays yours
+  to make in qBittorrent.
+- **Where Sonarr sends a key** is fixed: its download client's host, port and TLS, and its
+  connections' host and port. Drift reports a change to one, and `apply` puts the
+  stack's own address back; every test Mediaplane has Sonarr run is aimed there, whatever
+  Sonarr holds.
+- **Its root folder's folder, deleted by hand:** drift says Sonarr can't reach it
+  (`sonarr.root_folder.accessible`), and `apply` makes the folder again. Its path is
+  fixed: Sonarr knows a root folder by its path. To move your library, move it in
+  Sonarr, then stop Mediaplane managing the root folder with
+  `sonarr.root_folder: unmanaged` under `overrides:`.
+- **A connection's events,** which change files it tells the media server of, are yours:
+  drift doesn't report them.
 
@@ -148,4 +173,4 @@ LinuxServer.io image, unmodified.
   Use your own home, and the container name `docker ps` shows. If `mv` is refused, use
-  `sudo mv`. The old file keeps your settings, to enter again in Sonarr. Slice 8 does
-  this for you.
+  `sudo mv`. The old file keeps your settings, to enter again in Sonarr. Slice 10
+  does this for you.
 
```

**Change** `deploy/README.md`:

````diff
diff --git a/deploy/README.md b/deploy/README.md
index 39217bc..6926808 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -147,2 +147,3 @@ mediaplane credentials  # the admin login, and where each app is
 mediaplane vpn-check    # with a VPN: qBittorrent gets out only through it
+mediaplane drift        # what was changed by hand in the apps since apply
 ```
@@ -517,2 +518,8 @@ Each item is a message you may see, then what to do.
 
+- `Drift found`, from `mediaplane drift`, or a `Drift` section in `plan`
+
+  Something Mediaplane manages was changed in an app's web UI. Follow the
+  [drift reported runbook](../docs/runbooks/drift-reported.md): `apply` puts it back,
+  and `mediaplane keep` keeps it.
+
 - `Resource is still in use`, from `docker compose -p mediaplane down`
````

- [ ] **Step 5: The spec and the roadmap**

**Change** `docs/design/m1-engine-cli.md`:

```diff
diff --git a/docs/design/m1-engine-cli.md b/docs/design/m1-engine-cli.md
index 1dcb888..65b7780 100644
--- a/docs/design/m1-engine-cli.md
+++ b/docs/design/m1-engine-cli.md
@@ -222,3 +222,3 @@ converges on desired state.
 | `planner` | Diff the files, the containers and the wiring into an ordered `Plan` | all of the above | None (pure, given its inputs) |
-| `drift` | The planner in observe-only mode, using a three-way comparison (see §6) | planner | None |
+| `drift` | The planner in observe-only mode, using a three-way comparison (see §6) | planner | What its checks found, in `state/resources.json` (§11, Slice 8) |
 | `history` | Append-only change records | — | Writes `state/history/` |
@@ -550,7 +550,7 @@ in `compose.override.yaml` is therefore wired automatically.
 | `init` | Write a starter `stack.yaml` and a `secrets/` layout. On a TTY it asks interactive prompts (media server, data path, VPN provider and its WireGuard address, LAN or localhost, the LAN subnet and whether the LAN must sign in (both only with LAN), the admin user name, and whether to generate its password); otherwise it takes flags. It checks every flag it can before the first prompt, including the format of `--vpn-addresses` (on a terminal, only the refusal of `--vpn-addresses` without `--vpn-provider`, and whether `--lan-subnet` fits this host, wait for the provider and bind answers), and asks again after a bad answer. It never overwrites an existing file. It also checks the home first, creates the data folder, adds a note before each question, and takes the WireGuard key on a hidden prompt (§11, Slice 3b) |
-| `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (a key or password check can leave a mark in an app: §11, Slices 3c, 4, 5, 6 and 7; it never calls plex.tv); in the image it joins the wiring network, its only lasting change to Docker (§11, Slice 3b) |
+| `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (a key or password check can leave a mark in an app: §11, Slices 3c, 4, 5, 6, 7 and 8; it never calls plex.tv); in the image it joins the wiring network, its only lasting change to Docker (§11, Slice 3b) |
 | `apply` | Converge on `stack.yaml` (§5) |
 | `status [app]` | Container health, VPN state, and the last apply's outcome |
-| `drift` | Report drift only (§6.3) |
-| `keep <path>` | Keep mine: record a drifted value or a deletion as an override |
+| `drift` | Report drift only (§6.3): it changes nothing in the apps but for its checks' marks, fewer than `plan`'s, and keeps what it found of each secret in `state/resources.json` (§11, Slice 8) |
+| `keep <path>` | Keep mine: record a drifted value, or a resource deleted or left in an app, as an override, adding one line to `stack.yaml` (§11, Slice 8) |
 | `history [id]` | List change records, or show one in full |
@@ -1010,4 +1010,4 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   with `<app>.not-seeded`, and its hint gives the steps. A file Mediaplane can't read
-  counts as seeded, because there is no way to tell. Slice 8 automates the fix, with
-  the rest of "restore the key at the source" (§6.3).
+  counts as seeded, because there is no way to tell. Slice 10 automates the fix, with
+  the rest of "restore the key at the source" (§6.3; moved from Slice 8 on 2026-10-25).
 - **The shared admin (§6.1).** `admin.username` is 3 to 32 letters, digits, `.`, `_`
@@ -1357,3 +1357,4 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   stack drops its Cloudflare solver, as a download client stays when qBittorrent leaves:
-  Mediaplane doesn't remove what it made yet. Slice 8 decides, with §8.1(3) step 4.
+  Mediaplane doesn't remove what it made yet. Slice 8 reports it (`left` drift), and
+  `keep <app>.<resource>` makes it yours; removing it is Slice 10's, with §8.1(3) step 4.
 - **One way to wire a Servarr provider.** The arrs' download client and Prowlarr's links
@@ -1470,3 +1471,4 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   so. Removing it from `state/secrets.json` has the next `apply` sign in, make a new one,
-  and give it to the arrs' connections; Slice 8 automates that, with key recovery.
+  and give it to the arrs' connections; Slice 10 automates that, with key recovery
+  (moved from Slice 8 on 2026-10-25). Slice 8's drift reports the refused key.
 
@@ -1786 +1788,147 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   same unpublished `up` and recreate as Jellyfin's (§7.2(2)).
+
+### Slice 8: drift (2026-10-25)
+
+- **The three-way comparison** (§6.3), as built. D is what the stack wants: each
+  resource's `desired`, with the overrides that name its managed fields. L is its record
+  in `state/resources.json`. O is what the app holds. A field drifted when O differs
+  from L and from D: one the stack now wants, as after you edit `stack.yaml` to match
+  the app, isn't drift. Drift needs a record: a resource never applied has none. Each
+  item says what drifted (`mediaplane.drift/v1`, and `drift` in `plan`'s `--json`,
+  additive within `mediaplane.plan/v1`):
+  - `field`: the managed field, the value `apply` sets (`expected`, D), what was
+    applied (`applied`, L) when stack.yaml has changed it since, and what the app holds
+    (`actual`), redacted, and marked `redacted` when that changed it; or `actual: null`
+    with `unreadable` (redacted too) when the app holds it in another shape than
+    Mediaplane reads (another type, or missing): such a field is never read as empty,
+    and differs, so `apply` sets it (the roadmap's S8 items on shapes, and on `enable`).
+    Every observe reads its managed fields with a `FieldReader`; what a resource is
+    found by (its id, its name) is still parsed strictly, and an answer Mediaplane can't
+    parse leaves the resource unknown. A record of another name than the stack now wants
+    is of what it wanted before, such as qBittorrent's category once Sonarr's is kept as
+    another: what differs from it is a change, not drift;
+  - `missing`: the app no longer holds it;
+  - `secret`: the app's own check refuses one of its secrets, by name, with `since` when
+    drift found it before;
+  - `key`: an app refuses the key Mediaplane holds for it, and each resource of another
+    app that holds that key (`source`), whether or not that app can be asked: the
+    shared key of §6.3's last row, reported on the source and each consumer;
+  - `left`: a resource Mediaplane recorded that the stack no longer wants, still in the
+    app, such as Prowlarr's link to an arr taken out of the stack. One the app can't say
+    about is a warning (`drift.left-unknown`) and a wiring check that couldn't be made,
+    never said to be gone: drift isn't clear then.
+  - What puts each right is said by its kind: `apply` for a field, a resource or a
+    secret; for a key, the wiring failed runbook's steps (Slice 10 restores it); for what
+    is left, removing it in the app or `keep <app>.<resource>` (Slice 10 removes it).
+- **`mediaplane drift`** (§5.2) is `plan`, looking only: no preflight, and every app that
+  runs and is healthy is asked, even one `apply` would recreate. It runs under apply's
+  lock, which now records the command that holds it (`drift`, `keep`), so a held lock
+  says `mediaplane drift is running`. It exits 0 when nothing drifted and every resource
+  and secret was checked, 2 otherwise, and 1 on an error. Each secret's check is listed
+  (`checks`: `passed`, `refused`, or `unchecked` with why). Its one write is each check's
+  verdict and time, by the secret's name, in its resource's record (`checks`, an optional
+  field within `mediaplane.resources/v1`): never a value. A record `apply` writes has
+  none. It is built to be called as it is by a schedule (M2).
+- **Fewer marks** (§5.2; the owner's decisions of 2026-10-17):
+  - a secret drift found refused is taken as refused, without another check, by drift
+    and by `plan`, until `apply` sets it (its record then has no `checks`): qBittorrent's
+    password costs one failed sign-in, not one per run, and a failing test of an arr's
+    client, link or connection leaves its status as it was, rather than once per run.
+    The status probe: a failing test of Sonarr's download client records one failure
+    (`EscalationLevel` 1); more, a minute apart, leave it at 1, but once the first is
+    five minutes old each disables the client for a minute (`DisabledTill`), and Sonarr's
+    health says `All download clients are unavailable due to failures` (probed). A
+    passing test resets it;
+  - a resource may say how often drift checks its secrets at most, while they pass
+    (`checkEvery`): Jellyfin's admin, once a day, since each check signs in, three lines
+    in Jellyfin's activity log (one for a sign-in that fails, probed). `plan` and `apply`
+    check it every time;
+  - `plan` and drift leave an arr's download client key unchecked while qBittorrent
+    lacks a category the client names: its post-import one (the owner's decision), or
+    its own, once qBittorrent's is no longer managed and deleted; and while the setting
+    isn't text, or qBittorrent can't be asked. The arr's own test would make it, with no
+    save path (probed, its own category too). They ask qBittorrent first, through the
+    run's client for it (`VerifyContext.peer`), and say what clears it. A category the
+    client is kept with is qBittorrent's to have (`qbittorrent.category_<name>` wants it,
+    with its save path), so `apply` makes it, and the client waits for it. `apply`'s
+    test runs as before;
+  - Seerr's Jellyfin key, found refused, isn't checked again by the update that gives
+    Seerr Mediaplane's key: one failed check, one line in Seerr's log, per `apply`
+    (`update` is told what differs). A failing Seerr test logs one line each time, with
+    no throttling (probed).
+- **Overrides** (§4.2) are part of D in `plan`, `apply` and drift. `plan` checks each
+  before it asks any app: an app, resource or field that isn't there fails it, with the
+  closest name (names are case-sensitive); so do a secret, a fixed field, a value of
+  another type than the field's, and `<app>.<resource>` with anything but `unmanaged`.
+  One for an app the stack doesn't have, a field of a resource it doesn't want, or a
+  field of a resource made `unmanaged`, is a warning (`overrides.unused`); `unmanaged` of
+  a resource the stack doesn't want is quiet. `<app>.<resource>: unmanaged` takes the resource out of
+  what the stack wants: it is neither made, looked at, nor reported. A field held as a
+  comma-separated list (`lists`) is compared as a set. Seerr enables only the libraries
+  of Jellyfin's or Plex's that Mediaplane still manages, and those an override names.
+- **Every managed field reaches the app from D,** so that a kept value stays: Prowlarr's
+  proxy gets each tag its `tags` names; Jellyfin's libraries hold each folder in `paths`,
+  and an update reads the folders as Jellyfin lists them, so one with a comma in its name
+  is removed (the roadmap's S8 item); Plex's hold each in `location`; Seerr's servers take
+  `isDefault`, and its libraries are enabled as named.
+- **Fixed fields** (`locked`, each with why), which overrides and Keep mine can't change:
+  a root folder's path (the arr knows a root folder by it, and can't move one: another
+  would be added beside the one holding your library, the roadmap's S8 item); a
+  library's name, which Mediaplane finds it by and Seerr enables it by, and what it holds;
+  whether an arr reaches its root folder's folder; Seerr's `initialized`; and every
+  field that says where an app sends a key ("it sets where a key is sent", §11 Slice 6:
+  keys go only to the stack's own addresses): the host, port and TLS of the arrs'
+  download clients and connections, the URLs of Prowlarr's links (and its proxy's host),
+  and the host and port of Seerr's media server and servers. To keep a renamed library,
+  it is made `unmanaged`.
+- **Keys go only to the stack's own addresses, both ways:** besides those fixed fields,
+  every request that carries a key, Mediaplane's and each test it has an app run with a
+  key the app holds, is built from the stack's own service address for the other app
+  (`DesiredResource.sendsTo`), never from a managed field nor from what the app holds;
+  Seerr's list of Jellyfin's users is asked only while Seerr holds the stack's address.
+- **A root folder's folder, deleted by hand** (the roadmap's S8 item): a new managed field,
+  `accessible`, which the arr reads from the disk each time it is asked (probed); `apply`
+  makes the folder again, as it makes it for a new root folder. After upgrading, `plan`
+  adopts each root folder once, changing nothing in the arr.
+- **A library renamed by hand** (the roadmap's S8 items): Jellyfin keys a library by its
+  name, so a renamed one reads as missing; Plex's is found by its key, so its name reads
+  as drift, which `apply` puts back. Neither makes a library again on a folder another of
+  its libraries holds: `create` refuses, saying to rename it back or make the library
+  `unmanaged`. Probed: a Jellyfin library renamed loses its id until Jellyfin refreshes,
+  and gets the same one back with its name; Plex's key survives a rename, and Plex takes
+  a library's folders as one `location` each, made or updated.
+- **Prowlarr's indexer proxy** (the roadmap's S8 item): Mediaplane still never tests it.
+  Prowlarr's own health check, every six hours, tests its proxies and reports
+  `IndexerProxyStatusCheck`, `All indexer proxies are unavailable due to failures`, while
+  the solver is down, clearing it once the solver is back (probed). A resource may read
+  its app's health (`health`); drift warns of it (`drift.health`), and of a health check
+  it can't read, never taking that as healthy.
+- **Keep mine** (§5.2, §6.3) is `mediaplane keep <app>.<resource>.<field>`. It looks at
+  that one resource, under the lock: it checks that the app takes Mediaplane's key and
+  reads the resource, checks none of its secrets and runs no test of the app's (what
+  only the app can say, Seerr's profile, is the value applied), and keeps only what
+  drift finds there: a field that drifted, or, for `<app>.<resource>`, a resource missing
+  or left (`unmanaged`). It writes the override into `stack.yaml` by adding one line
+  under `overrides:`, in the indentation of those there, or a new `overrides:` at the
+  end, or replacing the value of one it wrote before, and changes nothing else: comments,
+  key order, quoting, spacing and line ends stay. A rewrite through the YAML library was
+  probed and kept neither aligned comments nor a comment's place, so it is a textual
+  insertion, checked to parse to the same stack with the override, or nothing is
+  written. It keeps the file's mode and group (not an ACL), writes atomically, and
+  refuses a `stack.yaml` that is a link, has other names (hard links), belongs to another
+  user or to a group its user isn't in, or is written as one `{ … }` block, giving the
+  line to add instead. With `managed_by: external` it writes
+  nothing and gives that line (the rest of externally managed mode is Slice 10). It never
+  keeps a secret, a value that holds one, or one it can't read. It then records the value
+  as applied, or forgets the resource's record, so drift is clear and `apply` has nothing
+  to do. `--json` is `mediaplane.keep/v1`.
+- **The integration contract** (§3.2) grows: `ObservedResource.unreadable` (with a
+  `FieldReader` that notes a field of another shape), `ResourceSpec.lists`, `locked`,
+  `checkEvery` and `health`; `verify` may get a `VerifyContext` (`readOnly`, and `peer`
+  for another app's client) and answer `{ unchecked }`; `update` may get what differs
+  (`changes`). Those an integration leaves out keep their meaning.
+- **Not in S8:** restoring a key at its source, or giving a new one to every resource that
+  holds it (§6.3's shared-key resolutions), with key recovery; removing what Mediaplane
+  made when its app leaves the stack (§8.1(3) step 4); externally managed mode; giving
+  Seerr a new Plex token, or another Jellyfin key: Slice 10. Drift on a schedule: M2.
+- **No new Docker API call:** drift and keep make the calls `plan` makes (§7.2(2)).
```

**Change** `docs/plans/m1-roadmap.md`:

```diff
diff --git a/docs/plans/m1-roadmap.md b/docs/plans/m1-roadmap.md
index 255dd28..e4bbb19 100644
--- a/docs/plans/m1-roadmap.md
+++ b/docs/plans/m1-roadmap.md
@@ -25,2 +25,3 @@ Detailed plans so far:
 - Slice 7: [`m1-s7-plex.md`](m1-s7-plex.md) (done).
+- Slice 8: [`m1-s8-drift.md`](m1-s8-drift.md) (done).
 
@@ -28,10 +29,10 @@ Where M1 stands (the README shows the same):
 
-- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6 and S7.
-- **Since S7 (2026-10-17), outside the slices** by the lighter route for small changes
-  (test-first, one review, CI): `hardware_transcoding` for Plex and Jellyfin, `init`
-  offering the Plex sign-in and asking for your own admin password, and
+- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6, S7 and S8.
+- **Between S7 and S8 (2026-10-17), outside the slices** by the lighter route for small
+  changes (test-first, one review, CI): `hardware_transcoding` for Plex and Jellyfin,
+  `init` offering the Plex sign-in and asking for your own admin password, and
   `deploy/install.sh`.
-- **Next:** S8 (drift detection).
-- **After that:** S9 (releases and safe updates), then S10 (recovery and automation),
-  which completes M1. [After M1](#after-m1) has what comes next.
+- **Next:** S9 (releases and safe updates).
+- **After that:** S10 (recovery and automation), which completes M1.
+  [After M1](#after-m1) has what comes next.
 
@@ -75,3 +76,5 @@ Where M1 stands (the README shows the same):
 - `migrate`;
-- the licence's SPDX field, and `main` protected.
+- the licence's SPDX field, and `main` protected;
+- from S8: FlareSolverr's anonymous volume, and a wiring network whose settings change
+  with an update.
 
@@ -83,3 +86,14 @@ leaves the stack running.
 - externally managed mode, name-based re-adoption, key recovery from appdata, and
-  shared-key propagation;
+  shared-key propagation, with restoring a key at its source (S8 reports a shared key
+  changed at its source);
+- removing what Mediaplane made when its app leaves the stack (S8 reports it), and
+  signing a setup in again: Seerr with a new Plex token, or another Jellyfin key;
+- each S8 item below marked "Moved to S10": restoring the keys of installs from before
+  S3a, Jellyfin's key deleted by hand, rotating the admin password, every setup getting
+  every stored key, the setups' contract leftovers, the fake Seerr's `/auth/me`, a failed
+  first-run setup stopping all wiring, and asking Seerr rather than reading its
+  `settings.json`;
+- in externally managed mode, `keep`'s line to add, as a field of `mediaplane.keep/v1`
+  rather than only an error's hint (S8 gives it in the hint);
+- `plan --help` and `drift --help` pointing at the published docs, not a repo path;
 - a contract for automation: the `--json` output shapes pinned and in the generated
@@ -254,3 +268,4 @@ added an S9 item and changed one, and its final review an S8 item and an S9 item
 (2026-10-16) marked the S7 items done, and added five S8 items and three S9 items, and
-its conflict check an S9 item. Each
+its conflict check an S9 item. Slice 8 (2026-10-25) settled each S8 item: built, decided,
+or moved with its reason, as each says. Each
 slice plan must address the items for that slice.
@@ -524,2 +539,3 @@ password, which are S3c's (and listed again below).
   - **Seerr's key checked twice per apply:** check it once.
+  - **Done in S8:** each of the five, as the items below say.
 - **Seerr keeps the Plex token it signed in with** (S7). After `plex-login` saves a new
@@ -529,4 +545,10 @@ password, which are S3c's (and listed again below).
   needs the setup's care: never to a Seerr that isn't Mediaplane's).
+  - **Moved to S10:** giving Seerr a new token means signing Seerr in again, which needs
+    the setup's care and plex.tv, with the recovery of a key that changed. Drift can't
+    check that token with Seerr's key without a call that reaches plex.tv.
 - **The arrs keep a Plex token while Plex takes it** (S7): a new token from `plex-login`
   reaches them only once the old one is refused. Decide whether drift moves them to it.
+  - **Decided in S8:** no. Secrets are checked, never compared, and one that works is
+    left; the new token reaches them once Plex refuses the old one. Moving them to it is
+    rotation, with S10.
 - **Plex's libraries are known by name** (S7), as Jellyfin's are: one renamed by hand
@@ -535,2 +557,5 @@ password, which are S3c's (and listed again below).
   Keep mine must cover `location`.
+  - **Done in S8:** found by Plex's key while `resources.json` has it, so a renamed
+    one is drift on its name, which `apply` puts back; `location` can be kept; the name
+    is fixed; and no library is made on a folder another of Plex's holds.
 - **Plex's devices grow** (S7): each arr's first test of its connection to Plex lists
@@ -538,2 +563,4 @@ password, which are S3c's (and listed again below).
   reports old ones.
+  - **Decided in S8:** not reported. Plex's devices aren't Mediaplane's to manage, and
+    an arr's later tests add none: only its first, or one after Plex is made anew.
 - **A Plex claimed by another account stays unpublished on every `apply`** (S7), with
@@ -541,2 +568,6 @@ password, which are S3c's (and listed again below).
   settings were removed by hand while it runs, which then looks unclaimed to it.
+  - **Decided in S8:** drift reports what `plan` reports when Plex refuses your token
+    (`key` drift); `plan` lists Plex's setup when its file holds no `PlexOnlineToken`.
+    A Plex unclaimed while it runs was not probed in S8; claiming it again is recovery:
+    S10.
 - **Every setup gets every stored key** (S7): `BootstrapContext.keys` holds each app's,
@@ -544,2 +575,3 @@ password, which are S3c's (and listed again below).
   give or to the Plex token alone, when S8 changes the setups for signing in again.
+  - **Moved to S10:** S8 changes no setup; S10 signs setups in again.
 - **The setups' contract has leftovers** (S7): `Bootstrap.firstStart`'s `stack` is
@@ -548,2 +580,3 @@ password, which are S3c's (and listed again below).
   `mediaplane.credentials/v1` has it, but say it is for later slices.
+  - **Moved to S10,** with the setups, for the same reason.
 - **The fake Seerr's `/auth/me` answers a session that isn't its admin's** with the
@@ -551,2 +584,3 @@ password, which are S3c's (and listed again below).
   yet. Fix the fake when signing Seerr in again reads sessions.
+  - **Moved to S10,** with signing Seerr in again.
 
@@ -554,2 +588,4 @@ password, which are S3c's (and listed again below).
   match them exactly.
+  - **Done in S8:** `plan` refuses a key that names no managed field, with the closest
+    name, whatever its case.
 - **A root folder whose path changes.** Sonarr and Radarr can't move a root folder, so a
@@ -557,2 +593,5 @@ password, which are S3c's (and listed again below).
   library (S3c). Decide what drift and Keep mine do with the old one.
+  - **Done in S8:** a root folder's path is fixed: an override or Keep mine of it is
+    refused, saying to move the library in the arr, then make the root folder
+    `unmanaged`.
 - **A root folder whose folder was deleted.** Mediaplane makes a root folder's folder
@@ -562,2 +601,4 @@ password, which are S3c's (and listed again below).
   `apply` makes the folder again.
+  - **Done in S8:** the new managed field `accessible`: drift reports it, and `apply`
+    makes the folder again.
 - **qBittorrent's sign-in ban.** qBittorrent bans an address from signing in for an hour
@@ -568,2 +609,4 @@ password, which are S3c's (and listed again below).
   the password less often, or not at all while it differs.
+  - **Done in S8,** as the owner decided: once drift finds the password refused,
+    neither drift nor `plan` signs in again until `apply` sets it.
 - **`plan` can make a post-import category in qBittorrent.** The arr's own test, which
@@ -575,2 +618,6 @@ password, which are S3c's (and listed again below).
   test while that category is missing.
+  - **Done in S8,** as the owner decided, and for the client's own category too, once
+    qBittorrent's is no longer managed and deleted: `plan` and drift leave the key
+    unchecked while qBittorrent lacks one, and say what clears it. A category the client
+    is kept with is qBittorrent's to have, so `apply` makes it.
 - **Settings Mediaplane manages in qBittorrent are put back.** A whitelist, a save path
@@ -578,4 +625,10 @@ password, which are S3c's (and listed again below).
   (S3c). Keep mine must cover them, with the arrs' download clients and root folders.
+  - **Done in S8:** drift reports each, and `mediaplane keep` keeps a whitelist, a save
+    path, a category's path, and a download client's category, which qBittorrent's
+    category then follows. A root folder's fields are fixed: one deleted is kept as
+    `unmanaged`. A download client's host, port and TLS are fixed too: they say where its
+    key goes.
 - **Appdata ownership is checked only on change.** Apply checks it only when
   something else changes, and never re-checks it for apps that are running.
+  - **Moved to M2 (`doctor`):** it is the host's state, not a change in an app.
 - **An override can move an appdata mount.** When `compose.override.yaml`
@@ -585,2 +638,3 @@ password, which are S3c's (and listed again below).
   it.
+  - **Moved to M2 (`doctor`),** for the same reason.
 - **Installs from before Slice 3a.** `plan` reports a `config.xml` without `ApiKey`,
@@ -590,2 +644,3 @@ password, which are S3c's (and listed again below).
   the key at the source", spec §6.3).
+  - **Moved to S10 on 2026-10-25,** with restoring a key at its source.
 - **FlareSolverr's anonymous volume.** Its image declares `VOLUME /config`, and the
@@ -594,4 +649,7 @@ password, which are S3c's (and listed again below).
   remove them with `down -v` since S3a.)
+  - **Moved to S9:** each recreate leaves one, and recreates come with updates. Mounting
+    a folder there needs the image's user probed first.
 - **Rotating the admin password.** There is no way to replace the generated password
   yet. Add one, which reaches every app through its API.
+  - **Moved to S10 on 2026-10-25.**
 - **A wiring network whose settings change.** Compose must make it anew then, and
@@ -599,2 +657,3 @@ password, which are S3c's (and listed again below).
   gives the steps by hand. Decide whether Mediaplane should do them.
+  - **Moved to S9:** its settings change only with Mediaplane's own updates.
 - **The `partial` outcome.** Spec §5 step 12 names `success`, `partial` and `failed`.
@@ -602,2 +661,4 @@ password, which are S3c's (and listed again below).
   re-apply needs `partial`.
+  - **Decided in S8:** not needed. Re-apply is `apply`, and `failed`, with each
+    resource's result, says what is left; `partial` stays unused.
 - **Links to an app that leaves the stack.** Remove Sonarr or Radarr from `stack.yaml`,
@@ -608,2 +669,5 @@ password, which are S3c's (and listed again below).
   whether `apply` removes what it made, or drift reports it.
+  - **Done in S8:** drift reports each as still in the app, and `mediaplane keep
+    <app>.<resource>` stops it. **Moved to S10:** removing them, which needs a delete
+    for every kind of resource, and its own end-to-end test (spec §8.1(3) step 4).
 - **Settings Mediaplane manages in Prowlarr are put back.** A link's addresses, sync
@@ -611,2 +675,5 @@ password, which are S3c's (and listed again below).
   UI, are undone by the next `apply` (S4). Keep mine must cover them.
+  - **Done in S8:** Keep mine covers the sync level, categories, the proxy's timeout and
+    tags. The links' addresses and the proxy's host are fixed: they say where a key, or
+    your indexers' requests, go.
 - **Mediaplane never tests the indexer proxy.** It holds no secret, so `plan` sends no
@@ -617,2 +684,4 @@ password, which are S3c's (and listed again below).
     could read `GET /api/v1/health` instead of running a test.
+  - **Done in S8:** Prowlarr's own health check does test it, every six hours (probed):
+    drift reads it, and never tests the proxy.
 - **`plan`'s key checks can record a failing status in the app; drift runs them on a
@@ -626,2 +695,5 @@ password, which are S3c's (and listed again below).
     to that arr and raise a health warning. S4's probe saw only escalation 1.
+  - **Done in S8:** probed: escalation stays at 1, and once the first failure is five
+    minutes old, each failing test disables the client for a minute. Drift and `plan`
+    test no more a secret drift found refused, as the owner decided.
 - **The shared provider schema doesn't check `enable` is a boolean** (S4). A download
@@ -630,2 +702,3 @@ password, which are S3c's (and listed again below).
   for every managed field.
+  - **Done in S8:** a field of another type is reported as one Mediaplane can't read.
 - **Categories or tags in an unexpected shape read as empty** (S4, as S3c's code), so
@@ -633,2 +706,3 @@ password, which are S3c's (and listed again below).
   can't read.
+  - **Done in S8:** reported as a value Mediaplane can't read, never as empty.
 - **Jellyfin's key, deleted by hand,** shuts Mediaplane out of Jellyfin (S5): `plan`
@@ -638,2 +712,4 @@ password, which are S3c's (and listed again below).
   take it.
+  - **Moved to S10 on 2026-10-25,** with key recovery. Drift reports it, as Jellyfin
+    refusing its key.
 - **Checking Jellyfin's admin password signs in** (S5), and Jellyfin's activity log keeps
@@ -641,2 +717,4 @@ password, which are S3c's (and listed again below).
   Decide whether drift checks it less often.
+  - **Done in S8,** as the owner decided: drift checks it once a day at most, while it
+    passes.
 - **Jellyfin's libraries are known by name** (S5). A library renamed by hand is left
@@ -645,2 +723,4 @@ password, which are S3c's (and listed again below).
   added to them by hand is put back: Keep mine must cover `paths`.
+  - **Done in S8:** a renamed one is reported deleted; `apply` refuses to make it again
+    on the folder the renamed one holds, saying what to do; `paths` can be kept.
 - **The triggers of an arr's connection to Jellyfin are the user's** after it is made
@@ -648,2 +728,4 @@ password, which are S3c's (and listed again below).
   and tells Jellyfin of nothing. Decide whether drift reports it.
+  - **Decided in S8:** not reported: they are yours (spec §6.2), and reporting them would
+    be managing them.
 - **A Jellyfin whose appdata Mediaplane can't read** (S5) is taken as set up when its key
@@ -651,2 +733,4 @@ password, which are S3c's (and listed again below).
   (`bootstrap.unreadable`). Decide whether drift should also report it.
+  - **Decided in S8:** drift runs `plan`'s checks of the setups, so it warns
+    (`bootstrap.unreadable`) as `plan` does.
 - **A failed first-run setup stops all wiring** (S5): the bootstrap step's failure skips
@@ -656,2 +740,3 @@ password, which are S3c's (and listed again below).
   app's resources are skipped; a failed one still stops the wiring.
+  - **Moved to S10:** it changes apply's steps, not drift.
 - **Seerr's checks log a line when they fail** (S6, probed): Seerr's own test of a
@@ -660,2 +745,4 @@ password, which are S3c's (and listed again below).
   run them.
+  - **Done in S8:** probed again, one line each, with no throttling; drift checks no
+    more a secret it found refused.
 - **Seerr's Jellyfin key is checked twice in one `apply`** (S6): once as the
@@ -663,2 +750,4 @@ password, which are S3c's (and listed again below).
   writes a second error line in Seerr's log. Check it once, with the item above.
+  - **Done in S8,** as the owner decided: the update is told the key was refused, and
+    doesn't check it again.
 - **Seerr keeps its own Jellyfin key** (S6): the one its first sign-in made, named
@@ -668,2 +757,4 @@ password, which are S3c's (and listed again below).
   whether drift should replace it, and remove the one Seerr made.
+  - **Decided in S8:** drift never writes to an app. Replacing it is rotation: moved to
+    S10.
 - **A Seerr whose `settings.json` Mediaplane can't read** is set up again, unpublished,
@@ -672,2 +763,4 @@ password, which are S3c's (and listed again below).
   it, or asks Seerr over the wiring network instead.
+  - **Decided in S8:** drift warns as `plan` does. Asking Seerr over the wiring network
+    instead changes its setup: moved to S10.
 - **Seerr's libraries are enabled by name, from Seerr's last sync** (S6). A library made
@@ -675,2 +768,4 @@ password, which are S3c's (and listed again below).
   only when the libraries differ. Decide whether drift syncs them, which writes to Seerr.
+  - **Decided in S8:** drift doesn't sync them, which would write to Seerr; `apply` syncs
+    them when the libraries differ, or Jellyfin moves.
 - **Seerr's servers are its default** (S6): making `Sonarr (Mediaplane)` the default
@@ -678,2 +773,4 @@ password, which are S3c's (and listed again below).
   Keep mine must cover the servers' fields, and Seerr's libraries.
+  - **Done in S8:** Keep mine covers the servers' profile, folder and `isDefault`, and
+    Seerr's libraries. Their host and port are fixed: they say where a key goes.
 - **A folder with a comma in its name, added by hand to a Jellyfin library** (S5), is
@@ -682,2 +779,4 @@ password, which are S3c's (and listed again below).
   `Locations` in `update`, with Keep mine's change to how `paths` is held.
+  - **Done in S8:** the update reads Jellyfin's folders whole; drift reports such a
+    folder as one it can't list, and Keep mine refuses it.
 
@@ -796,2 +895,8 @@ password, which are S3c's (and listed again below).
 
+- **From S8, for `doctor`:** appdata ownership, checked only when something else changes,
+  and an override that moves an appdata mount, which leaves the pre-start files where the
+  app doesn't look. Both are the host's state, not a change in an app.
+- **Drift on a schedule** (spec §6.3): `drift` takes apply's lock and checks no more than
+  it must (S8), so a schedule can call it as it is.
+
 - **A `network.lan_subnet` that covers the stack's Docker networks.** With
```

- [ ] **Step 6: Check the docs rules, and commit**

```bash
grep -rnE 'Slice 8 (does|adds|automates|decides|restores)|comes in Slice 8|\(Slice 8( adds|\))|\*\*Slice 8:\*\*|S8 \(drift detection\)' README.md catalog/*/README.md deploy/README.md docs/architecture.md docs/security docs/runbooks docs/design
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add README.md catalog deploy/README.md docs
git commit -m "docs: drift and Keep mine in the drift reported runbook, ADR 0003, the architecture, the threat model, the READMEs, the spec and the roadmap" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `grep` prints nothing. The check passes (2080 tests pass in 93 files). Every
`text` block in the changed docs is at most 40 columns wide.

## Slice 8 completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements. When this
  plan was replayed: 98.31% statements, 93.01% branches, 98.43% functions and 99.43% lines, with 2080 tests in 93 files.
- [ ] `pnpm test:e2e` passes with Compose 2.38.2 as the host plugin too, and leaves no
  `mediaplane-e2e-*` container or network, no new volume, and no `mediaplane-e2e-*`
  folder. When this plan was replayed, alone on the dev box, warm, without the plex.tv
  token (so the nightly test was skipped):
  - with Compose 5.5.1, 27 tests passed and 1 skipped in 11 files, in 14 min 47 s;
  - with Compose 2.38.2, 27 passed and 1 skipped, in 15 min 26 s.

  CI's e2e job allows 60 minutes, so `ci.yml` keeps its timeout.
- [ ] Success criterion 4 holds on the real apps: the drift end-to-end test sees `drift`
  report each change made through an app's API with what `apply` sets and what the app
  holds, `apply` put each back, `keep` record three of them, `apply` make the kept
  category in qBittorrent, `drift` clear, and the next `apply` change nothing
  (criterion 3).
- [ ] Drift writes to no app: its unit tests send no write to the fakes but the checks'
  own, the CLI test sees one qBittorrent sign-in and one Jellyfin sign-in over six
  `drift`s, and the download client's test isn't sent while qBittorrent lacks a category
  it names, or can't be asked. Its one write is `checks` in `state/resources.json`.
- [ ] Keys go only to the stack's own addresses: `catalog.test.ts` refuses an override of
  each field that says where a key goes, and each key-carrying resource's tests send its
  key to the stack's address whatever an override or the app holds (ruling B1).
- [ ] No secret shows: the tests that check it pass (drift's and keep's output and JSON,
  `state/resources.json`, `stack.yaml`, the restoring `apply`'s result); an app's value
  holding a secret is shown with `***` and refused by `keep`, and `unreadable` is
  redacted too.
- [ ] `keep` keeps `stack.yaml` as it was but for its line: the writer's tests on the spec's
  own example (comments lined up after values), `init`'s starter, CRLF line ends, a file
  without a last line end, flow and block `overrides:`, and the end-to-end test's file
  with comments; it keeps the file's mode and group; and it refuses a link, a file with
  other names, one of another user or another group, a `{ … }` file and
  `managed_by: external`, giving the line to add.
- [ ] The socket proxy's allow-list is unchanged: `git diff 3439f9d --
  deploy/mediaplane.compose.yaml deploy/deploy.test.ts` prints nothing (decision 24).
  `3439f9d` is `main` before this slice.
- [ ] No committed file contains a real path, user name, host name, address or token:
  `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing but the
  project's own names (its GitHub repo and schema URL, its GHCR image, the nightly job's
  repository guard) and the tests' fake `/srv/data/home` paths.
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B 3439f9d.. | grep -c Claude-Session` prints
  `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - the (check) decisions, for the controller and the owner to confirm or reverse, in
    particular 1 (drift needs a record, and a value the stack now wants isn't drift), 2
    (`drift`'s exit code 2 for anything it couldn't check), 3 (`checks` in
    `state/resources.json`, drift's one write), 4 (`plan` too takes a secret drift found
    refused as refused), 6 (the owner's post-import decision widened to the client's own
    category), 7 (a kept category is qBittorrent's to have), 9 and 10 (fixed fields, and
    keys only to the stack's own addresses), 13 (keep's textual insertion, its refusals,
    and what it asks), 14 (shared keys reported, repaired in S10), 17 (Prowlarr's health
    read, as a warning) and 23 (the end-to-end test);
  - for the owner: after upgrading, the first `plan` shows each root folder as `adopt`,
    changing nothing (decision 11); keeping a download client's category makes `plan`
    show qBittorrent's category to make, and drift waits for it (decision 7); a
    `stack.yaml` written as one `{ … }` block, or with a key written `? key`, can't be
    written by `keep`, which gives the line to add.
