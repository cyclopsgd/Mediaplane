# M1 Slice 10a: recovery — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a host can be rebuilt from `stack.yaml` and its appdata (the roadmap's S10, its
recovery half). After a lost `state/` and `generated/`, or a new host with the files put
back, `plan` recovers every key the apps still hold from their own appdata, before
anything is generated, and `apply` saves them, finds everything Mediaplane made in the
apps by its name, and sets a new admin password through the apps' keys when the generated
one went with the store. A second `apply` changes nothing. A key changed at its source is
put back by `apply`, in the app's own file, or kept with `mediaplane keep <app>.<key>`,
which the next `apply` gives to every resource that holds the old one. Jellyfin's key,
deleted by hand, is made again. A first-run setup that fails no longer stops the wiring.
The generated admin password can be rotated (`--rotate admin.password`).

**Architecture:**

- **Key recovery** (spec §6.1): each app says where it keeps its keys in its appdata
  (`keyFiles` in the catalog): a text file read with a pure reader, or, for Jellyfin, a
  SQLite database queried read-only with Node's own `node:sqlite`. `plan` reads every key
  `state/secrets.json` lacks from there, into the store it plans with
  (`secrets.recover`), and apply's keys step saves them. A key file it can't read stops
  `plan` rather than have a new key generated.
- **A key put back at its source** (spec §6.3, "Re-apply"): a text key file may also say
  how to write its key back (`write`). `plan` lists each key whose app's own file holds
  another, or none (`secrets.restore`), and the app as `restart`; apply's start step
  stops the app, writes the file as Keep mine writes `stack.yaml`, and `up` starts it.
- **Keep mine of a key** (spec §6.3): `mediaplane keep <app>.<key>` takes the key the
  app's own file holds into `state/secrets.json`, once the app is shown to refuse
  Mediaplane's and take that one, and names the resources that hold the old one.
- **Setups:** an app that refuses the key its setup made has its setup run again,
  published (Jellyfin's key deleted by hand); the wire step runs past a setup that
  failed; a setup gets only the keys you give.
- **The admin password:** `--rotate admin.password` on `plan` and `apply`, and a secret
  apply is to generate is taken as a change, never signed in with.
- **Tests:** unit tests on the fakes and on real SQLite and text files; an end-to-end test
  of a rebuilt host on real Docker; the deploy test recovers every key from inside the
  image; the Jellyfin test makes its key again without a hand edit.

**Tech Stack:** as Slice 9 (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2), and `node:sqlite`, which Node 24
bundles. No new dependency and no new image.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §2.3 (the success criteria: M1 is done when all hold; criterion 3, a second `apply`
  changes nothing);
- §4.1 (the home: what is the user's, what is Mediaplane's), §4.2 (externally managed
  mode, which a key's Keep mine respects);
- §5 (the apply flow: step 4, keys "generated or recovered"), §5.1 (converge forward,
  `skipped`), §5.2 (`plan`, `apply`, `keep`);
- §6.1 ("Key recovery"), §6.2 (what Mediaplane makes, by name), §6.3 (the drift model's
  last row, "a shared key changed at its source", and "Identity is the app-assigned ID…
  adopted rather than duplicated"), §6.4;
- §7 (security: §7.2(2), no new proxy permission; §7.2(4), secrets), §9 (the docs set),
  §10 ("Lost `state/`"), §11 (every slice's refinements, Slice 9's included).

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S10 row and its list, every
S8 item marked "Moved to S10", "S9 and S10 (before going public)", and "After M1".

### S10 in two parts (decision 1)

S10, as the roadmap lists it, is about 16 tasks: too large for one plan. It splits along
what each half changes:

- **S10a, recovery (this plan):** what Mediaplane holds on a host, its keys and the
  setups that make or use them, so that a host is rebuilt from its files.
  - Key recovery from appdata, Jellyfin's from its database.
  - Name-based re-adoption, proven on a rebuilt host.
  - A key restored at its source, installs from before S3a included.
  - Keep mine of a key, given to every holder by the next `apply`.
  - Jellyfin's key made again when deleted by hand.
  - A failed first-run setup no longer stopping the wiring.
  - The setups' keys narrowed, and their contract leftovers.
  - Rotating the admin password, and setting a new one after a lost store.
  - The "rebuilding a host" runbook.
  - Success criterion: on real Docker, a host loses its containers, networks, `state/`
    and `generated/`; `apply` recovers every key, adopts every resource by name, sets a
    new admin password, and a second `apply` changes nothing.
- **S10b, automation (the next plan):** what the stack and its users see from outside.
  - Removing what Mediaplane made when its app leaves the stack (spec §8.1(3) step 4).
  - The Plex token's rotation: the arrs moved to a new one, and Seerr signed in again
    with it (with the fake Seerr's `/auth/me`); a Plex unclaimed while it runs claimed
    again; Seerr's own Jellyfin key replaced; Seerr asked rather than its `settings.json`
    read.
  - Externally managed mode finished, with `keep`'s line to add in `mediaplane.keep/v1`.
  - The `--json` contract pinned and in the generated docs; exit codes; commands that
    ask nothing when a script runs them; a second `apply` that changes nothing.
  - `plan --help` and `drift --help` pointing at the published docs.
  - The "deploying with automation" guide with a short Ansible example, the full README
    and the add-an-app guide.
  - The test gaps, S9's review items, and which Compose versions work out a service
    differently.
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
- Every block was applied in order to a fresh worktree at `16d1b08`, and each task's tests
  failed before its implementation and passed after it (see the completion checklist).

## Global Constraints

Everything in the Slice 1 to 9 Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md` to `docs/plans/m1-s9-releases.md`):

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
- the integration contract (S3b to S8) and bootstrap before publish (S5 to S7) are
  unchanged but as decisions 10 to 12 say; keys go only to the stack's own addresses;
- never push, tag, release, or publish anything; never change the repository's settings.

The spec's exact values for this slice, verbatim:

- §6.1: "**Key recovery.** Sometimes `state/secrets.json` is missing while `appdata/`
  still exists, for example after a reinstall or lost state. In that case Mediaplane
  recovers the existing keys from the apps' own config before generating anything:
  `ApiKey` from `config.xml`; `WebUI\APIKey` from `qBittorrent.conf`; `main.apiKey` from
  Seerr's `settings.json`. New credentials are generated only for apps with no
  recoverable key. If a credential cannot be recovered, for example the Jellyfin admin
  password, `plan` reports it with a pointer to the recovery runbook."
- §6.3, the table's last row: "A shared key changed at its source (e.g. qBittorrent's API
  key regenerated) | The source of a key that other apps consume has moved | `drift`, on
  the source and on each consumer | Keep mine reads the new key and propagates it to every
  consumer. Re-apply restores the old key at the source (for qBittorrent: stop, rewrite
  `qBittorrent.conf`, start)".
- §6.3, the rules: "**Identity is the app-assigned ID** recorded in `resources.json`. If
  the ID is unknown, for example after lost state, a resource with the exact
  Mediaplane-assigned name is adopted rather than duplicated."; "**Drift never writes to
  an app.** Only `apply` does."
- §5 step 4: "**Keys.** Generate or recover every credential that can be chosen in
  advance, and persist it *before* any container starts."
- §5.1: "When an action fails, the independent actions still run and the dependent ones
  are marked `skipped`."
- §10: "Lost `state/` | Key recovery from appdata, plus name-based re-adoption (§6.1,
  §6.3)".
- §2.3, criterion 3: "**Idempotent.** A second `apply` reports `No changes`, exits 0 and
  modifies nothing."

These are added or restated for this slice:

- **Secrets never appear** in output, `--json`, errors, change records,
  `state/resources.json`, logs, a command line, or end-to-end failure messages: a key
  recovered from appdata, or kept, is a secret of the run from the moment it is read.
  `state/resources.json` holds names and verdicts only. End-to-end checks compare keys as
  yes or no, never print one.
- **Recovery reads only files in the home,** never through a link that leads out of the
  app's own appdata folder, and writes nothing beside what it reads: a SQLite database is
  opened read-only, or immutable when it is closed. A key is put back only into the app's
  own file, while the app is stopped, never through a link, over a file with other names,
  or of another user or group.
- **Fail closed:** a key file that is there but can't be read, or holds a key Mediaplane
  can't keep, never becomes "no key": `plan` stops. An app that can't say whether it takes
  a key never becomes "it does": `keep` keeps nothing.
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
(Sonarr 4.0.20, Radarr, Prowlarr, qBittorrent 5.2.4, Jellyfin 12.2, Seerr 3.5.0), in
`mediaplane-e2e-probe*` projects of its own, from source at `16d1b08` and then with this
plan's code:

1. **Where each key is, and who can read it.** After an `apply` of the Jellyfin stack:
   Sonarr's `config.xml` holds `<ApiKey>`, mode 0600 (Mediaplane writes it so, and Sonarr
   keeps the mode when it rewrites it), owned by the stack's user; `qBittorrent.conf`
   holds `WebUI\APIKey=`, 0644; Seerr's `settings.json` holds `main.apiKey`, 0644, owned
   by uid 1000; Gluetun's `auth/config.toml` is Mediaplane's own, 0600. Jellyfin keeps its
   keys in `data/data/jellyfin.db`, table `ApiKeys` (`Id`, `DateCreated`,
   `DateLastActivity`, `Name`, `AccessToken`), in WAL mode, 0644. Mediaplane's user reads
   each when it is the stack's user; another user reads all but the 0600 files.
2. **Reading Jellyfin's database while it runs.** `node:sqlite` (`DatabaseSync`,
   `readOnly`) reads `ApiKeys` while Jellyfin runs, with its `-wal` and `-shm` beside it,
   and sees a key deleted through Jellyfin's API at once. A copy owned by another uid,
   0644, reads too. A database closed cleanly, with no `-wal` or `-shm`, is read too, but
   a read-only open then **makes `-wal` and `-shm`, as Mediaplane's user, and leaves
   them**; an `immutable=1` open makes nothing, and misses only what a live log holds
   (decision 3).
3. **What each app does with its key.** Sonarr (and so Radarr and Prowlarr) take the key
   in their environment at every start, whatever `config.xml` says: with another key in
   the file, the environment's works and the file's is refused; a `PUT` of another key in
   the host settings changes neither; a `config.xml` without `ApiKey` stays so (the
   environment's key isn't written there). qBittorrent: its web UI's `rotateAPIKey`
   (`POST /api/v2/app/rotateAPIKey`, with a session; the key alone gets 403) makes a new
   key, writes it into `qBittorrent.conf` at once, and refuses the old one (403); stopped,
   with the old key written back into its file, and started, it takes the old one again.
   Seerr, with `API_KEY` set: `POST /api/v1/settings/main/regenerate` answers 200 with the
   same key, and `settings.json` keeps it (correcting Slice 6's note that a key made anew
   in its web UI lasts until a restart). Jellyfin: a key deleted with
   `DELETE /Auth/Keys/<key>` is refused at once (401).
4. **Re-adoption by name of every kind of resource.** With `state/resources.json` gone,
   `plan` adopts each of the 23 resources of the Jellyfin stack (Sonarr's, Radarr's,
   Prowlarr's, qBittorrent's, Jellyfin's and Seerr's), and `apply` records each with the
   same id.
5. **A rebuild, end to end, with this plan's code.** The stack down (containers, networks,
   anonymous volumes), `state/` and `generated/` removed: `plan` lists the six keys to
   recover and the admin password to generate, and Seerr's setup; `apply` saves the keys,
   updates the password of the five admins through their keys, adopts the rest, signs
   Seerr in to nothing (it checks Seerr with its key), and verifies; a second `apply` says
   `No changes.`; `drift` is clear. Then qBittorrent's key rotated in its web UI:
   `apply` puts it back, restarting qBittorrent; rotated again, `keep qbittorrent.apiKey`
   keeps it, and the next `apply` gives it to both arrs' download clients. And Jellyfin's
   key deleted by hand: `plan` lists its setup, published, and `apply` makes another and
   gives it to the arrs' connections.

plex.tv was not probed: no decision rests on a new plex.tv behaviour (decision 15).

## Decisions taken in this plan

Each task names the decisions it applies. The ones to look at first are marked
**(check)**.

1. **(check) S10 ships in two parts,** S10a (recovery) and S10b (automation), as "S10 in
   two parts" says above. The cut is by what each changes: S10a only what Mediaplane holds
   on a host (its keys, and the setups that make or use them), proven by a rebuilt host;
   S10b what the stack and its users see from outside, proven by a playbook. Removing what
   Mediaplane made when its app leaves the stack goes to S10b: it changes what the stack
   holds, needs a delete for every kind of resource, and has its own end-to-end step
   (spec §8.1(3) step 4); no part of a rebuild needs it. The Plex token's rotation goes to
   S10b too: it rotates a secret you give, needs real plex.tv probes, and only the
   nightly job can test it end to end. Each part is about eight tasks.
2. **Keys are recovered from the apps' own files, before anything is generated** (spec
   §6.1, §5 step 4), wherever the store is read: `plan`, `apply`, `drift` and `keep` all
   plan with the store and what they recover. `plan` lists them (`secrets.recover`, an
   additive field within `mediaplane.plan/v1`) and is changed; apply's keys step saves
   them with what it generates (`recover`, optional within `mediaplane.change/v1`). Each
   app declares its files in the catalog (`keyFiles`): the three the spec lists, and two
   more it couldn't: Gluetun's control key in its `auth/config.toml` (Mediaplane's role
   only), from Slice 3a, and Jellyfin's key (decision 3).
3. **(check) Jellyfin's key is read from its database,** the newest key named
   `Mediaplane`, as its setup picks one. §6.1 lists no source for it, because Jellyfin
   makes it; without it, a rebuild must sign in to Jellyfin, which needs the admin
   password, which a lost store takes with it when it was generated. The database is read
   with `node:sqlite`, which Node 24 bundles (no dependency), never written: opened
   read-only when its `-wal` and `-shm` are there (Jellyfin running), and immutable when
   they aren't (closed cleanly), since a read-only open would make both (probe 2). A
   database that can't give the key leaves Jellyfin's setup to find it by signing in; a
   warning says so only when the admin password is to be generated too.
4. **Fail closed** (spec §5.1's spirit, and the brief): a key file that is there but can't
   be read, or holds a key the store can't keep (`^[A-Za-z0-9_]+$`), stops `plan` with
   `keys.unrecoverable`, rather than have a key generated that would lock Mediaplane out
   of an app still holding the old one. A key file whose real path leads out of the app's
   own appdata folder is never read: a compromised app could otherwise plant a link to
   another app's file and have Mediaplane send that app's key to it.
5. **(check) A generated admin password lost with the store is set anew through the
   keys.** The apps keep only a hash, so it can't be recovered (§6.1). When keys were
   recovered and the password is to be generated, `plan` warns
   (`secrets.admin-password-lost`, with the runbook), and `apply` generates one and sets
   it in each app through its recovered key: Sonarr, Radarr, Prowlarr and qBittorrent as
   their `admin` resource's update, Jellyfin through `jellyfin.admin` with its recovered
   key. That goes beyond §6.1's "reports it", which would leave the stack unwired: the
   spec's intent is a rebuilt host. A password of your own (`admin.password: { file }`)
   is unchanged.
6. **Re-adoption by name needs no new code.** Slice 3b's `adopt` finds each resource by
   the name Mediaplane gave it (probe 4); this slice proves it on a rebuilt host, ids
   kept (Task 6). Seerr's and Plex's setup records go with the store, and their setups
   check them again, as Slices 6 and 7 built them.
7. **(check) Re-apply puts a key back at its source** (spec §6.3). A text key file may
   say how to write its key back (`write`): the arrs' `config.xml`, qBittorrent's
   `qBittorrent.conf`, and Gluetun's Mediaplane role, written whole. `plan` lists each key
   whose app's own file holds another, or none (`secrets.restore`, additive), compared
   with the store's (or the one apply generates), never with what the app answers, and
   marks the app `restart`. Apply's start step stops it (or a running one up would
   recreate), writes the file through Keep mine's safe read (no link, no other names, the
   file's own user and group, its mode kept, replaced only if it is still the file read),
   and runs `up` whatever the write did, so no app is left stopped; a failed write then
   fails the step. Seerr and the arrs take their key from their environment, which their
   web UIs can't change (probe 3), so their files are put right only after a hand edit,
   or from before Slice 3a. A file Mediaplane can't write so is `keys.restore`: a warning
   for one with another key, an error for one with none.
8. **Installs from before Slice 3a are put right by decision 7** (spec §11, Slice 3a: "Slice
   10 automates the fix"). Their file lacks the key, so it is a key to put back: the
   app's other settings in the file stay. `<app>.not-seeded` is left only for a pre-start
   file whose app has no key file that can be written (none in the catalog).
9. **A guest restarts with its host.** `strandedGuests` takes a host's `restart` as it
   takes its `start`: qBittorrent, in Gluetun's network, restarts when Gluetun's key is put
   back.
10. **(check) Keep mine of a key is `mediaplane keep <app>.<key>`** (spec §6.3's last row).
    It runs a `plan` that asks only that app, with the key Mediaplane holds; only if the
    app refuses it, reads the key from the app's own file, asks the app with it, and only
    if the app takes it, keeps it in `state/secrets.json`, takes the app's refusal out of
    `state/resources.json`, and names every resource the stack wants that holds the old
    one (`holders`, optional within `mediaplane.keep/v1`). "Propagates it to every
    consumer" is the next `apply`'s: those resources' own checks refuse the old key, and
    `apply` updates them. Keep writes to no app (§6.3: "Only `apply` does"), and writes no
    `stack.yaml`, so `managed_by: external` doesn't stop it. An app Mediaplane can't ask
    with the key (Gluetun) can't have it kept. An app that can't say (a timeout, a 5xx)
    keeps nothing.
11. **Jellyfin's key, refused while its setup is done, is made again** (the S8 item moved
    here). After the wiring is planned, an app whose setup made its key (`Bootstrap.secret`
    is its API's key) and refuses it, with appdata saying the setup is done, is listed
    under `First-run setup:`, published. Apply's bootstrap step signs in as the shared
    admin, takes the newest key named `Mediaplane` or makes one, and saves it; the arrs'
    connections take it in the wire step. A setup whose appdata can't be read is not run:
    it can't be told whether the setup is open.
12. **A failed first-run setup no longer stops the wiring** (spec §5.1; the S8 item moved
    here). `bootstrapApps` returns the setups that failed (`failed`) rather than throw;
    apply's bootstrap step still fails, with the same message (`setupFailure`), and the
    wire step runs past it, skipping that app's resources and what requires them
    (`<app>'s first-run setup failed`); verify is skipped. A failure to reach the apps, or
    to publish them, still stops the wiring.
13. **The setups' contract** (the S7 items moved here). A setup gets only the keys you give
    that an app's API takes (`BootstrapContext.given`, from `givenKeys`): your Plex token.
    `Bootstrap.firstStart` loses its unused `stack`. `AppLoginKind`'s own login is
    `{ own: 'Plex' }`. `{ comingIn }` stays, documented for the apps to come, as
    `mediaplane.credentials/v1` keeps `not-yet`.
14. **(check) Rotating the admin password is `--rotate admin.password`** on `plan` and
    `apply` (the S8 item moved here): the store plans without it, so it is generated anew
    and set in each app through its key, as after a lost store. Only `admin.password` is
    taken (`ROTATABLE`); one of your own is refused (`rotate.yours`): change its file.
    Verify plans again without rotating.
15. **A secret apply generates is never checked** (in the spirit of the owner's decisions
    of 2026-10-17 on marks): no app holds it yet, so `plan` takes it as a change
    (`fresh`), unchecked, rather than sign in with it: no failed sign-in counts towards
    qBittorrent's ban, nor goes into Jellyfin's activity log.
16. **Plex on a rebuilt host is Slice 7's,** and S10a changes nothing of it: Plex's key is
    your token, nothing is recovered for it, and its and Seerr's setups, their records
    gone, ask plex.tv whose account they are, as built. That is unit-tested (Slice 7); no
    end-to-end test rebuilds a Plex host, since only the nightly job reaches a real
    plex.tv account. The docs say so.
17. **No new Docker API call.** Recovery reads files in the home; a key put back is a file
    written there between `compose stop` and `up`, which apply already makes (§7.2(2)).
18. **The proof** (Task 6): one end-to-end file, the Jellyfin stack from source, a host
    lost and rebuilt, then qBittorrent's key put back and kept; the deploy test recovers
    every key from inside the image, as Mediaplane's user, with `node:sqlite` in its
    bundle (Task 1); the Jellyfin test makes its key again without a hand edit (Task 4).

## File structure (new and changed in this slice)

- `packages/engine/src/secrets/recover.ts` (new): reading a key file, `recoverKeys`,
  `withRecoveredKeys`, `REBUILD_RUNBOOK`.
- `packages/engine/src/secrets/restore.ts` (new): `planKeyRestores`, `restoreKeys`,
  `restorableKeyFiles`.
- `packages/engine/src/catalog/types.ts`: `KeyFile` and `AppDefinition.keyFiles`; the
  setups' `BootstrapContext.given`, `firstStart(ctx)`, `AppLoginKind`.
- `packages/engine/src/plan/plan.ts`: recovery, restores, setups to make keys again,
  `rotate`, `fresh`; `secrets.recover` and `secrets.restore`.
- `packages/engine/src/plan/prestart.ts`, `plan/stranded.ts`, `plan/bootstrap.ts`: a file
  whose key is put back, a host's restart, `setupsToMakeKeys`.
- `packages/engine/src/apply/apply.ts`, `apply/bootstrap.ts`: saving recovered keys, the
  start step's restores, the wiring past a failed setup, `setupFailure`.
- `packages/engine/src/integrations/wire.ts`, `integrations/wiring.ts`: skipping a failed
  setup's app; `fresh`.
- `packages/engine/src/keep.ts`: keeping an app's own key.
- `packages/engine/src/secrets/values.ts`, `secrets/store.ts`, `history/records.ts`,
  `runbooks.ts`, `vpn/check.ts`, `index.ts`: `givenKeys`, `APP_SECRET`, the records'
  fields, the new runbook, vpn-check's hint, the export.
- `catalog/_shared/servarr.ts`, `catalog/{gluetun,jellyfin,qbittorrent,seerr}/…`,
  `catalog/{sonarr,radarr,prowlarr}/app.ts`: each app's key files; Plex's and Seerr's
  setups read `given`.
- `packages/cli/src/run.ts`, `output.ts`: `--rotate`, the plan's and history's new lines,
  `keep`'s output for a key, the drift advice.
- `catalog/keys.test.ts`, `packages/engine/src/secrets/{recover,restore}.test.ts` (new),
  and the tests beside each changed file.
- `test/e2e/rebuild.e2e.test.ts` (new), `test/e2e/deploy.e2e.test.ts`,
  `test/e2e/jellyfin.e2e.test.ts`.
- Docs: `docs/runbooks/rebuilding-a-host.md` (new), the other runbooks, the apps'
  READMEs, `docs/architecture.md`, `docs/security/threat-model.md`, ADR 0003,
  `README.md`, `deploy/README.md`, the spec and the roadmap; `docs/reference/cli.md`
  (generated).


### Task 1: Key recovery: each key a lost store lacks, read back from the apps' appdata

Decisions 2 to 5. Each app declares where it keeps its keys; `plan` reads every key
`state/secrets.json` lacks from there before anything is generated, and apply's keys step
saves them. A generated admin password lost with the store is generated anew, with a
warning. The deploy test's check of an empty key store, from the image, now recovers every
key, Jellyfin's from its database through `node:sqlite` in the image's bundle.

**Files:**
- Create: `packages/engine/src/secrets/recover.ts`, `packages/engine/src/secrets/recover.test.ts`, `catalog/keys.test.ts`
- Modify: `packages/engine/src/catalog/types.ts`, `packages/engine/src/secrets/store.ts`, `packages/engine/src/runbooks.ts`, `packages/engine/src/index.ts`, `packages/engine/src/plan/plan.ts`, `packages/engine/src/apply/apply.ts`, `packages/engine/src/history/records.ts`, `packages/cli/src/output.ts`, `catalog/_shared/servarr.ts`, `catalog/{sonarr,radarr,prowlarr,qbittorrent,gluetun,seerr,jellyfin}/app.ts`, `catalog/qbittorrent/conf.ts`
- Test: `packages/engine/src/plan/plan.test.ts`, `packages/engine/src/apply/apply.test.ts`, `packages/cli/src/output.test.ts`, `test/e2e/deploy.e2e.test.ts`

**Interfaces:**
- **Consumes:** `readSecretStore`, `withGeneratedSecrets`, `adminPasswordToGenerate`, `secretsToGenerate` (unchanged).
- **Produces:**
  - `type KeyFile = { path: string; read(text: string): string | undefined } | { path: string; sqlite: { query: string; column: string } }`, and `AppDefinition.keyFiles?: Readonly<Record<string, KeyFile>>` (by the secret's name).
  - `readKeyFile(home: string, app: string, file: KeyFile): Promise<KeyFound>`, with `type KeyFound = { found: 'absent' } | { found: 'none' } | { found: 'key'; value: string } | { found: 'unreadable'; why: string }`; `keyFilePath(app: string, file: KeyFile): string` (`appdata/<app>/<path>`).
  - `recoverKeys(stack: ResolvedStack, store: SecretStore, newPassword: boolean): Promise<{ recovered: RecoveredKey[]; diagnostics: Diagnostic[] }>`, with `interface RecoveredKey { app: string; name: string; value: string }`; `withRecoveredKeys(store: SecretStore, recovered: readonly RecoveredKey[]): SecretStore`.
  - `REBUILD_RUNBOOK` (`runbookUrl('rebuilding-a-host')`), `Runbook` gains `'rebuilding-a-host'`; `APP_SECRET` (the store's key rule).
  - `PlanResult.secrets: { generate: string[]; recover: string[] }`; `PlanContext.store` holds the recovered keys; the change record's `plan.secrets.recover?: string[]`.
  - Diagnostics: `keys.unrecoverable` (error, or warning for a key the app makes), `secrets.admin-password-lost` (warning).

- [ ] **Step 1: Write the failing tests**

**Create** `packages/engine/src/secrets/recover.test.ts`:

````ts
import { chmod, mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Catalog, KeyFile } from '../catalog/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { readKeyFile, recoverKeys, withRecoveredKeys } from './recover';
import { emptySecretStore, type SecretStore } from './store';

const KEY = 'a'.repeat(32);

/** A key file as Sonarr's config.xml holds one. */
const CONFIG: KeyFile = {
  path: 'config.xml',
  read: (text) => /<ApiKey>([^<]*)<\/ApiKey>/.exec(text)?.[1],
};

/** A key file as Jellyfin's database holds one: the newest named Mediaplane. */
const DATABASE: KeyFile = {
  path: 'data/app.db',
  sqlite: {
    query: `SELECT AccessToken FROM ApiKeys WHERE Name = 'Mediaplane' ORDER BY DateCreated DESC, Id ASC LIMIT 1`,
    column: 'AccessToken',
  },
};

/** The fixture catalog, with Sonarr's key in its config.xml and Jellyfin's in its database. */
const CATALOG: Catalog = fixtureCatalog.map((app) =>
  app.id === 'sonarr'
    ? { ...app, keyFiles: { apiKey: CONFIG } }
    : app.id === 'jellyfin'
      ? {
          ...app,
          secrets: { apiKey: { createdBy: 'app' } },
          keyFiles: { apiKey: DATABASE },
        }
      : app,
);

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  qbittorrent: { vpn: false }
  sonarr: {}
`;

function stackIn(home: string): ResolvedStack {
  const result = resolveStack(fixtureConfig(STACK), CATALOG, FIXTURE_HOST, home);
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

/** `text` as appdata/<app>/<path> in a new home; the home. */
async function homeWith(app: string, path: string, text: string): Promise<string> {
  const home = await tempDir('mediaplane-recover-');
  await mkdir(join(home, 'appdata', app, path, '..'), { recursive: true });
  await writeFile(join(home, 'appdata', app, path), text);
  return home;
}

/** A database like Jellyfin's, with the keys `rows` gives, at appdata/jellyfin/data/app.db. */
async function homeWithDatabase(
  rows: { name: string; token: string; created: string }[],
): Promise<string> {
  const home = await tempDir('mediaplane-recover-');
  await mkdir(join(home, 'appdata', 'jellyfin', 'data'), { recursive: true });
  const db = new DatabaseSync(join(home, 'appdata', 'jellyfin', 'data', 'app.db'));
  db.exec(
    'CREATE TABLE ApiKeys (Id INTEGER PRIMARY KEY, DateCreated TEXT, Name TEXT, AccessToken TEXT)',
  );
  const insert = db.prepare(
    'INSERT INTO ApiKeys (DateCreated, Name, AccessToken) VALUES (?, ?, ?)',
  );
  for (const row of rows) insert.run(row.created, row.name, row.token);
  db.close();
  return home;
}

describe('readKeyFile', () => {
  it('gives the key a file holds, and says when it holds none or is absent', async () => {
    const home = await homeWith(
      'sonarr',
      'config.xml',
      `<Config><ApiKey>${KEY}</ApiKey>`,
    );
    expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
      found: 'key',
      value: KEY,
    });
    const without = await homeWith('sonarr', 'config.xml', '<Config></Config>');
    expect(await readKeyFile(without, 'sonarr', CONFIG)).toEqual({ found: 'none' });
    const empty = await homeWith('sonarr', 'config.xml', '<ApiKey></ApiKey>');
    expect(await readKeyFile(empty, 'sonarr', CONFIG)).toEqual({ found: 'none' });
    expect(await readKeyFile(home, 'radarr', CONFIG)).toEqual({ found: 'absent' });
  });

  it('never reads through a link that leads out of the app folder', async () => {
    const home = await homeWith('radarr', 'config.xml', `<ApiKey>${KEY}</ApiKey>`);
    await mkdir(join(home, 'appdata', 'sonarr'));
    await symlink(
      join(home, 'appdata', 'radarr', 'config.xml'),
      join(home, 'appdata', 'sonarr', 'config.xml'),
    );
    expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
      found: 'unreadable',
      why: 'it leads outside appdata/sonarr',
    });
    // A link to nothing exists, and can't be read.
    await symlink(join(home, 'nowhere'), join(home, 'appdata', 'radarr', 'other.xml'));
    expect(
      await readKeyFile(home, 'radarr', { ...CONFIG, path: 'other.xml' }),
    ).toMatchObject({ found: 'unreadable' });
  });

  it('reads through a link that stays inside the app folder', async () => {
    const home = await homeWith('sonarr', 'old.xml', `<ApiKey>${KEY}</ApiKey>`);
    await symlink('old.xml', join(home, 'appdata', 'sonarr', 'config.xml'));
    expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
      found: 'key',
      value: KEY,
    });
  });

  it.skipIf(process.getuid?.() === 0)(
    'says a file it may not read is unreadable, by its code alone',
    async () => {
      const home = await homeWith('sonarr', 'config.xml', `<ApiKey>${KEY}</ApiKey>`);
      await chmod(join(home, 'appdata', 'sonarr', 'config.xml'), 0o000);
      expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
        found: 'unreadable',
        why: 'it could not be read (EACCES)',
      });
      await chmod(join(home, 'appdata', 'sonarr'), 0o000);
      try {
        expect(await readKeyFile(home, 'sonarr', CONFIG)).toEqual({
          found: 'unreadable',
          why: 'it could not be read (EACCES)',
        });
      } finally {
        await chmod(join(home, 'appdata', 'sonarr'), 0o700);
      }
    },
  );

  it("reads a database's newest key of the name it asks for, read-only", async () => {
    const home = await homeWithDatabase([
      { name: 'Mediaplane', token: 'b'.repeat(32), created: '2026-10-26 06:09:30.39' },
      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
      { name: 'Seerr', token: 'c'.repeat(32), created: '2026-10-27 00:00:00' },
    ]);
    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toEqual({
      found: 'key',
      value: KEY,
    });
    const none = await homeWithDatabase([
      { name: 'Seerr', token: 'c'.repeat(32), created: '2026-10-27 00:00:00' },
    ]);
    expect(await readKeyFile(none, 'jellyfin', DATABASE)).toEqual({ found: 'none' });
  });

  it('writes nothing beside a database closed cleanly, in WAL mode as Jellyfin keeps it', async () => {
    const home = await homeWithDatabase([
      { name: 'Mediaplane', token: KEY, created: '2026-10-26 06:09:30.4' },
    ]);
    const folder = join(home, 'appdata', 'jellyfin', 'data');
    const wal = new DatabaseSync(join(folder, 'app.db'));
    wal.exec('PRAGMA journal_mode=WAL');
    wal.close();
    expect(await readdir(folder)).toEqual(['app.db']);
    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toEqual({
      found: 'key',
      value: KEY,
    });
    // A read-only open would have made app.db-shm and app.db-wal, as Mediaplane's user.
    expect(await readdir(folder)).toEqual(['app.db']);
  });

  it("reads a database in use, the app's write-ahead log too, making nothing", async () => {
    const home = await homeWithDatabase([]);
    const folder = join(home, 'appdata', 'jellyfin', 'data');
    const app = new DatabaseSync(join(folder, 'app.db'));
    try {
      // The app's key, only in its log yet: not checkpointed into the file.
      app.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
      app
        .prepare('INSERT INTO ApiKeys (DateCreated, Name, AccessToken) VALUES (?, ?, ?)')
        .run('2026-10-26 06:09:30.4', 'Mediaplane', KEY);
      const files = (await readdir(folder)).sort();
      expect(files).toEqual(['app.db', 'app.db-shm', 'app.db-wal']);
      expect(await readKeyFile(home, 'jellyfin', DATABASE)).toEqual({
        found: 'key',
        value: KEY,
      });
      expect((await readdir(folder)).sort()).toEqual(files);
    } finally {
      app.close();
    }
  });

  it('says a database it can ask nothing of, or whose key is not text, is unreadable', async () => {
    const home = await homeWith('jellyfin', 'data/app.db', 'not a database');
    expect(await readKeyFile(home, 'jellyfin', DATABASE)).toMatchObject({
      found: 'unreadable',
      why: expect.stringMatching(/^it could not be read as a database \(/) as string,
    });
    const numbers = await homeWithDatabase([]);
    expect(
      await readKeyFile(numbers, 'jellyfin', {
        ...DATABASE,
        sqlite: { query: 'SELECT 7 AS AccessToken', column: 'AccessToken' },
      }),
    ).toEqual({ found: 'unreadable', why: "its AccessToken isn't text" });
  });
});

describe('recoverKeys', () => {
  it("recovers each key the store lacks from the apps' appdata, by app then name", async () => {
    const home = await homeWithDatabase([
      { name: 'Mediaplane', token: 'd'.repeat(32), created: '2026-10-26 06:00:00' },
    ]);
    await mkdir(join(home, 'appdata', 'sonarr'));
    await writeFile(
      join(home, 'appdata', 'sonarr', 'config.xml'),
      `<ApiKey>${KEY}</ApiKey>`,
    );
    const stack = stackIn(home);
    expect(await recoverKeys(stack, emptySecretStore(), true)).toEqual({
      recovered: [
        { app: 'jellyfin', name: 'apiKey', value: 'd'.repeat(32) },
        { app: 'sonarr', name: 'apiKey', value: KEY },
      ],
      diagnostics: [],
    });
    // One the store holds is the store's.
    const held: SecretStore = {
      version: 1,
      apps: { sonarr: { apiKey: 'e'.repeat(32) } },
    };
    expect((await recoverKeys(stack, held, true)).recovered).toEqual([
      { app: 'jellyfin', name: 'apiKey', value: 'd'.repeat(32) },
    ]);
  });

  it('leaves a key to generate when no file holds it, or the file holds none', async () => {
    const stack = stackIn(await homeWith('sonarr', 'config.xml', '<Config/>'));
    expect(await recoverKeys(stack, emptySecretStore(), true)).toEqual({
      recovered: [],
      diagnostics: [],
    });
  });

  it('fails, naming the file and never the key, on a key it would generate but cannot keep', async () => {
    const home = await homeWith('sonarr', 'config.xml', '<ApiKey>not "a" key</ApiKey>');
    const { recovered, diagnostics } = await recoverKeys(
      stackIn(home),
      emptySecretStore(),
      false,
    );
    expect(recovered).toEqual([]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'keys.unrecoverable',
        message: expect.stringContaining(
          'state/secrets.json has no sonarr.apiKey, and appdata/sonarr/config.xml, where sonarr keeps it',
        ) as string,
        hint: expect.stringContaining('rebuilding-a-host.md') as string,
      }),
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('not "a" key');
  });

  it('fails on a key it would generate in a file it cannot read: a new one would lock it out', async () => {
    const home = await homeWith('sonarr', 'config.xml', `<ApiKey>${KEY}</ApiKey>`);
    await mkdir(join(home, 'appdata', 'radarr'));
    await symlink(
      join(home, 'appdata', 'radarr'),
      join(home, 'appdata', 'sonarr', 'linked'),
    );
    const linked = fixtureCatalog.map((app) =>
      app.id === 'sonarr'
        ? { ...app, keyFiles: { apiKey: { ...CONFIG, path: 'linked/config.xml' } } }
        : app,
    );
    await writeFile(
      join(home, 'appdata', 'radarr', 'config.xml'),
      `<ApiKey>${KEY}</ApiKey>`,
    );
    const result = resolveStack(fixtureConfig(STACK), linked, FIXTURE_HOST, home);
    if (result.stack === undefined) throw new Error('the stack did not resolve');
    const { diagnostics } = await recoverKeys(result.stack, emptySecretStore(), false);
    expect(diagnostics.map((d) => [d.severity, d.message])).toEqual([
      [
        'error',
        "state/secrets.json has no sonarr.apiKey, and appdata/sonarr/linked/config.xml, where sonarr keeps it, can't give it: it leads outside appdata/sonarr. A new key would lock Mediaplane out of sonarr, which still holds the old one",
      ],
    ]);
  });

  it("warns of a key the app made that it can't find only when the admin password is new too", async () => {
    const home = await homeWithDatabase([]);
    const stack = stackIn(home);
    // With the password the app has, its setup signs in to find the key: nothing to say.
    expect(await recoverKeys(stack, emptySecretStore(), false)).toEqual({
      recovered: [],
      diagnostics: [],
    });
    const lost = await recoverKeys(stack, emptySecretStore(), true);
    expect(lost.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'keys.unrecoverable',
        message:
          "state/secrets.json has no jellyfin.apiKey, and appdata/jellyfin/data/app.db, where jellyfin keeps it, can't give it: it holds none. The admin password is to be generated too, so apply can't sign in to jellyfin to find its key, and leaves jellyfin unwired",
      }),
    ]);
    // An app that isn't set up yet has no file: its setup makes the key.
    expect(
      await recoverKeys(
        stackIn(await tempDir('mediaplane-recover-')),
        emptySecretStore(),
        true,
      ),
    ).toEqual({ recovered: [], diagnostics: [] });
  });
});

describe('withRecoveredKeys', () => {
  it("adds each recovered key to a copy of the store, keeping the store's own", () => {
    const store: SecretStore = {
      version: 1,
      apps: { qbittorrent: { apiKey: 'qbt_fake' } },
      shared: { adminPassword: 'fake-admin-password' },
    };
    const added = withRecoveredKeys(store, [
      { app: 'sonarr', name: 'apiKey', value: KEY },
    ]);
    expect(added).toEqual({ ...store, apps: { ...store.apps, sonarr: { apiKey: KEY } } });
    expect(store.apps).toEqual({ qbittorrent: { apiKey: 'qbt_fake' } });
    expect(withRecoveredKeys(store, [])).toBe(store);
  });
});
````

**Create** `catalog/keys.test.ts`:

````ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  emptySecretStore,
  parseConfig,
  readKeyFile,
  renderPrestartFiles,
  resolveStack,
  withGeneratedSecrets,
  type AppDefinition,
  type KeyFile,
} from '@mediaplane/engine';
import { tempDir } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from './index';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: {}
  seerr: {}
`;

function app(id: string): AppDefinition {
  const found = catalog.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no ${id} in the catalog`);
  return found;
}

/** The key file of `id`'s secret `name`, as text. */
function textKeyFile(id: string, name: string): Extract<KeyFile, { read: unknown }> {
  const file = app(id).keyFiles?.[name];
  if (file === undefined || !('read' in file))
    throw new Error(`${id}.${name}: no text file`);
  return file;
}

describe("the apps' key files (spec §6.1, key recovery)", () => {
  it('read back every key a pre-start file writes, from the file as Mediaplane writes it', () => {
    const parsed = parseConfig(STACK);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    const { stack } = resolveStack(
      parsed.config,
      catalog,
      { arch: 'arm64', privateAddresses: [] },
      '/opt/mediaplane',
    );
    if (stack === undefined) throw new Error('the stack did not resolve');
    const { store } = withGeneratedSecrets(stack, emptySecretStore());
    const files = renderPrestartFiles(
      stack,
      store,
      { username: 'admin', password: 'fake-admin-password' },
      (size) => Buffer.alloc(size, 1),
    );
    const read: string[] = [];
    for (const file of files) {
      for (const [name, keyFile] of Object.entries(app(file.app).keyFiles ?? {})) {
        if (`appdata/${file.app}/${keyFile.path}` !== file.path) continue;
        expect('read' in keyFile && keyFile.read(file.content), file.path).toBe(
          store.apps[file.app]?.[name],
        );
        read.push(`${file.app}.${name}`);
      }
    }
    expect(read.sort()).toEqual([
      'gluetun.controlApiKey',
      'prowlarr.apiKey',
      'qbittorrent.apiKey',
      'radarr.apiKey',
      'sonarr.apiKey',
    ]);
  });

  it("covers every key Mediaplane generates or an app makes, but for one that isn't kept in a file", () => {
    const kept = catalog.flatMap((entry) =>
      Object.keys(entry.keyFiles ?? {}).map((name) => `${entry.id}.${name}`),
    );
    const keys = catalog.flatMap((entry) =>
      Object.entries(entry.secrets)
        .filter(([, source]) => !('userProvided' in source))
        .map(([name]) => `${entry.id}.${name}`),
    );
    expect(kept.sort()).toEqual(keys.sort());
    for (const entry of catalog) {
      for (const name of Object.keys(entry.keyFiles ?? {})) {
        expect(Object.keys(entry.secrets), `${entry.id}.${name}`).toContain(name);
      }
    }
  });

  it("reads Sonarr's, Radarr's and Prowlarr's from config.xml, as the app rewrites it", () => {
    const xml = `<Config>\n  <LogLevel>debug</LogLevel>\n  <ApiKey>${'a'.repeat(32)}</ApiKey>\n</Config>`;
    for (const id of ['sonarr', 'radarr', 'prowlarr']) {
      expect(textKeyFile(id, 'apiKey').read(xml)).toBe('a'.repeat(32));
      expect(textKeyFile(id, 'apiKey').read('<Config></Config>')).toBeUndefined();
    }
  });

  it("reads qBittorrent's from its WebUI\\APIKey line, line ends of either kind", () => {
    const file = textKeyFile('qbittorrent', 'apiKey');
    expect(file.path).toBe('qBittorrent/qBittorrent.conf');
    const conf = '[Preferences]\r\nWebUI\\APIKey=qbt_fake\r\nWebUI\\Address=*\r\n';
    expect(file.read(conf)).toBe('qbt_fake');
    expect(file.read(conf.replaceAll('\r', ''))).toBe('qbt_fake');
    expect(file.read('[Preferences]\nWebUI\\Address=*\n')).toBeUndefined();
  });

  it("reads Gluetun's from Mediaplane's own role only, never from a role of yours", () => {
    const file = textKeyFile('gluetun', 'controlApiKey');
    const yours = '[[roles]]\nname = "mine"\nauth = "apikey"\napikey = "yours"\n';
    const ours = `[[roles]]\nname = "mediaplane"\nroutes = ["GET /v1/vpn/status"]\nauth = "apikey"\napikey = "${'b'.repeat(32)}"\n`;
    expect(file.read(`${yours}\n${ours}`)).toBe('b'.repeat(32));
    expect(file.read(yours)).toBeUndefined();
  });

  it("reads Seerr's from main.apiKey in its settings.json, and none from one that isn't JSON", () => {
    const file = textKeyFile('seerr', 'apiKey');
    expect(
      file.read(JSON.stringify({ main: { apiKey: 'c'.repeat(32), other: 1 } })),
    ).toBe('c'.repeat(32));
    expect(file.read(JSON.stringify({ main: {} }))).toBeUndefined();
    expect(file.read('{ half')).toBeUndefined();
  });

  it("reads Jellyfin's from its database: the newest key named Mediaplane, as its setup does", async () => {
    const home = await tempDir('mediaplane-keys-');
    const folder = join(home, 'appdata', 'jellyfin', 'data', 'data');
    await mkdir(folder, { recursive: true });
    // Jellyfin 12's own table, with dates as .NET writes them: trailing zeros dropped.
    const db = new DatabaseSync(join(folder, 'jellyfin.db'));
    db.exec(
      'CREATE TABLE ApiKeys (Id INTEGER PRIMARY KEY, DateCreated TEXT, DateLastActivity TEXT, Name TEXT, AccessToken TEXT)',
    );
    const insert = db.prepare(
      "INSERT INTO ApiKeys (DateCreated, DateLastActivity, Name, AccessToken) VALUES (?, '0001-01-01 00:00:00', ?, ?)",
    );
    insert.run('2026-10-26 06:09:30.3940168', 'Mediaplane', 'd'.repeat(32));
    insert.run('2026-10-26 06:09:30.4', 'Mediaplane', 'e'.repeat(32));
    insert.run('2026-10-27 06:09:30', 'Seerr', 'f'.repeat(32));
    db.close();
    const file = app('jellyfin').keyFiles?.apiKey;
    if (file === undefined) throw new Error("Jellyfin's key has no file");
    expect(await readKeyFile(home, 'jellyfin', file)).toEqual({
      found: 'key',
      value: 'e'.repeat(32),
    });
  });

  it('reads nothing from a file that is not there', async () => {
    const home = await tempDir('mediaplane-keys-');
    await writeFile(join(home, 'stack.yaml'), STACK);
    for (const entry of catalog) {
      for (const file of Object.values(entry.keyFiles ?? {})) {
        expect(await readKeyFile(home, entry.id, file)).toEqual({ found: 'absent' });
      }
    }
  });
});
````

**Change** `packages/engine/src/plan/plan.test.ts`:

````diff
diff --git a/packages/engine/src/plan/plan.test.ts b/packages/engine/src/plan/plan.test.ts
index 8048070..7190941 100644
--- a/packages/engine/src/plan/plan.test.ts
+++ b/packages/engine/src/plan/plan.test.ts
@@ -1,2 +1,2 @@
-import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
+import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
 import { join } from 'node:path';
@@ -49,2 +49,15 @@ const WITH_FILES: Catalog = fixtureCatalog.map((app) =>
 
+/** WITH_FILES, with Sonarr's key read back from its pre-start file (spec §6.1). */
+const WITH_KEYS: Catalog = fixtureCatalog.map((app) =>
+  app.id === 'sonarr'
+    ? {
+        ...app,
+        configFiles,
+        keyFiles: {
+          apiKey: { path: 'config.ini', read: (text) => /^key=(.*)$/m.exec(text)?.[1] },
+        },
+      }
+    : app,
+);
+
 async function makeHome({
@@ -272,2 +285,58 @@ describe('plan', () => {
       generate: ['admin.password', 'gluetun.controlApiKey', 'sonarr.apiKey'],
+      recover: [],
+    });
+  });
+
+  describe('with state/secrets.json lost, and the apps still holding their keys', () => {
+    /** A current home, its store gone, Sonarr's file holding the key it had. */
+    async function lostStore(runtime: Runtime, key = '0'.repeat(32)): Promise<string> {
+      const home = await makeCurrentHome(runtime);
+      await rm(join(home, SECRETS_PATH));
+      await mkdir(join(home, 'appdata'), { mode: 0o700 });
+      await mkdir(join(home, 'appdata', 'sonarr'));
+      await writeFile(join(home, 'appdata', 'sonarr', 'config.ini'), `key=${key}\n`);
+      return home;
+    }
+
+    it("recovers each key from its app's appdata, so nothing else changes, and says the admin password is lost", async () => {
+      const runtime = fakeRuntime({
+        hashes: { ok: true, hashes: HASHES },
+        containers: running(HASHES),
+      });
+      const home = await lostStore(runtime);
+      const result = await planFor(home, { runtime, catalog: WITH_KEYS });
+      expect(result).toMatchObject({ ok: true, changed: true });
+      expect(result.secrets).toEqual({
+        generate: ['admin.password', 'gluetun.controlApiKey'],
+        recover: ['sonarr.apiKey'],
+      });
+      // .env holds the key Sonarr has: Sonarr isn't recreated with another.
+      expect(result.files.map((f) => [f.path, f.status])).toEqual([
+        [COMPOSE_PATH, 'unchanged'],
+        [ENV_PATH, 'unchanged'],
+        ['appdata/sonarr/config.ini', 'unchanged'],
+      ]);
+      expect(result.containers.every((c) => c.action === 'unchanged')).toBe(true);
+      expect(result.diagnostics).toEqual([
+        expect.objectContaining({
+          severity: 'warning',
+          code: 'secrets.admin-password-lost',
+        }),
+      ]);
+      // Never the key (the files' content holds the fake image digests' zeros).
+      expect(JSON.stringify({ ...result, files: [] })).not.toContain('0'.repeat(32));
+      expect(await readdir(join(home, 'state'))).toEqual([]);
+    });
+
+    it('fails, rather than generate a key that would lock it out, when it cannot keep the one held', async () => {
+      const runtime = fakeRuntime({
+        hashes: { ok: true, hashes: HASHES },
+        containers: running(HASHES),
+      });
+      const home = await lostStore(runtime, 'not "a" key');
+      const result = await planFor(home, { runtime, catalog: WITH_KEYS });
+      expect(result).toMatchObject({ ok: false, changed: false, files: [] });
+      expect(result.diagnostics).toContainEqual(
+        expect.objectContaining({ severity: 'error', code: 'keys.unrecoverable' }),
+      );
     });
````

**Change** `packages/engine/src/apply/apply.test.ts`:

````diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index 9e065fa..78c4da2 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -126,2 +126,17 @@ const WITH_FILES: Catalog = fixtureCatalog.map((app) =>
 
+/** WITH_FILES, with Sonarr's key read back from its pre-start file (spec §6.1). */
+const WITH_KEYS: Catalog = WITH_FILES.map((app) =>
+  app.id === 'sonarr'
+    ? {
+        ...app,
+        keyFiles: {
+          apiKey: {
+            path: 'config/app.ini',
+            read: (text) => /^key=(.*)$/m.exec(text)?.[1],
+          },
+        },
+      }
+    : app,
+);
+
 async function makeHome(stack = STACK): Promise<string> {
@@ -170,2 +185,30 @@ function stoppedUntilUp(docker: Runtime, service: string): Runtime {
 describe('apply', () => {
+  it("saves the keys it recovers from the apps' appdata with those it generates, and writes no file over them", async () => {
+    const home = await makeHome();
+    const key = 'f'.repeat(32);
+    const file = join(home, 'appdata', 'sonarr', 'config', 'app.ini');
+    await mkdir(join(file, '..'), { recursive: true });
+    await writeFile(file, `key=${key}\nuser=someone\n`);
+    const result = await apply(options(home, fakeDocker(home), { catalog: WITH_KEYS }));
+    expect(result.outcome).toBe('success');
+    expect(result.plan.secrets).toEqual({
+      generate: ['admin.password', 'gluetun.controlApiKey'],
+      recover: ['sonarr.apiKey'],
+    });
+    expect(result.actions[0]).toEqual({
+      step: 'keys',
+      result: 'done',
+      detail:
+        'recovered sonarr.apiKey from appdata; generated admin.password, gluetun.controlApiKey',
+    });
+    expect((await readSecretStore(home)).apps.sonarr).toEqual({ apiKey: key });
+    expect(await readFile(file, 'utf8')).toBe(`key=${key}\nuser=someone\n`);
+    expect(await readFile(join(home, ENV_PATH), 'utf8')).toContain(key);
+    const [record] = (await listRecords(home)).records;
+    expect(record?.plan.secrets).toEqual({
+      generate: ['admin.password', 'gluetun.controlApiKey'],
+      recover: ['sonarr.apiKey'],
+    });
+  });
+
   it('generates keys, writes files, pulls, starts, verifies and records', async () => {
````

**Change** `packages/cli/src/output.test.ts`:

````diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index 30731a9..5eb7b59 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -46,3 +46,3 @@ const PLAN: PlanResult = {
   containers: [],
-  secrets: { generate: [] },
+  secrets: { generate: [], recover: [] },
   unhealthy: [],
@@ -308,2 +308,26 @@ describe('printDrift', () => {
 describe('printPlan', () => {
+  it("lists the keys it recovers from the apps' appdata before those it generates, and counts them", () => {
+    const term = capture();
+    printPlan(
+      {
+        ...PLAN,
+        files: [],
+        secrets: {
+          generate: ['admin.password'],
+          recover: ['qbittorrent.apiKey', 'sonarr.apiKey'],
+        },
+      },
+      { json: false },
+      term.io,
+    );
+    expect(term.stdout()).toBe(
+      [
+        "Secrets to recover from the apps' appdata: qbittorrent.apiKey, sonarr.apiKey",
+        'Secrets to generate: admin.password',
+        'Plan: 2 secrets to recover, 1 secret to generate.',
+        '',
+      ].join('\n'),
+    );
+  });
+
   it('shows a guest apply restarts, with the hosts it starts', () => {
@@ -509,3 +533,3 @@ describe('the wire step, as apply shows it', () => {
         containers: [],
-        secrets: { generate: [] },
+        secrets: { generate: [], recover: ['sonarr.apiKey'] },
         wiring: [
@@ -518,2 +542,5 @@ describe('the wire step, as apply shows it', () => {
     printRecord(record, { json: false }, term.io);
+    expect(term.stdout()).toContain(
+      '  secrets recovered from appdata: sonarr.apiKey\n  > after start',
+    );
     // The same line as plan's.
````

**Change** `test/e2e/deploy.e2e.test.ts` (run with the end-to-end suite, in the completion checklist):

````diff
diff --git a/test/e2e/deploy.e2e.test.ts b/test/e2e/deploy.e2e.test.ts
index a180c0d..6c9c8cb 100644
--- a/test/e2e/deploy.e2e.test.ts
+++ b/test/e2e/deploy.e2e.test.ts
@@ -363,16 +363,32 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
     expect(codesIn(again.stdout)).not.toContain('preflight.home-path');
-    // Mediaplane in the image reads Jellyfin's system.xml: with Jellyfin's key out of the
-    // store, plan lists its setup published, since the wizard is done (apply would only
-    // sign in and make a new key). One it couldn't read would say nothing, and plan would
-    // start it unpublished. It reads Seerr's settings.json, which uid 1000 owns, too:
-    // Seerr's setup is done, so it isn't listed.
+    // Slice 10a, from the image: with every key out of the store, plan recovers each from
+    // the apps' appdata, as Mediaplane's user: Sonarr's config.xml, qBittorrent's
+    // qBittorrent.conf, Seerr's settings.json, which uid 1000 owns, and Jellyfin's
+    // database, read through node:sqlite in the image's bundle. So it lists no setup:
+    // Jellyfin's key is found, and its system.xml says its wizard is done; Seerr's
+    // settings.json says it is set up, and the store still records that it is
+    // Mediaplane's. The store is put back whatever plan did.
     const store = await readSecretStore(home);
-    const { jellyfin: _kept, ...others } = store.apps;
-    await writeSecretStore(home, { ...store, apps: others });
-    const keyless = await mediaplane('plan', '--json');
-    await writeSecretStore(home, store);
+    let keyless: ExecResult;
+    try {
+      await writeSecretStore(home, { ...store, apps: {} });
+      keyless = await mediaplane('plan', '--json');
+    } finally {
+      await writeSecretStore(home, store);
+    }
     expect(keyless.code, keyless.stderr).toBe(2);
-    expect((JSON.parse(keyless.stdout) as { bootstrap: unknown }).bootstrap).toEqual([
-      { app: 'jellyfin', unpublished: false },
-    ]);
+    expect(
+      JSON.parse(keyless.stdout) as { secrets: unknown; bootstrap: unknown },
+    ).toMatchObject({
+      secrets: {
+        generate: [],
+        recover: [
+          'jellyfin.apiKey',
+          'qbittorrent.apiKey',
+          'seerr.apiKey',
+          'sonarr.apiKey',
+        ],
+      },
+      bootstrap: [],
+    });
 
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/secrets/recover.test.ts catalog/keys.test.ts packages/engine/src/plan/plan.test.ts packages/engine/src/apply/apply.test.ts packages/cli/src/output.test.ts`

Expected: FAIL: 13 tests in 5 files (190 run). `recover.test.ts` can't load (`Cannot find module './recover'`); `catalog/keys.test.ts` finds no key file (`sonarr.apiKey: no text file`, `Jellyfin's key has no file`); `plan.test.ts` and `apply.test.ts` see no `secrets.recover` (a lost store's key is generated anew), and `output.test.ts` no "Secrets to recover" line.

- [ ] **Step 3: Implement**

The contract: where an app keeps a key.

**Change** `packages/engine/src/catalog/types.ts`:

````diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index 3b940d6..6607fa4 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -92,2 +92,26 @@ export interface ConfigFile {
 
+/**
+ * Where an app keeps one of its keys in its appdata folder (spec §6.1, key recovery): a
+ * key Mediaplane gave it, or one it made. When state/secrets.json lacks the key, plan and
+ * apply read it from here before generating anything, so a lost store never locks
+ * Mediaplane out of an app that still holds its key. Read only, never written, and never
+ * through a link that leads out of the app's appdata folder.
+ */
+export type KeyFile =
+  | {
+      /** Relative to the app's appdata folder, such as "config.xml". */
+      path: string;
+      /** The key the file's text holds, or undefined when it holds none. Pure. */
+      read(text: string): string | undefined;
+    }
+  | {
+      /** Relative to the app's appdata folder: a SQLite database the app keeps. */
+      path: string;
+      /**
+       * Opened read-only, which the app's own writes don't notice: `query` gives at most
+       * one row, whose `column` is the key (Jellyfin's newest key named Mediaplane).
+       */
+      sqlite: { query: string; column: string };
+    };
+
 /** What a pre-start file renderer sees. It holds secrets: never log or print it. */
@@ -225,2 +249,7 @@ export interface AppDefinition<Options = Record<string, unknown>> {
   secrets: Record<string, SecretSource>;
+  /**
+   * Where it keeps its keys in its appdata folder, by the secret's name (KeyFile): each
+   * key a pre-start file writes, and the keys it makes or takes from its environment.
+   */
+  keyFiles?: Readonly<Record<string, KeyFile>>;
   credentials: CredentialStep[];
````

**Change** `packages/engine/src/secrets/store.ts`:

````diff
diff --git a/packages/engine/src/secrets/store.ts b/packages/engine/src/secrets/store.ts
index 21ef4db..b119484 100644
--- a/packages/engine/src/secrets/store.ts
+++ b/packages/engine/src/secrets/store.ts
@@ -14,3 +14,5 @@ import { compare, unique } from '../util/sort';
  */
-const appSecret = z.string().regex(/^[A-Za-z0-9_]+$/);
+export const APP_SECRET = /^[A-Za-z0-9_]+$/;
+
+const appSecret = z.string().regex(APP_SECRET);
 
````

**Change** `packages/engine/src/runbooks.ts`:

````diff
diff --git a/packages/engine/src/runbooks.ts b/packages/engine/src/runbooks.ts
index dbf0349..ede28c8 100644
--- a/packages/engine/src/runbooks.ts
+++ b/packages/engine/src/runbooks.ts
@@ -8,3 +8,8 @@ export const RUNBOOKS_URL =
 /** The runbooks (docs/runbooks/<name>.md). */
-export type Runbook = 'app-wont-start' | 'drift-reported' | 'vpn-down' | 'wiring-failed';
+export type Runbook =
+  | 'app-wont-start'
+  | 'drift-reported'
+  | 'rebuilding-a-host'
+  | 'vpn-down'
+  | 'wiring-failed';
 
````

Reading the key files, and recovering what the store lacks:

**Create** `packages/engine/src/secrets/recover.ts`:

````ts
import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { KeyFile } from '../catalog/types';
import { error, warning, type Diagnostic } from '../diagnostics';
import { APPDATA_DIR } from '../paths';
import type { ResolvedStack } from '../resolver/resolve';
import { runbookUrl } from '../runbooks';
import { codeOf } from '../util/error-code';
import { isInside } from '../util/path';
import { compare } from '../util/sort';
import { APP_SECRET, type SecretStore } from './store';

/** Where a host is rebuilt from stack.yaml and appdata: what to do when a key isn't found. */
export const REBUILD_RUNBOOK = runbookUrl('rebuilding-a-host');

/**
 * What an app's key file holds (KeyFile): no file, a file without the key, the key, or a
 * file Mediaplane can't read, with why (never the file's content).
 */
export type KeyFound =
  | { found: 'absent' }
  | { found: 'none' }
  | { found: 'key'; value: string }
  | { found: 'unreadable'; why: string };

/** A key found in an app's appdata: the app, the secret's name, and its value. */
export interface RecoveredKey {
  app: string;
  name: string;
  value: string;
}

/** A key file's path relative to the home: appdata/<app>/<path>. */
export function keyFilePath(app: string, file: KeyFile): string {
  return posix.join(APPDATA_DIR, app, file.path);
}

/** Whether something stands at `path`. */
async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

/**
 * How to open the SQLite database at `path` without writing anything beside it. One in use
 * has its write-ahead log and its index (-wal, -shm) beside it, which a read-only open
 * reads, as the app's own readers do, making nothing. One closed cleanly has neither, and
 * all it holds is in the file: a read-only open would make both, as Mediaplane's user,
 * in the app's folder (probed), so it is opened immutable, which makes nothing.
 */
async function databaseAt(path: string): Promise<string | URL> {
  if ((await exists(`${path}-wal`)) && (await exists(`${path}-shm`))) return path;
  const url = pathToFileURL(path);
  url.searchParams.set('immutable', '1');
  return url;
}

/** Why a failure to read a key file happened, as its code, without its message. */
function because(cause: unknown): string {
  const code = codeOf(cause);
  return code === undefined ? 'it could not be read' : `it could not be read (${code})`;
}

/**
 * What `file`, in `app`'s appdata folder in the home, holds. A file whose real path leads
 * out of the app's folder is never read: an app that owns its folder could otherwise have
 * Mediaplane take another app's key, or another file, as its own. Never throws.
 */
export async function readKeyFile(
  home: string,
  app: string,
  file: KeyFile,
): Promise<KeyFound> {
  const folder = join(home, APPDATA_DIR, app);
  const path = join(home, keyFilePath(app, file));
  try {
    await lstat(path);
  } catch (cause) {
    const code = codeOf(cause);
    if (code === 'ENOENT' || code === 'ENOTDIR') return { found: 'absent' };
    return { found: 'unreadable', why: because(cause) };
  }
  let real: string;
  try {
    real = await realpath(path);
    if (!isInside(real, await realpath(folder))) {
      return {
        found: 'unreadable',
        why: `it leads outside ${posix.join(APPDATA_DIR, app)}`,
      };
    }
  } catch (cause) {
    return { found: 'unreadable', why: because(cause) };
  }
  if ('read' in file) {
    let text: string;
    try {
      text = await readFile(real, 'utf8');
    } catch (cause) {
      return { found: 'unreadable', why: because(cause) };
    }
    const value = file.read(text);
    return value === undefined || value === ''
      ? { found: 'none' }
      : { found: 'key', value };
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(await databaseAt(real), { readOnly: true });
    const row = db.prepare(file.sqlite.query).get();
    const value = row?.[file.sqlite.column];
    if (row === undefined) return { found: 'none' };
    return typeof value === 'string' && value !== ''
      ? { found: 'key', value }
      : { found: 'unreadable', why: `its ${file.sqlite.column} isn't text` };
  } catch (cause) {
    // SQLite's own message names what failed (a table, a lock), never a value.
    const said = cause instanceof Error ? cause.message : String(cause);
    return { found: 'unreadable', why: `it could not be read as a database (${said})` };
  } finally {
    db?.close();
  }
}

/** Why a key file found gave no key Mediaplane can keep; undefined for none at all. */
function noKey(found: KeyFound): string | undefined {
  if (found.found === 'unreadable') return found.why;
  if (found.found === 'key') {
    return 'it holds the key in a form Mediaplane can\'t keep (only letters, digits and "_")';
  }
  return found.found === 'none' ? 'it holds none' : undefined;
}

/**
 * The keys state/secrets.json lacks that the apps keep in their appdata (spec §6.1, key
 * recovery), by app then name, found before anything is generated.
 * - A key Mediaplane generates that is in a file it can't read, or in a form it can't
 *   keep, is an error: a new one would lock Mediaplane out of the app, which still holds
 *   the old one. A file without it is from before Mediaplane seeded the app, which plan's
 *   pre-start check reports.
 * - A key the app made (Jellyfin's) that can't be found is found by the app's setup, which
 *   signs in as the shared admin. That needs the password the app has: with the admin
 *   password to be generated (`newPassword`), which the app doesn't know, it is a warning.
 * Reads only; never says a key's value.
 */
export async function recoverKeys(
  stack: ResolvedStack,
  store: SecretStore,
  newPassword: boolean,
): Promise<{ recovered: RecoveredKey[]; diagnostics: Diagnostic[] }> {
  const recovered: RecoveredKey[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const app of stack.apps) {
    const { id, name: appName } = app.def;
    const files = Object.entries(app.def.keyFiles ?? {}).sort(([a], [b]) =>
      compare(a, b),
    );
    for (const [name, file] of files) {
      const source = app.def.secrets[name];
      if (source === undefined || store.apps[id]?.[name] !== undefined) continue;
      const found = await readKeyFile(stack.home, id, file);
      if (found.found === 'key' && APP_SECRET.test(found.value)) {
        recovered.push({ app: id, name, value: found.value });
        continue;
      }
      const why = noKey(found);
      const made = 'createdBy' in source;
      if (why === undefined || (made ? !newPassword : found.found === 'none')) continue;
      const where = keyFilePath(id, file);
      const lacks = `state/secrets.json has no ${id}.${name}, and ${where}, where ${appName} keeps it, can't give it: ${why}`;
      diagnostics.push(
        made
          ? warning(
              'keys.unrecoverable',
              `${lacks}. The admin password is to be generated too, so apply can't sign in to ${appName} to find its key, and leaves ${appName} unwired`,
              {
                hint: `set admin.password to a file holding the password ${appName}'s admin has, then run plan again; the runbook has the other ways: ${REBUILD_RUNBOOK}`,
              },
            )
          : error(
              'keys.unrecoverable',
              `${lacks}. A new key would lock Mediaplane out of ${appName}, which still holds the old one`,
              {
                hint: `make ${where} readable by the user Mediaplane runs as (MEDIAPLANE_UID in its container), or move appdata/${id} aside to start ${appName} afresh, then run plan again; see ${REBUILD_RUNBOOK}`,
              },
            ),
      );
    }
  }
  return { recovered, diagnostics };
}

/** `store`, with each recovered key added. */
export function withRecoveredKeys(
  store: SecretStore,
  recovered: readonly RecoveredKey[],
): SecretStore {
  if (recovered.length === 0) return store;
  const apps: Record<string, Record<string, string>> = Object.fromEntries(
    Object.entries(store.apps).map(([id, secrets]) => [id, { ...secrets }]),
  );
  for (const { app, name, value } of recovered) (apps[app] ??= {})[name] = value;
  return { ...store, apps };
}
````

**Change** `packages/engine/src/index.ts`:

````diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index c4f895f..d76f270 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -32,2 +32,3 @@ export * from './secrets/generate';
 export * from './secrets/values';
+export * from './secrets/recover';
 export * from './secrets/admin';
````

`plan` recovers before anything is generated; apply's keys step saves them; the change
record and the CLI say so:

**Change** `packages/engine/src/plan/plan.ts`:

````diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index 428fba1..face554 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -5,3 +5,3 @@ import type { Migration } from '../config/migrations';
 import { checkSecretRefs } from '../config/secrets';
-import { error, hasErrors, type Diagnostic } from '../diagnostics';
+import { error, hasErrors, warning, type Diagnostic } from '../diagnostics';
 import type { HostFacts } from '../host/facts';
@@ -36,4 +36,5 @@ import { dockerAccessWarnings } from '../runtime/docker';
 import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
-import { adminLogin } from '../secrets/admin';
+import { adminLogin, adminPasswordToGenerate } from '../secrets/admin';
 import { withGeneratedSecrets } from '../secrets/generate';
+import { REBUILD_RUNBOOK, recoverKeys, withRecoveredKeys } from '../secrets/recover';
 import { readSecretStore, type SecretStore } from '../secrets/store';
@@ -89,4 +90,7 @@ export interface PlanResult {
   containers: ContainerChange[];
-  /** Names ("sonarr.apiKey"), never values. */
-  secrets: { generate: string[] };
+  /**
+   * Names ("sonarr.apiKey"), never values: those to generate, and those to recover from
+   * the apps' appdata, which state/secrets.json lacks (spec §6.1).
+   */
+  secrets: { generate: string[]; recover: string[] };
   /**
@@ -112,4 +116,5 @@ export interface PlanResult {
  * What apply builds on after a successful plan, so it never works it out differently.
- * `store` holds the generated secrets in plain text: never log, print or serialise a
- * PlanContext.
+ * `store` holds the generated secrets in plain text, with the keys recovered from the
+ * apps' appdata (`secrets.recover`), which apply's keys step saves: never log, print or
+ * serialise a PlanContext.
  */
@@ -185,3 +190,25 @@ export async function planStack(
   const compose = renderCompose(stack);
-  const store = await readSecretStore(home);
+  const stored = await readSecretStore(home);
+  // The keys the store lacks that the apps still keep in their appdata (spec §6.1, key
+  // recovery): found before anything is generated, so a lost store never locks Mediaplane
+  // out of an app. From here on, the store holds them, as apply's keys step saves them.
+  const newPassword = adminPasswordToGenerate(stack.config, stored);
+  const recovery = await recoverKeys(stack, stored, newPassword);
+  diagnostics.push(...recovery.diagnostics);
+  if (hasErrors(diagnostics)) return failed(diagnostics);
+  const store = withRecoveredKeys(stored, recovery.recovered);
+  const recover = recovery.recovered.map(({ app, name }) => `${app}.${name}`);
+  if (newPassword && recover.length > 0) {
+    // The apps hold keys Mediaplane gave them, so it generated a password for them too,
+    // which went with the store: no app keeps it but as a hash.
+    diagnostics.push(
+      warning(
+        'secrets.admin-password-lost',
+        "the admin password Mediaplane generated went with state/secrets.json, though the apps still hold the keys it gave them: apply generates a new one, and sets it in each app through the app's key",
+        {
+          hint: `"mediaplane credentials" shows it once apply has run; to keep the old one, set admin.password to a file that holds it. See ${REBUILD_RUNBOOK}`,
+        },
+      ),
+    );
+  }
   const values = await secretValues(stack, store, options.env);
@@ -324,2 +351,3 @@ export async function planStack(
         generate.length > 0 ||
+        recover.length > 0 ||
         unhealthy.length > 0 ||
@@ -329,3 +357,3 @@ export async function planStack(
       containers,
-      secrets: { generate },
+      secrets: { generate, recover },
       unhealthy,
@@ -348,3 +376,3 @@ function failed(diagnostics: Diagnostic[]): { result: PlanResult; context: undef
       containers: [],
-      secrets: { generate: [] },
+      secrets: { generate: [], recover: [] },
       unhealthy: [],
````

**Change** `packages/engine/src/apply/apply.ts`:

````diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index 2f31cdc..a7d2acb 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -173,8 +173,17 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
   await steps.run('keys', async () => {
+    // The plan's store holds the keys it recovered from the apps' appdata: saved with the
+    // ones generated now, before anything starts (spec §5 step 4, §6.1).
     const result = withGeneratedSecrets(stack, store, options.random);
-    if (result.generated.length > 0) await writeSecretStore(home, result.store);
+    const { recover } = shown.secrets;
+    if (result.generated.length > 0 || recover.length > 0) {
+      await writeSecretStore(home, result.store);
+    }
     store = result.store;
-    return result.generated.length === 0
-      ? NONE_NEEDED
-      : `generated ${result.generated.join(', ')}`;
+    const done = [
+      ...(recover.length === 0 ? [] : [`recovered ${recover.join(', ')} from appdata`]),
+      ...(result.generated.length === 0
+        ? []
+        : [`generated ${result.generated.join(', ')}`]),
+    ];
+    return done.length === 0 ? NONE_NEEDED : done.join('; ');
   });
@@ -571,2 +580,3 @@ function remaining(result: PlanResult): string {
     ...result.secrets.generate,
+    ...result.secrets.recover,
     ...result.unhealthy,
@@ -604,3 +614,3 @@ function emptyPlan(): PlanResult {
     containers: [],
-    secrets: { generate: [] },
+    secrets: { generate: [], recover: [] },
     unhealthy: [],
````

**Change** `packages/engine/src/history/records.ts`:

````diff
diff --git a/packages/engine/src/history/records.ts b/packages/engine/src/history/records.ts
index 9292b02..7c8623b 100644
--- a/packages/engine/src/history/records.ts
+++ b/packages/engine/src/history/records.ts
@@ -57,3 +57,7 @@ export const changeRecordSchema = z.strictObject({
     ),
-    secrets: z.strictObject({ generate: z.array(z.string()) }),
+    secrets: z.strictObject({
+      generate: z.array(z.string()),
+      /** The keys recovered from the apps' appdata (spec §6.1). Added in Slice 10a. */
+      recover: z.array(z.string()).optional(),
+    }),
     /** What the plan said of each managed resource. Added in Slice 3b. */
````

**Change** `packages/cli/src/output.ts`:

````diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index 29151cd..1ede66d 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -181,3 +181,6 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
   }
-  const generate = result.secrets.generate;
+  const { generate, recover } = result.secrets;
+  if (recover.length > 0) {
+    io.stdout(`Secrets to recover from the apps' appdata: ${recover.join(', ')}\n`);
+  }
   if (generate.length > 0) io.stdout(`Secrets to generate: ${generate.join(', ')}\n`);
@@ -211,2 +214,3 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
     count(containers.length, 'container', 'to change'),
+    count(recover.length, 'secret', 'to recover'),
     count(generate.length, 'secret', 'to generate'),
@@ -633,2 +637,6 @@ export function printRecord(
   }
+  const recovered = record.plan.secrets.recover ?? [];
+  if (recovered.length > 0) {
+    io.stdout(`  secrets recovered from appdata: ${recovered.join(', ')}\n`);
+  }
   if (record.plan.secrets.generate.length > 0) {
````

Each app's key files:

**Change** `catalog/_shared/servarr.ts`:

````diff
diff --git a/catalog/_shared/servarr.ts b/catalog/_shared/servarr.ts
index eaf4b23..5739b05 100644
--- a/catalog/_shared/servarr.ts
+++ b/catalog/_shared/servarr.ts
@@ -11,2 +11,3 @@ import {
   type Integration,
+  type KeyFile,
   type ResourceSpec,
@@ -158 +159,13 @@ export function servarrConfigFiles(ctx: ConfigFileContext): ConfigFile[] {
 }
+
+/**
+ * Where Sonarr, Radarr and Prowlarr keep their key (spec §6.1, key recovery): config.xml's
+ * ApiKey, which servarrConfigFiles writes. Each also takes it from its environment at
+ * every start, which wins over the file's.
+ */
+export const servarrKeyFiles: Readonly<Record<string, KeyFile>> = {
+  apiKey: {
+    path: 'config.xml',
+    read: (text) => /<ApiKey>([^<]*)<\/ApiKey>/.exec(text)?.[1],
+  },
+};
````

**Change** `catalog/sonarr/app.ts`:

````diff
diff --git a/catalog/sonarr/app.ts b/catalog/sonarr/app.ts
index 532d4f8..8d24ca4 100644
--- a/catalog/sonarr/app.ts
+++ b/catalog/sonarr/app.ts
@@ -1,3 +1,8 @@
 import { defineApp } from '@mediaplane/engine';
-import { servarrApi, servarrConfigFiles, servarrEnv } from '../_shared/servarr';
+import {
+  servarrApi,
+  servarrConfigFiles,
+  servarrEnv,
+  servarrKeyFiles,
+} from '../_shared/servarr';
 import integration from './integration';
@@ -20,2 +25,3 @@ export default defineApp({
   secrets: { apiKey: { generate: 'hex32' } },
+  keyFiles: servarrKeyFiles,
   credentials: [{ step: 'env', var: 'SONARR__AUTH__APIKEY', secret: 'apiKey' }],
````

**Change** `catalog/radarr/app.ts`:

````diff
diff --git a/catalog/radarr/app.ts b/catalog/radarr/app.ts
index 173c12a..fec290b 100644
--- a/catalog/radarr/app.ts
+++ b/catalog/radarr/app.ts
@@ -1,3 +1,8 @@
 import { defineApp } from '@mediaplane/engine';
-import { servarrApi, servarrConfigFiles, servarrEnv } from '../_shared/servarr';
+import {
+  servarrApi,
+  servarrConfigFiles,
+  servarrEnv,
+  servarrKeyFiles,
+} from '../_shared/servarr';
 import integration from './integration';
@@ -20,2 +25,3 @@ export default defineApp({
   secrets: { apiKey: { generate: 'hex32' } },
+  keyFiles: servarrKeyFiles,
   credentials: [{ step: 'env', var: 'RADARR__AUTH__APIKEY', secret: 'apiKey' }],
````

**Change** `catalog/prowlarr/app.ts`:

````diff
diff --git a/catalog/prowlarr/app.ts b/catalog/prowlarr/app.ts
index 901fbd0..867238a 100644
--- a/catalog/prowlarr/app.ts
+++ b/catalog/prowlarr/app.ts
@@ -1,3 +1,8 @@
 import { defineApp } from '@mediaplane/engine';
-import { servarrApi, servarrConfigFiles, servarrEnv } from '../_shared/servarr';
+import {
+  servarrApi,
+  servarrConfigFiles,
+  servarrEnv,
+  servarrKeyFiles,
+} from '../_shared/servarr';
 import integration from './integration';
@@ -20,2 +25,3 @@ export default defineApp({
   secrets: { apiKey: { generate: 'hex32' } },
+  keyFiles: servarrKeyFiles,
   credentials: [{ step: 'env', var: 'PROWLARR__AUTH__APIKEY', secret: 'apiKey' }],
````

**Change** `catalog/qbittorrent/conf.ts`:

````diff
diff --git a/catalog/qbittorrent/conf.ts b/catalog/qbittorrent/conf.ts
index c57ca45..1ab6f64 100644
--- a/catalog/qbittorrent/conf.ts
+++ b/catalog/qbittorrent/conf.ts
@@ -1,3 +1,3 @@
 import { pbkdf2Sync } from 'node:crypto';
-import type { ConfigFileContext } from '@mediaplane/engine';
+import type { ConfigFileContext, KeyFile } from '@mediaplane/engine';
 
@@ -54 +54,14 @@ export function qbittorrentConf<Options>(ctx: ConfigFileContext<Options>): strin
 }
+
+/** qBittorrent's file, in its appdata folder: its settings, its login and its key. */
+export const QBITTORRENT_CONF = 'qBittorrent/qBittorrent.conf';
+
+/**
+ * qBittorrent's key in its file (spec §6.1, key recovery): `WebUI\APIKey`, which
+ * qbittorrentConf writes, and qBittorrent's web UI writes anew when it rotates the key
+ * (probed). The file is its only source: qBittorrent takes no key from its environment.
+ */
+export const qbittorrentKeyFile: KeyFile = {
+  path: QBITTORRENT_CONF,
+  read: (text) => /^WebUI\\APIKey=(.*?)\r?$/m.exec(text)?.[1],
+};
````

**Change** `catalog/qbittorrent/app.ts`:

````diff
diff --git a/catalog/qbittorrent/app.ts b/catalog/qbittorrent/app.ts
index fc784e4..88f1170 100644
--- a/catalog/qbittorrent/app.ts
+++ b/catalog/qbittorrent/app.ts
@@ -2,3 +2,3 @@ import { defineApp, warning } from '@mediaplane/engine';
 import { z } from 'zod';
-import { qbittorrentConf } from './conf';
+import { QBITTORRENT_CONF, qbittorrentConf, qbittorrentKeyFile } from './conf';
 import integration from './integration';
@@ -21,2 +21,3 @@ export default defineApp({
   secrets: { apiKey: { generate: 'qbt' } },
+  keyFiles: { apiKey: qbittorrentKeyFile },
   credentials: [],
@@ -78,3 +79,3 @@ export default defineApp({
     {
-      path: 'qBittorrent/qBittorrent.conf',
+      path: QBITTORRENT_CONF,
       content: qbittorrentConf(ctx),
````

**Change** `catalog/gluetun/app.ts`:

````diff
diff --git a/catalog/gluetun/app.ts b/catalog/gluetun/app.ts
index 74a358e..73ca5e1 100644
--- a/catalog/gluetun/app.ts
+++ b/catalog/gluetun/app.ts
@@ -1,2 +1,20 @@
-import { defineApp, error, warning } from '@mediaplane/engine';
+import { defineApp, error, warning, type KeyFile } from '@mediaplane/engine';
+
+/** Mediaplane's own role in auth/config.toml: an apikey line alone could be yours. */
+const MEDIAPLANE_ROLE = /^name = "mediaplane"$/m;
+
+/**
+ * Mediaplane's key to Gluetun's control server (spec §6.1, key recovery): the apikey of
+ * Mediaplane's own role in auth/config.toml, which its pre-start file writes. Gluetun
+ * reads the file when it starts, and never writes it.
+ */
+const controlKeyFile: KeyFile = {
+  path: 'auth/config.toml',
+  read: (text) =>
+    text
+      .split(/^\[\[roles\]\]\s*$/m)
+      .filter((role) => MEDIAPLANE_ROLE.test(role))
+      .map((role) => /^apikey = "([^"]*)"\s*$/m.exec(role)?.[1])
+      .find((key) => key !== undefined),
+};
 
@@ -23,2 +41,3 @@ export default defineApp({
   },
+  keyFiles: { controlApiKey: controlKeyFile },
   credentials: [{ step: 'env', var: 'WIREGUARD_PRIVATE_KEY', secret: 'wireguardKey' }],
@@ -71,4 +90,3 @@ export default defineApp({
       ].join('\n'),
-      // Mediaplane's own role: an apikey line alone could be a role of your own.
-      seeded: /^name = "mediaplane"$/m,
+      seeded: MEDIAPLANE_ROLE,
     },
````

**Change** `catalog/seerr/app.ts`:

````diff
diff --git a/catalog/seerr/app.ts b/catalog/seerr/app.ts
index 6fb5747..fb39bd6 100644
--- a/catalog/seerr/app.ts
+++ b/catalog/seerr/app.ts
@@ -1,2 +1,2 @@
-import { defineApp } from '@mediaplane/engine';
+import { defineApp, type KeyFile } from '@mediaplane/engine';
 import { z } from 'zod';
@@ -5,2 +5,22 @@ import integration from './integration';
 
+const settingsFile = z.looseObject({
+  main: z.looseObject({ apiKey: z.string() }).optional(),
+});
+
+/**
+ * Seerr's key in its settings.json (spec §6.1, key recovery): `main.apiKey`, which Seerr
+ * writes from API_KEY at its first start. It takes API_KEY again at every start, and its
+ * web UI can't make another key while API_KEY is set (probed).
+ */
+const keyFile: KeyFile = {
+  path: 'settings.json',
+  read: (text) => {
+    try {
+      return settingsFile.safeParse(JSON.parse(text)).data?.main?.apiKey;
+    } catch {
+      return undefined;
+    }
+  },
+};
+
 export default defineApp({
@@ -24,2 +44,3 @@ export default defineApp({
   secrets: { apiKey: { generate: 'hex32' } },
+  keyFiles: { apiKey: keyFile },
   credentials: [
````

**Change** `catalog/jellyfin/app.ts`:

````diff
diff --git a/catalog/jellyfin/app.ts b/catalog/jellyfin/app.ts
index 7d7c7d6..422fdc8 100644
--- a/catalog/jellyfin/app.ts
+++ b/catalog/jellyfin/app.ts
@@ -3,3 +3,3 @@ import { z } from 'zod';
 import { gpuExtras, hardwareTranscoding } from '../_shared/hardware-transcoding';
-import { jellyfinBootstrap } from './bootstrap';
+import { jellyfinBootstrap, KEY_NAME } from './bootstrap';
 import integration from './integration';
@@ -23,2 +23,14 @@ export default defineApp({
   secrets: { apiKey: { createdBy: 'app' } },
+  // The newest key named Mediaplane, as its setup takes it from Jellyfin's list (spec
+  // §6.1, key recovery), in Jellyfin's database: WAL mode, so reading it read-only stops
+  // none of Jellyfin's writes, and sees each as soon as it is made (probed).
+  keyFiles: {
+    apiKey: {
+      path: 'data/data/jellyfin.db',
+      sqlite: {
+        query: `SELECT AccessToken FROM ApiKeys WHERE Name = '${KEY_NAME}' ORDER BY DateCreated DESC, Id ASC LIMIT 1`,
+        column: 'AccessToken',
+      },
+    },
+  },
   credentials: [
````

- [ ] **Step 4: Run them, and see them pass**

Run: `pnpm vitest run packages/engine/src/secrets/recover.test.ts catalog/keys.test.ts packages/engine/src/plan/plan.test.ts packages/engine/src/apply/apply.test.ts packages/cli/src/output.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS. Nothing generated changes: no option and no catalog fact changed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): recover each key a lost state/secrets.json lacks from the apps' appdata" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: A key put back at its source, installs from before Slice 3a included

Decisions 7 to 9. A text key file may say how to write its key back. `plan` lists each key
whose app's own file holds another key, or none, and the app as `restart`; apply's start
step stops it, writes the file, and runs `up` whatever the write did. qBittorrent's key
made anew in its web UI, and a file from before Slice 3a, are put right so. vpn-check's
hint for a refused control key says so too.

**Files:**
- Create: `packages/engine/src/secrets/restore.ts`, `packages/engine/src/secrets/restore.test.ts`
- Modify: `packages/engine/src/catalog/types.ts`, `catalog/_shared/servarr.ts`, `catalog/qbittorrent/conf.ts`, `catalog/gluetun/app.ts`, `packages/engine/src/plan/prestart.ts`, `packages/engine/src/plan/stranded.ts`, `packages/engine/src/plan/plan.ts`, `packages/engine/src/apply/apply.ts`, `packages/engine/src/history/records.ts`, `packages/engine/src/vpn/check.ts`, `packages/cli/src/output.ts`
- Test: `catalog/keys.test.ts`, `packages/engine/src/plan/plan.test.ts`, `packages/engine/src/plan/prestart.test.ts`, `packages/engine/src/plan/stranded.test.ts`, `packages/engine/src/apply/apply.test.ts`, `packages/engine/src/vpn/check.test.ts`, `packages/cli/src/output.test.ts`

**Interfaces:**
- **Consumes:** `KeyFile`, `readKeyFile`, `keyFilePath`, `REBUILD_RUNBOOK` (Task 1); `readStackFile` (Slice 8, `config/overrides-file.ts`); `writeFileAtomic` with `group` and `replaces`.
- **Produces:**
  - `KeyFile`'s text form gains `write?(text: string, key: string): string | undefined`.
  - `planKeyRestores(stack: ResolvedStack, store: SecretStore): Promise<{ restore: string[]; diagnostics: Diagnostic[] }>` (keys as `"<app>.<name>"`), `restoreKeys(stack: ResolvedStack, store: SecretStore, keys: readonly string[]): Promise<string[]>`, `restorableKeyFiles(stack: ResolvedStack): Set<string>`.
  - `planPrestartFiles(home, files, restorable?: ReadonlySet<string>)`: a file it names isn't reported as `not-seeded`.
  - `PlanResult.secrets.restore: string[]`; the change record's `plan.secrets.restore?: string[]`; the container action `restart` for an app whose key goes back, and for its guest.
  - Diagnostic: `keys.restore` (a warning for a file with another key, an error for one with none).

- [ ] **Step 1: Write the failing tests**

**Create** `packages/engine/src/secrets/restore.test.ts`:

````ts
import { chmod, link, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Catalog, KeyFile } from '../catalog/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { planKeyRestores, restorableKeyFiles, restoreKeys } from './restore';
import type { SecretStore } from './store';

const KEY = 'a'.repeat(32);

/** A key file as qBittorrent's holds one: a line of its own, written back in place. */
const CONF: KeyFile = {
  path: 'app.conf',
  read: (text) => /^key=(.*)$/m.exec(text)?.[1],
  write: (text, key) =>
    /^key=/m.test(text)
      ? text.replace(/^key=.*$/m, () => `key=${key}`)
      : text.includes('[main]')
        ? text.replace('[main]', () => `[main]\nkey=${key}`)
        : undefined,
};

const CATALOG: Catalog = fixtureCatalog.map((app) =>
  app.id === 'sonarr'
    ? { ...app, keyFiles: { apiKey: CONF } }
    : app.id === 'jellyfin'
      ? // A key the app takes from its environment alone: nothing to write back.
        {
          ...app,
          secrets: { apiKey: { generate: 'hex32' } },
          keyFiles: { apiKey: { path: 'settings.json', read: () => 'other' } },
        }
      : app,
);

const STORE: SecretStore = {
  version: 1,
  apps: { sonarr: { apiKey: KEY }, jellyfin: { apiKey: KEY } },
};

function stackIn(home: string): ResolvedStack {
  const result = resolveStack(
    fixtureConfig(
      'version: 1\npaths: { data: /srv/data }\nnetwork: { bind: localhost }\nmedia_server: jellyfin\napps:\n  qbittorrent: { vpn: false }\n  sonarr: {}\n',
    ),
    CATALOG,
    FIXTURE_HOST,
    home,
  );
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

/** A home whose Sonarr keeps `text` in appdata/sonarr/app.conf; the file's path. */
async function homeWith(text: string): Promise<{ home: string; path: string }> {
  const home = await tempDir('mediaplane-restore-');
  await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
  const path = join(home, 'appdata', 'sonarr', 'app.conf');
  await writeFile(path, text);
  return { home, path };
}

describe('planKeyRestores', () => {
  it('puts back a key the file holds another of, or none of, and leaves one it holds', async () => {
    for (const [text, restore] of [
      [`[main]\nkey=${'b'.repeat(32)}\n`, ['sonarr.apiKey']],
      ['[main]\nport=1\n', ['sonarr.apiKey']],
      [`[main]\nkey=${KEY}\n`, []],
    ] as const) {
      const { home } = await homeWith(text);
      expect(await planKeyRestores(stackIn(home), STORE), text).toEqual({
        restore,
        diagnostics: [],
      });
    }
  });

  it('says nothing of a file that is not there, or that it may not read', async () => {
    const home = await tempDir('mediaplane-restore-');
    expect(await planKeyRestores(stackIn(home), STORE)).toEqual({
      restore: [],
      diagnostics: [],
    });
    if (process.getuid?.() === 0) return;
    const { home: closed, path } = await homeWith('[main]\nport=1\n');
    await chmod(path, 0o000);
    expect(await planKeyRestores(stackIn(closed), STORE)).toEqual({
      restore: [],
      diagnostics: [],
    });
  });

  it('puts back no key Mediaplane holds none of', async () => {
    const { home } = await homeWith('[main]\nport=1\n');
    expect(await planKeyRestores(stackIn(home), { version: 1, apps: {} })).toEqual({
      restore: [],
      diagnostics: [],
    });
  });

  it("warns of another key it can't put back, and fails on a missing one, saying why", async () => {
    const { home, path } = await homeWith(`[main]\nkey=${'b'.repeat(32)}\n`);
    await link(path, join(home, 'appdata', 'sonarr', 'other-name'));
    const other = await planKeyRestores(stackIn(home), STORE);
    expect(other.restore).toEqual([]);
    expect(other.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'keys.restore',
        message:
          "appdata/sonarr/app.conf holds another key than the one Mediaplane holds for sonarr (sonarr.apiKey), and Mediaplane can't put its key there: it has other names (hard links), which a rewrite would part from it",
        hint: expect.stringContaining(
          'then run apply, which puts the key back',
        ) as string,
      },
    ]);
    const { home: unplaced } = await homeWith('port=1\n');
    expect((await planKeyRestores(stackIn(unplaced), STORE)).diagnostics).toEqual([
      {
        severity: 'error',
        code: 'keys.restore',
        message:
          "appdata/sonarr/app.conf lacks the key Mediaplane holds for sonarr (sonarr.apiKey), as a file from before Mediaplane seeded sonarr does, and Mediaplane can't put its key there: Mediaplane can't tell where in it the key goes",
        hint: expect.stringContaining('move appdata/sonarr/app.conf aside') as string,
      },
    ]);
    expect(JSON.stringify([other, unplaced])).not.toContain(KEY);
  });

  it('never writes a file through a link, nor in a folder that leads out of the app folder', async () => {
    const { home, path } = await homeWith('[main]\n');
    await writeFile(join(home, 'elsewhere.conf'), '[main]\n');
    await symlink(
      join(home, 'elsewhere.conf'),
      join(home, 'appdata', 'sonarr', 'linked'),
    );
    const linked = CATALOG.map((app) =>
      app.id === 'sonarr'
        ? { ...app, keyFiles: { apiKey: { ...CONF, path: 'linked' } } }
        : app,
    );
    const result = resolveStack(
      fixtureConfig(
        'version: 1\npaths: { data: /srv/data }\nnetwork: { bind: localhost }\nmedia_server: jellyfin\napps:\n  qbittorrent: { vpn: false }\n  sonarr: {}\n',
      ),
      linked,
      FIXTURE_HOST,
      home,
    );
    if (result.stack === undefined) throw new Error('the stack did not resolve');
    // readKeyFile refuses it as leading outside: plan can't tell, so says nothing.
    expect(await planKeyRestores(result.stack, STORE)).toEqual({
      restore: [],
      diagnostics: [],
    });
    expect(await readFile(path, 'utf8')).toBe('[main]\n');
  });
});

describe('restorableKeyFiles', () => {
  it('lists each key file that says how to write its key back, by its path in the home', async () => {
    expect(restorableKeyFiles(stackIn(await tempDir('mediaplane-restore-')))).toEqual(
      new Set(['appdata/sonarr/app.conf']),
    );
  });
});

describe('restoreKeys', () => {
  it("puts the store's key back in the file, keeping the rest of it and its mode", async () => {
    const { home, path } = await homeWith(`[main]\nkey=${'b'.repeat(32)}\nport=1\n`);
    await chmod(path, 0o640);
    expect(await restoreKeys(stackIn(home), STORE, ['sonarr.apiKey'])).toEqual([
      'sonarr.apiKey',
    ]);
    expect(await readFile(path, 'utf8')).toBe(`[main]\nkey=${KEY}\nport=1\n`);
    expect((await stat(path)).mode & 0o777).toBe(0o640);
  });

  it('fails, naming the file and never the key, where it may not write it', async () => {
    const { home, path } = await homeWith(`[main]\nkey=${'b'.repeat(32)}\n`);
    await link(path, join(home, 'appdata', 'sonarr', 'other-name'));
    const failure = restoreKeys(stackIn(home), STORE, ['sonarr.apiKey']);
    await expect(failure).rejects.toThrow(
      'cannot put sonarr.apiKey back in appdata/sonarr/app.conf: it has other names (hard links), which a rewrite would part from it',
    );
    await expect(
      restoreKeys(stackIn(home), STORE, ['sonarr.apiKey']).catch((e: unknown) =>
        String(e),
      ),
    ).resolves.not.toContain(KEY);
    const { home: unplaced } = await homeWith('port=1\n');
    await expect(
      restoreKeys(stackIn(unplaced), STORE, ['sonarr.apiKey']),
    ).rejects.toThrow(
      "cannot put sonarr.apiKey back in appdata/sonarr/app.conf: Mediaplane can't tell where it goes",
    );
  });

  it('never writes through a link, nor in a folder that leads out of the app folder', async () => {
    const { home } = await homeWith(`[main]\nkey=${'b'.repeat(32)}\n`);
    const linked = (path: string): ResolvedStack => {
      const result = resolveStack(
        fixtureConfig(
          'version: 1\npaths: { data: /srv/data }\nnetwork: { bind: localhost }\nmedia_server: jellyfin\napps:\n  qbittorrent: { vpn: false }\n  sonarr: {}\n',
        ),
        CATALOG.map((app) =>
          app.id === 'sonarr' ? { ...app, keyFiles: { apiKey: { ...CONF, path } } } : app,
        ),
        FIXTURE_HOST,
        home,
      );
      if (result.stack === undefined) throw new Error('the stack did not resolve');
      return result.stack;
    };
    await symlink('app.conf', join(home, 'appdata', 'sonarr', 'linked.conf'));
    await expect(
      restoreKeys(linked('linked.conf'), STORE, ['sonarr.apiKey']),
    ).rejects.toThrow(
      'cannot put sonarr.apiKey back in appdata/sonarr/linked.conf: it is a link',
    );
    await mkdir(join(home, 'outside'));
    await writeFile(join(home, 'outside', 'app.conf'), '[main]\n');
    await symlink(join(home, 'outside'), join(home, 'appdata', 'sonarr', 'away'));
    await expect(
      restoreKeys(linked('away/app.conf'), STORE, ['sonarr.apiKey']),
    ).rejects.toThrow(
      'cannot put sonarr.apiKey back in appdata/sonarr/away/app.conf: a folder on its way leads outside appdata/sonarr',
    );
    expect(await readFile(join(home, 'outside', 'app.conf'), 'utf8')).toBe('[main]\n');
  });

  it('refuses a key it has no file or value for, which plan never names', async () => {
    const { home } = await homeWith('[main]\n');
    await expect(restoreKeys(stackIn(home), STORE, ['jellyfin.apiKey'])).rejects.toThrow(
      "jellyfin.apiKey can't be put back: Mediaplane has no file or key for it",
    );
    await expect(
      restoreKeys(stackIn(home), { version: 1, apps: {} }, ['sonarr.apiKey']),
    ).rejects.toThrow("sonarr.apiKey can't be put back");
  });

  it('says why a write that fails failed, by the path and its code', async () => {
    if (process.getuid?.() === 0) return;
    const { home } = await homeWith(`[main]\nkey=${'b'.repeat(32)}\n`);
    // The folder can be read, but not written: the temporary file can't be made.
    await chmod(join(home, 'appdata', 'sonarr'), 0o500);
    try {
      await expect(restoreKeys(stackIn(home), STORE, ['sonarr.apiKey'])).rejects.toThrow(
        `cannot put sonarr.apiKey back: cannot write ${join(home, 'appdata', 'sonarr', 'app.conf')} (EACCES)`,
      );
    } finally {
      await chmod(join(home, 'appdata', 'sonarr'), 0o700);
    }
  });
});
````

**Change** `catalog/keys.test.ts`:

````diff
diff --git a/catalog/keys.test.ts b/catalog/keys.test.ts
index 6dd21a0..bfcc51a 100644
--- a/catalog/keys.test.ts
+++ b/catalog/keys.test.ts
@@ -156,2 +156,56 @@ describe("the apps' key files (spec §6.1, key recovery)", () => {
 
+  it("puts the key back in Sonarr's, Radarr's and Prowlarr's config.xml, first in <Config> when it has none", () => {
+    const file = textKeyFile('sonarr', 'apiKey');
+    const held = `<Config>\n  <ApiKey>${'a'.repeat(32)}</ApiKey>\n  <Port>8989</Port>\n</Config>\n`;
+    expect(file.write?.(held, 'b'.repeat(32))).toBe(
+      held.replace('a'.repeat(32), 'b'.repeat(32)),
+    );
+    expect(
+      file.write?.('<Config>\n  <Port>8989</Port>\n</Config>\n', 'b'.repeat(32)),
+    ).toBe(
+      `<Config>\n  <ApiKey>${'b'.repeat(32)}</ApiKey>\n  <Port>8989</Port>\n</Config>\n`,
+    );
+    expect(file.write?.('<Settings />', 'b'.repeat(32))).toBeUndefined();
+    for (const id of ['radarr', 'prowlarr']) {
+      expect(textKeyFile(id, 'apiKey').write?.(held, 'b'.repeat(32))).toBe(
+        file.write?.(held, 'b'.repeat(32)),
+      );
+    }
+  });
+
+  it("puts the key back in qBittorrent's file, in place, under [Preferences], or in a new section", () => {
+    const file = textKeyFile('qbittorrent', 'apiKey');
+    expect(
+      file.write?.('[Preferences]\r\nWebUI\\APIKey=qbt_old\r\nA=1\r\n', 'qbt_new'),
+    ).toBe('[Preferences]\r\nWebUI\\APIKey=qbt_new\r\nA=1\r\n');
+    expect(
+      file.write?.('[LegalNotice]\nAccepted=true\n\n[Preferences]\nA=1\n', 'qbt_new'),
+    ).toBe('[LegalNotice]\nAccepted=true\n\n[Preferences]\nWebUI\\APIKey=qbt_new\nA=1\n');
+    expect(file.write?.('[LegalNotice]\nAccepted=true', 'qbt_new')).toBe(
+      '[LegalNotice]\nAccepted=true\n\n[Preferences]\nWebUI\\APIKey=qbt_new\n',
+    );
+    expect(file.write?.('', 'qbt_new')).toBe('[Preferences]\nWebUI\\APIKey=qbt_new\n');
+  });
+
+  it("puts Mediaplane's role back whole in Gluetun's file, after yours, which stay as they are", () => {
+    const file = textKeyFile('gluetun', 'controlApiKey');
+    const yours =
+      '# my roles\n[[roles]]\nname = "mine"\nauth = "apikey"\napikey = "yours"\n';
+    const ours = (key: string) =>
+      `[[roles]]\nname = "mediaplane"\nroutes = ["GET /v1/vpn/status", "GET /v1/publicip/ip"]\nauth = "apikey"\napikey = "${key}"\n`;
+    expect(file.write?.(yours, 'c'.repeat(32))).toBe(`${yours}\n${ours('c'.repeat(32))}`);
+    // In its place: a role of Mediaplane's with another key, or routes of another's.
+    const changed = `${ours('d'.repeat(32)).replace('GET /v1/publicip/ip', 'PUT /v1/vpn/status')}\n${yours}`;
+    expect(file.write?.(changed, 'c'.repeat(32))).toBe(
+      `${ours('c'.repeat(32))}\n${yours}`,
+    );
+    expect(file.write?.('', 'c'.repeat(32))).toBe(ours('c'.repeat(32)));
+    expect(file.read(file.write?.(yours, 'c'.repeat(32)) ?? '')).toBe('c'.repeat(32));
+  });
+
+  it('puts back none of the keys an app takes from its environment, or keeps in a database', () => {
+    expect('write' in textKeyFile('seerr', 'apiKey')).toBe(false);
+    expect(app('jellyfin').keyFiles?.apiKey).not.toHaveProperty('write');
+  });
+
   it('reads nothing from a file that is not there', async () => {
````

**Change** `packages/engine/src/plan/plan.test.ts`:

````diff
diff --git a/packages/engine/src/plan/plan.test.ts b/packages/engine/src/plan/plan.test.ts
index 7190941..3632904 100644
--- a/packages/engine/src/plan/plan.test.ts
+++ b/packages/engine/src/plan/plan.test.ts
@@ -49,2 +49,24 @@ const WITH_FILES: Catalog = fixtureCatalog.map((app) =>
 
+/**
+ * A key file that says how its key is written back: `key=` on a line of its own, or a new
+ * first line.
+ */
+const keyLine = (path: string) => ({
+  path,
+  read: (text: string) => /^key=(.*)$/m.exec(text)?.[1],
+  write: (text: string, key: string) =>
+    /^key=/m.test(text)
+      ? text.replace(/^key=.*$/m, () => `key=${key}`)
+      : `key=${key}\n${text}`,
+});
+
+/** Sonarr's and Gluetun's keys, each in a file of the app's own that can take it back. */
+const WITH_SOURCES: Catalog = fixtureCatalog.map((app) =>
+  app.id === 'sonarr'
+    ? { ...app, configFiles, keyFiles: { apiKey: keyLine('config.ini') } }
+    : app.id === 'gluetun'
+      ? { ...app, keyFiles: { controlApiKey: keyLine('auth.toml') } }
+      : app,
+);
+
 /** WITH_FILES, with Sonarr's key read back from its pre-start file (spec §6.1). */
@@ -286,2 +308,63 @@ describe('plan', () => {
       recover: [],
+      restore: [],
+    });
+  });
+
+  describe('with a key changed at its source', () => {
+    const runtime = () =>
+      fakeRuntime({ hashes: { ok: true, hashes: HASHES }, containers: running(HASHES) });
+
+    it("puts the key back in the app's own file, restarting the app, and its guest", async () => {
+      const docker = runtime();
+      const home = await makeCurrentHome(docker);
+      await mkdir(join(home, 'appdata', 'gluetun'), { recursive: true, mode: 0o700 });
+      await chmod(join(home, 'appdata'), 0o700);
+      await writeFile(
+        join(home, 'appdata', 'gluetun', 'auth.toml'),
+        `key=${'9'.repeat(32)}\n`,
+      );
+      const result = await planFor(home, { runtime: docker, catalog: WITH_SOURCES });
+      expect(result).toMatchObject({ ok: true, changed: true, diagnostics: [] });
+      expect(result.secrets.restore).toEqual(['gluetun.controlApiKey']);
+      // Gluetun reads its file as it starts; qBittorrent, in its network, starts after it.
+      expect(result.containers.filter((c) => c.action !== 'unchanged')).toEqual([
+        { service: 'gluetun', action: 'restart' },
+        { service: 'qbittorrent', action: 'restart' },
+      ]);
+      expect(await readFile(join(home, 'appdata', 'gluetun', 'auth.toml'), 'utf8')).toBe(
+        `key=${'9'.repeat(32)}\n`,
+      );
+    });
+
+    it('puts a key in a file from before Mediaplane seeded the app, rather than fail', async () => {
+      const docker = runtime();
+      const home = await makeCurrentHome(docker);
+      await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
+      await chmod(join(home, 'appdata'), 0o700);
+      await writeFile(join(home, 'appdata', 'sonarr', 'config.ini'), 'user=someone\n');
+      const result = await planFor(home, { runtime: docker, catalog: WITH_SOURCES });
+      expect(result).toMatchObject({ ok: true, diagnostics: [] });
+      expect(result.secrets.restore).toEqual(['sonarr.apiKey']);
+      expect(result.containers.filter((c) => c.action !== 'unchanged')).toEqual([
+        { service: 'sonarr', action: 'restart' },
+      ]);
+    });
+
+    it('has nothing to put back once the file holds the key Mediaplane holds', async () => {
+      const docker = runtime();
+      const home = await makeCurrentHome(docker);
+      await mkdir(join(home, 'appdata', 'gluetun'), { recursive: true });
+      await chmod(join(home, 'appdata'), 0o700);
+      await writeFile(
+        join(home, 'appdata', 'gluetun', 'auth.toml'),
+        `key=${'1'.repeat(32)}\n`,
+      );
+      await mkdir(join(home, 'appdata', 'sonarr'));
+      await writeFile(
+        join(home, 'appdata', 'sonarr', 'config.ini'),
+        `key=${'0'.repeat(32)}\n`,
+      );
+      const result = await planFor(home, { runtime: docker, catalog: WITH_SOURCES });
+      expect(result).toMatchObject({ ok: true, changed: false });
+      expect(result.secrets.restore).toEqual([]);
     });
@@ -311,2 +394,3 @@ describe('plan', () => {
         recover: ['sonarr.apiKey'],
+        restore: [],
       });
````

**Change** `packages/engine/src/plan/prestart.test.ts`:

````diff
diff --git a/packages/engine/src/plan/prestart.test.ts b/packages/engine/src/plan/prestart.test.ts
index 6365ee8..fee4f77 100644
--- a/packages/engine/src/plan/prestart.test.ts
+++ b/packages/engine/src/plan/prestart.test.ts
@@ -61,2 +61,10 @@ describe('planPrestartFiles', () => {
 
+  it('leaves a file from before Mediaplane seeded the app to the key put back there', async () => {
+    const home = await homeWith('<Config>\n  <Port>8989</Port>\n</Config>\n');
+    expect(await planPrestartFiles(home, [FILE], new Set([FILE.path]))).toEqual({
+      changes: [{ path: FILE.path, status: 'unchanged', ...AS_PLANNED }],
+      diagnostics: [],
+    });
+  });
+
   it('gives Gluetun its own steps: stopping it cuts qBittorrent off, which apply restarts', async () => {
````

**Change** `packages/engine/src/plan/stranded.test.ts`:

````diff
diff --git a/packages/engine/src/plan/stranded.test.ts b/packages/engine/src/plan/stranded.test.ts
index 38fa484..79619f4 100644
--- a/packages/engine/src/plan/stranded.test.ts
+++ b/packages/engine/src/plan/stranded.test.ts
@@ -72,2 +72,9 @@ describe('strandedGuests', () => {
 
+  it('restarts a running guest whose host apply restarts, to put its key back', async () => {
+    const runtime = runtimeWith({ qbittorrent: LATE, gluetun: EARLY });
+    expect(await strandedGuests(stack(), current, changes('restart'), runtime)).toEqual([
+      'qbittorrent',
+    ]);
+  });
+
   it('restarts a guest that started before its host last did', async () => {
````

**Change** `packages/engine/src/apply/apply.test.ts`:

````diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index 78c4da2..d8fe619 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -2,2 +2,3 @@ import {
   chmod,
+  link,
   mkdir,
@@ -126,2 +127,9 @@ const WITH_FILES: Catalog = fixtureCatalog.map((app) =>
 
+/** A key in a file of the app's own, on a `key=` line, written back in its place. */
+const KEY_LINE = {
+  path: 'auth.toml',
+  read: (text: string) => /^key=(.*)$/m.exec(text)?.[1],
+  write: (text: string, key: string) => text.replace(/^key=.*$/m, () => `key=${key}`),
+};
+
 /** WITH_FILES, with Sonarr's key read back from its pre-start file (spec §6.1). */
@@ -196,2 +204,3 @@ describe('apply', () => {
       recover: ['sonarr.apiKey'],
+      restore: [],
     });
@@ -210,2 +219,3 @@ describe('apply', () => {
       recover: ['sonarr.apiKey'],
+      restore: [],
     });
@@ -1289,2 +1299,62 @@ describe('apply: qBittorrent behind Gluetun', () => {
 
+  it("puts Gluetun's key back in its file while it is stopped, restarting qBittorrent too", async () => {
+    const home = await makeHome();
+    const docker = fakeDocker(home);
+    const catalog = fixtureCatalog.map((app) =>
+      app.id === 'gluetun' ? { ...app, keyFiles: { controlApiKey: KEY_LINE } } : app,
+    );
+    expect((await apply(options(home, docker, { catalog }))).outcome).toBe('success');
+    const file = join(home, 'appdata', 'gluetun', 'auth.toml');
+    await mkdir(join(file, '..'), { recursive: true });
+    await writeFile(file, `user=someone\nkey=${'9'.repeat(32)}\n`, { mode: 0o640 });
+    docker.calls.length = 0;
+    const result = await apply(options(home, docker, { catalog }));
+    expect(result.outcome).toBe('success');
+    expect(result.plan.secrets.restore).toEqual(['gluetun.controlApiKey']);
+    const stored = (await readSecretStore(home)).apps.gluetun?.controlApiKey ?? '';
+    expect(await readFile(file, 'utf8')).toBe(`user=someone\nkey=${stored}\n`);
+    expect(await modeOf(file)).toBe(0o640);
+    expect(docker.calls.indexOf('stop gluetun qbittorrent')).toBeGreaterThanOrEqual(0);
+    expect(docker.calls.indexOf('stop gluetun qbittorrent')).toBeLessThan(
+      docker.calls.indexOf('up'),
+    );
+    expect(result.actions.find((a) => a.step === 'start')?.detail).toBe(
+      "every app is running and healthy; restarted gluetun, qbittorrent; put gluetun.controlApiKey back in its app's file",
+    );
+    // Gluetun holds the key Mediaplane does: nothing is left to put back.
+    expect((await apply(options(home, docker, { catalog }))).outcome).toBe('no-changes');
+  });
+
+  it('starts every app again when a key it was to put back cannot be, then fails the step', async () => {
+    const home = await makeHome();
+    const docker = fakeDocker(home);
+    const catalog = fixtureCatalog.map((app) =>
+      app.id === 'gluetun' ? { ...app, keyFiles: { controlApiKey: KEY_LINE } } : app,
+    );
+    expect((await apply(options(home, docker, { catalog }))).outcome).toBe('success');
+    const file = join(home, 'appdata', 'gluetun', 'auth.toml');
+    await mkdir(join(file, '..'), { recursive: true });
+    await writeFile(file, `key=${'9'.repeat(32)}\n`);
+    // Between the plan and the write, the file gets a second name: no longer safe to
+    // replace.
+    const linking: Runtime = {
+      ...docker,
+      stop: async (services, values) => {
+        await link(file, `${file}.other-name`);
+        return docker.stop(services, values);
+      },
+    };
+    docker.calls.length = 0;
+    const result = await apply(options(home, linking, { catalog }));
+    expect(result.outcome).toBe('failed');
+    expect(result.actions.find((a) => a.step === 'start')).toEqual({
+      step: 'start',
+      result: 'failed',
+      error:
+        'cannot put gluetun.controlApiKey back in appdata/gluetun/auth.toml: it has other names (hard links), which a rewrite would part from it',
+    });
+    expect(docker.calls).toContain('up');
+    expect(await readFile(file, 'utf8')).toBe(`key=${'9'.repeat(32)}\n`);
+  });
+
   it('stops at a restart that fails, before up', async () => {
````

**Change** `packages/engine/src/vpn/check.test.ts`:

````diff
diff --git a/packages/engine/src/vpn/check.test.ts b/packages/engine/src/vpn/check.test.ts
index e520006..79e4301 100644
--- a/packages/engine/src/vpn/check.test.ts
+++ b/packages/engine/src/vpn/check.test.ts
@@ -779,2 +779,10 @@ describe('vpnCheck', () => {
 
+  it('says a refused key is put back by apply, and what to do when the file holds it already', async () => {
+    const answers: Answers = { ...HEALTHY, status: [0, '\n401'] };
+    const { result } = await checkWith(await homeWith(), { answers });
+    expect(result.ok && result.checks.find((c) => c.id === 'control')?.hint).toBe(
+      '"mediaplane apply" puts the key state/secrets.json holds back in appdata/gluetun/auth/config.toml when the file holds another, and restarts Gluetun and qBittorrent; a file that holds it already was changed while Gluetun ran, which reads it as it starts: restart Gluetun, then qBittorrent. See Gluetun\'s README',
+    );
+  });
+
   it("does not read a keyed answer that curl couldn't finish, such as one over the cap", async () => {
````

**Change** `packages/cli/src/output.test.ts`:

````diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index 5eb7b59..8f013f1 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -46,3 +46,3 @@ const PLAN: PlanResult = {
   containers: [],
-  secrets: { generate: [], recover: [] },
+  secrets: { generate: [], recover: [], restore: [] },
   unhealthy: [],
@@ -165,3 +165,3 @@ describe('printPlan: drift', () => {
 
-  it('says an app refuses its own key, which those that hold it hold too, and what is left, and that apply puts back neither', () => {
+  it('says an app refuses its own key, which those that hold it hold too, and what is left, and what puts each right', () => {
     const term = capture();
@@ -191,3 +191,3 @@ describe('printPlan: drift', () => {
         '  ? prowlarr.application_radarr: still in the app, though the stack no longer wants it; apply leaves it',
-        "  apply doesn't give an app back its own key: put back the key Mediaplane holds, as https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md shows.",
+        "  apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app; for any other app, put it back as https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md shows.",
         "  apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it, or keep it as yours with mediaplane keep <app>.<resource>, which stops the report.",
@@ -317,2 +317,3 @@ describe('printPlan', () => {
           recover: ['qbittorrent.apiKey', 'sonarr.apiKey'],
+          restore: [],
         },
@@ -332,2 +333,25 @@ describe('printPlan', () => {
 
+  it("lists the keys it puts back in their apps' own files, which restart, and counts them", () => {
+    const term = capture();
+    printPlan(
+      {
+        ...PLAN,
+        files: [],
+        containers: [{ service: 'qbittorrent', action: 'restart' }],
+        secrets: { generate: [], recover: [], restore: ['qbittorrent.apiKey'] },
+      },
+      { json: false },
+      term.io,
+    );
+    expect(term.stdout()).toBe(
+      [
+        'Containers:',
+        '  > restart   qbittorrent',
+        "Keys to put back in their apps' own files, each app stopped first: qbittorrent.apiKey",
+        'Plan: 1 container to change, 1 key to put back.',
+        '',
+      ].join('\n'),
+    );
+  });
+
   it('shows a guest apply restarts, with the hosts it starts', () => {
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/secrets/restore.test.ts catalog/keys.test.ts packages/engine/src/plan packages/engine/src/apply/apply.test.ts packages/engine/src/vpn/check.test.ts packages/cli/src/output.test.ts`

Expected: FAIL: 16 tests in 8 files (298 run). `restore.test.ts` can't load (`Cannot find module './restore'`); `keys.test.ts` finds no `write`; `plan.test.ts` has no `secrets.restore` and still stops at a file from before Slice 3a (`sonarr.not-seeded`); `prestart.test.ts` and `stranded.test.ts` see no restorable file and no host's `restart`; `apply.test.ts` writes no key back; `check.test.ts` and `output.test.ts` see the old hint and advice.

- [ ] **Step 3: Implement**

How each key goes back in its file:

**Change** `packages/engine/src/catalog/types.ts`:

````diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index 6607fa4..8a4b2a6 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -96,4 +96,4 @@ export interface ConfigFile {
  * apply read it from here before generating anything, so a lost store never locks
- * Mediaplane out of an app that still holds its key. Read only, never written, and never
- * through a link that leads out of the app's appdata folder.
+ * Mediaplane out of an app that still holds its key. Never read or written through a link
+ * that leads out of the app's appdata folder.
  */
@@ -105,2 +105,10 @@ export type KeyFile =
       read(text: string): string | undefined;
+      /**
+       * The file's text with `key` in it, as the app keeps it, everything else as it was;
+       * undefined when Mediaplane can't tell where it goes. For putting the key back at its
+       * source (spec §6.3), which apply does while the app is stopped: the app reads the
+       * file when it starts. Absent for a key the app takes from its environment alone.
+       * Pure.
+       */
+      write?(text: string, key: string): string | undefined;
     }
````

**Change** `catalog/_shared/servarr.ts`:

````diff
diff --git a/catalog/_shared/servarr.ts b/catalog/_shared/servarr.ts
index 5739b05..d654e2f 100644
--- a/catalog/_shared/servarr.ts
+++ b/catalog/_shared/servarr.ts
@@ -160,6 +160,9 @@ export function servarrConfigFiles(ctx: ConfigFileContext): ConfigFile[] {
 
+const API_KEY = /<ApiKey>([^<]*)<\/ApiKey>/;
+
 /**
  * Where Sonarr, Radarr and Prowlarr keep their key (spec §6.1, key recovery): config.xml's
- * ApiKey, which servarrConfigFiles writes. Each also takes it from its environment at
- * every start, which wins over the file's.
+ * ApiKey, which servarrConfigFiles writes, first in <Config>. Each also takes it from its
+ * environment at every start, which wins over the file's, and doesn't write that into a
+ * config.xml without one (probed), as one from before Slice 3a is.
  */
@@ -168,3 +171,10 @@ export const servarrKeyFiles: Readonly<Record<string, KeyFile>> = {
     path: 'config.xml',
-    read: (text) => /<ApiKey>([^<]*)<\/ApiKey>/.exec(text)?.[1],
+    read: (text) => API_KEY.exec(text)?.[1],
+    write: (text, key) => {
+      const line = `<ApiKey>${key}</ApiKey>`;
+      if (API_KEY.test(text)) return text.replace(API_KEY, () => line);
+      return text.includes('<Config>')
+        ? text.replace('<Config>', () => `<Config>\n  ${line}`)
+        : undefined;
+    },
   },
````

**Change** `catalog/qbittorrent/conf.ts`:

````diff
diff --git a/catalog/qbittorrent/conf.ts b/catalog/qbittorrent/conf.ts
index 1ab6f64..cf4e4ff 100644
--- a/catalog/qbittorrent/conf.ts
+++ b/catalog/qbittorrent/conf.ts
@@ -66,2 +66,17 @@ export const qbittorrentKeyFile: KeyFile = {
   read: (text) => /^WebUI\\APIKey=(.*?)\r?$/m.exec(text)?.[1],
+  // In place of the line it holds, else first under [Preferences], else in a new one.
+  write: (text, key) => {
+    const line = `WebUI\\APIKey=${key}`;
+    const held = /^WebUI\\APIKey=.*?(\r?)$/m;
+    if (held.test(text)) return text.replace(held, (_all, cr: string) => `${line}${cr}`);
+    const section = /^\[Preferences\](\r?)$/m;
+    if (section.test(text)) {
+      return text.replace(
+        section,
+        (_all, cr: string) => `[Preferences]${cr}\n${line}${cr}`,
+      );
+    }
+    const end = text === '' || text.endsWith('\n') ? '' : '\n';
+    return `${text}${end}${text === '' ? '' : '\n'}[Preferences]\n${line}\n`;
+  },
 };
````

**Change** `catalog/gluetun/app.ts`:

````diff
diff --git a/catalog/gluetun/app.ts b/catalog/gluetun/app.ts
index 73ca5e1..f380ee2 100644
--- a/catalog/gluetun/app.ts
+++ b/catalog/gluetun/app.ts
@@ -5,2 +5,20 @@ const MEDIAPLANE_ROLE = /^name = "mediaplane"$/m;
 
+/**
+ * Mediaplane's role in auth/config.toml, with `key`: the routes vpn-check reads, and no
+ * other (spec §11, Slice 3a).
+ */
+function mediaplaneRole(key: string): string {
+  return [
+    '[[roles]]',
+    'name = "mediaplane"',
+    'routes = ["GET /v1/vpn/status", "GET /v1/publicip/ip"]',
+    'auth = "apikey"',
+    `apikey = "${key}"`,
+    '',
+  ].join('\n');
+}
+
+/** auth/config.toml's roles, each from its [[roles]] line, after what comes before them. */
+const roles = (text: string) => text.split(/^(?=\[\[roles\]\][ \t]*$)/m);
+
 /**
@@ -8,3 +26,4 @@ const MEDIAPLANE_ROLE = /^name = "mediaplane"$/m;
  * Mediaplane's own role in auth/config.toml, which its pre-start file writes. Gluetun
- * reads the file when it starts, and never writes it.
+ * reads the file when it starts, and never writes it. Put back, Mediaplane's role is
+ * written whole, in its place or after yours, which stay as they are.
  */
@@ -13,7 +32,20 @@ const controlKeyFile: KeyFile = {
   read: (text) =>
-    text
-      .split(/^\[\[roles\]\]\s*$/m)
+    roles(text)
       .filter((role) => MEDIAPLANE_ROLE.test(role))
-      .map((role) => /^apikey = "([^"]*)"\s*$/m.exec(role)?.[1])
+      .map((role) => /^apikey = "([^"]*)"[ \t]*$/m.exec(role)?.[1])
       .find((key) => key !== undefined),
+  write: (text, key) => {
+    const parts = roles(text);
+    const at = parts.findIndex((role) => MEDIAPLANE_ROLE.test(role));
+    if (at < 0) {
+      const end = text === '' || text.endsWith('\n') ? '' : '\n';
+      return `${text}${end}${text === '' ? '' : '\n'}${mediaplaneRole(key)}`;
+    }
+    // Its own lines run to its last that is neither blank nor a comment: the blank lines
+    // and comments after them, before the next role, stay.
+    const lines = (parts[at] ?? '').split('\n');
+    const last = lines.findLastIndex((line) => !/^\s*(#.*)?$/.test(line));
+    parts[at] = `${mediaplaneRole(key)}${lines.slice(last + 1).join('\n')}`;
+    return parts.join('');
+  },
 };
@@ -82,10 +114,3 @@ export default defineApp({
       path: 'auth/config.toml',
-      content: [
-        '[[roles]]',
-        'name = "mediaplane"',
-        'routes = ["GET /v1/vpn/status", "GET /v1/publicip/ip"]',
-        'auth = "apikey"',
-        `apikey = "${ctx.secret('controlApiKey')}"`,
-        '',
-      ].join('\n'),
+      content: mediaplaneRole(ctx.secret('controlApiKey')),
       seeded: MEDIAPLANE_ROLE,
````

Planning and writing them:

**Create** `packages/engine/src/secrets/restore.ts`:

````ts
import { realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { KeyFile } from '../catalog/types';
import { readStackFile, type StackFile } from '../config/overrides-file';
import { error, warning, type Diagnostic } from '../diagnostics';
import { APPDATA_DIR } from '../paths';
import type { ResolvedStack } from '../resolver/resolve';
import { writeFileAtomic } from '../util/atomic';
import { codeOf } from '../util/error-code';
import { isInside } from '../util/path';
import { compare } from '../util/sort';
import { keyFilePath, readKeyFile, REBUILD_RUNBOOK } from './recover';
import type { SecretStore } from './store';

/** A key file that says how to write its key back. */
type WritableKeyFile = Extract<KeyFile, { read: unknown }> & {
  write: NonNullable<Extract<KeyFile, { read: unknown }>['write']>;
};

/** The app's key files that say how to write their key back, by the secret's name. */
function writable(
  files: Readonly<Record<string, KeyFile>> | undefined,
): [string, WritableKeyFile][] {
  return Object.entries(files ?? {})
    .filter((entry): entry is [string, WritableKeyFile] => 'write' in entry[1])
    .sort(([a], [b]) => compare(a, b));
}

/**
 * The path, relative to the home, of every file whose key planKeyRestores looks after:
 * one of them that lacks its key has it put back, rather than reported as from before
 * Mediaplane seeded the app.
 */
export function restorableKeyFiles(stack: ResolvedStack): Set<string> {
  return new Set(
    stack.apps.flatMap((app) =>
      writable(app.def.keyFiles).map(([, file]) => keyFilePath(app.def.id, file)),
    ),
  );
}

/**
 * The key file, read to be rewritten: refused, with why, as Keep mine refuses a stack.yaml
 * (readStackFile): a link, a file with other names, or one of another user or of a group
 * Mediaplane's user isn't in; and one in a folder that leads out of the app's appdata.
 */
async function openKeyFile(
  home: string,
  app: string,
  file: KeyFile,
): Promise<{ ok: true; path: string; file: StackFile } | { ok: false; why: string }> {
  const path = join(home, keyFilePath(app, file));
  try {
    const folder = await realpath(dirname(path));
    if (!isInside(folder, await realpath(join(home, APPDATA_DIR, app)))) {
      return { ok: false, why: `a folder on its way leads outside appdata/${app}` };
    }
    const read = await readStackFile(path);
    return read.ok
      ? { ok: true, path, file: read.file }
      : { ok: false, why: read.reason };
  } catch (cause) {
    const code = codeOf(cause);
    return {
      ok: false,
      why: `it could not be read${code === undefined ? '' : ` (${code})`}`,
    };
  }
}

/**
 * The keys to put back at their source (spec §6.3, "Re-apply restores the old key at the
 * source"): each key of the store's (`store`, with those apply generates) that its app
 * keeps in a file of its own that Mediaplane can write, which holds another key, or none,
 * as one from before Slice 3a does. The app reads the file when it starts, so apply stops
 * it first. A file Mediaplane can't read says nothing: it can't tell. One it can read but
 * not rewrite safely is an error for a file without the key, which the app can't work
 * with, and a warning for one with another, which `mediaplane keep` can keep. Reads only.
 */
export async function planKeyRestores(
  stack: ResolvedStack,
  store: SecretStore,
): Promise<{ restore: string[]; diagnostics: Diagnostic[] }> {
  const restore: string[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const app of stack.apps) {
    const { id, name: appName } = app.def;
    for (const [name, file] of writable(app.def.keyFiles)) {
      const value = store.apps[id]?.[name];
      if (value === undefined) continue;
      const found = await readKeyFile(stack.home, id, file);
      if (found.found === 'absent' || found.found === 'unreadable') continue;
      if (found.found === 'key' && found.value === value) continue;
      const key = `${id}.${name}`;
      const path = keyFilePath(id, file);
      const opened = await openKeyFile(stack.home, id, file);
      const placed = opened.ok ? file.write(opened.file.text, value) : undefined;
      if (opened.ok && placed !== undefined) {
        restore.push(key);
        continue;
      }
      const why = opened.ok
        ? "Mediaplane can't tell where in it the key goes"
        : opened.why;
      const holds =
        found.found === 'key'
          ? `holds another key than the one Mediaplane holds for ${appName} (${key})`
          : `lacks the key Mediaplane holds for ${appName} (${key}), as a file from before Mediaplane seeded ${appName} does`;
      diagnostics.push(
        (found.found === 'key' ? warning : error)(
          'keys.restore',
          `${path} ${holds}, and Mediaplane can't put its key there: ${why}`,
          {
            hint:
              found.found === 'key'
                ? `fix what stops it, as said above, then run apply, which puts the key back and restarts ${appName}; see ${REBUILD_RUNBOOK}`
                : `stop ${appName}, move ${path} aside, then run apply, which writes a new one; see ${REBUILD_RUNBOOK}`,
          },
        ),
      );
    }
  }
  return { restore, diagnostics };
}

/**
 * Put each key ("<app>.<name>") back in its app's own file (planKeyRestores), with the
 * store's value, while the app is stopped: the file's mode and group as they were, all at
 * once, and only in place of the file read. Returns the keys it put back. Throws an error
 * that names the file, never the key, when it can't.
 */
export async function restoreKeys(
  stack: ResolvedStack,
  store: SecretStore,
  keys: readonly string[],
): Promise<string[]> {
  const done: string[] = [];
  for (const key of keys) {
    // App ids hold no ".": what comes before the first is the app.
    const [id = '', name = ''] = key.split(/\.(.*)/);
    const app = stack.apps.find((candidate) => candidate.def.id === id);
    const file = writable(app?.def.keyFiles).find(([secret]) => secret === name)?.[1];
    const value = store.apps[id]?.[name];
    if (file === undefined || value === undefined) {
      throw new Error(`${key} can't be put back: Mediaplane has no file or key for it`);
    }
    const opened = await openKeyFile(stack.home, id, file);
    const where = keyFilePath(id, file);
    if (!opened.ok) throw new Error(`cannot put ${key} back in ${where}: ${opened.why}`);
    const text = file.write(opened.file.text, value);
    if (text === undefined) {
      throw new Error(
        `cannot put ${key} back in ${where}: Mediaplane can't tell where it goes`,
      );
    }
    const { mode, gid, dev, ino } = opened.file;
    try {
      await writeFileAtomic(opened.path, text, mode, {
        group: gid,
        replaces: { dev, ino },
      });
    } catch (cause) {
      // writeFileAtomic names the path and the reason, never the content.
      throw new Error(
        `cannot put ${key} back: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
    done.push(key);
  }
  return done;
}
````

**Change** `packages/engine/src/plan/prestart.ts`:

````diff
diff --git a/packages/engine/src/plan/prestart.ts b/packages/engine/src/plan/prestart.ts
index 5cc7633..916094d 100644
--- a/packages/engine/src/plan/prestart.ts
+++ b/packages/engine/src/plan/prestart.ts
@@ -54,3 +54,5 @@ async function find(path: string): Promise<Found> {
  * and leave it alone when it exists. A file that exists without what Mediaplane seeds is
- * from an install made before Slice 3a, which apply would never fix: an error.
+ * from an install made before Slice 3a: apply puts its key in it where it can
+ * (`restorable`, its path relative to the home, which planKeyRestores looks after);
+ * any other is an error, which apply would never fix.
  */
@@ -59,2 +61,3 @@ export async function planPrestartFiles(
   files: readonly PrestartFile[],
+  restorable: ReadonlySet<string> = new Set(),
 ): Promise<{ changes: FileChange[]; diagnostics: Diagnostic[] }> {
@@ -77,3 +80,4 @@ export async function planPrestartFiles(
       found.text !== undefined &&
-      found.text.search(file.seeded) === -1
+      found.text.search(file.seeded) === -1 &&
+      !restorable.has(file.path)
     ) {
````

**Change** `packages/engine/src/plan/stranded.ts`:

````diff
diff --git a/packages/engine/src/plan/stranded.ts b/packages/engine/src/plan/stranded.ts
index 93ab0b2..a3efd19 100644
--- a/packages/engine/src/plan/stranded.ts
+++ b/packages/engine/src/plan/stranded.ts
@@ -24,5 +24,6 @@ export function startedBefore(
  * another app's network namespace and otherwise unchanged, whose host, Gluetun, apply
- * starts again, or which started before its host's current run. Compose restarts a guest
- * when it recreates its host (depends_on restart), but not when it starts a stopped host
- * again (verified with Compose 5.5.1), so a guest would be left with no network.
+ * starts again (a stopped one, or one it restarts, to put a key back in its file), or
+ * which started before its host's current run. Compose restarts a guest when it
+ * recreates its host (depends_on restart), but not when it starts a stopped host again
+ * (verified with Compose 5.5.1), so a guest would be left with no network.
  */
@@ -44,3 +45,3 @@ export async function strandedGuests(
     if (action(app.def.id) !== 'unchanged') continue;
-    if (action(hostService) === 'start') {
+    if (action(hostService) === 'start' || action(hostService) === 'restart') {
       stranded.push(app.def.id);
````

**Change** `packages/engine/src/plan/plan.ts`:

````diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index face554..e10896d 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -39,2 +39,3 @@ import { withGeneratedSecrets } from '../secrets/generate';
 import { REBUILD_RUNBOOK, recoverKeys, withRecoveredKeys } from '../secrets/recover';
+import { planKeyRestores, restorableKeyFiles } from '../secrets/restore';
 import { readSecretStore, type SecretStore } from '../secrets/store';
@@ -91,6 +92,8 @@ export interface PlanResult {
   /**
-   * Names ("sonarr.apiKey"), never values: those to generate, and those to recover from
-   * the apps' appdata, which state/secrets.json lacks (spec §6.1).
+   * Names ("sonarr.apiKey"), never values: those to generate; those to recover from the
+   * apps' appdata, which state/secrets.json lacks (spec §6.1); and those to put back at
+   * their source, in the app's own file, which holds another key or none (spec §6.3): the
+   * app restarts.
    */
-  secrets: { generate: string[]; recover: string[] };
+  secrets: { generate: string[]; recover: string[]; restore: string[] };
   /**
@@ -218,2 +221,5 @@ export async function planStack(
   const preview = withGeneratedSecrets(stack, store).store;
+  // A key an app keeps in a file of its own that holds another, or none: put back there,
+  // the app stopped first (spec §6.3, "Re-apply restores the old key at the source").
+  const restores = await planKeyRestores(stack, preview);
   const prestart = await planPrestartFiles(
@@ -221,6 +227,9 @@ export async function planStack(
     await prestartFilesFor(stack, preview, options.env),
+    restorableKeyFiles(stack),
   );
-  if (hasErrors(prestart.diagnostics)) {
+  diagnostics.push(...restores.diagnostics);
+  if (hasErrors([...diagnostics, ...prestart.diagnostics])) {
     return failed([...diagnostics, ...prestart.diagnostics]);
   }
+  const restore = restores.restore;
   // Notes on what apply will do to appdata/ itself; they don't make the plan "changed".
@@ -266,2 +275,9 @@ export async function planStack(
   );
+  // An app whose key goes back in its file restarts: it reads the file as it starts.
+  const restarting = new Set(restore.map((key) => key.split('.')[0] ?? ''));
+  containers = containers.map((change) =>
+    restarting.has(change.service) && change.action === 'unchanged'
+      ? { ...change, action: 'restart' }
+      : change,
+  );
   try {
@@ -352,2 +368,3 @@ export async function planStack(
         recover.length > 0 ||
+        restore.length > 0 ||
         unhealthy.length > 0 ||
@@ -357,3 +374,3 @@ export async function planStack(
       containers,
-      secrets: { generate, recover },
+      secrets: { generate, recover, restore },
       unhealthy,
@@ -376,3 +393,3 @@ function failed(diagnostics: Diagnostic[]): { result: PlanResult; context: undef
       containers: [],
-      secrets: { generate: [], recover: [] },
+      secrets: { generate: [], recover: [], restore: [] },
       unhealthy: [],
````

**Change** `packages/engine/src/apply/apply.ts`:

````diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index a7d2acb..d7ac25b 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -29,2 +29,3 @@ import {
 import { withGeneratedSecrets, type RandomBytes } from '../secrets/generate';
+import { restoreKeys } from '../secrets/restore';
 import { writeSecretStore } from '../secrets/store';
@@ -241,8 +242,29 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
     }
-    // A guest whose host up starts again (strandedGuests): stopped now, up starts it in
-    // the host's new network.
-    const restart = shown.containers
-      .filter((change) => change.action === 'restart')
-      .map((change) => change.service);
+    // A guest whose host up starts again (strandedGuests), and an app whose key goes
+    // back in its file, which it reads as it starts: stopped now, and up starts them.
+    // One that up recreates is stopped first too, for its file to be written.
+    const { restore } = shown.secrets;
+    const running = new Set(
+      context.current.filter((c) => c.state === 'running').map((c) => c.service),
+    );
+    const restart = [
+      ...new Set([
+        ...shown.containers
+          .filter((change) => change.action === 'restart')
+          .map((change) => change.service),
+        ...restore
+          .map((key) => key.split('.')[0] ?? '')
+          .filter((app) => running.has(app)),
+      ]),
+    ].sort(compare);
     if (restart.length > 0) succeeded(await runtime.stop(restart, values));
+    // Each key back in its file, the app stopped (spec §6.3). Up runs whatever happened,
+    // so that no app is left stopped; then a failure fails the step.
+    let restored: string[] = [];
+    let unrestored: Error | undefined;
+    try {
+      restored = await restoreKeys(stack, store, restore);
+    } catch (cause) {
+      unrestored = cause instanceof Error ? cause : new Error(String(cause));
+    }
     // An app whose first-run setup is open to anyone starts with no published port: the
@@ -251,2 +273,3 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
     await up(unpublished);
+    if (unrestored !== undefined) throw unrestored;
     const [its, it] = unpublished.length === 1 ? ['its', 'it'] : ['their', 'them'];
@@ -255,2 +278,7 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
       ...(restart.length === 0 ? [] : [`restarted ${restart.join(', ')}`]),
+      ...(restored.length === 0
+        ? []
+        : [
+            `put ${restored.join(', ')} back in ${restored.length === 1 ? "its app's file" : "their apps' files"}`,
+          ]),
       ...(unpublished.length === 0
@@ -581,2 +609,3 @@ function remaining(result: PlanResult): string {
     ...result.secrets.recover,
+    ...result.secrets.restore,
     ...result.unhealthy,
@@ -614,3 +643,3 @@ function emptyPlan(): PlanResult {
     containers: [],
-    secrets: { generate: [], recover: [] },
+    secrets: { generate: [], recover: [], restore: [] },
     unhealthy: [],
````

**Change** `packages/engine/src/history/records.ts`:

````diff
diff --git a/packages/engine/src/history/records.ts b/packages/engine/src/history/records.ts
index 7c8623b..f28ba4f 100644
--- a/packages/engine/src/history/records.ts
+++ b/packages/engine/src/history/records.ts
@@ -61,2 +61,4 @@ export const changeRecordSchema = z.strictObject({
       recover: z.array(z.string()).optional(),
+      /** The keys put back in their app's own file (spec §6.3). Added in Slice 10a. */
+      restore: z.array(z.string()).optional(),
     }),
````

What they say:

**Change** `packages/engine/src/vpn/check.ts`:

````diff
diff --git a/packages/engine/src/vpn/check.ts b/packages/engine/src/vpn/check.ts
index 13cfd7c..e8d01d6 100644
--- a/packages/engine/src/vpn/check.ts
+++ b/packages/engine/src/vpn/check.ts
@@ -435,3 +435,3 @@ function controlWarning(status: number, exit: number): VpnCheckItem {
     hint: refused
-      ? 'appdata/gluetun/auth/config.toml holds another key than state/secrets.json: see Gluetun\'s README, "Set up before Slice 3a"'
+      ? '"mediaplane apply" puts the key state/secrets.json holds back in appdata/gluetun/auth/config.toml when the file holds another, and restarts Gluetun and qBittorrent; a file that holds it already was changed while Gluetun ran, which reads it as it starts: restart Gluetun, then qBittorrent. See Gluetun\'s README'
       : `see ${VPN_RUNBOOK}`,
````

**Change** `packages/cli/src/output.ts`:

````diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index 1ede66d..0fc68cb 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -93,4 +93,5 @@ export function driftLine(drift: Drift): string {
  * What puts right the drift found, one line for each kind of it there is: apply puts back
- * a field, a resource or a secret changed in an app; it gives no app back a key changed
- * there, and removes nothing the stack no longer wants, so it is never said to.
+ * a field, a resource or a secret changed in an app, and an app's own key where the app
+ * keeps it in a file of its own; it removes nothing the stack no longer wants, so it is
+ * never said to.
  */
@@ -106,3 +107,3 @@ export function driftAdvice(drift: readonly Drift[]): string[] {
       ? [
-          `apply doesn't give an app back its own key: put back the key Mediaplane holds, as ${WIRING_RUNBOOK} shows`,
+          `apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app; for any other app, put it back as ${WIRING_RUNBOOK} shows`,
         ]
@@ -181,3 +182,3 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
   }
-  const { generate, recover } = result.secrets;
+  const { generate, recover, restore } = result.secrets;
   if (recover.length > 0) {
@@ -186,2 +187,7 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
   if (generate.length > 0) io.stdout(`Secrets to generate: ${generate.join(', ')}\n`);
+  if (restore.length > 0) {
+    io.stdout(
+      `Keys to put back in their apps' own files, each app stopped first: ${restore.join(', ')}\n`,
+    );
+  }
   const unhealthy = result.unhealthy;
@@ -216,2 +222,3 @@ export function printPlan(result: PlanResult, options: { json: boolean }, io: Io
     count(generate.length, 'secret', 'to generate'),
+    count(restore.length, 'key', 'to put back'),
     count(unhealthy.length, 'app', 'to wait for'),
@@ -644,2 +651,6 @@ export function printRecord(
   }
+  const restored = record.plan.secrets.restore ?? [];
+  if (restored.length > 0) {
+    io.stdout(`  keys put back in their apps' files: ${restored.join(', ')}\n`);
+  }
   for (const change of (record.plan.wiring ?? []).filter(
````

- [ ] **Step 4: Run them, and see them pass**

Run: `pnpm vitest run packages/engine/src/secrets/restore.test.ts catalog/keys.test.ts packages/engine/src/plan packages/engine/src/apply/apply.test.ts packages/engine/src/vpn/check.test.ts packages/cli/src/output.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): apply puts a key back in its app's own file, which holds another key or none, restarting the app" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Keep mine of an app's own key

Decision 10. `mediaplane keep <app>.<key>` keeps the key the app's own file holds, once
the app refuses Mediaplane's and takes that one, in `state/secrets.json`, and names the
resources that hold the old one. `keep`'s CLI help, its exit codes and its output say so,
and the warning of a key Mediaplane can't put back names it.

**Files:**
- Modify: `packages/engine/src/keep.ts`, `packages/engine/src/secrets/restore.ts`, `packages/cli/src/output.ts`, `packages/cli/src/run.ts`
- Test: `packages/engine/src/keep.test.ts`, `packages/engine/src/secrets/restore.test.ts`, `packages/cli/src/output.test.ts`, `packages/cli/src/run.test.ts`
- Generated: `docs/reference/cli.md`

**Interfaces:**
- **Consumes:** `KeyFile`, `readKeyFile`, `keyFilePath`, `withRecoveredKeys`, `REBUILD_RUNBOOK`, `APP_SECRET` (Task 1); `planStack` with `drift` and `only`; `reachApps`, `checkApp`, `knownSecrets`, `wantedResources`, `resourceAddress`, `desiredOf`, `notOnNetwork`, `PLAN_DEADLINE_MS`.
- **Produces:** `KeepOptions.path` may be `<app>.<key>`, one of the app's `keyFiles`; `KeepResult.holders?: string[]`; diagnostics `keep.no-check`, `keep.no-drift`, `keep.no-key`, `keep.refused`.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/engine/src/keep.test.ts`:

````diff
diff --git a/packages/engine/src/keep.test.ts b/packages/engine/src/keep.test.ts
index 3381fae..0cfb291 100644
--- a/packages/engine/src/keep.test.ts
+++ b/packages/engine/src/keep.test.ts
@@ -16,3 +16,3 @@ import { describe, expect, it } from 'vitest';
 import type { Catalog } from './catalog/types';
-import { readResources, writeResources } from './integrations/resources';
+import { readResources, readState, writeResources } from './integrations/resources';
 import type { ResourceSpec } from './integrations/types';
@@ -21,2 +21,3 @@ import { LOCK_PATH, RESOURCES_PATH } from './paths';
 import { plan } from './plan/plan';
+import { readSecretStore } from './secrets/store';
 import type { Runtime } from './runtime/types';
@@ -527 +528,168 @@ describe('keep', () => {
 });
+
+describe("keep: an app's own key, changed at its source", () => {
+  /** Sonarr's key in its config.xml; qBittorrent with a link that holds Sonarr's key. */
+  const KEYED: Catalog = WIRED_CATALOG.map((def) =>
+    def.id === 'sonarr'
+      ? {
+          ...def,
+          keyFiles: {
+            apiKey: {
+              path: 'config.xml',
+              read: (text) => /<ApiKey>([^<]*)<\/ApiKey>/.exec(text)?.[1],
+            },
+          },
+        }
+      : def.id === 'qbittorrent'
+        ? {
+            ...def,
+            integration: {
+              after: [],
+              resources: [
+                {
+                  ...FAKE_LOGIN,
+                  name: 'link',
+                  secrets: ['sonarrKey'],
+                  desired: ({ keys }) => ({
+                    name: 'link',
+                    fields: {},
+                    secrets: { sonarrKey: keys.sonarr?.apiKey ?? '' },
+                  }),
+                },
+              ],
+            },
+          }
+        : def.id === 'gluetun'
+          ? {
+              ...def,
+              keyFiles: { controlApiKey: { path: 'auth.toml', read: () => 'x' } },
+            }
+          : def,
+  );
+  const NEW = '5'.repeat(32);
+
+  /** A home whose Sonarr's config.xml holds `held`. */
+  async function keyedHome(held: string | undefined): Promise<string> {
+    const dir = await home();
+    await mkdir(join(dir, 'appdata'), { mode: 0o700 });
+    await mkdir(join(dir, 'appdata', 'sonarr'));
+    await writeFile(
+      join(dir, 'appdata', 'sonarr', 'config.xml'),
+      held === undefined ? '<Config />' : `<Config><ApiKey>${held}</ApiKey></Config>`,
+    );
+    return dir;
+  }
+
+  it("keeps the key the app's file holds, once the app takes it and refuses Mediaplane's, and names who holds the old", async () => {
+    const dir = await keyedHome(NEW);
+    // A drift found Sonarr refusing the key Mediaplane holds: it isn't sent again.
+    await writeResources(
+      dir,
+      { 'sonarr.login': RECORD },
+      {
+        'sonarr.apiKey': { verdict: 'refused', at: AT.toISOString() },
+      },
+    );
+    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
+    const kept = await keep(options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED }));
+    expect(kept).toEqual({
+      ok: true,
+      key: 'sonarr.apiKey',
+      value: undefined,
+      holders: ['qbittorrent.link'],
+      diagnostics: [],
+    });
+    expect((await readSecretStore(dir)).apps.sonarr).toEqual({ apiKey: NEW });
+    expect((await readState(dir)).keys).toEqual({});
+    // Asked with the new key only: the old one was found refused before.
+    expect(sonarr.app.requests.filter((r) => r.headers['x-api-key'] === KEY)).toEqual([]);
+    expect(JSON.stringify(kept)).not.toContain(NEW);
+    const after = await plan({
+      ...options(dir, sonarr, '', { catalog: KEYED }),
+      drift: { now: () => AT },
+    });
+    expect(after.drift.filter((d) => d.kind === 'key')).toEqual([]);
+    await expect(readFile(join(dir, LOCK_PATH))).rejects.toThrow();
+  });
+
+  it('keeps no key the app takes already, nor one its file holds that the app refuses too', async () => {
+    const takes = await keyedHome(NEW);
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    expect(
+      codes(await keep(options(takes, sonarr, 'sonarr.apiKey', { catalog: KEYED }))),
+    ).toEqual(['keep.no-drift']);
+    const neither = await keyedHome('6'.repeat(32));
+    const other = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
+    const result = await keep(
+      options(neither, other, 'sonarr.apiKey', { catalog: KEYED }),
+    );
+    expect(result).toMatchObject({
+      ok: false,
+      diagnostics: [
+        expect.objectContaining({
+          code: 'keep.refused',
+          message: expect.stringMatching(
+            /^sonarr refuses the key its own file holds too: /,
+          ) as string,
+        }),
+      ],
+    });
+    expect(JSON.stringify(result)).not.toContain('6'.repeat(32));
+    expect((await readSecretStore(neither)).apps.sonarr).toEqual({ apiKey: KEY });
+  });
+
+  it("keeps no key an app doesn't answer about: an unsure answer is never a yes", async () => {
+    const dir = await keyedHome(NEW);
+    await writeResources(
+      dir,
+      { 'sonarr.login': RECORD },
+      {
+        'sonarr.apiKey': { verdict: 'refused', at: AT.toISOString() },
+      },
+    );
+    const sonarr = await fakeSonarr({
+      key: NEW,
+      user: 'admin',
+      password: PASSWORD,
+      up: false,
+    });
+    const result = await keep(options(dir, sonarr, 'sonarr.apiKey', { catalog: KEYED }));
+    expect(result.diagnostics).toEqual([
+      expect.objectContaining({
+        code: 'keep.refused',
+        message: expect.stringMatching(
+          /^Mediaplane couldn't tell whether sonarr takes the key its own file holds: /,
+        ) as string,
+      }),
+    ]);
+    expect((await readSecretStore(dir)).apps.sonarr).toEqual({ apiKey: KEY });
+  });
+
+  it("keeps no key from a file that holds none, or the one the app refuses, or of an app it can't ask", async () => {
+    const sonarr = await fakeSonarr({ key: NEW, user: 'admin', password: PASSWORD });
+    for (const [held, why] of [
+      [undefined, 'it holds none'],
+      [KEY, 'it holds the one Mediaplane holds, which the app refuses'],
+    ] as const) {
+      const result = await keep(
+        options(await keyedHome(held), sonarr, 'sonarr.apiKey', { catalog: KEYED }),
+      );
+      expect(result.diagnostics).toEqual([
+        expect.objectContaining({
+          code: 'keep.no-key',
+          message: `Mediaplane can't keep sonarr's own key: appdata/sonarr/config.xml can't give it: ${why}`,
+        }),
+      ]);
+    }
+    const gluetun = await keep(
+      options(await keyedHome(NEW), sonarr, 'gluetun.controlApiKey', { catalog: KEYED }),
+    );
+    expect(gluetun.diagnostics).toEqual([
+      expect.objectContaining({
+        code: 'keep.no-check',
+        message:
+          "Mediaplane can't ask gluetun whether it takes the key appdata/gluetun/auth.toml holds, so it doesn't keep it",
+      }),
+    ]);
+  });
+});
````

**Change** `packages/engine/src/secrets/restore.test.ts`:

````diff
diff --git a/packages/engine/src/secrets/restore.test.ts b/packages/engine/src/secrets/restore.test.ts
index da5a34f..5b54923 100644
--- a/packages/engine/src/secrets/restore.test.ts
+++ b/packages/engine/src/secrets/restore.test.ts
@@ -114,3 +114,3 @@ describe('planKeyRestores', () => {
         hint: expect.stringContaining(
-          'then run apply, which puts the key back',
+          '"mediaplane keep sonarr.apiKey" keeps sonarr\'s own key instead',
         ) as string,
````

**Change** `packages/cli/src/output.test.ts`:

````diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index 8f013f1..e325f43 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -13,2 +13,3 @@ import {
   printHistory,
+  printKeep,
   printMigrate,
@@ -191,3 +192,3 @@ describe('printPlan: drift', () => {
         '  ? prowlarr.application_radarr: still in the app, though the stack no longer wants it; apply leaves it',
-        "  apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app; for any other app, put it back as https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md shows.",
+        "  apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app; for any other app, put it back as https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md shows. mediaplane keep <app>.<key> keeps the app's own key instead.",
         "  apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it, or keep it as yours with mediaplane keep <app>.<resource>, which stops the report.",
@@ -580,2 +581,43 @@ describe('the wire step, as apply shows it', () => {
 
+describe('printKeep', () => {
+  it("says it kept an app's own key, never showing it, and what apply gives it to", () => {
+    const term = capture();
+    printKeep(
+      {
+        ok: true,
+        key: 'qbittorrent.apiKey',
+        value: undefined,
+        holders: ['radarr.download_client', 'sonarr.download_client'],
+        diagnostics: [],
+      },
+      { json: false },
+      term.io,
+    );
+    expect(term.stdout()).toBe(
+      "Kept qbittorrent's own key (qbittorrent.apiKey) in state/secrets.json, where Mediaplane keeps its keys; stack.yaml is as it was.\nRun apply to give it to radarr.download_client, sonarr.download_client, which hold the old one.\n",
+    );
+    const none = capture();
+    printKeep(
+      { ok: true, key: 'sonarr.apiKey', value: undefined, holders: [], diagnostics: [] },
+      { json: false },
+      none.io,
+    );
+    expect(none.stdout()).toContain('No resource of the stack holds the old one.\n');
+    const json = capture();
+    printKeep(
+      { ok: true, key: 'sonarr.apiKey', value: undefined, holders: [], diagnostics: [] },
+      { json: true },
+      json.io,
+    );
+    expect(JSON.parse(json.stdout())).toEqual({
+      schema: 'mediaplane.keep/v1',
+      ok: true,
+      key: 'sonarr.apiKey',
+      value: null,
+      holders: [],
+      diagnostics: [],
+    });
+  });
+});
+
 describe('printMigrate', () => {
````

**Change** `packages/cli/src/run.test.ts`:

````diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 0f6556f..234d5e7 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -1951,3 +1951,5 @@ describe('mediaplane keep', () => {
     );
-    expect(human.stderr()).toContain('Nothing was kept; stack.yaml is as it was.\n');
+    expect(human.stderr()).toContain(
+      'Nothing was kept; stack.yaml and state/secrets.json are as they were.\n',
+    );
     expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe(before);
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/keep.test.ts packages/engine/src/secrets/restore.test.ts packages/cli/src/output.test.ts packages/cli/src/run.test.ts`

Expected: FAIL: 8 tests in 4 files (143 run). `keep.test.ts` reads `sonarr.apiKey` as an override key, which names no resource (`overrides.unknown`); `restore.test.ts`'s hint names no `keep`; `output.test.ts` has no kept key to print, and the old advice; `run.test.ts` the old "Nothing was kept" line.

- [ ] **Step 3: Implement**

**Change** `packages/engine/src/keep.ts`:

````diff
diff --git a/packages/engine/src/keep.ts b/packages/engine/src/keep.ts
index c579cad..6edf66f 100644
--- a/packages/engine/src/keep.ts
+++ b/packages/engine/src/keep.ts
@@ -15,7 +15,27 @@ import {
 } from './integrations/overrides';
-import { readResources, writeResources } from './integrations/resources';
+import type { AppDefinition, KeyFile } from './catalog/types';
+import { AppApiError } from './http/client';
+import { readResources, readState, writeResources } from './integrations/resources';
 import type { Scalar } from './integrations/types';
-import { DRIFT_RUNBOOK } from './integrations/wiring';
+import {
+  checkApp,
+  DRIFT_RUNBOOK,
+  knownSecrets,
+  notOnNetwork,
+  PLAN_DEADLINE_MS,
+  reachApps,
+  redactionValues,
+  resourceAddress,
+  wantedResources,
+} from './integrations/wiring';
+import { desiredOf } from './integrations/overrides';
 import { STACK_PATH } from './paths';
-import { planStack, type PlanOptions } from './plan/plan';
+import { planStack, type PlanContext, type PlanOptions } from './plan/plan';
+import {
+  keyFilePath,
+  readKeyFile,
+  REBUILD_RUNBOOK,
+  withRecoveredKeys,
+} from './secrets/recover';
+import { APP_SECRET, writeSecretStore } from './secrets/store';
 import { acquireLock, LockedError, type Lock } from './state/lock';
@@ -23,5 +43,9 @@ import { writeFileAtomic } from './util/atomic';
 import { fileKind } from './util/fs';
+import { foundSecrets, redact } from './util/redact';
 
 export interface KeepOptions extends PlanOptions {
-  /** What to keep: `<app>.<resource>.<field>`, or `<app>.<resource>` for one deleted. */
+  /**
+   * What to keep: `<app>.<resource>.<field>`, or `<app>.<resource>` for one deleted; or
+   * `<app>.<key>`, an app's own key, changed at its source (spec §6.3).
+   */
   path: string;
@@ -33,6 +57,14 @@ export interface KeepResult {
   ok: boolean;
-  /** The override key it wrote under `overrides:`. */
+  /** The override key it wrote under `overrides:`, or the app's key it kept. */
   key: string;
-  /** Its value: the app's, or `unmanaged` for a resource deleted outside Mediaplane. */
+  /**
+   * Its value: the app's, or `unmanaged` for a resource deleted outside Mediaplane; never
+   * a key's, which it keeps in state/secrets.json.
+   */
   value: Scalar | undefined;
+  /**
+   * For an app's own key it kept: the resources of the stack that hold the key, each
+   * given the kept one by the next apply. Added in Slice 10a.
+   */
+  holders?: string[];
   diagnostics: Diagnostic[];
@@ -40,2 +72,19 @@ export interface KeepResult {
 
+/** An app's own key that keep can take: the app, the key's name, and where it keeps it. */
+interface KeyTarget {
+  def: AppDefinition;
+  name: string;
+  file: KeyFile;
+}
+
+/** The app's own key `path` names (`<app>.<key>`, which a key file holds), if it names one. */
+function keyTarget(catalog: PlanOptions['catalog'], path: string): KeyTarget | undefined {
+  const [app = '', name = '', ...rest] = path.split('.');
+  const def = catalog.find((d) => d.id === app);
+  const file = def?.keyFiles?.[name];
+  return def === undefined || file === undefined || rest.length > 0
+    ? undefined
+    : { def, name, file };
+}
+
 /**
@@ -63,6 +112,5 @@ export async function keep(options: KeepOptions): Promise<KeepResult> {
   });
-  const named = overrideTarget(options.catalog, key);
-  if (!named.ok) return refused([named.diagnostic]);
-  const { spec, def, field } = named.target;
-  const address = `${def.id}.${spec.name}`;
+  // An app's own key, or else what an override names.
+  const named = keyTarget(options.catalog, key) ?? overrideTarget(options.catalog, key);
+  if ('ok' in named && !named.ok) return refused([named.diagnostic]);
   const stackPath = join(home, STACK_PATH);
@@ -94,2 +142,5 @@ export async function keep(options: KeepOptions): Promise<KeepResult> {
   try {
+    if (!('ok' in named)) return await keepKey({ ...options, home }, now, named);
+    const { spec, def, field } = named.target;
+    const address = `${def.id}.${spec.name}`;
     const { result, context } = await planStack({
@@ -241 +292,138 @@ export async function keep(options: KeepOptions): Promise<KeepResult> {
 }
+
+/**
+ * Keep mine for an app's own key, changed at its source (spec §6.3): the key the app's own
+ * file holds (its KeyFile), taken as the stack's, in state/secrets.json, once the app is
+ * shown to refuse the key Mediaplane holds, and to take that one. The next apply gives it
+ * to every resource of the stack that holds it (`holders`), as one the other app refuses:
+ * keep itself writes to no app. Under apply's lock, as keep is. Its plan asks the app with
+ * the key Mediaplane holds, and nothing else; then the app is asked with the file's.
+ * Never says either key.
+ */
+async function keepKey(
+  options: KeepOptions,
+  now: () => Date,
+  { def, name, file }: KeyTarget,
+): Promise<KeepResult> {
+  const key = `${def.id}.${name}`;
+  const refused = (code: string, message: string, hint?: string): KeepResult => ({
+    ok: false,
+    key,
+    value: undefined,
+    diagnostics: [error(code, message, hint === undefined ? {} : { hint })],
+  });
+  const where = keyFilePath(def.id, file);
+  if (def.api?.key.secret !== name) {
+    return refused(
+      'keep.no-check',
+      `Mediaplane can't ask ${def.name} whether it takes the key ${where} holds, so it doesn't keep it`,
+      `apply puts the key Mediaplane holds back in ${where}, and restarts ${def.name}; see ${REBUILD_RUNBOOK}`,
+    );
+  }
+  // Only this app is asked, with the key Mediaplane holds: `key` names no resource.
+  const { result, context } = await planStack({ ...options, drift: { now }, only: key });
+  if (!result.ok || context === undefined) {
+    return { ok: false, key, value: undefined, diagnostics: result.diagnostics };
+  }
+  const refusing = result.drift.some(
+    (d) => d.kind === 'key' && d.resource === def.id && d.source === undefined,
+  );
+  if (!refusing) {
+    return refused(
+      'keep.no-drift',
+      `${key} has not changed outside Mediaplane: ${def.name} takes the key Mediaplane holds, or couldn't be asked`,
+      `"mediaplane drift" says which; see ${DRIFT_RUNBOOK}`,
+    );
+  }
+  const found = await readKeyFile(context.stack.home, def.id, file);
+  const held = context.store.apps[def.id]?.[name];
+  if (found.found !== 'key' || !APP_SECRET.test(found.value) || found.value === held) {
+    const why =
+      found.found === 'unreadable'
+        ? found.why
+        : found.found !== 'key'
+          ? 'it holds none'
+          : found.value === held
+            ? 'it holds the one Mediaplane holds, which the app refuses'
+            : 'it holds the key in a form Mediaplane can\'t keep (only letters, digits and "_")';
+    return refused(
+      'keep.no-key',
+      `Mediaplane can't keep ${def.name}'s own key: ${where} can't give it: ${why}`,
+      `see "A key changed at its source" in ${REBUILD_RUNBOOK}`,
+    );
+  }
+  const value = found.value;
+  const asked = await askWith(options, context, def, name, value);
+  if (asked !== undefined)
+    return refused('keep.refused', asked, `see ${REBUILD_RUNBOOK}`);
+  await writeSecretStore(
+    context.stack.home,
+    withRecoveredKeys(context.store, [{ app: def.id, name, value }]),
+  );
+  // The app takes Mediaplane's key again: plan and drift may send it.
+  const state = await readState(context.stack.home);
+  if (Object.hasOwn(state.keys, key)) {
+    Reflect.deleteProperty(state.keys, key);
+    await writeResources(context.stack.home, state.resources, state.keys);
+  }
+  return {
+    ok: true,
+    key,
+    value: undefined,
+    holders: held === undefined ? [] : holdersOf(context, held),
+    // What the plan said of the app refusing the key it held is what keep has put right.
+    diagnostics: result.diagnostics.filter((d) => !d.code.startsWith('wire.')),
+  };
+}
+
+/**
+ * Why `def` doesn't take `value` as its key, asked as plan asks it, or undefined when it
+ * does. Any failure, a refusal or no answer, is a reason not to keep it: an unsure answer
+ * never becomes "it takes it". The key is kept out of what is said.
+ */
+async function askWith(
+  options: KeepOptions,
+  context: PlanContext,
+  def: AppDefinition,
+  name: string,
+  value: string,
+): Promise<string | undefined> {
+  const app = context.stack.apps.find((candidate) => candidate.def.id === def.id);
+  if (app === undefined) return `${def.name} is not in the stack`;
+  const secrets = [value, ...knownSecrets({}, context.store, { password: '' })];
+  const reached = await reachApps([app], {
+    runtime: options.runtime,
+    current: context.current,
+    keys: { [def.id]: { [name]: value } },
+    secrets,
+    found: foundSecrets(),
+    deadlineMs: PLAN_DEADLINE_MS,
+    ...(options.wiring === undefined ? {} : { seams: options.wiring }),
+  });
+  const client = reached.get(def.id);
+  if (client === undefined) return notOnNetwork(app);
+  try {
+    await checkApp(client);
+    return undefined;
+  } catch (cause) {
+    if (!(cause instanceof AppApiError)) throw cause;
+    const said = redact(cause.message, redactionValues(secrets));
+    return cause.kind === 'auth'
+      ? `${def.name} refuses the key its own file holds too: ${said}`
+      : `Mediaplane couldn't tell whether ${def.name} takes the key its own file holds: ${said}`;
+  }
+}
+
+/** Each resource the stack wants that holds `value` as one of its secrets, by address. */
+function holdersOf(context: PlanContext, value: string): string[] {
+  const { stack, store } = context;
+  const admin = { username: stack.config.admin.username, password: '' };
+  return stack.apps.flatMap((app) => {
+    const ctx = { stack, app, admin, keys: store.apps };
+    return wantedResources(ctx).flatMap((spec) =>
+      Object.values(desiredOf(spec, ctx)?.secrets ?? {}).includes(value)
+        ? [resourceAddress(app, spec)]
+        : [],
+    );
+  });
+}
````

**Change** `packages/engine/src/secrets/restore.ts`:

````diff
diff --git a/packages/engine/src/secrets/restore.ts b/packages/engine/src/secrets/restore.ts
index c866238..dfec11b 100644
--- a/packages/engine/src/secrets/restore.ts
+++ b/packages/engine/src/secrets/restore.ts
@@ -115,3 +115,3 @@ export async function planKeyRestores(
               found.found === 'key'
-                ? `fix what stops it, as said above, then run apply, which puts the key back and restarts ${appName}; see ${REBUILD_RUNBOOK}`
+                ? `"mediaplane keep ${key}" keeps ${appName}'s own key instead, once ${appName} takes it; or fix what stops Mediaplane, as said above, and run apply, which puts its key back and restarts ${appName}. See ${REBUILD_RUNBOOK}`
                 : `stop ${appName}, move ${path} aside, then run apply, which writes a new one; see ${REBUILD_RUNBOOK}`,
````

**Change** `packages/cli/src/output.ts`:

````diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index 0fc68cb..d1cc19f 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -107,3 +107,3 @@ export function driftAdvice(drift: readonly Drift[]): string[] {
       ? [
-          `apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app; for any other app, put it back as ${WIRING_RUNBOOK} shows`,
+          `apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app; for any other app, put it back as ${WIRING_RUNBOOK} shows. mediaplane keep <app>.<key> keeps the app's own key instead`,
         ]
@@ -308,4 +308,17 @@ export function printKeep(result: KeepResult, options: { json: boolean }, io: Io
   for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
+  if (result.ok && result.holders !== undefined) {
+    const [app] = result.key.split('.');
+    io.stdout(
+      `Kept ${String(app)}'s own key (${result.key}) in state/secrets.json, where Mediaplane keeps its keys; stack.yaml is as it was.\n${
+        result.holders.length === 0
+          ? 'No resource of the stack holds the old one.\n'
+          : `Run apply to give it to ${result.holders.join(', ')}, which hold the old one.\n`
+      }`,
+    );
+    return;
+  }
   if (!result.ok || result.value === undefined) {
-    io.stderr('\nNothing was kept; stack.yaml is as it was.\n');
+    io.stderr(
+      '\nNothing was kept; stack.yaml and state/secrets.json are as they were.\n',
+    );
     return;
````

**Change** `packages/cli/src/run.ts`:

````diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index 26857db..8b7e700 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -119,2 +119,3 @@ export const EXIT_CODES: Readonly<Record<string, readonly string[]>> = {
     '0: stack.yaml keeps what the app holds, or stops managing what was deleted',
+    "0: or state/secrets.json keeps an app's own key, which the app takes",
     "1: nothing was kept: it hasn't drifted, can't be kept, or an error",
@@ -373,3 +374,3 @@ export function createProgram(
     .description(
-      'Keep mine: take what an app holds now, changed outside Mediaplane, as what you want, written as an override in stack.yaml, keeping the rest of the file as it is; or, for a resource deleted outside Mediaplane, stop managing it',
+      "Keep mine: take what an app holds now, changed outside Mediaplane, as what you want, written as an override in stack.yaml, keeping the rest of the file as it is; or, for a resource deleted outside Mediaplane, stop managing it; or, for an app's own key changed in the app, take the key its own file holds, once the app takes it, into state/secrets.json, which the next apply gives to every resource that holds the old one",
     )
@@ -377,3 +378,3 @@ export function createProgram(
       '<path>',
-      'what to keep, as drift shows it: <app>.<resource>.<field>, or <app>.<resource> for one deleted',
+      "what to keep, as drift shows it: <app>.<resource>.<field>, or <app>.<resource> for one deleted, or <app>.<key> for an app's own key",
     )
````

- [ ] **Step 4: Regenerate the CLI reference**

Run: `pnpm docs:generate`
Expected: it rewrites `docs/reference/cli.md` (`keep`'s description, argument and exit codes).

- [ ] **Step 5: Run them, and see them pass**

Run: `pnpm vitest run packages/engine/src/keep.test.ts packages/engine/src/secrets/restore.test.ts packages/cli/src/output.test.ts packages/cli/src/run.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(engine): keep an app's own key changed at its source, which the next apply gives to every resource that holds it" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


### Task 4: The setups: Jellyfin's key made again, the wiring past a failed setup, and only the keys you give

Decisions 11 to 13. An app that refuses the key its setup made, its setup done, has the
setup run again, published. A setup that fails no longer stops the wire step, which skips
that app's resources. A setup gets only the keys you give (`given`), `firstStart` loses
its unused stack, and the own login is Plex's. The Jellyfin end-to-end test makes the
key again with no hand edit of `state/secrets.json`.

**Files:**
- Modify: `packages/engine/src/catalog/types.ts`, `packages/engine/src/secrets/values.ts`, `packages/engine/src/plan/bootstrap.ts`, `packages/engine/src/plan/plan.ts`, `packages/engine/src/apply/bootstrap.ts`, `packages/engine/src/apply/apply.ts`, `packages/engine/src/integrations/wire.ts`, `catalog/plex/bootstrap.ts`, `catalog/seerr/bootstrap.ts`
- Test: `packages/engine/src/testing/bootstrap.ts`, `packages/engine/src/plan/bootstrap.test.ts`, `packages/engine/src/secrets/values.test.ts`, `packages/engine/src/integrations/wire.test.ts`, `packages/engine/src/apply/apply.test.ts`, `catalog/plex/bootstrap.test.ts`, `catalog/seerr/bootstrap.test.ts`, `catalog/seerr/integration.test.ts`, `test/e2e/jellyfin.e2e.test.ts`

**Interfaces:**
- **Consumes:** `appSetupDone`, `inspectBootstrap` (Slice 5); the plan's `drift` (Slice 8).
- **Produces:**
  - `setupsToMakeKeys(stack: ResolvedStack, refusing: readonly string[], listed: readonly BootstrapChange[]): Promise<BootstrapChange[]>`.
  - `bootstrapApps(options): Promise<BootstrapResult>`, with `interface BootstrapResult { store: SecretStore; detail: string; waiting: WaitingSetup[]; failed: FailedSetup[] }` and `interface FailedSetup { app: string; reason: string }`; `setupFailure(set: BootstrapResult): BootstrapFailed | undefined`.
  - `WireOptions.failed?: readonly string[]`: those apps' resources are skipped (`<app>'s first-run setup failed`).
  - `BootstrapContext.given` (in place of `keys`), `givenKeys(stack, given): Record<string, Record<string, string>>`; `Bootstrap.firstStart?(ctx: BootstrapContext)`; `AppLoginKind = 'shared' | { own: 'Plex' } | { comingIn: string }`.
  - Apply's step runner (`Steps`, in `apply.ts`) gains `runDespite(step, despite: readonly ApplyStep[], work)`: the wire step runs despite a bootstrap step whose setups failed.

- [ ] **Step 1: Write the failing tests**

The fake setups' context, as the contract names it now:

**Change** `packages/engine/src/testing/bootstrap.ts`:

````diff
diff --git a/packages/engine/src/testing/bootstrap.ts b/packages/engine/src/testing/bootstrap.ts
index 8c84c45..d3e4c73 100644
--- a/packages/engine/src/testing/bootstrap.ts
+++ b/packages/engine/src/testing/bootstrap.ts
@@ -15,3 +15,3 @@ import { fakeHttpApp, type FakeApp, type FakeReply, type FakeRequest } from './h
  */
-export const NO_SETUP_CONTEXT: BootstrapContext = { keys: {}, plexTv: NO_PLEX_TV };
+export const NO_SETUP_CONTEXT: BootstrapContext = { given: {}, plexTv: NO_PLEX_TV };
 
````

**Change** `packages/engine/src/plan/bootstrap.test.ts`:

````diff
diff --git a/packages/engine/src/plan/bootstrap.test.ts b/packages/engine/src/plan/bootstrap.test.ts
index cd51cb1..e450629 100644
--- a/packages/engine/src/plan/bootstrap.test.ts
+++ b/packages/engine/src/plan/bootstrap.test.ts
@@ -8,3 +8,3 @@ import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures
 import { tempDir } from '../testing/temp';
-import { inspectBootstrap, planBootstrap } from './bootstrap';
+import { inspectBootstrap, planBootstrap, setupsToMakeKeys } from './bootstrap';
 
@@ -215 +215,40 @@ describe('planBootstrap: a setup that makes no key', () => {
 });
+
+describe('setupsToMakeKeys', () => {
+  it('sets up again, published, an app that refuses the key its setup made, once its setup is done', async () => {
+    const stack = await stackIn();
+    await setupFile(stack, 'done\n');
+    expect(await setupsToMakeKeys(stack, ['jellyfin'], [])).toEqual([
+      { app: 'jellyfin', unpublished: false },
+    ]);
+    // Not one that takes its key, nor one the plan sets up already.
+    expect(await setupsToMakeKeys(stack, [], [])).toEqual([]);
+    expect(
+      await setupsToMakeKeys(
+        stack,
+        ['jellyfin'],
+        [{ app: 'jellyfin', unpublished: true }],
+      ),
+    ).toEqual([]);
+  });
+
+  it("leaves one whose setup isn't shown to be done, and one whose setup makes no key", async () => {
+    const stack = await stackIn();
+    await setupFile(stack, 'open\n');
+    expect(await setupsToMakeKeys(stack, ['jellyfin'], [])).toEqual([]);
+    await rm(join(stack.home, 'appdata', 'jellyfin', 'setup.txt'));
+    // It can't be read: whether the setup is open can't be told.
+    await setupFile(stack, undefined);
+    expect(await setupsToMakeKeys(stack, ['jellyfin'], [])).toEqual([]);
+    const resolved = resolveStack(
+      fixtureConfig(STACK),
+      SIGN_IN_CATALOG,
+      FIXTURE_HOST,
+      stack.home,
+    );
+    if (resolved.stack === undefined) throw new Error('the stack did not resolve');
+    await mkdir(join(stack.home, 'appdata', 'sonarr'), { recursive: true });
+    await writeFile(join(stack.home, 'appdata', 'sonarr', 'signed-in.txt'), 'yes\n');
+    expect(await setupsToMakeKeys(resolved.stack, ['sonarr'], [])).toEqual([]);
+  });
+});
````

**Change** `packages/engine/src/secrets/values.test.ts`:

````diff
diff --git a/packages/engine/src/secrets/values.test.ts b/packages/engine/src/secrets/values.test.ts
index d02f2ef..0a53d74 100644
--- a/packages/engine/src/secrets/values.test.ts
+++ b/packages/engine/src/secrets/values.test.ts
@@ -4,5 +4,11 @@ import { describe, expect, it } from 'vitest';
 import { resolveStack, type ResolvedStack } from '../resolver/resolve';
-import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
+import {
+  FIXTURE_API,
+  FIXTURE_HOST,
+  fixtureCatalog,
+  fixtureConfig,
+} from '../testing/fixtures';
 import { emptySecretStore, type SecretStore } from './store';
 import {
+  givenKeys,
   missingGeneratedSecrets,
@@ -155 +161,26 @@ describe('userSecrets and stackKeys', () => {
 });
+
+describe('givenKeys', () => {
+  it("gives only the secrets you give that an app's API takes as its key", async () => {
+    const stack = await stackIn();
+    const catalog = fixtureCatalog.map((app) =>
+      app.id === 'gluetun'
+        ? {
+            ...app,
+            api: {
+              ...FIXTURE_API,
+              key: { secret: 'wireguardKey', scheme: 'x-api-key' as const },
+            },
+          }
+        : app,
+    );
+    const keyed = resolveStack(fixtureConfig(STACK), catalog, FIXTURE_HOST, stack.home);
+    if (keyed.stack === undefined) throw new Error('the stack did not resolve');
+    const given = { gluetun: { wireguardKey: 'fake-key', other: 'fake-other' } };
+    expect(givenKeys(keyed.stack, given)).toEqual({
+      gluetun: { wireguardKey: 'fake-key' },
+    });
+    // Without an API that takes it, the VPN key reaches no setup.
+    expect(givenKeys(stack, given)).toEqual({});
+  });
+});
````

**Change** `packages/engine/src/integrations/wire.test.ts`:

````diff
diff --git a/packages/engine/src/integrations/wire.test.ts b/packages/engine/src/integrations/wire.test.ts
index be3949f..16545b1 100644
--- a/packages/engine/src/integrations/wire.test.ts
+++ b/packages/engine/src/integrations/wire.test.ts
@@ -483,2 +483,27 @@ describe('wire', () => {
     );
+    // A setup that failed, rather than one that waits, is said so.
+    const sonarrAgain = await fakeSonarr({ key: KEY });
+    const failed = await wireWith(
+      {
+        seams: sonarrAgain.seams,
+        addresses: { ...sonarrAgain.addresses, 'fake-jellyfin': '127.0.0.1' },
+      },
+      {
+        stack: stackOf(wired),
+        store: {
+          version: 1,
+          apps: { sonarr: { apiKey: KEY }, jellyfin: { apiKey: KEY } },
+          shared: { adminPassword: PASSWORD },
+        },
+        failed: ['jellyfin'],
+      },
+    );
+    expect(
+      ((await failed.run.catch((thrown: unknown) => thrown)) as WiringFailed).message,
+    ).toBe(
+      "the wiring failed for sonarr.login; skipped sonarr.second, which needs what failed; skipped jellyfin.needs, jellyfin.free, whose app's first-run setup failed",
+    );
+    expect(failed.actions.find((a) => a.resource === 'jellyfin.free')?.detail).toBe(
+      "jellyfin's first-run setup failed",
+    );
   });
````

**Change** `packages/engine/src/apply/apply.test.ts`:

````diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index d8fe619..27c8a5b 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -1842,6 +1842,8 @@ describe('apply: first-run setup before the ports are published', () => {
     expect(result.outcome).toBe('failed');
-    expect(result.actions.slice(-3).map((a) => [a.step, a.result])).toEqual([
-      ['bootstrap', 'failed'],
-      ['wire', 'skipped'],
-      ['verify', 'skipped'],
+    // The wire step runs past it, skipping the app whose setup failed (spec §5.1).
+    expect(result.actions.slice(-4).map((a) => [a.step, a.resource, a.result])).toEqual([
+      ['bootstrap', undefined, 'failed'],
+      ['wire', 'jellyfin', 'skipped'],
+      ['wire', undefined, 'done'],
+      ['verify', undefined, 'skipped'],
     ]);
@@ -1908,2 +1910,27 @@ describe('apply: first-run setup before the ports are published', () => {
 
+  it('makes the key again, signed in and published throughout, for an app that refuses the one its setup made', async () => {
+    const { home, setup, ups, run } = await setUpStack();
+    expect((await run()).outcome).toBe('success');
+    // Its key deleted by hand, and another made: the app refuses the stored one.
+    setup.state.key = '7'.repeat(32);
+    const again = await run();
+    expect(again.outcome).toBe('success');
+    expect(again.plan.drift).toEqual([
+      { resource: 'jellyfin', kind: 'key', secret: 'apiKey' },
+    ]);
+    expect(again.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: false }]);
+    expect(again.plan.containers.find((c) => c.service === 'jellyfin')?.action).toBe(
+      'unchanged',
+    );
+    expect(again.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
+      'set up jellyfin and saved jellyfin.apiKey',
+    );
+    // The start step's up alone: it was never unpublished.
+    expect(ups.slice(2)).toEqual(['all published, setup done']);
+    expect((await readSecretStore(home)).apps.jellyfin).toEqual({
+      apiKey: '7'.repeat(32),
+    });
+    expect((await run()).outcome).toBe('no-changes');
+  });
+
   it('sets up again, without its ports, an app whose appdata lost its setup, and keeps its new key', async () => {
@@ -1937,6 +1964,8 @@ describe('apply: first-run setup before the ports are published', () => {
     expect(result.outcome).toBe('failed');
-    expect(result.actions.slice(-3).map((a) => [a.step, a.result])).toEqual([
-      ['bootstrap', 'failed'],
-      ['wire', 'skipped'],
-      ['verify', 'skipped'],
+    // The wire step runs past it, skipping the app whose setup failed (spec §5.1).
+    expect(result.actions.slice(-4).map((a) => [a.step, a.resource, a.result])).toEqual([
+      ['bootstrap', undefined, 'failed'],
+      ['wire', 'jellyfin', 'skipped'],
+      ['wire', undefined, 'done'],
+      ['verify', undefined, 'skipped'],
     ]);
@@ -1993,6 +2022,8 @@ describe('apply: first-run setup before the ports are published', () => {
     expect(result.plan.bootstrap).toEqual([{ app: 'jellyfin', unpublished: true }]);
-    expect(result.actions.slice(-3).map((a) => [a.step, a.result])).toEqual([
-      ['bootstrap', 'failed'],
-      ['wire', 'skipped'],
-      ['verify', 'skipped'],
+    // The wire step runs past it, skipping the app whose setup failed (spec §5.1).
+    expect(result.actions.slice(-4).map((a) => [a.step, a.resource, a.result])).toEqual([
+      ['bootstrap', undefined, 'failed'],
+      ['wire', 'jellyfin', 'skipped'],
+      ['wire', undefined, 'done'],
+      ['verify', undefined, 'skipped'],
     ]);
@@ -2246,2 +2277,31 @@ describe('apply: a first-run setup that makes no key, after another', () => {
 
+  it("wires the rest past a setup that failed, skipping that app's resources, and verifies nothing", async () => {
+    const { setup, run } = await signInStack();
+    // Someone signed in to Sonarr first: its setup fails, as claimed.
+    setup.signIn.refuse = true;
+    setup.signIn.claimant = true;
+    const failed = await run();
+    expect(failed.outcome).toBe('failed');
+    expect(
+      failed.actions.slice(-4).map((a) => [a.step, a.resource ?? '', a.result]),
+    ).toEqual([
+      ['bootstrap', '', 'failed'],
+      ['wire', 'sonarr', 'skipped'],
+      ['wire', '', 'done'],
+      ['verify', '', 'skipped'],
+    ]);
+    // The wire step asked Jellyfin, set up, whether it takes its key: the rest is wired.
+    expect(
+      setup.app.requests.some(
+        (r) => r.path === '/check' && (r.headers.host ?? '').startsWith('jellyfin:'),
+      ),
+    ).toBe(true);
+    expect(failed.actions.find((a) => a.resource === 'sonarr')?.detail).toBe(
+      "sonarr's first-run setup failed",
+    );
+    expect(failed.diagnostics.filter((d) => d.severity === 'error')).toEqual([
+      expect.objectContaining({ code: 'apply.bootstrap-failed' }),
+    ]);
+  });
+
   it('sets the apps up in the order of their integrations, not of their names', async () => {
@@ -2625,3 +2685,3 @@ describe("apply: a setup's first start, and what it is given", () => {
           ...bootstrap,
-          firstStart: (_stack, ctx) => {
+          firstStart: (ctx) => {
             seen.push(ctx);
@@ -2667,4 +2727,5 @@ describe("apply: a setup's first start, and what it is given", () => {
     expect(given).toEqual([JSON.stringify({ sonarr: { FIRST_START: FIRST } }), '{}']);
-    // The first start and the setup are given the stack's keys, and plex.tv as apply was
-    // given it, but no secret you give that no app's API takes as its key: the VPN key.
+    // The first start and the setup are given plex.tv as apply was given it, and of the
+    // stack's keys only those you give that an app's API takes as its key: none here.
+    // Neither state/secrets.json's (Sonarr's key) nor the VPN key you give.
     expect(seen).toHaveLength(2);
@@ -2672,4 +2733,3 @@ describe("apply: a setup's first start, and what it is given", () => {
       expect(ctx.plexTv).toBe(plexTv);
-      expect(ctx.keys.sonarr?.apiKey).toBeDefined();
-      expect(ctx.keys.gluetun?.wireguardKey).toBeUndefined();
+      expect(ctx.given).toEqual({});
     }
````

**Change** `catalog/plex/bootstrap.test.ts`:

````diff
diff --git a/catalog/plex/bootstrap.test.ts b/catalog/plex/bootstrap.test.ts
index 42c4b98..5b05e38 100644
--- a/catalog/plex/bootstrap.test.ts
+++ b/catalog/plex/bootstrap.test.ts
@@ -6,2 +6,3 @@ import {
   BootstrapFailed,
+  setupFailure,
   createAppApi,
@@ -100,3 +101,3 @@ async function plexOf(deadlineMs = 0) {
   const ctx: BootstrapContext = {
-    keys: { plex: { token: TOKEN } },
+    given: { plex: { token: TOKEN } },
     plexTv: plexTv.client,
@@ -118,4 +119,4 @@ describe("Plex's first-run setup", () => {
   it('gives its first start a claim token for your account, fetched with your token', async () => {
-    const { plexTv, ctx, stack } = await plexOf();
-    const env = await plexBootstrap.firstStart?.(stack, ctx);
+    const { plexTv, ctx } = await plexOf();
+    const env = await plexBootstrap.firstStart?.(ctx);
     expect(env).toEqual({ PLEX_CLAIM: plexTv.state.claims[0]?.token });
@@ -127,7 +128,7 @@ describe("Plex's first-run setup", () => {
   it("says what to do when it can't get a claim token, and never shows the token", async () => {
-    const { stack, plexTv } = await plexOf();
+    const { plexTv } = await plexOf();
     const refused = await thrown(
       Promise.resolve(
-        plexBootstrap.firstStart?.(stack, {
-          keys: { plex: { token: 'revoked-plex-token-0' } },
+        plexBootstrap.firstStart?.({
+          given: { plex: { token: 'revoked-plex-token-0' } },
           plexTv: plexTv.client,
@@ -148,4 +149,4 @@ describe("Plex's first-run setup", () => {
       Promise.resolve(
-        plexBootstrap.firstStart?.(stack, {
-          keys: { plex: { token: TOKEN } },
+        plexBootstrap.firstStart?.({
+          given: { plex: { token: TOKEN } },
           plexTv: away,
@@ -162,4 +163,4 @@ describe("Plex's first-run setup", () => {
       Promise.resolve(
-        plexBootstrap.firstStart?.(stack, {
-          keys: { plex: { token: TOKEN } },
+        plexBootstrap.firstStart?.({
+          given: { plex: { token: TOKEN } },
           plexTv: plexTv.client,
@@ -173,3 +174,3 @@ describe("Plex's first-run setup", () => {
     const none = await thrown(
-      Promise.resolve(plexBootstrap.firstStart?.(stack, { keys: {}, plexTv: away })),
+      Promise.resolve(plexBootstrap.firstStart?.({ given: {}, plexTv: away })),
     );
@@ -201,4 +202,4 @@ describe("Plex's first-run setup", () => {
         Promise.resolve(
-          plexBootstrap.firstStart?.(stack, {
-            keys: { plex: { token: TOKEN } },
+          plexBootstrap.firstStart?.({
+            given: { plex: { token: TOKEN } },
             plexTv: broken(cause),
@@ -220,3 +221,3 @@ describe("Plex's first-run setup", () => {
         plexBootstrap.run(api, ADMIN, stack, {
-          keys: { plex: { token: TOKEN } },
+          given: { plex: { token: TOKEN } },
           plexTv: broken(cause),
@@ -595,3 +596,3 @@ describe("Plex's first-run setup", () => {
       plexBootstrap.run(api, ADMIN, stack, {
-        keys: { plex: { token: 'revoked-plex-token-0' } },
+        given: { plex: { token: 'revoked-plex-token-0' } },
         plexTv: plexTv.client,
@@ -630,3 +631,3 @@ describe("Plex's first start, when it can't be prepared", () => {
     const failing = (cause: Error): BootstrapContext => ({
-      keys: { plex: { token: TOKEN } },
+      given: { plex: { token: TOKEN } },
       plexTv: { ...NO_PLEX_TV, claimToken: () => Promise.reject(cause) },
@@ -677,3 +678,3 @@ describe("Plex's first start, when it can't be prepared", () => {
     const failed = await thrown(
-      startVariables(odd, pending, { keys: {}, plexTv: NO_PLEX_TV }, runtime, {}),
+      startVariables(odd, pending, { given: {}, plexTv: NO_PLEX_TV }, runtime, {}),
     );
@@ -776,3 +777,3 @@ describe("Plex's first start, when it can't be prepared", () => {
     const failed = await thrown(
-      startVariables(odd, pending, { keys: {}, plexTv: NO_PLEX_TV }, runtime, {}),
+      startVariables(odd, pending, { given: {}, plexTv: NO_PLEX_TV }, runtime, {}),
     );
@@ -813,3 +814,3 @@ describe("Plex's first start, when it can't be prepared", () => {
     const failing = (): BootstrapContext => ({
-      keys: { plex: { token: TOKEN } },
+      given: { plex: { token: TOKEN } },
       plexTv: {
@@ -890,3 +891,3 @@ describe("Plex's setup, as apply's bootstrap step runs it", () => {
     };
-    const ctx: BootstrapContext = { keys: given, plexTv: client };
+    const ctx: BootstrapContext = { given, plexTv: client };
     const run = async (from: SecretStore) => {
@@ -913,2 +914,4 @@ describe("Plex's setup, as apply's bootstrap step runs it", () => {
       });
+      const failure = setupFailure(set);
+      if (failure !== undefined) throw failure;
       return { pending, env, ...set };
````

**Change** `catalog/seerr/bootstrap.test.ts`:

````diff
diff --git a/catalog/seerr/bootstrap.test.ts b/catalog/seerr/bootstrap.test.ts
index a1e24bd..c8d58d7 100644
--- a/catalog/seerr/bootstrap.test.ts
+++ b/catalog/seerr/bootstrap.test.ts
@@ -5,2 +5,3 @@ import {
   BootstrapFailed,
+  setupFailure,
   createAppApi,
@@ -522,2 +523,5 @@ describe("Seerr's first-run setup, through the engine's bootstrap step", () => {
       });
+      // As apply says it: a setup that failed is the step's failure.
+      const failure = setupFailure(set);
+      if (failure !== undefined) throw failure;
       return { pending, ...set };
@@ -662,3 +666,3 @@ describe("Seerr's first-run setup, with Plex", () => {
     const ctx: BootstrapContext = {
-      keys: { plex: { token: TOKEN } },
+      given: { plex: { token: TOKEN } },
       plexTv: plexTv.client,
@@ -708,3 +712,3 @@ describe("Seerr's first-run setup, with Plex", () => {
       seerrBootstrap.run(api, ADMIN, stack, {
-        keys: { plex: { token: 'revoked-plex-token-0' } },
+        given: { plex: { token: 'revoked-plex-token-0' } },
         plexTv: plexTv.client,
````

**Change** `catalog/seerr/integration.test.ts`:

````diff
diff --git a/catalog/seerr/integration.test.ts b/catalog/seerr/integration.test.ts
index 26b64a2..90d14b9 100644
--- a/catalog/seerr/integration.test.ts
+++ b/catalog/seerr/integration.test.ts
@@ -158,3 +158,3 @@ describe("Seerr's media server, with Plex", () => {
     await seerrBootstrap.run(api, ADMIN, contextOf(PLEX_STACK).stack, {
-      keys: { plex: { token: TOKEN } },
+      given: { plex: { token: TOKEN } },
       plexTv: plexTv.client,
````

**Change** `test/e2e/jellyfin.e2e.test.ts` (run with the end-to-end suite):

````diff
diff --git a/test/e2e/jellyfin.e2e.test.ts b/test/e2e/jellyfin.e2e.test.ts
index 1bc8d06..0424782 100644
--- a/test/e2e/jellyfin.e2e.test.ts
+++ b/test/e2e/jellyfin.e2e.test.ts
@@ -10,3 +10,2 @@ import {
   readSecretStore,
-  writeSecretStore,
   type ApplyOptions,
@@ -381,5 +380,5 @@ describe('Jellyfin, set up before it is published', () => {
       // Jellyfin's own key, deleted in its dashboard: plan says Jellyfin refuses it, and
-      // both arrs' own test refuses the old key their connections hold. With it taken out
-      // of state/secrets.json, apply signs in as the admin, published, makes a new key,
-      // and gives it to both arrs' connections, whose test then passes.
+      // both arrs' own test refuses the old key their connections hold. apply signs in as
+      // the admin, published, makes a new key, and gives it to both arrs' connections,
+      // whose test then passes (Slice 10a: no hand edit of state/secrets.json).
       const revoked = await api(JELLYFIN, `/Auth/Keys/${key}`, mediaBrowser(key), {
@@ -389,2 +388,3 @@ describe('Jellyfin, set up before it is published', () => {
       const refused = await plan(options);
+      expect(refused.bootstrap).toEqual([{ app: 'jellyfin', unpublished: false }]);
       expect(refused.wiring.filter((w) => w.resource.startsWith('jellyfin.'))).toEqual(
@@ -404,4 +404,2 @@ describe('Jellyfin, set up before it is published', () => {
       }
-      const { jellyfin: _lost, ...others } = store.apps;
-      await writeSecretStore(home, { ...store, apps: others });
       seen.length = 0;
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/plan/bootstrap.test.ts packages/engine/src/secrets/values.test.ts packages/engine/src/integrations/wire.test.ts packages/engine/src/apply/apply.test.ts catalog/plex catalog/seerr`

Expected: FAIL: 58 tests in 7 files (298 run). Plex's and Seerr's setups still read `ctx.keys`, which the tests give as `given` now, so they find no Plex token (48 tests in `catalog/plex` and `catalog/seerr`); `plan/bootstrap.test.ts` has no `setupsToMakeKeys`, `values.test.ts` no `givenKeys`, `wire.test.ts` no `failed`; in `apply.test.ts` the wire step is skipped after a setup that failed, and Jellyfin's key isn't made again.

- [ ] **Step 3: Implement**

The contract, and the keys a setup gets:

**Change** `packages/engine/src/catalog/types.ts`:

````diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index 8a4b2a6..2142f4f 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -162,6 +162,7 @@ export interface BootstrapContext {
   /**
-   * The stack's keys, by app then name: those in state/secrets.json, and the ones you
-   * give, such as Plex's token (`keys.plex.token`).
+   * The keys you give that an app's API takes as its key, by app then name: Plex's token
+   * (`given.plex.token`). None of state/secrets.json's: a setup reaches its own app with
+   * the client apply gives it, and no other app's key.
    */
-  keys: Readonly<Record<string, Readonly<Record<string, string>>>>;
+  given: Readonly<Record<string, Readonly<Record<string, string>>>>;
   /** plex.tv: called directly from source, through the plex.tv helper in the image. */
@@ -199,6 +200,3 @@ export interface Bootstrap {
    */
-  firstStart?(
-    stack: ResolvedStack,
-    ctx: BootstrapContext,
-  ): Promise<Record<string, string>>;
+  firstStart?(ctx: BootstrapContext): Promise<Record<string, string>>;
   /**
@@ -230,6 +228,7 @@ export interface Bootstrap {
  * How you sign in to an app's web UI: with the shared admin login (`'shared'`), with your
- * own account of the service it names (`{ own: 'Plex' }`: your plex.tv account), or with a
- * login a later slice brings.
+ * own plex.tv account (`{ own: 'Plex' }`), or with a login a later slice brings
+ * (`{ comingIn }`), which no app of the catalog has now: `mediaplane credentials` keeps
+ * saying `not-yet` for one, as `mediaplane.credentials/v1` allows, for the apps to come.
  */
-export type AppLoginKind = 'shared' | { own: string } | { comingIn: string };
+export type AppLoginKind = 'shared' | { own: 'Plex' } | { comingIn: string };
 
````

**Change** `packages/engine/src/secrets/values.ts`:

````diff
diff --git a/packages/engine/src/secrets/values.ts b/packages/engine/src/secrets/values.ts
index 71a4db1..892f388 100644
--- a/packages/engine/src/secrets/values.ts
+++ b/packages/engine/src/secrets/values.ts
@@ -67,13 +67,12 @@ export async function userSecrets(
 /**
- * Every app's keys, by app then name: the store's, and of the ones you give (userSecrets),
- * only those an app's API takes as its key, such as Plex's token, which is Plex's key to
- * Mediaplane. The others, such as the VPN key, are redacted, but never reach a setup or a
- * resource.
+ * Of the secrets you give (userSecrets), only those an app's API takes as its key, by app
+ * then name, such as Plex's token, which is Plex's key to Mediaplane: what a first-run
+ * setup gets (BootstrapContext.given). The others, such as the VPN key, are redacted, but
+ * never reach a setup or a resource.
  */
-export function stackKeys(
+export function givenKeys(
   stack: ResolvedStack,
-  store: SecretStore,
   given: Readonly<Record<string, Readonly<Record<string, string>>>>,
 ): Record<string, Record<string, string>> {
-  const keys: Record<string, Record<string, string>> = { ...store.apps };
+  const keys: Record<string, Record<string, string>> = {};
   for (const app of stack.apps) {
@@ -81,5 +80,19 @@ export function stackKeys(
     const value = name === undefined ? undefined : given[app.def.id]?.[name];
-    if (name !== undefined && value !== undefined) {
-      keys[app.def.id] = { ...keys[app.def.id], [name]: value };
-    }
+    if (name !== undefined && value !== undefined) keys[app.def.id] = { [name]: value };
+  }
+  return keys;
+}
+
+/**
+ * Every app's keys, by app then name: the store's, and the ones you give that an app's
+ * API takes as its key (givenKeys).
+ */
+export function stackKeys(
+  stack: ResolvedStack,
+  store: SecretStore,
+  given: Readonly<Record<string, Readonly<Record<string, string>>>>,
+): Record<string, Record<string, string>> {
+  const keys: Record<string, Record<string, string>> = { ...store.apps };
+  for (const [app, held] of Object.entries(givenKeys(stack, given))) {
+    keys[app] = { ...keys[app], ...held };
   }
````

**Change** `catalog/plex/bootstrap.ts`:

````diff
diff --git a/catalog/plex/bootstrap.ts b/catalog/plex/bootstrap.ts
index 9cd38fd..c55195d 100644
--- a/catalog/plex/bootstrap.ts
+++ b/catalog/plex/bootstrap.ts
@@ -122,3 +122,3 @@ function opens(settings: readonly { id: string; value?: unknown }[]): OpenSettin
 function tokenOf(ctx: BootstrapContext): string | undefined {
-  return ctx.keys.plex?.token;
+  return ctx.given.plex?.token;
 }
@@ -217,3 +217,3 @@ export const plexBootstrap: Bootstrap = {
   open: async (api) => !(await identityOf(api)).claimed,
-  async firstStart(_stack, ctx) {
+  async firstStart(ctx) {
     const token = tokenOf(ctx);
````

**Change** `catalog/seerr/bootstrap.ts`:

````diff
diff --git a/catalog/seerr/bootstrap.ts b/catalog/seerr/bootstrap.ts
index 2218b92..c9f8f2b 100644
--- a/catalog/seerr/bootstrap.ts
+++ b/catalog/seerr/bootstrap.ts
@@ -224,3 +224,3 @@ async function runPlex(
   const plex = stackAddress(stack, 'plex');
-  const token = ctx.keys.plex?.token;
+  const token = ctx.given.plex?.token;
   if (plex === undefined || token === undefined) {
````

A setup made again for a key refused:

**Change** `packages/engine/src/plan/bootstrap.ts`:

````diff
diff --git a/packages/engine/src/plan/bootstrap.ts b/packages/engine/src/plan/bootstrap.ts
index 71a6945..579787a 100644
--- a/packages/engine/src/plan/bootstrap.ts
+++ b/packages/engine/src/plan/bootstrap.ts
@@ -90,2 +90,28 @@ export async function inspectBootstrap(
 
+/**
+ * The apps whose first-run setup runs again, published, because they refuse the key it
+ * made (`refusing`, by app: spec §6.3, "a key changed at its source"), as Jellyfin does once
+ * its key is deleted by hand. Only one whose appdata says its setup is done, so nobody can
+ * claim it, and that `listed` doesn't name already: its setup signs in as the shared
+ * admin, finds the key named for Mediaplane or makes another, and saves it; the resources
+ * that hold the old one take the new one in the wire step. Reads only.
+ */
+export async function setupsToMakeKeys(
+  stack: ResolvedStack,
+  refusing: readonly string[],
+  listed: readonly BootstrapChange[],
+): Promise<BootstrapChange[]> {
+  const changes: BootstrapChange[] = [];
+  for (const app of stack.apps) {
+    const setup = app.def.bootstrap;
+    const id = app.def.id;
+    if (setup?.secret === undefined || setup.secret !== app.def.api?.key.secret) continue;
+    if (!refusing.includes(id) || listed.some((change) => change.app === id)) continue;
+    if ((await appSetupDone(stack.home, app)) === true) {
+      changes.push({ app: id, unpublished: false });
+    }
+  }
+  return changes;
+}
+
 /** The apps whose first-run setup apply will finish; see `inspectBootstrap`. */
````

**Change** `packages/engine/src/plan/plan.ts`:

````diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index e10896d..59a8026 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -48,3 +48,3 @@ import {
 import { planAppdata } from './appdata';
-import { inspectBootstrap, type BootstrapChange } from './bootstrap';
+import { inspectBootstrap, setupsToMakeKeys, type BootstrapChange } from './bootstrap';
 import { notYetHealthy, otherHomes, ownPorts, type ContainerChange } from './containers';
@@ -268,3 +268,3 @@ export async function planStack(
   if (hasErrors(diagnostics)) return failed(diagnostics);
-  const bootstrap = setups.changes;
+  let bootstrap = setups.changes;
   const unpublished = new Set(bootstrap.filter((b) => b.unpublished).map((b) => b.app));
@@ -355,2 +355,7 @@ export async function planStack(
       diagnostics.push(...planned.diagnostics);
+      // An app that refuses the key its setup made has the setup run again, signed in.
+      const refusing = drift
+        .filter((d) => d.kind === 'key' && d.source === undefined)
+        .map((d) => d.resource);
+      bootstrap = [...bootstrap, ...(await setupsToMakeKeys(stack, refusing, bootstrap))];
     } catch (cause) {
````

The wiring past a setup that failed:

**Change** `packages/engine/src/apply/bootstrap.ts`:

````diff
diff --git a/packages/engine/src/apply/bootstrap.ts b/packages/engine/src/apply/bootstrap.ts
index 8f0be14..5e719db 100644
--- a/packages/engine/src/apply/bootstrap.ts
+++ b/packages/engine/src/apply/bootstrap.ts
@@ -19,3 +19,3 @@ import { adminLogin } from '../secrets/admin';
 import { writeSecretStore, type SecretStore } from '../secrets/store';
-import { stackKeys } from '../secrets/values';
+import { givenKeys } from '../secrets/values';
 import { foundSecrets, redact, type FoundSecrets } from '../util/redact';
@@ -65,2 +65,19 @@ export interface WaitingSetup {
 
+/** An app whose first-run setup failed, and why: redacted, for the user. */
+export interface FailedSetup {
+  app: string;
+  reason: string;
+}
+
+/** What the bootstrap step did: the store with its keys, and how each setup went. */
+export interface BootstrapResult {
+  store: SecretStore;
+  /** What it did, for the step's detail. */
+  detail: string;
+  /** The setups that wait, which didn't fail. */
+  waiting: WaitingSetup[];
+  /** The setups that failed: their apps stay as the plan started them, or unpublished. */
+  failed: FailedSetup[];
+}
+
 /**
@@ -81,2 +98,15 @@ const HINT = `fix what the error says, then run apply again: an app whose setup
 
+/**
+ * The bootstrap step's failure, when a setup failed: what each failed setup said, and
+ * each that waits; undefined when none failed.
+ */
+export function setupFailure(set: BootstrapResult): BootstrapFailed | undefined {
+  if (set.failed.length === 0) return undefined;
+  const said = [
+    ...set.failed.map((f) => f.reason),
+    ...set.waiting.map((w) => `${w.app} waits: ${w.reason}`),
+  ];
+  return new BootstrapFailed(`the first-run setup failed: ${said.join('; ')}`, HINT);
+}
+
 const LEAVE_HINT = `Mediaplane steps off the stack's wiring network before Compose publishes the apps, and couldn't, so nothing was published; fix what the error says, then run apply again. See ${WIRING_RUNBOOK}`;
@@ -108,8 +138,7 @@ function withSecret(
  *
- * Returns the store with the new keys, what it did, and the apps whose setup waits;
- * throws BootstrapFailed when a setup failed, once it has published what it can.
+ * Returns the store with the new keys, what it did, and the apps whose setup waits or
+ * failed (setupFailure says the step's failure), once it has published what it can.
+ * Throws BootstrapFailed when it couldn't reach the apps, or publish them.
  */
-export async function bootstrapApps(
-  options: BootstrapOptions,
-): Promise<{ store: SecretStore; detail: string; waiting: WaitingSetup[] }> {
+export async function bootstrapApps(options: BootstrapOptions): Promise<BootstrapResult> {
   const { stack, runtime } = options;
@@ -148,3 +177,2 @@ export async function bootstrapApps(
   const found = options.found ?? foundSecrets();
-  const allKeys = stackKeys(stack, options.store, given);
   // A key that Mediaplane chose, and the app takes from its environment (Seerr's), is
@@ -162,3 +190,6 @@ export async function bootstrapApps(
   );
-  const ctx: BootstrapContext = { keys: allKeys, plexTv: options.plexTv ?? NO_PLEX_TV };
+  const ctx: BootstrapContext = {
+    given: givenKeys(stack, given),
+    plexTv: options.plexTv ?? NO_PLEX_TV,
+  };
   let reached: Map<string, ReachedApp>;
@@ -186,3 +217,3 @@ export async function bootstrapApps(
   const saved: string[] = [];
-  const failed: string[] = [];
+  const failed: FailedSetup[] = [];
   const waiting: WaitingSetup[] = [];
@@ -239,3 +270,5 @@ export async function bootstrapApps(
       );
-    if (result.failure !== undefined) failed.push(clean(result.failure));
+    if (result.failure !== undefined) {
+      failed.push({ app: app.def.id, reason: clean(result.failure) });
+    }
     if (result.waiting !== undefined) {
@@ -265,8 +298,2 @@ export async function bootstrapApps(
   const waits = waiting.map((w) => `${w.app} waits: ${w.reason}`);
-  if (failed.length > 0) {
-    throw new BootstrapFailed(
-      `the first-run setup failed: ${[...failed, ...waits].join('; ')}`,
-      HINT,
-    );
-  }
   const finished = apps.filter((app) => !unfinished.includes(app)).map((a) => a.def.id);
@@ -282,2 +309,3 @@ export async function bootstrapApps(
     waiting,
+    failed,
   };
@@ -443,3 +471,3 @@ export async function firstStartEnv(
     if (bootstrap?.firstStart === undefined) continue;
-    env[app.def.id] = await bootstrap.firstStart(stack, ctx);
+    env[app.def.id] = await bootstrap.firstStart(ctx);
   }
````

**Change** `packages/engine/src/integrations/wire.ts`:

````diff
diff --git a/packages/engine/src/integrations/wire.ts b/packages/engine/src/integrations/wire.ts
index 4a0f5ff..e304a99 100644
--- a/packages/engine/src/integrations/wire.ts
+++ b/packages/engine/src/integrations/wire.ts
@@ -69,2 +69,7 @@ export interface WireOptions {
   waiting?: readonly string[];
+  /**
+   * Apps whose first-run setup failed, which the bootstrap step said: their resources are
+   * skipped, and so is what requires them, as for one that waits.
+   */
+  failed?: readonly string[];
   /** What the run finds in the apps' answers (FoundSecrets); the step's own, by default. */
@@ -147,2 +152,4 @@ export async function wire(options: WireOptions): Promise<string[]> {
   const waited: string[] = [];
+  /** Skipped because an app's first-run setup failed, or because they need what is. */
+  const unset: string[] = [];
   const done: string[] = [];
@@ -202,6 +209,7 @@ export async function wire(options: WireOptions): Promise<string[]> {
     const targets = wiringTargets(ctx);
-    if (options.waiting?.includes(app.def.id) === true) {
+    const waits = options.waiting?.includes(app.def.id) === true;
+    if (waits || options.failed?.includes(app.def.id) === true) {
       for (const target of targets) {
         skipped.push(target);
-        waited.push(target);
+        (waits ? waited : unset).push(target);
         options.record({
@@ -210,3 +218,3 @@ export async function wire(options: WireOptions): Promise<string[]> {
           result: 'skipped',
-          detail: `${app.def.id}'s first-run setup waits`,
+          detail: `${app.def.id}'s first-run setup ${waits ? 'waits' : 'failed'}`,
         });
@@ -248,2 +256,3 @@ export async function wire(options: WireOptions): Promise<string[]> {
         if (waited.includes(blocker)) waited.push(address);
+        if (unset.includes(blocker)) unset.push(address);
         options.record({
@@ -333,3 +342,3 @@ export async function wire(options: WireOptions): Promise<string[]> {
   if (failed.length > 0) {
-    throw new WiringFailed(failureMessage(failed, skipped, waited), diagnostics, {
+    throw new WiringFailed(failureMessage(failed, skipped, waited, unset), diagnostics, {
       hint: HINTS.resources,
@@ -377,3 +386,4 @@ async function makeFolders(
  * "the wiring failed for a; skipped b, which needs what failed; skipped c, which waits for
- * a first-run setup". A resource skipped because a setup waits didn't fail anything.
+ * a first-run setup; skipped d, whose app's first-run setup failed". A resource skipped
+ * because of a setup didn't fail anything here: the bootstrap step said what did.
  */
@@ -383,4 +393,7 @@ function failureMessage(
   waited: readonly string[],
+  unset: readonly string[],
 ): string {
-  const after = skipped.filter((address) => !waited.includes(address));
+  const after = skipped.filter(
+    (address) => !waited.includes(address) && !unset.includes(address),
+  );
   const because =
@@ -393,3 +406,7 @@ function failureMessage(
       : `; skipped ${waited.join(', ')}, which ${waited.length === 1 ? 'waits' : 'wait'} for a first-run setup`;
-  return `the wiring failed for ${failed.join(', ')}${because}${waits}`;
+  const unsetUp =
+    unset.length === 0
+      ? ''
+      : `; skipped ${unset.join(', ')}, whose app's first-run setup failed`;
+  return `the wiring failed for ${failed.join(', ')}${because}${waits}${unsetUp}`;
 }
````

**Change** `packages/engine/src/apply/apply.ts`:

````diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index d7ac25b..2b3a9e1 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -31,3 +31,3 @@ import { restoreKeys } from '../secrets/restore';
 import { writeSecretStore } from '../secrets/store';
-import { secretValues, stackKeys, userSecrets } from '../secrets/values';
+import { givenKeys, secretValues, userSecrets } from '../secrets/values';
 import { acquireLock, LockedError, type Lock } from '../state/lock';
@@ -39,3 +39,8 @@ import { compare } from '../util/sort';
 import { vpnCheck, VPN_RUNBOOK } from '../vpn/check';
-import { bootstrapApps, BootstrapFailed, startVariables } from './bootstrap';
+import {
+  bootstrapApps,
+  BootstrapFailed,
+  setupFailure,
+  startVariables,
+} from './bootstrap';
 import {
@@ -230,3 +235,3 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
       shown.bootstrap,
-      { keys: stackKeys(stack, store, given), plexTv },
+      { given: givenKeys(stack, given), plexTv },
       runtime,
@@ -292,2 +297,7 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
   let waiting: string[] = [];
+  /**
+   * The apps whose first-run setup failed: the step fails, but the wire step still runs,
+   * skipping their resources and what requires them (spec §5.1).
+   */
+  let unset: string[] = [];
   /** The secrets the bootstrap and wire steps read in the apps' answers. */
@@ -313,2 +323,5 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
       waiting = set.waiting.map((w) => w.app);
+      unset = set.failed.map((f) => f.app);
+      const failure = setupFailure(set);
+      if (failure !== undefined) throw failure;
       // The step goes on: the wire step may make the app ready, as the next apply finds.
@@ -324,3 +337,4 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
   }
-  await steps.run('wire', async () => {
+  // Past a setup that failed, which skips that app: not past any other failure.
+  await steps.runDespite('wire', unset.length > 0 ? ['bootstrap'] : [], async () => {
     try {
@@ -340,2 +354,3 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
         waiting,
+        failed: unset,
         found,
@@ -477,3 +492,16 @@ class Steps {
   async run(step: ApplyStep, work: () => Promise<string>): Promise<void> {
-    if (this.failed) {
+    await this.runDespite(step, [], work);
+  }
+
+  /** run(), past a failure of the steps `despite` names. */
+  async runDespite(
+    step: ApplyStep,
+    despite: readonly ApplyStep[],
+    work: () => Promise<string>,
+  ): Promise<void> {
+    if (
+      this.actions.some(
+        (action) => action.result === 'failed' && !despite.includes(action.step),
+      )
+    ) {
       this.#finish({ step, result: 'skipped' });
````

- [ ] **Step 4: Run them, and see them pass**

Run: `pnpm vitest run packages/engine/src/plan/bootstrap.test.ts packages/engine/src/secrets/values.test.ts packages/engine/src/integrations/wire.test.ts packages/engine/src/apply/apply.test.ts catalog/plex catalog/seerr`
Expected: PASS.

- [ ] **Step 5: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(engine): a setup makes its app's key again when the app refuses it, and the wiring runs past a setup that failed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Rotating the admin password, and no sign-in with a password yet to be generated

Decisions 14 and 15. `plan --rotate admin.password` and `apply --rotate admin.password`
plan with the store's generated password left out, so it is generated anew and set in
each app through its key. A secret apply is to generate is taken as a change, unchecked.

**Files:**
- Modify: `packages/engine/src/integrations/wiring.ts`, `packages/engine/src/plan/plan.ts`, `packages/engine/src/apply/apply.ts`, `packages/cli/src/run.ts`
- Test: `packages/engine/src/integrations/wiring.test.ts`, `packages/engine/src/plan/plan.test.ts`, `packages/engine/src/apply/apply.test.ts`, `packages/cli/src/run.test.ts`
- Generated: `docs/reference/cli.md`

**Interfaces:**
- **Consumes:** `missingGeneratedSecrets`, `adminPasswordToGenerate`, `ADMIN_PASSWORD_PATH`; the plan's preview of the store.
- **Produces:** `PlanOptions.rotate?: readonly string[]` (so `ApplyOptions` too), `ROTATABLE: readonly string[]` (`['admin.password']`); `ExamineOptions.fresh?` and `PlanWiringOptions.fresh?: readonly string[]` (the values apply generates); diagnostics `rotate.unknown`, `rotate.yours`; the CLI's `--rotate <secret>` on `plan` and `apply`.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/engine/src/integrations/wiring.test.ts`:

````diff
diff --git a/packages/engine/src/integrations/wiring.test.ts b/packages/engine/src/integrations/wiring.test.ts
index 30a90e1..2df622d 100644
--- a/packages/engine/src/integrations/wiring.test.ts
+++ b/packages/engine/src/integrations/wiring.test.ts
@@ -130,2 +130,27 @@ describe('planWiring', () => {
 
+  it('takes a secret apply generates as a change, never signing in with it: no app holds it yet', async () => {
+    const sonarr = await fakeSonarr({ key: KEY, user: 'admin', password: PASSWORD });
+    const fresh = 'fake-new-password';
+    const planned = await planWiring(
+      options(sonarr, {
+        known: RECORDED,
+        admin: { username: 'admin', password: fresh },
+        fresh: [fresh],
+      }),
+    );
+    expect(planned).toMatchObject({
+      changes: [{ resource: 'sonarr.login', action: 'update', changes: ['password'] }],
+      drift: [],
+      checks: [
+        {
+          resource: 'sonarr.login',
+          secret: 'password',
+          verdict: 'unchecked',
+          reason: 'apply generates it, and sets it: no app holds it yet',
+        },
+      ],
+    });
+    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
+  });
+
   it('checks no secret while a field differs: the update sets them all the same', async () => {
````

**Change** `packages/engine/src/plan/plan.test.ts`:

````diff
diff --git a/packages/engine/src/plan/plan.test.ts b/packages/engine/src/plan/plan.test.ts
index 3632904..76b5ae3 100644
--- a/packages/engine/src/plan/plan.test.ts
+++ b/packages/engine/src/plan/plan.test.ts
@@ -39,2 +39,5 @@ apps:
 const SERVICES = ['gluetun', 'jellyfin', 'qbittorrent', 'sonarr'];
+
+/** The key makeHome's store holds for Sonarr. */
+const KEY_OF_STORE = '0'.repeat(32);
 const HASHES = Object.fromEntries(SERVICES.map((s, i) => [s, String(i).repeat(64)]));
@@ -1370 +1373,80 @@ describe('plan: the wiring', () => {
 });
+
+describe('plan: rotating the admin password', () => {
+  it('generates it anew, as one to set in each app, signing in to none with it', async () => {
+    const sonarr = await fakeSonarr({
+      key: KEY_OF_STORE,
+      user: 'admin',
+      password: 'fake-admin-password',
+    });
+    const home = await makeHome({ withStore: true });
+    await writeResources(home, {
+      'sonarr.login': {
+        id: null,
+        name: 'login',
+        fields: { user: 'admin' },
+        secrets: ['password'],
+        appliedAt: '2026-10-10T12:00:00.000Z',
+      },
+    });
+    const runtime = fakeRuntime({
+      hashes: { ok: true, hashes: HASHES },
+      containers: running(HASHES),
+      addresses: sonarr.addresses,
+    });
+    const result = await plan({
+      home,
+      catalog: WIRED_CATALOG,
+      host: FIXTURE_HOST,
+      env: {},
+      runtime,
+      probe: fakeProbe(),
+      wiring: sonarr.seams,
+      rotate: ['admin.password'],
+    });
+    expect(result.secrets.generate).toEqual(['admin.password']);
+    expect(result.wiring).toEqual([
+      { resource: 'sonarr.login', action: 'update', changes: ['password'] },
+    ]);
+    expect(sonarr.app.requests.some((r) => r.path === '/login')).toBe(false);
+    // The store is as it was: plan writes nothing.
+    expect(JSON.parse(await readFile(join(home, SECRETS_PATH), 'utf8'))).toMatchObject({
+      shared: { adminPassword: 'fake-admin-password' },
+    });
+  });
+
+  it('refuses a secret it does not rotate, and an admin password of your own', async () => {
+    const home = await makeHome({ withStore: true });
+    const unknown = await plan({
+      home,
+      catalog: fixtureCatalog,
+      host: FIXTURE_HOST,
+      env: {},
+      runtime: fakeRuntime(),
+      probe: fakeProbe(),
+      rotate: ['sonarr.apiKey'],
+    });
+    expect(unknown).toMatchObject({ ok: false });
+    expect(unknown.diagnostics.map((d) => [d.code, d.message])).toContainEqual([
+      'rotate.unknown',
+      "Mediaplane doesn't rotate sonarr.apiKey: it rotates admin.password",
+    ]);
+    await writeFile(join(home, 'secrets', 'admin'), 'fake-own-password\n');
+    await writeFile(
+      join(home, 'stack.yaml'),
+      STACK.replace('apps:', 'admin: { password: { file: secrets/admin } }\napps:'),
+    );
+    const yours = await plan({
+      home,
+      catalog: fixtureCatalog,
+      host: FIXTURE_HOST,
+      env: {},
+      runtime: fakeRuntime(),
+      probe: fakeProbe(),
+      rotate: ['admin.password'],
+    });
+    expect(yours.diagnostics).toContainEqual(
+      expect.objectContaining({ code: 'rotate.yours', severity: 'error' }),
+    );
+  });
+});
````

**Change** `packages/engine/src/apply/apply.test.ts`:

````diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index 27c8a5b..0821057 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -1393,2 +1393,31 @@ describe('apply: qBittorrent behind Gluetun', () => {
 
+describe('apply: rotating the admin password', () => {
+  it('generates a new one, sets it in each app with its key, and the next apply changes nothing', async () => {
+    const home = await makeHome();
+    const sonarr = await fakeSonarr();
+    const docker = fakeDocker(home, { addresses: sonarr.addresses });
+    const wired = { catalog: WIRED_CATALOG, wiring: sonarr.seams };
+    expect((await apply(options(home, docker, wired))).outcome).toBe('success');
+    const before = (await readSecretStore(home)).shared?.adminPassword ?? '';
+    const signIns = () => sonarr.app.requests.filter((r) => r.path === '/login').length;
+    const signedIn = signIns();
+    const random = (size: number) => Buffer.alloc(size, 0xcd);
+    const rotated = await apply(
+      options(home, docker, { ...wired, random, rotate: ['admin.password'] }),
+    );
+    expect(rotated.outcome).toBe('success');
+    expect(rotated.actions[0]).toEqual({
+      step: 'keys',
+      result: 'done',
+      detail: 'generated admin.password',
+    });
+    const after = (await readSecretStore(home)).shared?.adminPassword ?? '';
+    expect(after !== '' && after !== before, 'a new password was saved').toBe(true);
+    expect(sonarr.state.password === after, 'Sonarr has the new password').toBe(true);
+    // One sign-in, with the new one, by verify's plan: none with a password no app had.
+    expect(signIns() - signedIn).toBe(1);
+    expect((await apply(options(home, docker, wired))).outcome).toBe('no-changes');
+  });
+});
+
 describe('apply: the wiring', () => {
````

**Change** `packages/cli/src/run.test.ts`:

````diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 234d5e7..ee2d3c4 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -412,2 +412,22 @@ describe('mediaplane plan', () => {
 
+  it('takes --rotate, refusing a secret it does not rotate before it asks anything', async () => {
+    const term = capture();
+    const home = await makeHome();
+    expect(
+      await run(['plan', '--home', home, '--rotate', 'admin.password'], term.io, deps()),
+    ).toBe(2);
+    expect(term.stdout()).toContain('Secrets to generate: admin.password,');
+    const refused = capture();
+    expect(
+      await run(
+        ['apply', '--home', home, '--yes', '--rotate', 'sonarr.apiKey'],
+        refused.io,
+        deps(),
+      ),
+    ).toBe(1);
+    expect(refused.stderr()).toContain(
+      "error: Mediaplane doesn't rotate sonarr.apiKey: it rotates admin.password",
+    );
+  });
+
   it('prints versioned JSON without file contents', async () => {
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/engine/src/integrations/wiring.test.ts packages/engine/src/plan/plan.test.ts packages/engine/src/apply/apply.test.ts packages/cli/src/run.test.ts`

Expected: FAIL: 5 tests in 4 files (312 run). `--rotate` is an unknown option (`run.test.ts` exits 1, not 2), and plan and apply ignore `rotate`: no `admin.password` to generate, an `apply` with `no-changes`, a secret it doesn't rotate not refused; `wiring.test.ts` signs in with the fresh password, which the app refuses (a `secret` drift).

- [ ] **Step 3: Implement**

**Change** `packages/engine/src/integrations/wiring.ts`:

````diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index 02a9fd2..563eb7b 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -391,2 +391,9 @@ export interface ExamineOptions {
   blocked?: string;
+  /**
+   * The values of the secrets apply generates (plan's preview of them, such as a rotated
+   * admin password): no app holds one yet, so a secret holding one is a change, which
+   * apply sets, and isn't checked. A check would only fail, leaving a mark in the app (a
+   * failed sign-in, which counts towards qBittorrent's ban).
+   */
+  fresh?: readonly string[];
 }
@@ -405,2 +412,8 @@ const WITH_REFUSED: Verdict = {
 
+/** Why a secret apply generates isn't checked. */
+const FRESH: Verdict = {
+  verdict: 'unchecked',
+  reason: 'apply generates it, and sets it: no app holds it yet',
+};
+
 /** Each of the resource's secrets, with its verdict. */
@@ -504,2 +517,6 @@ export async function examine(
       : fieldDrift(spec, address, compared, record, desired, observed);
+  // A secret apply generates is new to the app: a change, set with the others.
+  const fresh = spec.secrets.filter((secret) =>
+    (options.fresh ?? []).includes(desired.secrets[secret] ?? ''),
+  );
   // A field that differs makes it an update, which sets the secrets too: checking them
@@ -512,5 +529,10 @@ export async function examine(
         ? unchecked('a managed field differs: apply sets the secrets with it')
-        : await checkSecrets(spec, api, address, desired, observed, known, options);
+        : fresh.length > 0
+          ? eachSecret(spec, address, (secret) =>
+              fresh.includes(secret) ? FRESH : WITH_REFUSED,
+            )
+          : await checkSecrets(spec, api, address, desired, observed, known, options);
   const refused = checks.filter((check) => check.verdict === 'refused');
   changes.push(...refused.map((check) => check.secret));
+  if (changes.length === 0) changes.push(...fresh);
   if (record !== undefined) {
@@ -758,2 +780,4 @@ export interface PlanWiringOptions {
   only?: string;
+  /** The values of the secrets apply generates (ExamineOptions.fresh). */
+  fresh?: readonly string[];
   seams?: WiringSeams;
@@ -924,2 +948,3 @@ export async function planWiring(options: PlanWiringOptions): Promise<PlannedWir
           ...(held === undefined ? {} : { blocked: held }),
+          ...(options.fresh === undefined ? {} : { fresh: options.fresh }),
         });
````

**Change** `packages/engine/src/plan/plan.ts`:

````diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index 59a8026..890926c 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -36,3 +36,7 @@ import { dockerAccessWarnings } from '../runtime/docker';
 import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
-import { adminLogin, adminPasswordToGenerate } from '../secrets/admin';
+import {
+  ADMIN_PASSWORD_PATH,
+  adminLogin,
+  adminPasswordToGenerate,
+} from '../secrets/admin';
 import { withGeneratedSecrets } from '../secrets/generate';
@@ -42,2 +46,3 @@ import { readSecretStore, type SecretStore } from '../secrets/store';
 import {
+  missingGeneratedSecrets,
   secretsToGenerate,
@@ -83,4 +88,12 @@ export interface PlanOptions {
   only?: string;
+  /**
+   * The secrets Mediaplane generated to generate anew, and set in every app that holds them
+   * (ROTATABLE): `admin.password`, unless it is yours.
+   */
+  rotate?: readonly string[];
 }
 
+/** The secrets `rotate` takes. */
+export const ROTATABLE: readonly string[] = [ADMIN_PASSWORD_PATH];
+
 export interface PlanResult {
@@ -193,3 +206,9 @@ export async function planStack(
   const compose = renderCompose(stack);
-  const stored = await readSecretStore(home);
+  const rotating = rotation(options.rotate ?? [], stack);
+  if (rotating.diagnostics.length > 0)
+    return failed([...diagnostics, ...rotating.diagnostics]);
+  const read = await readSecretStore(home);
+  // A secret to rotate is one to generate anew: the store, as plan and apply see it, has
+  // none. Apply saves the new one in its keys step.
+  const stored: SecretStore = rotating.password ? withoutPassword(read) : read;
   // The keys the store lacks that the apps still keep in their appdata (spec §6.1, key
@@ -245,2 +264,11 @@ export async function planStack(
   const generate = secretsToGenerate(stack, store);
+  // What apply generates, in plan's preview of it: no app holds it yet.
+  const fresh = [
+    ...(adminPasswordToGenerate(stack.config, store)
+      ? [preview.shared?.adminPassword ?? '']
+      : []),
+    ...missingGeneratedSecrets(stack, store).map(
+      ({ app, name }) => preview.apps[app]?.[name] ?? '',
+    ),
+  ].filter((value) => value !== '');
   let predicted: PredictResult;
@@ -351,2 +379,3 @@ export async function planStack(
         ...(options.wiring === undefined ? {} : { seams: options.wiring }),
+        fresh,
       });
@@ -391,2 +420,41 @@ export async function planStack(
 
+/** `store` without the admin password it holds: one to generate anew. */
+function withoutPassword(store: SecretStore): SecretStore {
+  const { shared: _shared, ...rest } = store;
+  return rest;
+}
+
+/**
+ * What `rotate` asks of the stack: whether to generate the admin password anew, or why
+ * not. A secret it doesn't take, and one that is yours, are refused before anything is
+ * asked or generated.
+ */
+function rotation(
+  rotate: readonly string[],
+  stack: ResolvedStack,
+): { password: boolean; diagnostics: Diagnostic[] } {
+  const diagnostics = rotate.flatMap((name) => {
+    if (!ROTATABLE.includes(name)) {
+      return [
+        error(
+          'rotate.unknown',
+          `Mediaplane doesn't rotate ${name}: it rotates ${ROTATABLE.join(', ')}`,
+        ),
+      ];
+    }
+    return stack.config.admin.password === undefined
+      ? []
+      : [
+          error(
+            'rotate.yours',
+            `${name} is yours, read from the file stack.yaml names, so Mediaplane doesn't generate it`,
+            {
+              hint: 'put another password in that file, then run apply: it sets it in every app',
+            },
+          ),
+        ];
+  });
+  return { password: rotate.includes(ADMIN_PASSWORD_PATH), diagnostics };
+}
+
 function failed(diagnostics: Diagnostic[]): { result: PlanResult; context: undefined } {
````

**Change** `packages/engine/src/apply/apply.ts`:

````diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index 2b3a9e1..6d95a04 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -366,3 +366,5 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
   await steps.run('verify', async () => {
-    const after = await plan(options);
+    // As it is now: the secrets rotated are generated, and saved.
+    const { rotate: _rotated, ...now } = options;
+    const after = await plan(now);
     // This plan's clients know only what they read themselves: the secrets the bootstrap
````

**Change** `packages/cli/src/run.ts`:

````diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index 8b7e700..0bbaedd 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -245,2 +245,14 @@ export function defaultDeps(env: NodeJS.ProcessEnv): CliDeps {
 
+/** --rotate, as plan and apply take it: the secret to generate anew. */
+const ROTATE_HELP =
+  'generate a secret Mediaplane generated anew, and set it in every app that holds it: admin.password (not one of your own)';
+
+/** What apply's options are, as Commander gives them. */
+interface ApplyFlags {
+  home: string;
+  yes?: boolean;
+  json?: boolean;
+  rotate?: string;
+}
+
 /** The CLI's commands. Each action reports its exit code through `setExitCode`. */
@@ -272,5 +284,6 @@ export function createProgram(
     .option('--home <dir>', 'Mediaplane home directory', defaultHome)
+    .option('--rotate <secret>', ROTATE_HELP)
     .option('--json', 'print machine-readable JSON')
     .addHelpText('after', exitCodesHelp('plan'))
-    .action(async (options: { home: string; json?: boolean }) => {
+    .action(async (options: { home: string; json?: boolean; rotate?: string }) => {
       const home = resolve(options.home);
@@ -278,2 +291,3 @@ export function createProgram(
       const result = await plan({
+        ...(options.rotate === undefined ? {} : { rotate: [options.rotate] }),
         home,
@@ -296,5 +310,6 @@ export function createProgram(
     .option('--yes', 'apply without asking for confirmation')
+    .option('--rotate <secret>', ROTATE_HELP)
     .option('--json', 'print machine-readable JSON (needs --yes)')
     .addHelpText('after', exitCodesHelp('apply'))
-    .action(async (options: { home: string; yes?: boolean; json?: boolean }) => {
+    .action(async (options: ApplyFlags) => {
       const asJson = options.json === true;
@@ -314,2 +329,3 @@ export function createProgram(
       const result = await apply({
+        ...(options.rotate === undefined ? {} : { rotate: [options.rotate] }),
         home,
````

- [ ] **Step 4: Regenerate the CLI reference**

Run: `pnpm docs:generate`
Expected: it rewrites `docs/reference/cli.md` (`--rotate` on `plan` and `apply`).

- [ ] **Step 5: Run them, and see them pass**

Run: `pnpm vitest run packages/engine/src/integrations/wiring.test.ts packages/engine/src/plan/plan.test.ts packages/engine/src/apply/apply.test.ts packages/cli/src/run.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(cli): rotate the generated admin password with --rotate, and sign in with no password apply has yet to generate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: End to end: a host rebuilt from stack.yaml and its appdata

Decision 18, and S10a's success criterion. On real Docker, from source: the Jellyfin
stack is applied, then its containers, networks, `state/` and `generated/` are removed;
`plan` lists every key to recover and the admin password to generate; `apply` saves the
keys, sets the new password in each admin through its key, and adopts the rest with the
same ids; a second `apply` changes nothing. Then qBittorrent's key, made anew in its web
UI, is put back by `apply`; made anew again, it is kept by `keep`, and the next `apply`
gives it to both arrs' download clients. The drift advice names Jellyfin's key made
again (Task 4), which `plan` shows on this stack.

**Files:**
- Create: `test/e2e/rebuild.e2e.test.ts`
- Modify: `packages/cli/src/output.ts`
- Test: `packages/cli/src/output.test.ts`

**Interfaces:**
- **Consumes:** everything Tasks 1 to 5 produce; `test/e2e/helpers.ts` (`makeHome`, `composeDown`, `expectWiringRemoved`, `runTeardown`, `api`, `wired`).
- **Produces:** nothing new for later tasks.

- [ ] **Step 1: Write the failing tests**

**Create** `test/e2e/rebuild.e2e.test.ts`:

````ts
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  drift,
  keep,
  nodeProbe,
  plan,
  readSecretStore,
  type ApplyOptions,
  type ApplyResult,
  type SecretStore,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  api,
  composeDown,
  expectWiringRemoved,
  makeHome,
  runTeardown,
  wired,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-rebuild`;
/** qBittorrent's web UI, on 127.0.0.1. */
const QBITTORRENT = 8080;
/** Every key Mediaplane holds for the stack's apps, as state/secrets.json names them. */
const KEYS = [
  'jellyfin.apiKey',
  'prowlarr.apiKey',
  'qbittorrent.apiKey',
  'radarr.apiKey',
  'seerr.apiKey',
  'sonarr.apiKey',
];
/** The resources that hold the shared admin's password, set again through each key. */
const ADMINS = [
  'jellyfin.admin',
  'qbittorrent.admin',
  'radarr.admin',
  'sonarr.admin',
  'prowlarr.admin',
];

interface Resources {
  resources: Record<string, { id: string | number | null }>;
}

/** Each resource's id in its app, as state/resources.json keeps it: no secret. */
async function idsIn(home: string): Promise<Record<string, unknown>> {
  const file = await readFile(join(home, 'state', 'resources.json'), 'utf8');
  const { resources } = JSON.parse(file) as Resources;
  return Object.fromEntries(Object.entries(resources).map(([key, r]) => [key, r.id]));
}

/** A key's value, by its "<app>.<name>": a secret, compared, never printed. */
function keyOf(store: SecretStore, key: string): string {
  const [app = '', name = ''] = key.split('.');
  return store.apps[app]?.[name] ?? '';
}

/** Whether qBittorrent takes `key`, as its own API says: yes or no, never the key. */
async function qbittorrentTakes(key: string): Promise<boolean> {
  const answer = await api(QBITTORRENT, '/api/v2/app/version', {
    Authorization: `Bearer ${key}`,
  });
  return answer.status === 200;
}

/**
 * qBittorrent's key made anew in its web UI, as you would: signed in as the shared admin,
 * a session's rotateAPIKey, which writes the new key into qBittorrent.conf at once
 * (probed). Says only whether each step worked.
 */
async function rotateQbittorrentKey(password: string): Promise<void> {
  const form = { 'Content-Type': 'application/x-www-form-urlencoded' };
  const origin = { Referer: `http://127.0.0.1:${String(QBITTORRENT)}` };
  const signIn = await fetch(
    `http://127.0.0.1:${String(QBITTORRENT)}/api/v2/auth/login`,
    {
      method: 'POST',
      headers: { ...form, ...origin },
      body: new URLSearchParams({ username: 'admin', password }).toString(),
      signal: AbortSignal.timeout(30_000),
    },
  );
  expect(signIn.status, "the shared admin's sign-in to qBittorrent").toBe(204);
  const session = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const rotated = await api(
    QBITTORRENT,
    '/api/v2/app/rotateAPIKey',
    { ...origin, Cookie: session },
    { method: 'POST' },
  );
  expect(rotated.status, "qBittorrent's rotateAPIKey").toBe(200);
}

/** That none of `secrets` is in `text`: a yes/no check, which never prints either. */
function expectNoSecret(what: string, text: string, secrets: readonly string[]): void {
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(text.includes(secret), `${what} holds a secret`).toBe(false);
  }
}

/** An apply that found nothing to do; a failure names what changed, never a value. */
function expectNoChanges(result: ApplyResult): void {
  expect(
    result.plan.wiring
      .filter((w) => w.action !== 'unchanged')
      .map((w) => `${w.resource} ${w.action} ${(w.changes ?? []).join(',')}`),
    'wiring changed',
  ).toEqual([]);
  expect(result.outcome).toBe('no-changes');
}

describe('a host rebuilt from stack.yaml and its appdata (spec §6.1, §6.3, §10)', () => {
  it("recovers every key from the apps' appdata, adopts every resource by name, sets a new admin password, and changes nothing after", async () => {
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
      const first = await apply(options);
      expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(first.outcome).toBe('success');
      const before = await readSecretStore(home);
      const ids = await idsIn(home);
      const oldPassword = before.shared?.adminPassword ?? '';
      const secrets = [...KEYS.map((key) => keyOf(before, key)), oldPassword];

      // The host is lost: its containers and networks, and Mediaplane's state/ and
      // generated/. What is left is what a rebuild starts from: stack.yaml, appdata/ and
      // the data folder.
      const down = await composeDown(PROJECT);
      expect(down.code, down.stderr).toBe(0);
      await expectWiringRemoved(PROJECT);
      await rm(join(home, 'state'), { recursive: true });
      await rm(join(home, 'generated'), { recursive: true });

      // plan recovers every key from the apps' own files, and generates only the admin
      // password, which went with the store, saying so. Seerr's record that its setup
      // is Mediaplane's went too: it is checked again, unpublished, with its key.
      const shown = await plan(options);
      expect(shown.ok).toBe(true);
      expect(shown.secrets).toEqual({
        generate: ['admin.password'],
        recover: KEYS,
        restore: [],
      });
      expect(shown.diagnostics.map((d) => d.code)).toContain(
        'secrets.admin-password-lost',
      );
      expect(shown.bootstrap).toEqual([{ app: 'seerr', unpublished: true }]);

      const rebuilt = await apply(options);
      expect(rebuilt.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(rebuilt.outcome).toBe('success');
      expect(rebuilt.actions[0]?.detail).toBe(
        `recovered ${KEYS.join(', ')} from appdata; generated admin.password`,
      );
      // Each admin gets the new password through its app's key; everything else Mediaplane
      // made is found by name, and adopted as it is.
      expect(wired(rebuilt.actions).filter(([, detail]) => detail !== 'adopted')).toEqual(
        ADMINS.map((resource) => [resource, 'updated password']),
      );
      const after = await readSecretStore(home);
      for (const key of KEYS) {
        expect(keyOf(after, key) === keyOf(before, key), `${key} is the one before`).toBe(
          true,
        );
      }
      const newPassword = after.shared?.adminPassword ?? '';
      expect(newPassword !== '' && newPassword !== oldPassword, 'a new password').toBe(
        true,
      );
      secrets.push(newPassword);
      // The same resources, by the same ids in the apps: none made again.
      expect(await idsIn(home)).toEqual(ids);
      expect(after.setUp).toEqual(['seerr']);
      expectNoSecret("the rebuild's result", JSON.stringify(rebuilt), secrets);
      expectNoSecret(
        'resources.json',
        await readFile(join(home, 'state', 'resources.json'), 'utf8'),
        secrets,
      );
      expectNoChanges(await apply(options));

      // qBittorrent's key made anew in its web UI: apply puts Mediaplane's back in its
      // file, restarting it, and nothing else changes.
      const qbittorrentKey = keyOf(after, 'qbittorrent.apiKey');
      await rotateQbittorrentKey(newPassword);
      expect(await qbittorrentTakes(qbittorrentKey), 'qBittorrent refuses it now').toBe(
        false,
      );
      const restored = await apply(options);
      expect(restored.outcome).toBe('success');
      expect(restored.plan.secrets.restore).toEqual(['qbittorrent.apiKey']);
      expect(restored.plan.containers.filter((c) => c.action !== 'unchanged')).toEqual([
        { service: 'qbittorrent', action: 'restart' },
      ]);
      expect(restored.actions.find((a) => a.step === 'start')?.detail).toBe(
        "every app is running and healthy; restarted qbittorrent; put qbittorrent.apiKey back in its app's file",
      );
      expect(await qbittorrentTakes(qbittorrentKey), 'qBittorrent takes it again').toBe(
        true,
      );
      expectNoChanges(await apply(options));

      // Made anew again, and this time kept (Keep mine): drift finds qBittorrent
      // refusing Mediaplane's key; keep takes its own into state/secrets.json; the next
      // apply gives it to both arrs' download clients, and then nothing changes.
      await rotateQbittorrentKey(newPassword);
      const found = await drift(options);
      expect(found.drift).toContainEqual({
        resource: 'qbittorrent',
        kind: 'key',
        secret: 'apiKey',
      });
      const kept = await keep({ ...options, path: 'qbittorrent.apiKey' });
      expect(kept).toMatchObject({
        ok: true,
        key: 'qbittorrent.apiKey',
        holders: ['radarr.download_client', 'sonarr.download_client'],
      });
      expect(kept.value).toBeUndefined();
      expect(kept.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const ownKey = keyOf(await readSecretStore(home), 'qbittorrent.apiKey');
      secrets.push(ownKey);
      expect(ownKey !== qbittorrentKey, "qBittorrent's own key is kept").toBe(true);
      expect(await qbittorrentTakes(ownKey), 'qBittorrent takes the kept key').toBe(true);
      const given = await apply(options);
      expect(given.outcome).toBe('success');
      expect(wired(given.actions).filter(([, detail]) => detail !== 'unchanged')).toEqual(
        [
          ['radarr.download_client', 'updated apiKey'],
          ['sonarr.download_client', 'updated apiKey'],
        ],
      );
      expectNoSecret(
        "keep's and apply's results",
        JSON.stringify([kept, given]),
        secrets,
      );
      expectNoChanges(await apply(options));
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
````

**Change** `packages/cli/src/output.test.ts`:

````diff
diff --git a/packages/cli/src/output.test.ts b/packages/cli/src/output.test.ts
index e325f43..416f075 100644
--- a/packages/cli/src/output.test.ts
+++ b/packages/cli/src/output.test.ts
@@ -192,3 +192,3 @@ describe('printPlan: drift', () => {
         '  ? prowlarr.application_radarr: still in the app, though the stack no longer wants it; apply leaves it',
-        "  apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app; for any other app, put it back as https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md shows. mediaplane keep <app>.<key> keeps the app's own key instead.",
+        "  apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app, and has an app that made its own key, such as Jellyfin, make another; for any other app, put it back as https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/wiring-failed.md shows. mediaplane keep <app>.<key> keeps the app's own key instead.",
         "  apply doesn't remove what Mediaplane made that the stack no longer wants: remove it in the app if you don't want it, or keep it as yours with mediaplane keep <app>.<resource>, which stops the report.",
````

- [ ] **Step 2: Run them, and see them fail**

Run: `pnpm vitest run packages/cli/src/output.test.ts`

Expected: FAIL: 1 test in 1 file (`printPlan: drift`): the advice for a key doesn't say that an app that made its own key makes another.

The end-to-end test needs nothing more from this task: it passes on Tasks 1 to 5, and is
run with the whole suite, in the completion checklist.

- [ ] **Step 3: Implement**

**Change** `packages/cli/src/output.ts`:

````diff
diff --git a/packages/cli/src/output.ts b/packages/cli/src/output.ts
index d1cc19f..49f51d7 100644
--- a/packages/cli/src/output.ts
+++ b/packages/cli/src/output.ts
@@ -107,3 +107,3 @@ export function driftAdvice(drift: readonly Drift[]): string[] {
       ? [
-          `apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app; for any other app, put it back as ${WIRING_RUNBOOK} shows. mediaplane keep <app>.<key> keeps the app's own key instead`,
+          `apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app, and has an app that made its own key, such as Jellyfin, make another; for any other app, put it back as ${WIRING_RUNBOOK} shows. mediaplane keep <app>.<key> keeps the app's own key instead`,
         ]
````

- [ ] **Step 4: Run them, and see them pass**

Run: `pnpm vitest run packages/cli/src/output.test.ts`
Expected: PASS. Then, alone on the machine, with nothing else running in Docker:
`pnpm vitest run --config vitest.e2e.config.ts test/e2e/rebuild.e2e.test.ts` passes in
about two minutes, warm.

- [ ] **Step 5: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(e2e): a host rebuilt from stack.yaml and its appdata, and qBittorrent's key put back or kept" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Docs

The §9 set for what Tasks 1 to 6 built. The generated CLI reference was regenerated in
Tasks 3 and 5.

**Files:**
- Create: `docs/runbooks/rebuilding-a-host.md`
- Modify: `README.md`, `deploy/README.md`, `catalog/{sonarr,radarr,prowlarr,qbittorrent,gluetun,jellyfin,seerr,plex}/README.md`, `docs/adr/0003-drift-detect-and-warn-with-keep-mine.md`, `docs/architecture.md`, `docs/design/m1-engine-cli.md`, `docs/plans/m1-roadmap.md`, `docs/runbooks/drift-reported.md`, `docs/runbooks/wiring-failed.md`, `docs/security/threat-model.md`

**Interfaces:**
- **Consumes:** Tasks 1 to 6; `REBUILD_RUNBOOK`, the address every new hint gives.
- **Produces:** `docs/runbooks/rebuilding-a-host.md`; the spec's §11 "Slice 10a"; the roadmap's S10a and S10b.

- [ ] **Step 1: See the docs still promise Slice 10**

Run: `test "$(grep -rlE 'Slice 10 does this for you|yet \(Slice 10\)|Slice 10 restores|comes in Slice 10\.|password \(Slice 10\)|is Slice 10\.|\*\*Next:\*\* S10 |\(Slice 10\);|until Slice 10\.' README.md catalog docs/runbooks docs/architecture.md docs/security docs/adr docs/plans/m1-roadmap.md | wc -l)" -eq 0`

Expected: it exits 1: nine files still say Slice 10 brings what this slice builds, such as `catalog/qbittorrent/README.md`'s "Slice 10 does this for you", or the README's `**Next:** S10 (recovery and automation)`.

- [ ] **Step 2: Write the runbook**

**Create** `docs/runbooks/rebuilding-a-host.md`:

````markdown
# Runbook: rebuilding a host

A host is rebuilt from what you keep of it: `stack.yaml`, `secrets/` (the files
`stack.yaml` names, such as your VPN key), `compose.override.yaml` if you have one, the
apps' `appdata/`, and your data folder. Everything else Mediaplane makes again: the
containers and their networks, `generated/`, and `state/`, which holds the keys it gave
the apps (`state/secrets.json`) and what it made in them (`state/resources.json`).

Mediaplane finds what the apps still hold, rather than starting afresh:

- **Each app's key,** from the app's own files in `appdata/` (key recovery): Sonarr's,
  Radarr's and Prowlarr's `config.xml`, qBittorrent's `qBittorrent.conf`, Seerr's
  `settings.json`, Gluetun's `auth/config.toml`, and Jellyfin's database
  (`data/data/jellyfin.db`), read and never written. `plan` lists them under
  `Secrets to recover from the apps' appdata:`.
- **What it made in each app,** by the name it gave it: a download client named
  `qBittorrent (Mediaplane)`, the Movies library, and so on. `plan` shows each as
  `= adopt`, and `apply` records it, changing nothing in the app.

The same holds when only `state/` is lost, with the containers still running.

The shared admin password can't be found again: the apps keep only a hash of it. If
Mediaplane generated it, `apply` generates a new one, and sets it in each app through
the app's key, which it recovered. `mediaplane credentials` shows the new one once
`apply` has run. If it is yours (`admin.password: { file: … }`), nothing changes.

```text
 kept            made again
 ----            ----------
 stack.yaml      containers, networks
 secrets/        generated/
 appdata/   -->  state/secrets.json
 data folder       (keys recovered)
                 state/resources.json
                   (found by name)
```

## Symptoms

- **A new host, or a lost `state/`.** `mediaplane plan` lists keys to recover from the
  apps' appdata, and, for a generated admin password, warns
  `secrets.admin-password-lost`:

  ```console
  $ mediaplane plan
  warning: the admin password Mediaplane generated went with
  state/secrets.json, though the apps still hold the keys it
  gave them: apply generates a new one, and sets it in each
  app through the app's key
  …
  Secrets to recover from the apps' appdata: jellyfin.apiKey,
  prowlarr.apiKey, qbittorrent.apiKey, radarr.apiKey,
  seerr.apiKey, sonarr.apiKey
  Secrets to generate: admin.password
  First-run setup:
    + seerr (with no port published until it is done)
  ```

  Seerr is set up again, without its port, because the record that its setup is
  Mediaplane's went with `state/`: the setup asks Seerr, with its key, whether its admin
  is the shared admin and its Jellyfin the stack's, and publishes it only then. On a Plex
  stack, Plex and Seerr are asked the same way, through plex.tv, whose account they are.

- **`keys.unrecoverable`, an error:** a key file is there, but Mediaplane can't read it,
  or it holds the key in a form Mediaplane can't keep. `plan` stops, and nothing is
  generated: a new key would lock Mediaplane out of the app, which still holds the old
  one. A file that leads out of the app's own appdata folder, through a link, is never
  read.
- **`keys.unrecoverable`, a warning, for Jellyfin:** its database can't give its key,
  and the admin password is to be generated too, so `apply` can't sign in to Jellyfin to
  find the key, and leaves Jellyfin unwired.
- **`keys.restore`:** an app keeps its key in a file of its own that holds another key,
  or none, and Mediaplane can't write the file safely (see "A key changed at its source").

## Checks

1. Is everything you keep where `stack.yaml` expects it: `appdata/` and `secrets/` in the
   Mediaplane home, and the data folder at `paths.data`?
2. Can Mediaplane's user read the apps' key files? In the image, that is
   `MEDIAPLANE_UID` (`deploy/mediaplane.compose.yaml`). `ls -l` the file `plan` names.
3. Is the admin password yours, or generated? With `admin.password: { file: … }`, the
   file must hold the password the apps have.

## Fix

### A host rebuilt from its files

1. Install Mediaplane on the new host, as its README's quick start says, with the same
   `MEDIAPLANE_HOME`.
2. Put back `stack.yaml`, `secrets/`, `compose.override.yaml` and `appdata/` in the home,
   and the data folder at `paths.data`, keeping their owners. Leave `state/` and
   `generated/` out: Mediaplane makes them again.
3. Run `mediaplane plan`. Check what it says it recovers and generates, as above. Fix any
   error it gives first.
4. Run `mediaplane apply`. It saves the keys it recovered, starts the apps, sets up
   again what it must, sets a new admin password where the old one went, and finds
   everything it made by name.
5. Run `mediaplane apply` again: it says `No changes.`

### `keys.unrecoverable` (an error)

Make the file `plan` names readable by Mediaplane's user, then run `plan` again. To start
that app afresh instead, losing its settings, move `appdata/<app>` aside: `apply` then
generates a new key and writes the app's file anew.

### Jellyfin's key, when its database can't give it

Its key is made by Jellyfin, so it isn't in a file Mediaplane writes. Either make
`appdata/jellyfin/data/data/jellyfin.db` readable by Mediaplane's user, or give
Mediaplane the password Jellyfin's admin has: put it in a file in the home, set
`admin.password: { file: … }` to it, and run `apply`, which signs in to Jellyfin and
finds, or makes, its key named `Mediaplane`.

### A key changed at its source

An app that keeps its key in a file of its own can be given another, by hand, or from
its web UI: qBittorrent's web UI makes a new key, and writes it into its file at once.
The app then refuses the key Mediaplane holds, and `plan` and `drift` say so.

- **To put Mediaplane's back:** run `apply`. `plan` lists the key under
  `Keys to put back in their apps' own files`, and the app as `> restart`: `apply` stops
  the app, writes the key into its file, keeping the file's mode and group, and starts
  it again. A Gluetun restarted so restarts qBittorrent, in its network, too.
- **To keep the app's own instead:** `mediaplane keep qbittorrent.apiKey`. It asks the
  app with the key its file holds, and only if the app takes it, keeps it in
  `state/secrets.json`. The next `apply` gives it to every resource that holds the old
  one, which `keep` names: Sonarr's and Radarr's download clients.

Sonarr, Radarr, Prowlarr and Seerr take their key from their environment at every start,
which wins over their files, so their web UIs can't change it. Jellyfin makes its own: a
key deleted in its dashboard is made again by the next `apply`, which signs in to
Jellyfin as the shared admin while it stays published.

`keys.restore`, a warning: the file holds another key, but Mediaplane won't write it:
it is a link, has other names, or belongs to another user or group. Fix that, then run
`apply`; or keep the app's key, as above.

`keys.restore`, an error: the file holds no key, as one from before Mediaplane seeded the
app does, and Mediaplane can't write it. Stop the app, move the file aside, and run
`apply`, which writes a new one before the app starts.

### Rotating the admin password

`mediaplane apply --rotate admin.password` generates a new one, and sets it in each app
through the app's key, as after a lost `state/`. `mediaplane plan --rotate admin.password`
shows it first. A password of your own is rotated in its file instead: put another in it,
and run `apply`.

## Prevention

- Back up `stack.yaml`, `secrets/`, `compose.override.yaml` and `appdata/` together.
  `appdata/` holds the apps' keys, so keep the backup private.
- Give the admin password as a file of your own (`admin.password: { file: … }`), kept
  with your other secrets, so a rebuild keeps it too.
- Keep `state/` too, if you can: with it, a rebuild has nothing to recover.
````

- [ ] **Step 3: Update the runbooks, the apps' READMEs, the guides and the ADR**

**Change** `docs/runbooks/wiring-failed.md`:

````diff
diff --git a/docs/runbooks/wiring-failed.md b/docs/runbooks/wiring-failed.md
index 7b49c42..b4088c6 100644
--- a/docs/runbooks/wiring-failed.md
+++ b/docs/runbooks/wiring-failed.md
@@ -269,29 +269,25 @@ differ, and a `reason` when it is `unknown`.
 - **`refused Mediaplane's API key (HTTP 401 or 403)`.** The app's key is no longer the
-  one in `state/secrets.json`.
-  - **qBittorrent** keeps its key only in its file, so a key made anew in its web UI
-    shuts Mediaplane out. Stop it, put the stored key back, and start it:
-    `docker stop mediaplane-qbittorrent-1`, set `WebUI\APIKey=` in
-    `appdata/qbittorrent/qBittorrent/qBittorrent.conf` to `qbittorrent.apiKey` from
-    `state/secrets.json`, then `docker start mediaplane-qbittorrent-1`.
-  - **Sonarr, Radarr and Prowlarr** get the stored key in their environment, and in
-    `config.xml` before their first start. Restarting the container may put the stored
-    key back, if the app prefers its environment, but that depends on the app. What works
-    either way: stop the app, set `<ApiKey>` in `appdata/<app>/config.xml` to
-    `<app>.apiKey` from `state/secrets.json` (use `sudo` if the file isn't yours), and
-    start it. If `plan` says `<app>.not-seeded`, follow the app's README.
-  - **Jellyfin** makes its own key, so no key can be put back: a new one is made. A key
-    deleted in Jellyfin's dashboard (API Keys) shuts Mediaplane out of every Jellyfin
-    resource, and `plan` shows them as `? unknown`, with this message. Edit
-    `state/secrets.json` and remove the `jellyfin` entry under `apps`, keeping the file
-    valid JSON (use `sudo` if the file isn't yours). Then run `apply`: Jellyfin is still
-    set up, so Mediaplane signs in as the shared admin, with its port published, makes a
-    new key named `Mediaplane`, keeps it, and gives it to Sonarr's and Radarr's
-    connections, whose own test refuses the old one (`updated apiKey`).
-  - **Seerr** takes the stored key from its environment at every start, whatever its
-    `settings.json` says, so a key made anew in its web UI lasts only until Seerr
-    restarts: `docker restart mediaplane-seerr-1` puts the stored one back.
+  one in `state/secrets.json`: a key changed at its source. The
+  [rebuilding a host runbook](rebuilding-a-host.md#a-key-changed-at-its-source) has the
+  details.
+  - **qBittorrent** keeps its key only in its file, which its web UI writes when it makes
+    a new key. Run `apply`: it stops qBittorrent, puts the stored key back in
+    `appdata/qbittorrent/qBittorrent/qBittorrent.conf`, and starts it again. Or keep
+    qBittorrent's own key: `mediaplane keep qbittorrent.apiKey`, then `apply`, which gives
+    it to Sonarr's and Radarr's download clients.
+  - **Sonarr, Radarr, Prowlarr and Seerr** take the stored key from their environment at
+    every start, and their web UIs can't change it then. One that refuses it was given
+    another by hand, such as an `<APP>__AUTH__APIKEY` or `API_KEY` in
+    `compose.override.yaml`: take that out, and run `apply`.
+  - **Jellyfin** makes its own key. One deleted in its dashboard (API Keys) shuts
+    Mediaplane out of every Jellyfin resource, and `plan` shows them as `? unknown`, with
+    this message, and lists Jellyfin's first-run setup again,
+    `signing in as the admin, to make its key`. Run `apply`: Jellyfin is still set up, so
+    Mediaplane signs in as the shared admin, with its port published, takes the newest
+    key named `Mediaplane` or makes one, keeps it, and gives it to Sonarr's and Radarr's
+    connections, whose own test refuses the old one (`updated apiKey`). That needs the
+    password Jellyfin's admin has.
   - `mediaplane drift` reports a key changed at its source, on the app and on each
     resource that holds it, and keeps that the app refused it: neither drift nor `plan`
-    sends the app that key again until `apply` checks it, so put the key back, then run
-    `apply`. Slice 10 restores a key at its source for you, and makes Jellyfin's anew.
+    sends the app that key again until `apply` checks it.
 - **`refused the request (HTTP 403)`, with
````

**Change** `docs/runbooks/drift-reported.md`:

````diff
diff --git a/docs/runbooks/drift-reported.md b/docs/runbooks/drift-reported.md
index e0592c0..6c9ec55 100644
--- a/docs/runbooks/drift-reported.md
+++ b/docs/runbooks/drift-reported.md
@@ -81,3 +81,3 @@ Each line says what kind of drift it is:
   remove it in the app, or keep it as yours with `mediaplane keep <app>.<resource>`.
-  Removing it for you comes in Slice 10.
+  Removing it for you comes in Slice 10b.
 
@@ -142,7 +142,10 @@ Choose, for each change, which side wins.
   managed in Jellyfin or Plex is no longer enabled by Mediaplane in Seerr either.
-- **A key changed at its source** (`refuses the key Mediaplane holds for it`): put the
-  stored key back in the app, as the
-  [wiring failed runbook](wiring-failed.md#fix) shows for each app, then run `apply`.
-  `apply` checks the key again, and once the app takes it, drift and `plan` ask the app
-  again. Mediaplane doesn't put the key back for you yet (Slice 10).
+- **A key changed at its source** (`refuses the key Mediaplane holds for it`): `apply`
+  puts the key Mediaplane holds back where the app keeps it in a file of its own
+  (qBittorrent's), restarting the app, and has Jellyfin make another. To keep the app's
+  own key instead, `mediaplane keep <app>.<key>`, such as `qbittorrent.apiKey`: once the
+  app takes the key its file holds, it is kept in `state/secrets.json`, and the next
+  `apply` gives it to each resource that holds the old one, which `keep` names. The
+  [rebuilding a host runbook](rebuilding-a-host.md#a-key-changed-at-its-source) has the
+  details for each app.
 - **A download client's key not checked, because qBittorrent lacks a category it
````

**Change** `catalog/sonarr/README.md`:

````diff
diff --git a/catalog/sonarr/README.md b/catalog/sonarr/README.md
index 7631ec5..c9d4b9e 100644
--- a/catalog/sonarr/README.md
+++ b/catalog/sonarr/README.md
@@ -166,24 +166,11 @@ LinuxServer.io image, unmodified.
 - **Set up before Slice 3a.** If Sonarr first started before Mediaplane wrote its
-  `config.xml`, the file has no API key, and `plan` stops with `sonarr.not-seeded`. To
-  fix it, stop Sonarr, move the file aside, and apply again: Mediaplane writes a new
-  one before Sonarr starts. You lose the settings kept in that file, such as a URL
-  base you set in Sonarr. Your library and history stay.
-
-  ```bash
-  docker stop mediaplane-sonarr-1
-  file=/opt/mediaplane/appdata/sonarr/config.xml
-  mv "$file" "$file.before-3a"
-  mediaplane apply
-  ```
-
-  Use your own home, and the container name `docker ps` shows. If `mv` is refused, use
-  `sudo mv`. The old file keeps your settings, to enter again in Sonarr. Slice 10
-  does this for you.
-
-  If `apply` then fails with `cannot create … (EACCES)`, the folder belongs to the
-  stack's `user:`, not to the user Mediaplane runs as (`MEDIAPLANE_UID` in its
-  container). Give the folder to Mediaplane's user, with
-  `sudo chown <uid>:<gid> /opt/mediaplane/appdata/sonarr` and the ids from
-  `deploy/.env`, then apply again. Sonarr takes the folder back when it starts. Or
-  delete `appdata/sonarr` to start Sonarr afresh: it loses its database and settings,
-  but not your media.
+  `config.xml`, the file has no API key: Sonarr takes its key from its environment, and
+  doesn't write it there. `plan` lists `sonarr.apiKey` under
+  `Keys to put back in their apps' own files`, and Sonarr as `> restart`: `apply` stops
+  Sonarr, puts the key in its `config.xml`, keeping the rest, and starts it again. If
+  Mediaplane can't write the file (`keys.restore`), the
+  [rebuilding a host runbook](../../docs/runbooks/rebuilding-a-host.md) says what to do.
+- **Its key after a lost `state/`** is read back from `config.xml`, before anything is
+  generated, as the [rebuilding a host runbook](../../docs/runbooks/rebuilding-a-host.md)
+  says. One Mediaplane can't read stops `plan` (`keys.unrecoverable`): a new key would
+  lock it out of Sonarr.
````

**Change** `catalog/radarr/README.md`:

````diff
diff --git a/catalog/radarr/README.md b/catalog/radarr/README.md
index 44cfb4d..9343302 100644
--- a/catalog/radarr/README.md
+++ b/catalog/radarr/README.md
@@ -173,24 +173,11 @@ LinuxServer.io image, unmodified.
 - **Set up before Slice 3a.** If Radarr first started before Mediaplane wrote its
-  `config.xml`, the file has no API key, and `plan` stops with `radarr.not-seeded`. To
-  fix it, stop Radarr, move the file aside, and apply again: Mediaplane writes a new
-  one before Radarr starts. You lose the settings kept in that file, such as a URL
-  base you set in Radarr. Your library and history stay.
-
-  ```bash
-  docker stop mediaplane-radarr-1
-  file=/opt/mediaplane/appdata/radarr/config.xml
-  mv "$file" "$file.before-3a"
-  mediaplane apply
-  ```
-
-  Use your own home, and the container name `docker ps` shows. If `mv` is refused, use
-  `sudo mv`. The old file keeps your settings, to enter again in Radarr. Slice 10
-  does this for you.
-
-  If `apply` then fails with `cannot create … (EACCES)`, the folder belongs to the
-  stack's `user:`, not to the user Mediaplane runs as (`MEDIAPLANE_UID` in its
-  container). Give the folder to Mediaplane's user, with
-  `sudo chown <uid>:<gid> /opt/mediaplane/appdata/radarr` and the ids from
-  `deploy/.env`, then apply again. Radarr takes the folder back when it starts. Or
-  delete `appdata/radarr` to start Radarr afresh: it loses its database and settings,
-  but not your media.
+  `config.xml`, the file has no API key: Radarr takes its key from its environment, and
+  doesn't write it there. `plan` lists `radarr.apiKey` under
+  `Keys to put back in their apps' own files`, and Radarr as `> restart`: `apply` stops
+  Radarr, puts the key in its `config.xml`, keeping the rest, and starts it again. If
+  Mediaplane can't write the file (`keys.restore`), the
+  [rebuilding a host runbook](../../docs/runbooks/rebuilding-a-host.md) says what to do.
+- **Its key after a lost `state/`** is read back from `config.xml`, before anything is
+  generated, as the [rebuilding a host runbook](../../docs/runbooks/rebuilding-a-host.md)
+  says. One Mediaplane can't read stops `plan` (`keys.unrecoverable`): a new key would
+  lock it out of Radarr.
````

**Change** `catalog/prowlarr/README.md`:

````diff
diff --git a/catalog/prowlarr/README.md b/catalog/prowlarr/README.md
index 3385ffc..04ba16c 100644
--- a/catalog/prowlarr/README.md
+++ b/catalog/prowlarr/README.md
@@ -161,24 +161,11 @@ to the solver only when the site answers with a Cloudflare challenge.
 - **Set up before Slice 3a.** If Prowlarr first started before Mediaplane wrote its
-  `config.xml`, the file has no API key, and `plan` stops with `prowlarr.not-seeded`. To
-  fix it, stop Prowlarr, move the file aside, and apply again: Mediaplane writes a new
-  one before Prowlarr starts. You lose the settings kept in that file, such as a URL
-  base you set in Prowlarr. Your indexers stay.
-
-  ```bash
-  docker stop mediaplane-prowlarr-1
-  file=/opt/mediaplane/appdata/prowlarr/config.xml
-  mv "$file" "$file.before-3a"
-  mediaplane apply
-  ```
-
-  Use your own home, and the container name `docker ps` shows. If `mv` is refused, use
-  `sudo mv`. The old file keeps your settings, to enter again in Prowlarr. Slice 10
-  does this for you.
-
-  If `apply` then fails with `cannot create … (EACCES)`, the folder belongs to the
-  stack's `user:`, not to the user Mediaplane runs as (`MEDIAPLANE_UID` in its
-  container). Give the folder to Mediaplane's user, with
-  `sudo chown <uid>:<gid> /opt/mediaplane/appdata/prowlarr` and the ids from
-  `deploy/.env`, then apply again. Prowlarr takes the folder back when it starts. Or
-  delete `appdata/prowlarr` to start Prowlarr afresh: it loses its database and settings,
-  your indexers included.
+  `config.xml`, the file has no API key: Prowlarr takes its key from its environment, and
+  doesn't write it there. `plan` lists `prowlarr.apiKey` under
+  `Keys to put back in their apps' own files`, and Prowlarr as `> restart`: `apply` stops
+  Prowlarr, puts the key in its `config.xml`, keeping the rest, and starts it again. If
+  Mediaplane can't write the file (`keys.restore`), the
+  [rebuilding a host runbook](../../docs/runbooks/rebuilding-a-host.md) says what to do.
+- **Its key after a lost `state/`** is read back from `config.xml`, before anything is
+  generated, as the [rebuilding a host runbook](../../docs/runbooks/rebuilding-a-host.md)
+  says. One Mediaplane can't read stops `plan` (`keys.unrecoverable`): a new key would
+  lock it out of Prowlarr.
````

**Change** `catalog/qbittorrent/README.md`:

````diff
diff --git a/catalog/qbittorrent/README.md b/catalog/qbittorrent/README.md
index e3a6912..b9b46bd 100644
--- a/catalog/qbittorrent/README.md
+++ b/catalog/qbittorrent/README.md
@@ -165,26 +165,14 @@ holds for it`. Neither drift nor `plan` sends that key again until `apply` check
 - **Set up before Slice 3a.** If qBittorrent first started before Mediaplane wrote its
-  `qBittorrent.conf`, it runs with the image's own file. That file has no API key, and
-  until you set a password, qBittorrent makes a new temporary one at every start. `plan`
-  stops with `qbittorrent.not-seeded`. To fix it, stop qBittorrent, move the file
-  aside, and apply again: Mediaplane writes a new one before qBittorrent starts. You
-  lose the settings kept in that file, such as speed limits. Your torrents stay.
-
-  ```bash
-  docker stop mediaplane-qbittorrent-1
-  file=/opt/mediaplane/appdata/qbittorrent/qBittorrent/qBittorrent.conf
-  mv "$file" "$file.before-3a"
-  mediaplane apply
-  ```
-
-  Stop it first: qBittorrent writes the file again when it stops. Use your own home,
-  and the container name `docker ps` shows. If `mv` is refused, use `sudo mv`. Then
-  sign in with what `mediaplane credentials` shows. The old file keeps your settings,
-  to enter again in qBittorrent. Slice 10 does this for you.
-
-  If `apply` then fails with `cannot create … (EACCES)`, the folder belongs to the
-  stack's `user:`, not to the user Mediaplane runs as (`MEDIAPLANE_UID` in its
-  container). Give the folder to Mediaplane's user, with
-  `sudo chown <uid>:<gid> /opt/mediaplane/appdata/qbittorrent/qBittorrent` and the ids
-  from `deploy/.env`, then apply again. qBittorrent takes the folder back when it
-  starts. Or delete `appdata/qbittorrent` to start qBittorrent afresh: it loses its
-  settings and its list of torrents, but not the files it downloaded.
+  `qBittorrent.conf`, its file has no API key. `plan` lists `qbittorrent.apiKey` under
+  `Keys to put back in their apps' own files`: `apply` stops qBittorrent, puts the key in
+  its file, under `[Preferences]`, keeping the rest, and starts it again. The file's
+  login is still the image's, with its temporary password: the wiring then sets the
+  shared login, through the key.
+- **Its key made anew in its web UI** (Options, WebUI, API key) is written into
+  `qBittorrent.conf` at once, and shuts Mediaplane out. `apply` puts the stored key back,
+  restarting qBittorrent; or `mediaplane keep qbittorrent.apiKey` keeps the new one, and
+  the next `apply` gives it to Sonarr's and Radarr's download clients. The
+  [rebuilding a host runbook](../../docs/runbooks/rebuilding-a-host.md#a-key-changed-at-its-source)
+  has the details.
+- **Its key after a lost `state/`** is read back from `qBittorrent.conf`, before anything
+  is generated. One Mediaplane can't read stops `plan` (`keys.unrecoverable`).
````

**Change** `catalog/gluetun/README.md`:

````diff
diff --git a/catalog/gluetun/README.md b/catalog/gluetun/README.md
index a317527..891ec94 100644
--- a/catalog/gluetun/README.md
+++ b/catalog/gluetun/README.md
@@ -133,22 +133,10 @@ Nothing for Gluetun itself. See the [roadmap](../../docs/plans/m1-roadmap.md).
   - If `appdata/gluetun/auth/config.toml` was there already, without Mediaplane's role
-    (`name = "mediaplane"`), `plan` stops with `gluetun.not-seeded`, even if your own
-    roles have keys. To fix it, stop Gluetun, move the file aside, and apply again:
-    Mediaplane writes a new one, starts Gluetun again, and restarts qBittorrent, which
-    shares Gluetun's network and loses it when Gluetun stops.
-
-    ```bash
-    docker stop mediaplane-gluetun-1
-    file=/opt/mediaplane/appdata/gluetun/auth/config.toml
-    mv "$file" "$file.before-3a"
-    mediaplane apply
-    ```
-
-    Use your own home, and the container names `docker ps` shows. If `mv` is refused,
-    use `sudo mv`. The old file keeps your own roles: add them again below Mediaplane's
-    in the new file, then restart Gluetun and qBittorrent as above.
-
-  - If `apply` then fails with `cannot create … (EACCES)`, the `auth` folder doesn't
-    belong to the user Mediaplane runs as (`MEDIAPLANE_UID` in its container). Give it to
-    that user, with `sudo chown <uid>:<gid> /opt/mediaplane/appdata/gluetun/auth` and the
-    ids from `deploy/.env`, then apply again. Gluetun runs as root, so it still reads the
-    file.
+    (`name = "mediaplane"`), `plan` lists `gluetun.controlApiKey` under
+    `Keys to put back in their apps' own files`, and Gluetun and qBittorrent as
+    `> restart`: `apply` stops them, adds Mediaplane's role after your own, which stay as
+    they are, and starts them again. A role named `mediaplane` with another key is
+    written again whole. If Mediaplane can't write the file (`keys.restore`), the
+    [rebuilding a host runbook](../../docs/runbooks/rebuilding-a-host.md) says what to do.
+
+- **Its key after a lost `state/`** is read back from Mediaplane's role in
+  `auth/config.toml`, before anything is generated.
````

**Change** `catalog/jellyfin/README.md`:

````diff
diff --git a/catalog/jellyfin/README.md b/catalog/jellyfin/README.md
index 0c276a6..3167ad6 100644
--- a/catalog/jellyfin/README.md
+++ b/catalog/jellyfin/README.md
@@ -178,6 +178,11 @@ upstream LinuxServer.io image, unmodified, when `media_server` is `jellyfin`.
 - **Its key deleted in Jellyfin's dashboard** (API Keys). `plan` warns that Jellyfin
-  refuses Mediaplane's API key. Remove the `jellyfin` entry under `apps` from
-  `state/secrets.json`, keeping the file valid JSON, and apply: Mediaplane signs in as the
-  admin, makes a new key, and gives it to Sonarr and Radarr. Slice 10 does this for you.
-  The [wiring failed runbook](../../docs/runbooks/wiring-failed.md) has the details.
+  refuses Mediaplane's API key, and lists its first-run setup again, published: `apply`
+  signs in as the admin, makes a new key, and gives it to Sonarr and Radarr. The
+  [wiring failed runbook](../../docs/runbooks/wiring-failed.md) has the details.
+- **Its key after a lost `state/`** is read back from Jellyfin's database
+  (`appdata/jellyfin/data/data/jellyfin.db`): the newest key named `Mediaplane`, read
+  without changing anything, while Jellyfin runs. So a rebuilt host needs no sign-in to
+  Jellyfin, and a generated admin password, lost with `state/`, is set again through the
+  key. The [rebuilding a host runbook](../../docs/runbooks/rebuilding-a-host.md) has
+  what to do when the database can't be read.
 - **Its `appdata/` emptied by hand.** Jellyfin starts its wizard again. Stop Jellyfin
````

**Change** `catalog/seerr/README.md`:

````diff
diff --git a/catalog/seerr/README.md b/catalog/seerr/README.md
index 291b62e..fd3aa47 100644
--- a/catalog/seerr/README.md
+++ b/catalog/seerr/README.md
@@ -140,3 +140,3 @@ With Jellyfin as the media server (with Plex, see below):
 
-- **Slice 10:** a way to give Seerr a new Plex token: it keeps the one it signed in with.
+- **Slice 10b:** a way to give Seerr a new Plex token: it keeps the one it signed in with.
 
````

**Change** `catalog/plex/README.md`:

````diff
diff --git a/catalog/plex/README.md b/catalog/plex/README.md
index dc004fc..de0e9a8 100644
--- a/catalog/plex/README.md
+++ b/catalog/plex/README.md
@@ -187,3 +187,3 @@ LinuxServer.io image, unmodified, when `media_server` is `plex`.
   next `apply` when Plex refuses theirs. Seerr keeps the token it signed in with, and
-  Mediaplane can't give it another yet (Slice 10).
+  Mediaplane can't give it another yet (Slice 10b).
 - **A Plex claimed outside `apply`,** with another account, stays unpublished: see the
````

**Change** `docs/adr/0003-drift-detect-and-warn-with-keep-mine.md`:

````diff
diff --git a/docs/adr/0003-drift-detect-and-warn-with-keep-mine.md b/docs/adr/0003-drift-detect-and-warn-with-keep-mine.md
index 006f21b..ca85426 100644
--- a/docs/adr/0003-drift-detect-and-warn-with-keep-mine.md
+++ b/docs/adr/0003-drift-detect-and-warn-with-keep-mine.md
@@ -87,7 +87,10 @@ address after five failed sign-ins in a row.
 
-- **Shared keys are reported, not repaired, in S8.** A key changed at its source, such
-  as qBittorrent's made anew in its web UI, is drift on qBittorrent and on each resource
-  that holds it. Putting the old key back at the source, or taking the new one and giving
-  it to every consumer, needs the key read from the app's own files, which is key
-  recovery: Slice 10 brings both. The wiring failed runbook gives the steps by hand.
+- **Shared keys are reported in S8, and repaired from Slice 10a.** A key changed at its
+  source, such as qBittorrent's made anew in its web UI, is drift on qBittorrent and on
+  each resource that holds it. Re-apply puts the old key back at the source: `apply`
+  stops the app, writes the key into the app's own file, and starts it again. Keep mine
+  is `mediaplane keep <app>.<key>`: it reads the new key from the app's own file, which
+  is key recovery, keeps it in `state/secrets.json` once the app takes it, and names
+  every resource that holds the old one, which the next `apply` gives it to. Keep writes
+  to no app, as drift doesn't.
 
@@ -108,3 +111,3 @@ address after five failed sign-ins in a row.
 - **A resource left in an app is reported, never removed.** Removing what Mediaplane made
-  when its app leaves the stack needs a delete for every kind of resource: Slice 10.
+  when its app leaves the stack needs a delete for every kind of resource: Slice 10b.
 - **After upgrading to Slice 8, `plan` adopts each root folder once,** changing nothing
````

**Change** `docs/architecture.md`:

````diff
diff --git a/docs/architecture.md b/docs/architecture.md
index 5a6043f..28f562e 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -184,3 +184,5 @@ diff
   │ files, containers,
-  │ keys to generate,
+  │ keys to recover from
+  │ appdata, to generate,
+  │ or to put back,
   │ apps not healthy yet,
@@ -220,3 +222,5 @@ lock
  → plan, then ask
- → generate keys
+ → save the keys found
+   in appdata, generate
+   the rest
  → write files, and
@@ -228,3 +232,6 @@ lock
    network; stop a
-   stranded qBittorrent
+   stranded qBittorrent,
+   and an app whose key
+   goes back in its file
+   (then written)
  → up --wait, an app
@@ -246,3 +253,5 @@ lock
   pull, so a network failure leaves the running stack alone.
-- **Keys are saved before any container starts.**
+- **Keys are saved before any container starts.** A key `state/secrets.json` lacks is
+  first looked for in the app's own appdata, and only generated when the app holds none:
+  see [Rebuilding a host](#rebuilding-a-host).
 - **Pre-start files are written once, before the first start.** Some apps read a file
@@ -253,3 +262,4 @@ lock
   A file that is there but lacks Mediaplane's key is from an install made before
-  Slice 3a: `plan` stops with `<app>.not-seeded`.
+  Slice 3a: apply puts the key in it, the app stopped (see
+  [Rebuilding a host](#rebuilding-a-host)).
 - **Pulls are retried.** When a registry times out, drops the connection, answers with
@@ -328,2 +338,51 @@ Shows and Movies libraries.
 
+## Rebuilding a host
+
+A host is rebuilt from `stack.yaml`, `secrets/`, `compose.override.yaml`, `appdata/` and
+the data folder. Mediaplane makes the rest again
+([runbook](runbooks/rebuilding-a-host.md)):
+
+```text
+appdata/<app>/
+  │ the app's own files
+  ▼
+keys state/secrets.json
+lacks, read back
+  │ never through a link
+  │ out of the folder
+  ▼
+plan: secrets.recover
+  ▼
+apply's keys step
+saves them
+  ▼
+the wiring: each
+resource found by its
+name, and adopted
+```
+
+- **Key recovery.** Each app says where it keeps its keys (`keyFiles` in the catalog):
+  `config.xml` for Sonarr, Radarr and Prowlarr, `qBittorrent.conf`, Seerr's
+  `settings.json`, Gluetun's `auth/config.toml`, and Jellyfin's database, opened
+  read-only with Node's own SQLite. A key file that is there but can't be read stops
+  `plan` (`keys.unrecoverable`): a new key would lock Mediaplane out of an app that still
+  holds the old one.
+- **The admin password can't be read back:** the apps keep a hash. When the one
+  Mediaplane generated went with `state/`, apply generates another, and sets it in each
+  app through the app's key. `apply --rotate admin.password` does the same on purpose.
+  A secret apply generates is never checked by `plan`: no app holds it yet.
+- **Re-adoption.** Every resource Mediaplane makes has a name of its own, by which it is
+  found when `state/resources.json` lacks its id (`adopt`).
+- **A key changed at its source.** An app that keeps its key in a file of its own
+  (qBittorrent, whose web UI rotates it there, Gluetun, and the arrs' `config.xml`) gets
+  the key Mediaplane holds back: `plan` lists it under
+  `Keys to put back in their apps' own files`, the app as `restart`, and apply's start
+  step stops the app, writes the file, as Keep mine writes `stack.yaml`, and `up` starts
+  it again. `mediaplane keep <app>.<key>` keeps the app's own key instead, once the app
+  takes it, and the next `apply` gives it to every resource that holds the old one.
+  Jellyfin, which makes its own key, is signed in to again, while it stays published,
+  and makes another.
+- **A first-run setup that fails** fails its step, but the wiring still runs, skipping
+  that app's resources and what requires them; verify doesn't run.
+
 ## Bootstrap before publish
@@ -755,5 +814,6 @@ O ≠ L, O ≠ D: drift, changed
   `plan` shows the same drift. What puts each right is said by its kind: `apply` puts
-  back a field, a resource or a secret; a key changed at its source, and what is left in
-  an app, are put right by hand, or kept, until Slice 10. Its exit code is 0 when
-  nothing changed and every resource and secret was checked, and 2 otherwise.
+  back a field, a resource or a secret, and a key changed at its source where the app
+  keeps it in a file of its own; what is left in an app is removed by hand, or kept,
+  until Slice 10b. Its exit code is 0 when nothing changed and every resource and secret
+  was checked, and 2 otherwise.
 
@@ -799,4 +859,5 @@ O ≠ L, O ≠ D: drift, changed
   is clear once it has.
-- **Not yet:** putting back a key at its source, or giving a new one to every app that
-  holds it, and removing what Mediaplane made when its app leaves the stack (Slice 10);
+- **Keep mine of a key:** `mediaplane keep <app>.<key>` keeps an app's own key, changed
+  at its source, as [Rebuilding a host](#rebuilding-a-host) says.
+- **Not yet:** removing what Mediaplane made when its app leaves the stack (Slice 10b);
   drift on a schedule (M2).
@@ -910,2 +971,4 @@ The [roadmap](plans/m1-roadmap.md) has the order:
 
-- recovery and automation (Slice 10), which completes M1.
+- automation (Slice 10b): removing what Mediaplane made when its app leaves the stack,
+  a new Plex token for the arrs and Seerr, the `--json` contract, and the docs that
+  complete M1.
````

**Change** `docs/security/threat-model.md`:

````diff
diff --git a/docs/security/threat-model.md b/docs/security/threat-model.md
index a3f5426..a75302e 100644
--- a/docs/security/threat-model.md
+++ b/docs/security/threat-model.md
@@ -331,2 +331,7 @@ Controls today:
   refuses a path that leaves the folder, and a link on the way that leads outside it.
+- Mediaplane reads an app's key from its appdata only when `state/secrets.json` lacks it,
+  and never through a link that leads out of the app's folder: a compromised app could
+  otherwise plant a link to another app's file, and have Mediaplane take that app's key
+  as its own, and send it there. A key put back in an app's file is written only there,
+  never through a link, nor over a file with other names, or of another user or group.
 
@@ -364,3 +369,3 @@ What remains:
   until it is removed by hand (in Prowlarr's web UI). `mediaplane drift` reports it, as
-  still in the app though the stack no longer wants it; removing it for you is Slice 10.
+  still in the app though the stack no longer wants it; removing it for you is Slice 10b.
 - The apps' calls to each other, and Mediaplane's to them, are plain HTTP on Docker's own
@@ -481,2 +486,5 @@ Controls today:
   Mediaplane keeps `appdata/` itself private (0700), as it does `state/`.
+- Key recovery reads those keys back after a lost `state/`, Jellyfin's from its database,
+  opened read-only. A key read so is a secret of the run from then on: kept out of every
+  message, record and output, as the store's are.
 
@@ -629,3 +637,4 @@ What remains:
   what to do.
-- There is no way yet to rotate the generated password (Slice 10).
+- `mediaplane apply --rotate admin.password` gives every app a new generated password,
+  through each app's key. A password of your own is rotated in its file.
 
````

**Change** `README.md`:

````diff
diff --git a/README.md b/README.md
index a136879..80e5ce5 100644
--- a/README.md
+++ b/README.md
@@ -43,4 +43,7 @@ Compose and wires the apps together for you.**
 >   release yet.
-> - **Next:** rebuilding a host from `stack.yaml` and its appdata, and driving
->   Mediaplane from automation.
+> - **Rebuilding a host:** from `stack.yaml` and the apps' appdata, `apply` recovers each
+>   key the apps hold, finds what it made in them by name, and sets a new admin password
+>   through their keys if the generated one is lost. A key changed in an app is put back,
+>   or kept with `mediaplane keep`.
+> - **Next:** driving Mediaplane from automation.
 > - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
@@ -95,3 +98,4 @@ Mediaplane does that part for you:
 | Releases, and updating Mediaplane without touching the stack (none cut yet)       | Done    |
-| Rebuild a host, or deploy with automation such as Ansible                         | Planned |
+| Rebuild a host from `stack.yaml` and its appdata                                  | Done    |
+| Deploy with automation such as Ansible                                            | Planned |
 
@@ -592,7 +596,7 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
   test and `vpn-check`), S3b (the wiring framework), S3c (the download path), S4
-  (indexers), S5 (Jellyfin), S6 (requests), S7 (Plex), S8 (drift) and S9 (releases and
-  safe updates). Between S7 and
+  (indexers), S5 (Jellyfin), S6 (requests), S7 (Plex), S8 (drift), S9 (releases and
+  safe updates) and S10a (recovery). Between S7 and
   S8, smaller changes added a guided install (`deploy/install.sh`, and `init` asking for
   your own admin password and signing you in to Plex) and hardware transcoding.
-- **Next:** S10 (recovery and automation), which completes M1.
+- **Next:** S10b (automation), which completes M1.
 
````

**Change** `deploy/README.md`:

````diff
diff --git a/deploy/README.md b/deploy/README.md
index 7458459..cbe583b 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -685,2 +685,11 @@ only after `apply`, because `plan` joins the network to ask the apps. Bring
 
+## Moving to a new host
+
+Keep `stack.yaml`, `secrets/`, `compose.override.yaml` and `appdata/` from the Mediaplane
+home, and your data folder. On the new host, install Mediaplane with the same
+`MEDIAPLANE_HOME`, put them back, then run `mediaplane plan` and `mediaplane apply`: it
+recovers each app's key from its appdata, and finds what it made in the apps by name. The
+[rebuilding a host runbook](../docs/runbooks/rebuilding-a-host.md) has the steps, and
+what Mediaplane can't recover.
+
 ## Removing Mediaplane
````

- [ ] **Step 4: The spec and the roadmap**

**Change** `docs/design/m1-engine-cli.md` (§5.2, §6.1, and §11's "Slice 10a"):

````diff
diff --git a/docs/design/m1-engine-cli.md b/docs/design/m1-engine-cli.md
index 45ef867..3a1a15e 100644
--- a/docs/design/m1-engine-cli.md
+++ b/docs/design/m1-engine-cli.md
@@ -551,6 +551,6 @@ in `compose.override.yaml` is therefore wired automatically.
 | `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (a key or password check can leave a mark in an app: §11, Slices 3c, 4, 5, 6, 7 and 8; it never calls plex.tv); in the image it joins the wiring network, its only lasting change to Docker (§11, Slice 3b) |
-| `apply` | Converge on `stack.yaml` (§5) |
+| `apply` | Converge on `stack.yaml` (§5). `--rotate admin.password`, which `plan` takes too, generates a new admin password, and sets it in every app (§11, Slice 10a) |
 | `status [app]` | Container health, VPN state, and the last apply's outcome |
 | `drift` | Report drift only (§6.3): it changes nothing in the apps but for its checks' marks, fewer than `plan`'s, and keeps what it found of each secret, and of each app's own key, in `state/resources.json`; like `plan`, it joins the wiring network in the image, and like `apply` it holds `state/lock` while it runs (§11, Slice 8) |
-| `keep <path>` | Keep mine: record a drifted value, or a resource deleted or left in an app, as an override, adding one line to `stack.yaml`, and record it as applied in `state/resources.json`; like `plan`, it joins the wiring network in the image, and it holds `state/lock` while it runs (§11, Slice 8) |
+| `keep <path>` | Keep mine: record a drifted value, or a resource deleted or left in an app, as an override, adding one line to `stack.yaml`, and record it as applied in `state/resources.json`; or, for an app's own key changed at its source (`<app>.<key>`), keep the key its own file holds in `state/secrets.json`, which the next `apply` gives to each resource that holds the old one (§11, Slice 10a); like `plan`, it joins the wiring network in the image, and it holds `state/lock` while it runs (§11, Slice 8) |
 | `history [id]` | List change records, or show one in full |
@@ -617,3 +617,5 @@ generating anything:
 - `WebUI\APIKey` from `qBittorrent.conf`;
-- `main.apiKey` from Seerr's `settings.json`.
+- `main.apiKey` from Seerr's `settings.json`;
+- Mediaplane's role's `apikey` from Gluetun's `auth/config.toml`, and Jellyfin's key from
+  its database (§11, Slice 10a).
 
@@ -2096 +2098,89 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
 - **No new Docker API call:** the socket proxy's allow-list is unchanged (§7.2(2)).
+
+### Slice 10a: recovery (2026-10-26)
+
+- **S10 ships in two parts** (§2.3): S10a, recovery (a host rebuilt from `stack.yaml`
+  and its appdata, and the keys and setups Mediaplane holds there), and S10b, automation
+  (removing what Mediaplane made when its app leaves the stack, a new Plex token for the
+  arrs and Seerr, the `--json` contract, and the docs that complete M1). The roadmap
+  gives each part's items.
+- **Key recovery** (§6.1, §10 "Lost `state/`"). Each app says where it keeps its keys in
+  its appdata (`keyFiles` in the catalog). `plan`, `drift`, `keep` and `apply` read every
+  key `state/secrets.json` lacks from there, before anything is generated: `config.xml`
+  (Sonarr, Radarr, Prowlarr), `qBittorrent.conf`, Seerr's `settings.json`, as this
+  section lists them, and Gluetun's `auth/config.toml` (Mediaplane's role, from Slice
+  3a). `plan` lists them under `Secrets to recover from the apps' appdata:`
+  (`secrets.recover` in `--json`, additive within `mediaplane.plan/v1`), and the plan is
+  changed; apply's keys step saves them with those it generates (`recover` in the change
+  record's `plan.secrets`, an optional field within `mediaplane.change/v1`).
+  - **Jellyfin's key,** which Jellyfin makes, is recovered from its database
+    (`data/data/jellyfin.db`, the newest key named `Mediaplane`, as its setup picks
+    one), opened read-only with Node's own `node:sqlite`: Jellyfin keeps it in WAL mode,
+    so a read stops none of its writes and sees each at once, even as another user, with
+    the files readable (probed on Jellyfin 12.2). One closed cleanly, with no `-wal` and
+    `-shm` beside it, is opened immutable: a read-only open would make both, as
+    Mediaplane's user, in Jellyfin's folder (probed). Nothing is written.
+  - **Fail closed.** A key file that is there but can't be read, or holds a key the store
+    can't keep, stops `plan` (`keys.unrecoverable`): a new key would lock Mediaplane out
+    of the app, which still holds the old one. A file whose real path leads out of the
+    app's appdata folder is never read: an app that owns its folder could otherwise hand
+    Mediaplane another app's key. Jellyfin's, which its setup can find by signing in, is
+    a warning, and only while the admin password is to be generated too.
+- **The admin password can't be recovered:** the apps keep only a hash of it. When the
+  one Mediaplane generated went with the store, while the apps still hold their keys,
+  `plan` warns (`secrets.admin-password-lost`), and apply generates another and sets it
+  in each app through the app's key (§6.1: "plan reports it"). A password of your own
+  (`admin.password: { file: … }`) is kept.
+- **Name-based re-adoption** (§6.3) is Slice 3b's `adopt`, for every kind of resource
+  (probed): after a rebuild, each is found by the name Mediaplane gave it, and recorded,
+  with the same id in its app. Seerr's and Plex's `setUp` record goes with the store, so
+  each is set up again, unpublished, and checked to be Mediaplane's (Slices 6 and 7).
+- **A key changed at its source** (§6.3, the last row).
+  - **Re-apply puts it back:** a key file may say how to write its key back (`write`).
+    `plan` lists each key whose app keeps it in a file of its own that holds another key,
+    or none (`Keys to put back in their apps' own files`, `secrets.restore`), and the app
+    as `restart`. The start step stops the app, writes the key into the file, as Keep
+    mine writes `stack.yaml` (no link, no other names, the file's own user and group, its
+    mode kept), and `up` starts it, whatever the write did; a failed write then fails the
+    step. A guest of an app that restarts restarts too (Gluetun's qBittorrent).
+    qBittorrent's web UI rotates its key into its file (probed), so this puts it back
+    there. Sonarr, Radarr, Prowlarr and Seerr take their key from their environment at
+    every start, and their web UIs can't change it then (probed: Seerr's regenerate gives
+    back the same key while `API_KEY` is set, correcting Slice 6's note): only their
+    files need it, after a hand edit, or from before Slice 3a.
+  - **Installs from before Slice 3a** are put right this way (§11, Slice 3a): a
+    `config.xml` without `ApiKey` (the arrs don't write their environment's key into it,
+    probed), a `qBittorrent.conf` without `WebUI\APIKey`, or a Gluetun file without
+    Mediaplane's role (written whole, after your own roles) gets the key, and the app
+    restarts. `<app>.not-seeded` remains for a file Mediaplane can't write so
+    (`keys.restore`).
+  - **Keep mine reads the new key:** `mediaplane keep <app>.<key>` takes the key the
+    app's own file holds, once `plan` finds the app refusing Mediaplane's and the app
+    takes that one, into `state/secrets.json`, and names each resource that holds the old
+    one (`holders`, an optional field within `mediaplane.keep/v1`). The next apply gives
+    it to them, as a secret their app refuses: keep, like drift, writes to no app. It
+    writes nothing in `stack.yaml`, so it works with `managed_by: external` too. An app
+    Mediaplane can't ask with the key (Gluetun's control server) can't be kept.
+  - **Jellyfin's key,** refused while its setup is done (deleted in its dashboard), is
+    made again: `plan` lists its setup, published, and apply's bootstrap step signs in as
+    the shared admin, takes the newest key named `Mediaplane` or makes one, and saves it;
+    the arrs' connections take it in the wire step (§11, Slice 5's step by hand).
+- **A failed first-run setup no longer stops the wiring** (§5.1). The bootstrap step
+  fails, as before, but the wire step still runs, skipping that app's resources and what
+  requires them (`<app>'s first-run setup failed`); verify is skipped. A failure to reach
+  or publish the apps still stops it.
+- **Rotating the admin password:** `plan --rotate admin.password` and
+  `apply --rotate admin.password` generate it anew, as after a lost store. A password of
+  your own is refused (`rotate.yours`): change its file. A secret apply generates is
+  taken as a change, unchecked: no app holds it yet, so no sign-in is sent with it, and
+  none counts towards qBittorrent's ban.
+- **The setups' contract** (§3.2): a setup gets only the keys you give that an app's API
+  takes (`BootstrapContext.given`: your Plex token), never `state/secrets.json`'s;
+  `Bootstrap.firstStart` takes no stack; `AppLoginKind`'s own login is `{ own: 'Plex' }`;
+  `{ comingIn }` stays for apps to come, as `mediaplane.credentials/v1` keeps `not-yet`.
+- **Plex on a rebuilt host** comes back through Slice 7's setups: Plex, with its
+  `Preferences.xml`, and Seerr are asked whose account they are, through plex.tv. That
+  is unit-tested, not end to end on every pull request, which can't reach a real
+  plex.tv account.
+- **No new Docker API call:** recovery reads files in the home, a key put back is a file
+  written there between `compose stop` and `up`, which apply already makes (§7.2(2)).
````

**Change** `docs/plans/m1-roadmap.md`:

````diff
diff --git a/docs/plans/m1-roadmap.md b/docs/plans/m1-roadmap.md
index d06d02b..430b3db 100644
--- a/docs/plans/m1-roadmap.md
+++ b/docs/plans/m1-roadmap.md
@@ -4,4 +4,4 @@
 
-M1 is too large for one implementation plan, so it is delivered in 15 vertical
-slices: S1, S2 in three parts, S3 in four, and S4 to S10. Each slice:
+M1 is too large for one implementation plan, so it is delivered in 16 vertical
+slices: S1, S2 in three parts, S3 in four, S4 to S9, and S10 in two. Each slice:
 
@@ -27,2 +27,3 @@ Detailed plans so far:
 - Slice 9: [`m1-s9-releases.md`](m1-s9-releases.md) (done).
+- Slice 10a: [`m1-s10a-recovery.md`](m1-s10a-recovery.md) (done).
 
@@ -30,3 +31,3 @@ Where M1 stands (the README shows the same):
 
-- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6, S7, S8 and S9.
+- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6, S7, S8, S9 and S10a.
 - **Between S7 and S8 (2026-10-17), outside the slices** by the lighter route for small
@@ -35,3 +36,3 @@ Where M1 stands (the README shows the same):
   `deploy/install.sh`.
-- **Next:** S10 (recovery and automation), which completes M1.
+- **Next:** S10b (automation), which completes M1.
   [After M1](#after-m1) has what comes next.
@@ -63,3 +64,3 @@ Where M1 stands (the README shows the same):
 | S9 | **Releases and safe updates** | Versioned, published releases, and updating Mediaplane without touching the stack (listed below) | §8.2, §9 | Success criterion 7 |
-| S10 | **Recovery and automation** | Rebuilding a host, and running Mediaplane from automation (listed below) | §6.1 (key recovery), §6.3, §9 | M1 is done |
+| S10 | **Recovery and automation**, in two parts: S10a and S10b | Rebuilding a host, and running Mediaplane from automation (listed below) | §6.1 (key recovery), §6.3, §9 | M1 is done |
 
@@ -109,2 +110,36 @@ playbook. That completes M1.
 
+### S10 is delivered in two parts (decided 2026-10-26)
+
+S10 is too large for one plan (about 16 tasks), so it ships as two parts, each ending
+green, as a full slice does. The cut follows what each changes: S10a, what Mediaplane
+holds on a host (its keys, and the setups that make or use them), so that a host is
+rebuilt from its files; S10b, what the stack and its users see from outside (what is
+removed when an app leaves, the Plex token's rotation, and the contract automation
+relies on, with the docs that complete M1).
+
+- **S10a: recovery** ([plan](m1-s10a-recovery.md)).
+  - Delivers: key recovery from appdata, Jellyfin's from its database; a key put back at
+    its source, installs from before S3a included; keep of an app's own key, given to
+    every holder by the next `apply`; Jellyfin's key made again; a failed first-run setup
+    no longer stopping the wiring; the setups' keys and contract leftovers; the admin
+    password rotated (`--rotate admin.password`), and set anew through the keys after a
+    lost `state/`; the "rebuilding a host" runbook.
+  - Proves: a host rebuilt from `stack.yaml` and its appdata, on real Docker: every key
+    recovered, every resource adopted by name, a new admin password set through the keys,
+    and a second `apply` with no changes; qBittorrent's key changed in its web UI, put
+    back by `apply`, then kept by `keep`.
+- **S10b: automation.**
+  - Delivers: removing what Mediaplane made when its app leaves the stack (§8.1(3) step
+    4); a new Plex token for the arrs, and Seerr signed in again with it, a Plex
+    unclaimed while it runs claimed again, Seerr's own Jellyfin key replaced, and Seerr
+    asked rather than its `settings.json` read; externally managed mode finished, with
+    `keep`'s line to add in `mediaplane.keep/v1`; the `--json` contract pinned and in the
+    generated docs, exit codes, commands that ask nothing when a script runs them, and a
+    second `apply` that changes nothing; `plan --help` and `drift --help` pointing at the
+    published docs; the "deploying with automation" guide with a short Ansible example,
+    the full README and the add-an-app guide; the test gaps and S9's review items below;
+    and which Compose versions work out a service differently.
+  - Proves: a playbook deploys a stack, removes an app from it, and rebuilds the host,
+    reading only the documented contract.
+
 ### S2 is delivered in three parts (decided 2026-10-09)
@@ -537,2 +572,3 @@ password, which are S3c's (and listed again below).
   rotating the admin password. S8 keeps drift and Keep mine.
+  - **Done in S10a:** all three, as the items below say.
 - **Decided by the owner on 2026-10-17,** for the items below:
@@ -555,2 +591,5 @@ password, which are S3c's (and listed again below).
     check that token with Seerr's key without a call that reaches plex.tv.
+  - **Moved to S10b:** it needs plex.tv probes with a real account, and a test that only
+    the nightly job can run; it rotates a token you give, which S10a's recovery of the
+    keys Mediaplane holds doesn't touch.
 - **The arrs keep a Plex token while Plex takes it** (S7): a new token from `plex-login`
@@ -560,2 +599,4 @@ password, which are S3c's (and listed again below).
     rotation, with S10.
+  - **Moved to S10b,** with Seerr's new token: both need to know the token changed,
+    which Mediaplane can't tell by comparing secrets.
 - **Plex's libraries are known by name** (S7), as Jellyfin's are: one renamed by hand
@@ -579,2 +620,4 @@ password, which are S3c's (and listed again below).
     S10.
+  - **Moved to S10b,** with the Plex token's items: it needs a real claim, through
+    plex.tv. A rebuilt host's Plex is checked again by S7's setup (S10a).
 - **Every setup gets every stored key** (S7): `BootstrapContext.keys` holds each app's,
@@ -583,2 +626,4 @@ password, which are S3c's (and listed again below).
   - **Moved to S10:** S8 changes no setup; S10 signs setups in again.
+  - **Done in S10a:** a setup gets only the keys you give that an app's API takes
+    (`BootstrapContext.given`): your Plex token.
 - **The setups' contract has leftovers** (S7): `Bootstrap.firstStart`'s `stack` is
@@ -588,2 +633,4 @@ password, which are S3c's (and listed again below).
   - **Moved to S10,** with the setups, for the same reason.
+  - **Done in S10a:** `firstStart` takes no stack, and the own login is
+    `{ own: 'Plex' }`; `{ comingIn }` and `not-yet` stay, for the apps to come.
 - **The fake Seerr's `/auth/me` answers a session that isn't its admin's** with the
@@ -592,2 +639,3 @@ password, which are S3c's (and listed again below).
   - **Moved to S10,** with signing Seerr in again.
+  - **Moved to S10b,** with signing Seerr in again.
 
@@ -652,2 +700,4 @@ password, which are S3c's (and listed again below).
   - **Moved to S10 on 2026-10-25,** with restoring a key at its source.
+  - **Done in S10a:** `apply` stops the app, puts the key in its file, and starts it
+    again; `not-seeded` remains only for a file Mediaplane can't write so.
 - **FlareSolverr's anonymous volume.** Its image declares `VOLUME /config`, and the
@@ -665,2 +715,4 @@ password, which are S3c's (and listed again below).
   - **Moved to S10 on 2026-10-25.**
+  - **Done in S10a:** `apply --rotate admin.password`, and `plan` with it, set a new one
+    through each app's key, as after a lost `state/`.
 - **A wiring network whose settings change.** Compose must make it anew then, and
@@ -687,2 +739,3 @@ password, which are S3c's (and listed again below).
     for every kind of resource, and its own end-to-end test (spec §8.1(3) step 4).
+    **Moved to S10b:** it changes what the stack holds, not what Mediaplane recovers.
 - **Settings Mediaplane manages in Prowlarr are put back.** A link's addresses, sync
@@ -729,2 +782,4 @@ password, which are S3c's (and listed again below).
     refusing its key.
+  - **Done in S10a:** `plan` lists Jellyfin's setup again, published, while its wizard is
+    done, and `apply` signs in, makes the key, and gives it to the connections.
 - **Checking Jellyfin's admin password signs in** (S5), and Jellyfin's activity log keeps
@@ -756,2 +811,4 @@ password, which are S3c's (and listed again below).
   - **Moved to S10:** it changes apply's steps, not drift.
+  - **Done in S10a:** the wire step runs past it, skipping that app's resources and what
+    requires them; verify doesn't run.
 - **Seerr's checks log a line when they fail** (S6, probed): Seerr's own test of a
@@ -774,2 +831,3 @@ password, which are S3c's (and listed again below).
     S10.
+  - **Moved to S10b,** with the other rotations of what Seerr holds.
 - **A Seerr whose `settings.json` Mediaplane can't read** is set up again, unpublished,
@@ -780,2 +838,5 @@ password, which are S3c's (and listed again below).
     instead changes its setup: moved to S10.
+  - **Moved to S10b,** with Seerr signed in again. S10a reads its key from that file
+    too, and a file it can't read stops `plan` (`keys.unrecoverable`) when the store
+    lacks the key.
 - **Seerr's libraries are enabled by name, from Seerr's last sync** (S6). A library made
@@ -806,2 +867,3 @@ password, which are S3c's (and listed again below).
     to set: the S9 plan gives the settings for light and strict, and recommends strict.
+  - **S10's are S10b's** (split on 2026-10-26): S10a settles none of the items below.
 - **Decided by the owner on 2026-10-17:**
@@ -927,3 +989,3 @@ password, which are S3c's (and listed again below).
     GHCR's and lscr.io's pulls stay anonymous, and apply's own pull retries stay.
-- **Which Compose versions work out a service differently (open, for S10).** Updating
+- **Which Compose versions work out a service differently (open, for S10b).** Updating
   Mediaplane never touches the stack, but a later `apply` runs the image's own Docker
@@ -934,3 +996,3 @@ password, which are S3c's (and listed again below).
   and say so in Renovate's pull request for a Compose bump.
-- **From S9's reviews, for S10.** None hides a fault in S9's releases:
+- **From S9's reviews, for S10b.** None hides a fault in S9's releases:
   - a test that Renovate can read the tag of each image pinned outside the catalog
@@ -948,3 +1010,3 @@ password, which are S3c's (and listed again below).
     the stack's user and group (1000), replayed on both Composes.
-- **Before the first real migration** of `stack.yaml` (none is planned, S10 included;
+- **Before the first real migration** of `stack.yaml` (none is planned, S10a and S10b included;
   spec §11, Slice 9): make the commands that only read `stack.yaml` (`credentials`,
@@ -997,3 +1059,3 @@ password, which are S3c's (and listed again below).
     (allowed networks may be set on purpose), and the same for any existing Sonarr and
-    Radarr. It builds on S10's re-adoption by name and key recovery from appdata.
+    Radarr. It builds on S10a's re-adoption by name and key recovery from appdata.
 - **NVIDIA hardware transcoding.** `hardware_transcoding` gives the media server
````

- [ ] **Step 5: See the docs promise nothing of Slice 10 that is built**

Run: `test "$(grep -rlE 'Slice 10 does this for you|yet \(Slice 10\)|Slice 10 restores|comes in Slice 10\.|password \(Slice 10\)|is Slice 10\.|\*\*Next:\*\* S10 |\(Slice 10\);|until Slice 10\.' README.md catalog docs/runbooks docs/architecture.md docs/security docs/adr docs/plans/m1-roadmap.md | wc -l)" -eq 0`
Expected: it exits 0. Every `text` diagram is 40 columns at most, and none is Mermaid.

- [ ] **Step 6: Run the full check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: rebuilding a host, a key put back or kept, the admin password rotated; spec §11 Slice 10a, and the roadmap's S10a and S10b" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


## Slice 10a completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements. When this
  plan was replayed: 98.05% statements, 92.9% branches, 98.07% functions and 99.18% lines, with 2442 tests in 111 files.
- [ ] `pnpm test:e2e` passes with Compose 2.38.2 as the host plugin too, and leaves no
  `mediaplane-e2e-*` container, network, volume or image, and no `mediaplane-e2e-*`
  folder. When this plan was replayed, alone on the dev box, warm, without the plex.tv
  token (so the nightly test was skipped):
  - with Compose 5.5.1, 29 tests passed and 1 skipped in 13 files, in 18 min 4 s (the rebuild test alone took about 2 min);
  - with Compose 2.38.2, 29 passed and 1 skipped, in 18 min 49 s.

  CI's e2e job allows 60 minutes, so `ci.yml` keeps its timeout.
- [ ] A host is rebuilt from `stack.yaml` and its appdata (`test/e2e/rebuild.e2e.test.ts`),
  and the deploy test recovers every key from inside the image: both pass on both
  Composes.
- [ ] The socket proxy's allow-list is unchanged:
  `git diff 16d1b08 -- deploy/mediaplane.compose.yaml deploy/deploy.test.ts` prints
  nothing (decision 17). `16d1b08` is `main` before this slice.
- [ ] No committed file contains a real path, user name, host name, address or token:
  `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing but the
  project's own names (its GitHub repo and schema URL, its GHCR image, the workflows'
  repository guards, the release notes' install commands) and the tests' fake
  `/srv/data/home` paths.
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B 16d1b08.. | grep -c Claude-Session` prints
  `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - the (check) decisions, for the controller and the owner to confirm or reverse: 1 (the
    split), 3 (Jellyfin's key read from its database), 5 (a lost generated password set
    anew through the keys), 7 (a key put back at its source, by `apply`), 10 (Keep mine
    of a key, given to the holders by the next `apply`) and 14 (`--rotate`);
  - that S10b's plan comes next, from the roadmap's S10b list.

There are no owner's steps in this slice.
