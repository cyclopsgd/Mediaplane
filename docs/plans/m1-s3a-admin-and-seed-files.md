# M1 Slice 3a: shared admin and pre-start files — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every stack gets one shared admin login, with a generated password unless you
give your own, and `mediaplane credentials` shows it. Before an app first starts, Mediaplane
writes the files it reads at start: Sonarr's, Radarr's and Prowlarr's `config.xml` with
their API key, qBittorrent's `qBittorrent.conf` with the shared login and its API key, and
Gluetun's control-server key. qBittorrent is the first app whose login works from its first
start. `init` asks for what this needs, the S3 network inputs from the roadmap land, and
two kinds of housekeeping: pulls are retried on registry hiccups, and tests clean up after
themselves.

**Architecture:**

- **The shared admin (spec §6.1).** `admin.username` gets a pattern; a password of your
  own must be at least 12 characters. Otherwise apply generates 24 base62 characters and
  keeps them in `state/secrets.json` as `shared.adminPassword`, an additive optional key in
  the store's v1 format. `plan` lists `admin.password` among the secrets to generate.
- **Pre-start files (spec §6.4).** Each catalog app may declare a pure renderer,
  `configFiles(ctx)`, which returns the files to write into its appdata folder: a path, the
  content, and a pattern (`seeded`) that recognises the file as Mediaplane's even after the
  app has rewritten it.
  - The engine renders them (`render/prestart.ts`).
  - `plan` reports each one as `create` (absent) or `unchanged` (present), marked `prestart`
    and `sensitive`, so it never shows the content (`plan/prestart.ts`). A file that exists
    but doesn't match `seeded` is an install from before this slice, and plan fails with
    `<app>.not-seeded` and the steps to fix it.
  - `apply` writes the absent ones in its `files` step, before any pull or start: all at
    once, 0600, never over an existing file, with their folders created
    (`apply/prestart.ts`). It looks first (`lstat`) and writes only where nothing is, so
    it never touches a folder the app has taken over.
- **`mediaplane credentials [app]` (spec §5.2).** The engine's `credentials()` loads the
  stack, the store and the host facts, and returns the login and each web UI's address.
  Each catalog app says whether its login is the shared one today or which slice brings
  it (`login`).
- **The network inputs (roadmap, S3).** Apps learn whether their web UIs are on the LAN
  (`AppContext.publishesOnLan`), and which LAN subnets to trust
  (`AppContext.lanClientSubnets`: the LAN subnets while the UIs are on the LAN, otherwise
  none). Gluetun's outbound subnets, Servarr's trusted networks and qBittorrent's login
  whitelist all read `lanClientSubnets`. `lan_subnet` must be private, a cloud VM trusts no
  subnet unless you name one, and `plan` warns when the UIs are on the LAN but no subnet
  is known.

**Tech Stack:** as Slice 2c (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no new image:
PBKDF2 comes from `node:crypto`, and the end-to-end tests use only images already pinned.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §4.3 (credential seeding steps), §5 steps 4, 6, 7 and 12, §5.1 (retries), §5.2
  (`init`, `credentials`);
- §6.1 (the credentials table, login on the LAN, the shared admin credential), §6.2 (the
  qBittorrent row), §6.4 (pre-start files);
- §7.2(4) and (5) (secrets, the apps' logins);
- §9 (the documentation set).

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md), especially the S3 row, the S3
list in "Inputs for later slices from the reviews", and "Every slice writes its own docs as
it goes".

Decisions made for S3 after the roadmap (controller's rulings, 2026-10-09; the owner can
still reverse the ones marked "logged"):

- **S3 ships in four parts, in this order:** S3a (this plan: shared admin and pre-start
  files), S3d (VPN: the kill-switch test and `vpn-check`), S3b (the wiring framework), S3c
  (the download path). S3b waits for the owner's decision on how the Mediaplane container
  reaches the apps.
- **Pre-start files** are written only if absent, in the `files` step, with exclusive
  creation, mode 0600 and their parents created. `plan` lists them as created before first
  start, and marks them sensitive. The renderer is `configFiles?(ctx)` on `AppDefinition`.
- **Installs from before S3a** are detected and reported, never overwritten:
  `qbittorrent.not-seeded` when `qBittorrent.conf` exists without `WebUI\APIKey`, and the
  same for a Servarr `config.xml` without `ApiKey`. S4 automates the fix.
- **The shared admin:** the username pattern, 12 characters minimum for your own password
  (`admin.password-too-short`), `{ generate: 'password' }` of 24 base62 characters stored
  as `shared.adminPassword`. In S3a the login reaches only qBittorrent, through its
  pre-start file. Sonarr, Radarr and Prowlarr get it through their API in S3b, but S3a
  already writes their `config.xml` with `ApiKey`, `AuthenticationMethod` and
  `AuthenticationRequired`.
- **`init` asks five more questions,** each with a flag for non-TTY use.
- **Automatic Torrent Management is on** (logged for the owner).
- **Gluetun gets a pre-start `auth/config.toml`** with a generated `controlApiKey` whose
  role covers only `GET /v1/vpn/status` and `GET /v1/publicip/ip`.
- **Change records grow by additive, optional fields within `mediaplane.change/v1`.**
- **Housekeeping:** a pull is retried on transient registry errors; a shared test helper
  removes the temporary folders unit tests make; the end-to-end homes are removed and
  `composeDown` passes `-v`.

## Global Constraints

Everything in the Slice 1, 2a, 2b and 2c Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md`, `m1-s2a-plan-against-docker.md`, `m1-s2b-apply.md`,
`m1-s2c-packaging.md`):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses or hostnames in committed files. Test secrets look like
  `fake-admin-password`, `'0'.repeat(32)` or `qbt_` and 28 zeros, which `.gitleaks.toml`
  allows;
- neutral framing;
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes nothing;
- Docker is reached only through the `Runtime`;
- unit tests never need Docker, except the spawned tests in
  `packages/cli/src/main.test.ts`;
- `apply` writes only inside the Mediaplane home, with the S2b file modes, and pre-start
  files 0600;
- the runtime refuses any Compose project that is not `mediaplane` or `mediaplane-<name>`,
  and never accepts `mediaplane-system`;
- every image is pinned by digest, and every GitHub Action by commit SHA;
- end-to-end test files run one at a time;
- never push.

These are added or restated for this slice:

- **Secrets never appear** in diagnostics, errors, change records, logs, `plan` or `apply`
  output, or JSON output. The two exceptions are both in `mediaplane credentials`: its
  human output shows a generated password (spec §6.1: "`mediaplane credentials` shows
  them"), and `--reveal` shows the password in `--json`, or your own password. A
  pre-start file's content is never shown, diffed or recorded.
- **Docker and Compose flags.** Compose spells some long flags differently in v2 and v5
  (`--no-TTY` and `--no-tty`). CI runs Docker 28 with Compose v2.38.2; the dev box runs
  Docker 29.8 with Compose 5.5.1; preflight requires Compose 2.24. Prefer short flags. This
  slice adds only `down -v` (the short form of `--volumes` in both) in the end-to-end
  helpers, and `docker logs <id>` in a test. Never add a Compose long flag without checking
  its spelling on both.
- **Never prune images** (`docker image prune`, `docker system prune`): the dev box keeps
  the pinned images cached for the end-to-end tests.
- **Names in end-to-end tests** start with `mediaplane-e2e-`: projects
  `mediaplane-e2e-<pid>[-<suffix>]`, temporary folders `mediaplane-e2e-…`.
- **Temporary folders in unit tests** come from `tempDir()` or `tempDirSync()` in
  `@mediaplane/engine/testing` (from Task 1 on), so they are removed when the test ends.
  No new `mkdtemp` in a unit test; the existing ones in `scripts/` and `deploy/` clean up
  after themselves.
- **Coverage thresholds are never lowered.** `vitest.config.ts` keeps 90% lines,
  functions, branches and statements on `packages/engine/src`.
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

The spec and the rulings leave these open. Each is marked `Decision:` where it is applied:

1. The temporary-folder helper registers its removal with Vitest's `onTestFinished`, and
   lives in `@mediaplane/engine/testing` beside the other test helpers (Task 1).
2. The end-to-end `makeHome()` registers the home's removal (as root, for files the apps
   wrote) with `onTestFinished`, so no test has to remember it (Task 1).
3. A pull is retried three times, after 5, 15 and 45 seconds, on: TLS handshake and I/O
   timeouts, reset connections, unexpected EOF, client timeouts, rate limits and HTTP
   500/502/503/504. A name that doesn't resolve, a missing image or a refused login is not
   retried (Task 2).
4. `network.no-lan-subnet` comes from the catalog's `validate` hooks: Gluetun's (the LAN
   can't reach qBittorrent through its firewall) and qBittorrent's (no LAN whitelist
   although `login_on_lan` is `false`), because each knows what it loses (Tasks 3 and 8).
5. The admin password is generated for every stack that doesn't set `admin.password`, even
   before an app uses it, so it exists before any app needs it (Task 4).
6. `plan` renders the pre-start files from a preview of the secrets apply would generate,
   in memory, to learn their paths. It shows and keeps no content; apply renders them
   again with the keys it saves. Both call one helper, `prestartFilesFor` (Task 5).
7. An existing pre-start file that Mediaplane can't read (the app owns it after its first
   start) counts as seeded: there is no way to tell, and installs from before S3a are the
   owner's own dev installs only (Task 5). Apply leaves it alone the same way (Task 6).
8. Pre-start files are written with the existing `writeFileExclusive` (exclusive creation
   through a hard link: never over an existing file, and never half-written), which the
   home already needs for its lock. It makes a temporary file next to the target, so apply
   first `lstat`s each path and writes only when that says ENOENT. Anything else (a file,
   EACCES, EPERM) is the app's, and skipped: after the first start the app's folder may
   be closed to Mediaplane (Task 6).
9. The `config-file` credential step is removed from the catalog types: `configFiles(ctx)`
   replaces it (Task 8).
10. qBittorrent's `AuthSubnetWhitelist` follows the same rule as Servarr's trusted
    networks: only with `login_on_lan: false` and the web UI published on the LAN (Task 8).
    The rule lives in one place: the resolver's `AppContext.lanClientSubnets`, which is
    `lanSubnets` while the web UIs are on the LAN and `[]` otherwise (Task 3). Gluetun,
    Servarr and qBittorrent read only that.
11. `credentials` shows a generated password in its human output, as spec §5.2 and §6.1
    say ("never printed in `--json` unless `--reveal` is given"; "`mediaplane credentials`
    shows them"). Your own password, from `admin.password`, is shown only with `--reveal`.
    The JSON entry for each app is `{app, name, urls, login: 'shared' | 'not-yet',
    comingIn?}` (Task 9).
12. Each catalog app with a published web UI declares `login`: `'shared'` (qBittorrent),
    or `{ comingIn: 'Slice …' }` (Sonarr, Radarr and Prowlarr: 3b; Jellyfin and Plex: 6;
    Seerr: 7). `credentials` lists only these apps (Task 9).
13. `credentials` builds each URL from the stack's bind addresses and published ports. With
    `bind: all` it names `127.0.0.1` and the host's private addresses instead of `0.0.0.0`.
    It needs the host facts (the host helper, in the image), not the running containers, so
    it works before the stack is up (Task 9).
14. `init`'s question order is: media server, data folder, VPN provider, WireGuard address
    (with a provider), `lan` or `localhost`, LAN subnet (with `lan`), login on the LAN,
    admin user name, generate the password or name a file. On a cloud VM, init never
    offers the subnet it sees (a cloud VM's private network is not a LAN): you type it.
    Without a terminal, `--bind lan` with no `--lan-subnet` writes no subnet (plan detects
    it), except on a cloud VM, where init refuses, as plan would. `--admin-password-file`
    must be a path inside the home, and `--vpn-addresses` needs `--vpn-provider`
    (Task 10).
15. The S3a end-to-end checks extend the existing apply test's stack instead of starting a
    second one, which saves about three minutes on each CI runner (Task 11).

## File structure (new and changed in this slice)

```
packages/engine/src/
├── testing/temp.ts (+test)          (new) tempDir, tempDirSync
├── testing/fakes.ts                 (changed) a pull that answers in sequence
├── apply/pull.ts (+test)            (new) pullImages: retries transient errors
├── apply/prestart.ts (+test)        (new) writePrestartFiles, only where lstat
│                                          finds nothing
├── apply/apply.ts                   (changed) pull retry, pre-start files, sleep
├── host/facts.ts                    (changed) isPrivateSubnet
├── config/schema.ts                 (changed) private lan_subnet, admin rules
├── config/secrets.ts                (changed) admin.password-too-short
├── catalog/types.ts                 (changed) publishesOnLan, lanClientSubnets,
│                                             ConfigFile, ConfigFileContext,
│                                             configFiles, login;
│                                             no more config-file step
├── resolver/resolve.ts              (changed) lanSubnets on a cloud VM,
│                                             publishesOnLan, lanClientSubnets
├── secrets/admin.ts (+test)         (new) adminPasswordToGenerate, adminLogin
├── secrets/store.ts                 (changed) shared.adminPassword
├── secrets/generate.ts              (changed) the 'password' kind, the admin password
├── secrets/values.ts                (changed) secretsToGenerate lists admin.password
├── render/prestart.ts (+test)       (new) renderPrestartFiles, prestartFilesFor
├── plan/prestart.ts (+test)         (new) planPrestartFiles, <app>.not-seeded
├── plan/files.ts                    (changed) FileChange.prestart
├── plan/plan.ts                     (changed) pre-start files in the plan
├── credentials.ts (+test)           (new) credentials()
└── index.ts                         (changed) new exports
packages/cli/src/
├── credentials.ts (+test)           (new) printCredentials
├── output.ts (+output.test.ts)      (changed) the pre-start line
├── run.ts                           (changed) credentials, init's new flags
└── init.ts                          (changed) five new questions
catalog/
├── _shared/servarr.ts               (changed) config.xml, LAN-only trusted networks
├── sonarr|radarr|prowlarr/app.ts    (changed) configFiles, login
├── qbittorrent/conf.ts (+test)      (new) qBittorrent.conf, PBKDF2
├── qbittorrent/app.ts               (changed) configFiles, login, warning
├── gluetun/app.ts                   (changed) controlApiKey, auth file, LAN rule
├── jellyfin|plex|seerr/app.ts       (changed) login
├── render.test.ts, catalog.test.ts  (changed)
└── */README.md                      (changed) hand-written sections, facts
test/e2e/
├── helpers.ts                       (changed) makeHome cleans up, down -v
├── apply.e2e.test.ts                (changed) S3a checks
└── plan.e2e.test.ts                 (changed) temp folders, pre-start files
docs/                                (changed) threat model, architecture,
                                     references, spec §11, roadmap
deploy/README.md, README.md          (changed)
```

The unit tests that move to `tempDir` (Task 1) are listed in that task.

**Tasks:**

1. A shared temporary-folder helper, and end-to-end tests that clean up.
2. Retry image pulls after transient registry errors.
3. The LAN inputs: a private `lan_subnet`, LAN-only trust, and `network.no-lan-subnet`.
4. The shared admin: user name rules, a 12-character minimum, and a generated password.
5. Pre-start files in `plan`: the `configFiles` hook, and installs from before S3a.
6. Pre-start files in `apply`: written once, before the first start.
7. Servarr's `config.xml` and Gluetun's control-server key.
8. qBittorrent's `qBittorrent.conf`.
9. `mediaplane credentials`.
10. `init`'s five new questions.
11. End-to-end: the seeded files and qBittorrent's login on real Docker.
12. Docs: threat model, app READMEs, install guide, architecture, spec §11, roadmap.

**Out of scope here:**

- **The Servarr admin login.** S3a writes `config.xml` but creates no user: that goes
  through the API, as the first resource of S3b's wiring framework. Nothing here may
  claim that the shared login works in Sonarr, Radarr or Prowlarr.
- **Wiring** (download clients, categories, root folders, `resources.json`, the typed HTTP
  client): S3b and S3c.
- **The kill-switch end-to-end test, `vpn-check`, the WireGuard server pin and the CI
  `modprobe` step:** S3d.
- **Fixing installs from before S3a automatically:** S4, with the rest of "restore the key
  at the source".
- **Mediaplane's network in Servarr's `TRUSTEDNETWORKS`** (roadmap ruling R12): M2. Task
  12 records why in spec §11.
- **ADR 0011** (how the Mediaplane container reaches the apps): S3b, after the owner's
  decision.

---
### Task 1: A shared temporary-folder helper, and end-to-end tests that clean up

Controller's notes: the unit tests `mkdtemp` under about twenty prefixes and never clean
up (some 9,300 `/tmp/mediaplane-*` folders built up in a day of runs); the plan and apply
end-to-end homes leak too; and `composeDown` leaves anonymous volumes behind, such as the
one FlareSolverr's image declares (`VOLUME /config`).

Decision: the helper registers its removal with Vitest's `onTestFinished`, which runs
whether the test passed or not, and lives in `@mediaplane/engine/testing` with the other
test helpers. Decision: the end-to-end `makeHome()` registers `removeHome()` the same way,
so a test only has to bring its project down in its own `finally`, which runs first.

**Files:**
- Create: `packages/engine/src/testing/temp.ts`, `packages/engine/src/testing/temp.test.ts`
- Modify: `packages/engine/src/testing/index.ts`
- Modify (call sites and imports only):
  - `packages/cli/src/init.test.ts`, `packages/cli/src/main.test.ts`,
    `packages/cli/src/run.test.ts`;
  - `packages/engine/src/status.test.ts`;
  - `packages/engine/src/apply/apply.test.ts`, `apply/ownership.test.ts`;
  - `packages/engine/src/config/load.test.ts`, `config/secrets.test.ts`;
  - `packages/engine/src/history/records.test.ts`;
  - `packages/engine/src/host/facts.test.ts`, `host/helper.test.ts`;
  - `packages/engine/src/plan/files.test.ts`, `plan/plan.test.ts`;
  - `packages/engine/src/preflight/probe.test.ts`;
  - `packages/engine/src/runtime/docker.test.ts`;
  - `packages/engine/src/secrets/store.test.ts`, `secrets/values.test.ts`;
  - `packages/engine/src/state/lock.test.ts`;
  - `packages/engine/src/testing/fakes.test.ts`;
  - `packages/engine/src/util/atomic.test.ts`, `util/fs.test.ts`.
- Modify: `test/e2e/helpers.ts`, `test/e2e/apply.e2e.test.ts`, `test/e2e/plan.e2e.test.ts`
- Leave alone: `scripts/bundle.test.ts`, `scripts/docs.test.ts`, `scripts/root.test.ts`
  and `deploy/deploy.test.ts` keep their `mkdtemp`: they already clean up after
  themselves.

**Interfaces:**
- **Consumes:** Vitest's `onTestFinished`.
- **Produces**, exported from `@mediaplane/engine/testing` (and, inside the engine, from
  `packages/engine/src/testing/temp.ts`):
  - `tempDir(prefix: string): Promise<string>`;
  - `tempDirSync(prefix: string): string`.

  Both must be called while a test runs (in the test, or a helper it calls), never in a
  hook or at the top of a file. Every later task uses them for temporary folders.
- **Changes:** `makeHome()` in `test/e2e/helpers.ts` removes its home after the test, and
  `composeDown(project)` runs `docker compose -p <project> down --remove-orphans -v`.

- [ ] **Step 1: Write the failing test**

`packages/engine/src/testing/temp.test.ts`:

```ts
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir, tempDirSync } from './temp';

// The first test records the folders it made; the second checks they are gone.
const made: string[] = [];

describe('tempDir and tempDirSync', () => {
  it('make an empty folder in the temporary folder, named with the prefix', async () => {
    const dir = await tempDir('mediaplane-temp-');
    expect(dir.startsWith(join(tmpdir(), 'mediaplane-temp-'))).toBe(true);
    expect(existsSync(dir)).toBe(true);
    await writeFile(join(dir, 'file'), 'fake-content');
    const sync = tempDirSync('mediaplane-temp-');
    expect(existsSync(sync)).toBe(true);
    made.push(dir, sync);
  });

  it('removed both folders, and what was in them, when that test finished', () => {
    expect(made).toHaveLength(2);
    for (const dir of made) expect(existsSync(dir)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run packages/engine/src/testing/temp.test.ts`

Expected: FAIL, because `./temp` does not exist.

- [ ] **Step 3: Write the helper**

`packages/engine/src/testing/temp.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

/**
 * A new, empty folder in the system's temporary folder, named `prefix` and a random
 * suffix. It is deleted, with everything in it, when the test that asked for it finishes,
 * whether the test passed or not. Call it while a test runs, from the test or a helper it
 * calls, never from a hook or at the top of a file.
 */
export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** tempDir(), for synchronous code. */
export function tempDirSync(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
```

In `packages/engine/src/testing/index.ts`, add after `export * from './schema';`:

```ts
export * from './temp';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run packages/engine/src/testing/temp.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Count the temporary folders before**

```bash
TMP="$(node -p 'require("os").tmpdir()')"
ls -d "$TMP"/mediaplane-* 2>/dev/null | wc -l
```

Write the number down. Run this and the count after Step 9 on a quiet machine: another
session's test run would change it.

- [ ] **Step 6: Replace every `mkdtemp` call in the unit tests**

```bash
sed -i -E \
  -e "s/mkdtemp\(join\(tmpdir\(\), ('[^']+')\)\)/tempDir(\1)/g" \
  -e "s/mkdtempSync\(join\(tmpdir\(\), ('[^']+')\)\)/tempDirSync(\1)/g" \
  packages/cli/src/init.test.ts packages/cli/src/main.test.ts \
  packages/cli/src/run.test.ts packages/engine/src/status.test.ts \
  packages/engine/src/apply/apply.test.ts packages/engine/src/apply/ownership.test.ts \
  packages/engine/src/config/load.test.ts packages/engine/src/config/secrets.test.ts \
  packages/engine/src/history/records.test.ts packages/engine/src/host/facts.test.ts \
  packages/engine/src/host/helper.test.ts packages/engine/src/plan/files.test.ts \
  packages/engine/src/plan/plan.test.ts packages/engine/src/preflight/probe.test.ts \
  packages/engine/src/runtime/docker.test.ts packages/engine/src/secrets/store.test.ts \
  packages/engine/src/secrets/values.test.ts packages/engine/src/state/lock.test.ts \
  packages/engine/src/testing/fakes.test.ts packages/engine/src/util/atomic.test.ts \
  packages/engine/src/util/fs.test.ts
```

The imports still name `mkdtemp` and `tmpdir` until Step 7 removes them.

- [ ] **Step 7: Fix the imports**

In each file, make exactly these edits. "Add" means a new import line after the file's
last relative (`./` or `../`) import, or, in the CLI files, as shown.

- `packages/cli/src/init.test.ts`:
  - `import { mkdtemp, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';`
    becomes `import { open, readdir, readFile, stat, writeFile } from 'node:fs/promises';`;
  - delete `import { tmpdir } from 'node:os';`;
  - `import { FIXTURE_HOST, fakeProbe, fakeRuntime } from '@mediaplane/engine/testing';`
    becomes
    `import { FIXTURE_HOST, fakeProbe, fakeRuntime, tempDir } from '@mediaplane/engine/testing';`.
- `packages/cli/src/main.test.ts`:
  - `import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';` becomes
    `import { mkdirSync, writeFileSync } from 'node:fs';`;
  - delete `import { tmpdir } from 'node:os';`;
  - add `import { tempDirSync } from '@mediaplane/engine/testing';` after
    `import { fileURLToPath } from 'node:url';`.
- `packages/cli/src/run.test.ts`:
  - `import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';` becomes
    `import { mkdir, readFile, writeFile } from 'node:fs/promises';`;
  - delete `import { tmpdir } from 'node:os';`;
  - in the `from '@mediaplane/engine/testing'` import, add `tempDir,` after `running,`.
- `packages/engine/src/status.test.ts`: `import { mkdir, mkdtemp, writeFile }` becomes
  `import { mkdir, writeFile }`; delete the `tmpdir` import; add
  `import { tempDir } from './testing/temp';`.
- `packages/engine/src/apply/apply.test.ts`: drop `mkdtemp, ` from the `node:fs/promises`
  import; `import { hostname, tmpdir } from 'node:os';` becomes
  `import { hostname } from 'node:os';`; add `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/apply/ownership.test.ts`: `import { mkdtemp, readdir }` becomes
  `import { readdir }`; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/config/load.test.ts`: `import { mkdtemp, writeFile }` becomes
  `import { writeFile }`; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/config/secrets.test.ts`: `import { mkdir, mkdtemp, writeFile }`
  becomes `import { mkdir, writeFile }`; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/history/records.test.ts`: drop `mkdtemp, ` from the
  `node:fs/promises` import; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/host/facts.test.ts`: `import { mkdtemp, writeFile }` becomes
  `import { writeFile }`; delete `import { tmpdir } from 'node:os';` (keep
  `import type { NetworkInterfaceInfo } from 'node:os';`); add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/host/helper.test.ts`: `import { mkdtemp, writeFile }` becomes
  `import { writeFile }`; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/plan/files.test.ts`: `import { mkdir, mkdtemp, writeFile }` becomes
  `import { mkdir, writeFile }`; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/plan/plan.test.ts`: `import { mkdir, mkdtemp, readdir, writeFile }`
  becomes `import { mkdir, readdir, writeFile }`; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/preflight/probe.test.ts`: delete
  `import { mkdtemp } from 'node:fs/promises';` and `import { join } from 'node:path';`
  (keep the `tmpdir` import: a test still uses it); add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/runtime/docker.test.ts`: `import { mkdtemp, writeFile }` becomes
  `import { writeFile }`; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/secrets/store.test.ts`: drop `mkdtemp, ` from the
  `node:fs/promises` import; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/secrets/values.test.ts`: `import { mkdir, mkdtemp, writeFile }`
  becomes `import { mkdir, writeFile }`; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/state/lock.test.ts`: delete the `  mkdtemp,` line from the
  multi-line `node:fs/promises` import; `import { hostname, tmpdir } from 'node:os';`
  becomes `import { hostname } from 'node:os';`; add
  `import { tempDir } from '../testing/temp';`. Its `vi.mock('node:fs/promises', …)` keeps
  `mkdtemp` and `rm` real, so the helper is unaffected.
- `packages/engine/src/testing/fakes.test.ts`: `import { mkdir, mkdtemp, writeFile }`
  becomes `import { mkdir, writeFile }`; delete the `tmpdir` import; add
  `import { tempDir } from './temp';`.
- `packages/engine/src/util/atomic.test.ts`: drop `mkdtemp, ` from the
  `node:fs/promises` import; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.
- `packages/engine/src/util/fs.test.ts`: `import { chmod, mkdtemp, writeFile }` becomes
  `import { chmod, writeFile }`; delete the `tmpdir` import; add
  `import { tempDir } from '../testing/temp';`.

Run:

```bash
pnpm typecheck && pnpm lint
grep -rnE "mkdtemp(Sync)?\(" packages --include=*.test.ts
```

Expected: both checks pass, and the `grep` prints nothing: no unit test in `packages`
calls `mkdtemp` or `mkdtempSync` any more. A leftover unused import is reported by
ESLint (`no-unused-vars`) with its file and line: remove it.

- [ ] **Step 8: Clean up in the end-to-end tests**

In `test/e2e/helpers.ts`:

- replace the import lines down to `import { expect } from 'vitest';` with:

  ```ts
  import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { nodeExec, type ExecResult } from '@mediaplane/engine';
  import { expect, onTestFinished } from 'vitest';
  ```

- replace `makeHome()` and `composeDown()`, with their doc comments, with:

  ```ts
  /**
   * A new temporary Mediaplane home holding the video stack's `stack.yaml` and a data
   * folder. It is removed when the test finishes, files the apps wrote as other users
   * included, so a test that starts containers must bring its project down
   * (`composeDown`) in its own `finally`, which runs first.
   */
  export async function makeHome(): Promise<string> {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
    onTestFinished(() => removeHome(home));
    await mkdir(join(home, 'data'));
    await writeFile(join(home, 'stack.yaml'), stackFor(join(home, 'data')));
    return home;
  }

  /**
   * Remove a test project's containers, network and anonymous volumes, whatever it
   * contains. `-v` is the short form of `--volumes` in Compose v2 and v5.
   */
  export function composeDown(project: string): Promise<ExecResult> {
    return nodeExec(
      'docker',
      ['compose', '-p', project, 'down', '--remove-orphans', '-v'],
      { cwd: '/' },
    );
  }
  ```

In `test/e2e/apply.e2e.test.ts`:

- replace the first three import lines with:

  ```ts
  import { readFile, stat, writeFile } from 'node:fs/promises';
  import { join } from 'node:path';
  ```

- add `import { tempDir } from '@mediaplane/engine/testing';` after the
  `from '@mediaplane/engine'` import;
- change the helpers import to
  `import { BUSYBOX, composeDown, ejectArguments, makeHome } from './helpers';`;
- in the first test's `finally` block, delete the line `await removeHome(home);`, so it
  reads:

  ```ts
    } finally {
      const down = await composeDown(PROJECT);
      expect(down.code, down.stderr).toBe(0);
    }
  ```

- in the `.env` test, replace `await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'))` with
  `await tempDir('mediaplane-e2e-')`.

In `test/e2e/plan.e2e.test.ts`:

- `import { mkdtemp, writeFile } from 'node:fs/promises';` becomes
  `import { writeFile } from 'node:fs/promises';`, and delete
  `import { tmpdir } from 'node:os';`;
- add `import { tempDir } from '@mediaplane/engine/testing';` after the
  `from '@mediaplane/engine'` import;
- in the two tests that make their own folder, replace
  `await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'))` with `await tempDir('mediaplane-e2e-')`.

`test/e2e/deploy.e2e.test.ts` already removes its home, data folder and override folder in
`afterAll`: leave it.

- [ ] **Step 9: Run everything, and count the folders again**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
ls -d "$TMP"/mediaplane-* 2>/dev/null | wc -l
pnpm test:e2e test/e2e/plan.e2e.test.ts
ls -d "$TMP"/mediaplane-* 2>/dev/null | wc -l
docker ps -a --filter name=mediaplane-e2e --format '{{.Names}}'
```

Expected:
- every check passes;
- both counts equal the number from Step 5;
- `plan.e2e.test.ts` passes (it needs Docker and the pinned images, which are cached);
- `docker ps` prints nothing.

- [ ] **Step 10: Commit**

```bash
git add packages test/e2e
git commit -m "test: remove every temporary folder the tests make, and the e2e volumes" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Retry image pulls after transient registry errors

Controller's notes: on PR #1's CI, the apply end-to-end test failed once with
`Get "https://lscr.io/v2/": net/http: TLS handshake timeout` while pulling Radarr, and a
re-run passed. Spec §5.1 already says transient errors are retried with backoff.

Decision: `apply` retries `compose pull` three times, waiting 5, 15 and then 45 seconds.
It retries TLS handshake and I/O timeouts, reset connections, unexpected EOF, client
timeouts, rate limits (`toomanyrequests`, `429 Too Many Requests`) and HTTP 500, 502, 503
and 504. It never retries a name that doesn't resolve, a missing image or a refused login:
waiting doesn't fix those. `pull --policy missing` fetches only what is still missing, so a
retry repeats no finished download.

**Files:**
- Create: `packages/engine/src/apply/pull.ts`, `packages/engine/src/apply/pull.test.ts`
- Modify: `packages/engine/src/apply/apply.ts`, `packages/engine/src/testing/fakes.ts`,
  `packages/engine/src/index.ts`
- Test: `packages/engine/src/testing/fakes.test.ts`,
  `packages/engine/src/apply/apply.test.ts`

**Interfaces:**
- **Consumes:** `Runtime.pull(values): Promise<CommandResult>`.
- **Produces:**
  - `PULL_RETRY_DELAYS_MS: readonly number[]` (`[5_000, 15_000, 45_000]`);
  - `isTransientPullError(message: string): boolean`;
  - `pullImages(runtime: Runtime, values: Record<string, string>, sleep?: (ms: number) => Promise<unknown>): Promise<string>`,
    which returns the `pull` step's detail (`images present`, or
    `images present, after 1 retry` / `after 2 retries`) and throws `Error` with Compose's
    message otherwise;
  - `ApplyOptions.sleep?: (ms: number) => Promise<unknown>`, the wait between retries;
  - `FakeRuntimeOptions.pull?: CommandResult | readonly CommandResult[]`: with a list,
    each call answers the next result, and the last one repeats.

- [ ] **Step 1: Let the fake Docker answer pulls in sequence**

Add to `packages/engine/src/testing/fakes.test.ts`, after the `fakeDocker` describe:

```ts
describe('fakeRuntime().pull', () => {
  it('answers from a list, one result per call, repeating the last', async () => {
    const runtime = fakeRuntime({
      pull: [{ ok: false, error: 'fake: first' }, { ok: true }],
    });
    expect(await runtime.pull({})).toEqual({ ok: false, error: 'fake: first' });
    expect(await runtime.pull({})).toEqual({ ok: true });
    expect(await runtime.pull({})).toEqual({ ok: true });
  });
});
```

In `packages/engine/src/testing/fakes.ts`, change the `pull` line of
`FakeRuntimeOptions` to:

```ts
  /** What pull answers: the same for every call, or one per call, the last repeating. */
  pull?: CommandResult | readonly CommandResult[];
```

and in `fakeRuntime`, add `let pulls = 0;` after the `const record = …` line, and
replace the `pull` member with:

```ts
    pull: () => {
      record('pull');
      const planned = options.pull ?? { ok: true };
      const results = 'ok' in planned ? [planned] : planned;
      return Promise.resolve(
        results[Math.min(pulls++, results.length - 1)] ?? { ok: true },
      );
    },
```

Run: `pnpm vitest run packages/engine/src/testing`

Expected: PASS.

- [ ] **Step 2: Write the failing tests**

`packages/engine/src/apply/pull.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CommandResult } from '../runtime/types';
import { fakeRuntime } from '../testing/fakes';
import { isTransientPullError, PULL_RETRY_DELAYS_MS, pullImages } from './pull';

const TLS: CommandResult = {
  ok: false,
  error: 'Get "https://registry.test/v2/": net/http: TLS handshake timeout',
};

/** A sleep that returns at once and records how long it was asked to wait. */
function sleeper(): { slept: number[]; sleep: (ms: number) => Promise<void> } {
  const slept: number[] = [];
  return {
    slept,
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

describe('isTransientPullError', () => {
  it.each([
    'Get "https://lscr.io/v2/": net/http: TLS handshake timeout',
    'dial tcp 192.0.2.1:443: i/o timeout',
    'read tcp 10.0.0.2:51234->192.0.2.1:443: read: connection reset by peer',
    'unexpected EOF',
    'net/http: request canceled (Client.Timeout exceeded while awaiting headers)',
    'toomanyrequests: You have reached your pull rate limit.',
    'received unexpected HTTP status: 429 Too Many Requests',
    'received unexpected HTTP status: 503 Service Unavailable',
    'received unexpected HTTP status: 502 Bad Gateway',
  ])('retries "%s"', (message) => {
    expect(isTransientPullError(message)).toBe(true);
  });

  it.each([
    'manifest unknown: manifest unknown',
    'pull access denied for registry.test/fake, repository does not exist',
    'dial tcp: lookup registry.test: no such host',
    'fake registry unreachable',
  ])('does not retry "%s"', (message) => {
    expect(isTransientPullError(message)).toBe(false);
  });
});

describe('pullImages', () => {
  it('pulls once when the first pull works', async () => {
    const { slept, sleep } = sleeper();
    const calls: string[] = [];
    expect(await pullImages(fakeRuntime({ calls }), {}, sleep)).toBe('images present');
    expect(calls).toEqual(['pull']);
    expect(slept).toEqual([]);
  });

  it('tries again after a temporary registry error, waiting longer each time', async () => {
    const { slept, sleep } = sleeper();
    const calls: string[] = [];
    const runtime = fakeRuntime({ calls, pull: [TLS, TLS, { ok: true }] });
    expect(await pullImages(runtime, {}, sleep)).toBe('images present, after 2 retries');
    expect(calls).toEqual(['pull', 'pull', 'pull']);
    expect(slept).toEqual([5_000, 15_000]);
  });

  it('gives up after three retries, with the last error', async () => {
    const { slept, sleep } = sleeper();
    const calls: string[] = [];
    await expect(pullImages(fakeRuntime({ calls, pull: TLS }), {}, sleep)).rejects.toThrow(
      'docker compose pull failed 4 times with a temporary registry error; the last one: Get "https://registry.test/v2/": net/http: TLS handshake timeout',
    );
    expect(calls).toHaveLength(4);
    expect(slept).toEqual([...PULL_RETRY_DELAYS_MS]);
  });

  it('never retries an error that waiting will not fix', async () => {
    const { slept, sleep } = sleeper();
    const calls: string[] = [];
    const runtime = fakeRuntime({ calls, pull: { ok: false, error: 'manifest unknown' } });
    await expect(pullImages(runtime, {}, sleep)).rejects.toThrow(/^manifest unknown$/);
    expect(calls).toEqual(['pull']);
    expect(slept).toEqual([]);
  });
});
```

Add to `describe('apply', …)` in `packages/engine/src/apply/apply.test.ts`, after
"stops at a failed pull, skips the rest and records the failure":

```ts
  it('pulls again after a temporary registry error', async () => {
    const home = await makeHome();
    const slept: number[] = [];
    const docker = fakeDocker(home, {
      pull: [{ ok: false, error: 'net/http: TLS handshake timeout' }, { ok: true }],
    });
    const sleep = (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    };
    const result = await apply(options(home, docker, { sleep }));
    expect(result.outcome).toBe('success');
    expect(result.actions[2]).toEqual({
      step: 'pull',
      result: 'done',
      detail: 'images present, after 1 retry',
    });
    expect(slept).toEqual([5_000]);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/apply`

Expected: FAIL. `pull.test.ts` can't import `./pull`, and the new apply test fails its
pull step with `net/http: TLS handshake timeout`.

- [ ] **Step 4: Implement**

`packages/engine/src/apply/pull.ts`:

```ts
import { setTimeout as delay } from 'node:timers/promises';
import type { Runtime } from '../runtime/types';

/** How long apply waits before each retry of a pull that failed with a temporary error. */
export const PULL_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 45_000];

/**
 * Registry errors that usually pass, as Docker prints them: a slow or dropped connection,
 * a registry that is briefly down, or a rate limit (spec §5.1). A missing image, a refused
 * login or a name that doesn't resolve won't pass by waiting, so they are not here.
 */
const TRANSIENT_PULL_ERRORS: readonly RegExp[] = [
  /TLS handshake timeout/i,
  /i\/o timeout/i,
  /connection reset by peer/i,
  /unexpected EOF/i,
  /Client\.Timeout exceeded/i,
  /toomanyrequests|Too Many Requests/i,
  /\b(?:500 Internal Server Error|502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout)\b/i,
];

/** Whether a failed pull is worth trying again. */
export function isTransientPullError(message: string): boolean {
  return TRANSIENT_PULL_ERRORS.some((pattern) => pattern.test(message));
}

/**
 * `compose pull`, tried again after a temporary registry error, up to three times. It
 * pulls only what is missing, so a retry repeats no finished download. Returns the pull
 * step's detail, and throws with Compose's error when the pull fails for good.
 */
export async function pullImages(
  runtime: Runtime,
  values: Record<string, string>,
  sleep: (ms: number) => Promise<unknown> = delay,
): Promise<string> {
  for (let retries = 0; ; retries++) {
    const result = await runtime.pull(values);
    if (result.ok) {
      if (retries === 0) return 'images present';
      return `images present, after ${retries} ${retries === 1 ? 'retry' : 'retries'}`;
    }
    if (!isTransientPullError(result.error)) throw new Error(result.error);
    const wait = PULL_RETRY_DELAYS_MS[retries];
    if (wait === undefined) {
      throw new Error(
        `docker compose pull failed ${retries + 1} times with a temporary registry error; the last one: ${result.error}`,
      );
    }
    await sleep(wait);
  }
}
```

In `packages/engine/src/apply/apply.ts`:

- add `import { pullImages } from './pull';` after
  `import { ensureAppdataDirs, ownershipFixes } from './ownership';`;
- add to `ApplyOptions`, after `waitSeconds?: number;`:

  ```ts
    /** How apply waits between pull retries; tests pass one that returns at once. */
    sleep?: (ms: number) => Promise<unknown>;
  ```

- replace the `pull` step with:

  ```ts
    await steps.run('pull', () => pullImages(runtime, values, options.sleep));
  ```

In `packages/engine/src/index.ts`, add `export * from './apply/pull';` after
`export * from './apply/ownership';`.

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/apply packages/cli`

Expected: PASS. The CLI's "exits 1 and explains a failed step" still fails at once: its
`fake registry unreachable` is not a temporary error.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src
git commit -m "feat(engine): retry a pull after a temporary registry error" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: The LAN inputs: a private `lan_subnet`, LAN-only trust, and `network.no-lan-subnet`

Roadmap, "Inputs for later slices", S3:

- *"Gluetun's `FIREWALL_OUTBOUND_SUBNETS` and Servarr's `TRUSTEDNETWORKS` should only be
  filled when ports are actually published on the LAN."*
- *"Warn when `lanSubnets` is empty but a feature needs it."*
- *"On a cloud VM without an explicit `lan_subnet`, leave `lanSubnets` empty."*
- *"Require `lan_subnet` to be inside RFC 1918, so a public or `0.0.0.0/0` subnet can't
  widen `TRUSTEDNETWORKS` or the authentication bypass."*

The fourth item, Mediaplane's own network in `TRUSTEDNETWORKS` (R12), waits for M2: Task
12 records why.

A Gluetun port published on localhost works with no outbound subnet, because Docker's
proxy reaches it from the bridge's own subnet. A LAN client keeps its own address through
Docker's DNAT, so Gluetun's firewall must let it back out. This was checked by hand on the
pinned image; Slice 3d's end-to-end test checks it (Task 12 adds that to the roadmap).

Decision: the warning comes from the catalog's `validate` hooks. Here it is Gluetun's: the
LAN can't reach qBittorrent through its firewall. Task 8 adds qBittorrent's, for its login
whitelist.

Decision: the trust rule ("only while the web UIs are on the LAN") lives in the resolver,
as `AppContext.lanClientSubnets`: `lanSubnets` when `publishesOnLan`, otherwise `[]`. Every
catalog site that trusts LAN clients reads that field, never `lanSubnets` with its own
`publishesOnLan` check: Servarr's trusted networks and Gluetun's outbound subnets here,
qBittorrent's login whitelist in Task 8.

**Files:**
- Modify: `packages/engine/src/host/facts.ts`, `packages/engine/src/config/schema.ts`,
  `packages/engine/src/catalog/types.ts`, `packages/engine/src/resolver/resolve.ts`
- Modify: `catalog/_shared/servarr.ts`, `catalog/gluetun/app.ts`
- Test: `packages/engine/src/host/facts.test.ts`,
  `packages/engine/src/config/load.test.ts`,
  `packages/engine/src/resolver/resolve.test.ts`, `catalog/render.test.ts`
- Generated: `docs/reference/stack-yaml.md`, `docs/reference/stack.schema.json`

**Interfaces:**
- **Consumes:** `inSubnet(address, cidr)` and `networkOf(cidr)` in `host/facts.ts`.
- **Produces:**
  - `isPrivateSubnet(cidr: string): boolean` in `host/facts.ts`;
  - `AppContext.publishesOnLan: boolean`: `network.bind` is `lan` or `all`;
  - `AppContext.lanClientSubnets: string[]`: `publishesOnLan ? lanSubnets : []`, the
    subnets whose clients may be trusted (login skipped, let through Gluetun's firewall);
  - `ResolvedStack.lanSubnets` (and `AppContext.lanSubnets`) is `[]` on a cloud VM
    without `network.lan_subnet`;
  - the warning `network.no-lan-subnet` (path `network.lan_subnet`).

- [ ] **Step 1: Write the failing tests**

In `packages/engine/src/host/facts.test.ts`, add `isPrivateSubnet,` to the import from
`./facts` (after `isPrivateIPv4,`), and add after `describe('networkOf', …)`:

```ts
describe('isPrivateSubnet', () => {
  it('accepts subnets that lie wholly inside 10/8, 172.16/12 or 192.168/16', () => {
    for (const cidr of [
      '10.0.0.0/8',
      '10.1.2.0/24',
      '172.16.0.0/12',
      '172.31.255.0/24',
      '192.168.0.0/16',
      '192.168.1.0/24',
      '192.168.1.10/32',
    ]) {
      expect(isPrivateSubnet(cidr)).toBe(true);
    }
  });

  it('refuses public subnets, and private ones that spill out of their range', () => {
    for (const cidr of [
      '0.0.0.0/0',
      '8.8.8.0/24',
      '100.64.0.0/10',
      '172.32.0.0/16',
      '172.16.0.0/11',
      '192.168.0.0/15',
      '10.0.0.0/7',
    ]) {
      expect(isPrivateSubnet(cidr)).toBe(false);
    }
  });
});
```

Add to `describe('parseConfig', …)` in `packages/engine/src/config/load.test.ts`, after
"rejects subnets with leading zeros in an octet":

```ts
  it('rejects a lan_subnet outside the private (RFC 1918) ranges, and says why', () => {
    for (const subnet of ['0.0.0.0/0', '203.0.113.0/24', '172.32.0.0/16']) {
      const diagnostics = diagnosticsOf(`${MINIMAL}network: { lan_subnet: ${subnet} }\n`);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        code: 'config.invalid',
        path: 'network.lan_subnet',
      });
      expect(diagnostics[0]?.message).toContain('a private (RFC 1918) subnet');
    }
    expect(parseConfig(`${MINIMAL}network: { lan_subnet: 172.20.0.0/16 }\n`).ok).toBe(
      true,
    );
  });

  it('reports a lan_subnet that is not a subnet once, not also as public', () => {
    expect(
      diagnosticsOf(`${MINIMAL}network: { lan_subnet: 999.168.1.0/24 }\n`),
    ).toHaveLength(1);
  });
```

Add to `describe('resolveStack: binding', …)` in
`packages/engine/src/resolver/resolve.test.ts`, after "prefers an explicit lan_subnet":

```ts
  it('knows no LAN subnet on a cloud VM, unless lan_subnet names one', () => {
    const cloud: HostFacts = { ...FIXTURE_HOST, cloud: 'Oracle Cloud' };
    expect(resolve('  qbittorrent: {}\n', { host: cloud }).stack?.lanSubnets).toEqual([]);
    const base = BASE.replace('bind: localhost', 'bind: localhost, lan_subnet: 10.0.0.0/24');
    expect(resolve('  qbittorrent: {}\n', { base, host: cloud }).stack?.lanSubnets).toEqual(
      ['10.0.0.0/24'],
    );
  });

  it('tells the apps whether their web UIs are on the LAN, and which clients to trust', () => {
    const contextFor = (base: string) =>
      app(resolve('  sonarr: {}\n  qbittorrent: {}\n', { base }), 'sonarr')?.context;
    expect(contextFor(BASE)).toMatchObject({
      lanSubnets: ['192.168.1.0/24'],
      publishesOnLan: false,
      lanClientSubnets: [],
    });
    for (const base of [lan, BASE.replace('bind: localhost', 'bind: all')]) {
      expect(contextFor(base)).toMatchObject({
        lanSubnets: ['192.168.1.0/24'],
        publishesOnLan: true,
        lanClientSubnets: ['192.168.1.0/24'],
      });
    }
  });
```

Add to `describe('the real catalog', …)` in `catalog/render.test.ts`, after "lets the LAN
reach apps inside the VPN namespace":

```ts
  it('trusts no subnet, and lets nothing in through Gluetun, with bind: localhost', () => {
    const source = SPEC_EXAMPLE.replace(
      'network: { bind: lan }',
      'network: { bind: localhost }\nsecurity: { login_on_lan: false }',
    );
    const { compose, diagnostics } = render(source);
    expect(diagnostics).toEqual([]);
    expect(compose.services.radarr?.environment).toMatchObject({
      RADARR__AUTH__REQUIRED: 'DisabledForLocalAddresses',
    });
    expect(compose.services.radarr?.environment).not.toHaveProperty(
      'RADARR__SERVER__TRUSTEDNETWORKS',
    );
    expect(compose.services.gluetun?.environment).not.toHaveProperty(
      'FIREWALL_OUTBOUND_SUBNETS',
    );
  });

  it('warns when the web UIs are on the LAN but Mediaplane knows no LAN subnet', () => {
    const source = SPEC_EXAMPLE.replace('network: { bind: lan }', 'network: { bind: all }');
    const { compose, diagnostics } = render(source, { ...HOST, cloud: 'Oracle Cloud' });
    expect(codes(diagnostics)).toEqual(['network.no-lan-subnet', 'network.bind-all']);
    expect(diagnostics[0]).toEqual({
      severity: 'warning',
      code: 'network.no-lan-subnet',
      message:
        "the web UIs are published on the LAN, but Mediaplane knows no LAN subnet, so Gluetun's firewall keeps your LAN out of qBittorrent's web UI",
      path: 'network.lan_subnet',
      hint: 'set network.lan_subnet to your LAN, such as 192.168.1.0/24',
    });
    expect(compose.services.gluetun?.environment).not.toHaveProperty(
      'FIREWALL_OUTBOUND_SUBNETS',
    );
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/host packages/engine/src/config packages/engine/src/resolver catalog`

Expected: FAIL.
- **facts:** `isPrivateSubnet` is not exported.
- **load:** `0.0.0.0/0` and the others parse.
- **resolve:** on a cloud VM, `lanSubnets` is `['192.168.1.0/24']`, and the context has
  no `publishesOnLan` or `lanClientSubnets`.
- **render:** with `bind: localhost`, Radarr's environment still has
  `RADARR__SERVER__TRUSTEDNETWORKS`; on the cloud VM, there is no warning.

- [ ] **Step 3: Implement**

In `packages/engine/src/host/facts.ts`, add after `inSubnet`:

```ts
/** The RFC 1918 ranges, with their prefix lengths. */
const PRIVATE_RANGES = [
  ['10.0.0.0/8', 8],
  ['172.16.0.0/12', 12],
  ['192.168.0.0/16', 16],
] as const;

/** Whether all of `cidr` lies inside one RFC 1918 range. */
export function isPrivateSubnet(cidr: string): boolean {
  const [address = '', prefix = '32'] = cidr.split('/');
  return PRIVATE_RANGES.some(
    ([range, size]) => Number(prefix) >= size && inSubnet(address, range),
  );
}
```

In `packages/engine/src/config/schema.ts`:

- add `import { isPrivateSubnet } from '../host/facts';` after
  `import { z } from 'zod';`;
- replace the `lan_subnet` field with:

  ```ts
      lan_subnet: z
        .string()
        .refine(isIpv4Cidr, {
          message: 'must be an IPv4 CIDR such as 192.168.1.0/24',
          abort: true,
        })
        .refine(
          isPrivateSubnet,
          'must be a private (RFC 1918) subnet, inside 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16: addresses in it may skip logins and get through the VPN firewall',
        )
        .optional()
        .describe(
          "Your LAN, as a private (RFC 1918) IPv4 CIDR such as 192.168.1.0/24. Left out, it is detected from this host's private addresses, except on a cloud VM, where bind: lan needs it set. Mediaplane trusts it only while the web UIs are published on the LAN.",
        ),
  ```

In `packages/engine/src/catalog/types.ts`, replace the `lanSubnets` member of
`AppContext` with:

```ts
  /**
   * LAN subnets: network.lan_subnet, or those of the host's private addresses. Empty on a
   * cloud VM without lan_subnet, whose private network is not a LAN.
   */
  lanSubnets: string[];
  /** Whether the web UIs are published on the LAN: network.bind is lan or all. */
  publishesOnLan: boolean;
  /**
   * The LAN subnets whose clients may be trusted: lanSubnets while publishesOnLan,
   * otherwise none. Use it, not lanSubnets, to skip a login or open a firewall.
   */
  lanClientSubnets: string[];
```

In `packages/engine/src/resolver/resolve.ts`, replace the `lanSubnets` declaration at the
top of `resolveStack` with:

```ts
  const lanSubnets =
    config.network.lan_subnet !== undefined
      ? [config.network.lan_subnet]
      : host.cloud !== undefined
        ? []
        : unique(host.privateAddresses.map((a) => networkOf(a.cidr)));
  const publishesOnLan = config.network.bind !== 'localhost';
  // Only LAN clients need trusting, and only while the web UIs are on the LAN.
  const lanClientSubnets = publishesOnLan ? lanSubnets : [];
```

and the `context` line in the `apps` map with:

```ts
    const context: AppContext = {
      config,
      settings,
      options,
      lanSubnets,
      publishesOnLan,
      lanClientSubnets,
    };
```

In `catalog/_shared/servarr.ts`, replace the `if` that sets `TRUSTEDNETWORKS` with:

```ts
  // Empty unless the web UI is on the LAN: only LAN clients need trusting.
  if (!loginOnLan && ctx.lanClientSubnets.length > 0) {
    env[`${prefix}__SERVER__TRUSTEDNETWORKS`] = ctx.lanClientSubnets.join(',');
  }
```

In `catalog/gluetun/app.ts`:

- change the first line to `import { defineApp, error, warning } from '@mediaplane/engine';`;
- in `env`, replace the `FIREWALL_OUTBOUND_SUBNETS` spread with:

  ```ts
      // Only LAN clients need a way back out: empty unless the web UIs are on the LAN.
      ...(ctx.lanClientSubnets.length > 0
        ? { FIREWALL_OUTBOUND_SUBNETS: ctx.lanClientSubnets.join(',') }
        : {}),
  ```

- replace `validate` with:

  ```ts
    validate: (ctx) => [
      ...(ctx.config.vpn
        ? []
        : [
            error('vpn.missing', 'Gluetun is enabled but stack.yaml has no vpn: block', {
              path: 'vpn',
              hint: 'add vpn: { provider: …, private_key: { file: secrets/wg.key } }, or set apps.qbittorrent.vpn: false',
            }),
          ]),
      ...(ctx.publishesOnLan && ctx.lanClientSubnets.length === 0
        ? [
            warning(
              'network.no-lan-subnet',
              "the web UIs are published on the LAN, but Mediaplane knows no LAN subnet, so Gluetun's firewall keeps your LAN out of qBittorrent's web UI",
              {
                path: 'network.lan_subnet',
                hint: 'set network.lan_subnet to your LAN, such as 192.168.1.0/24',
              },
            ),
          ]
        : []),
    ],
  ```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/host packages/engine/src/config packages/engine/src/resolver catalog`

Expected: PASS. The existing "trusts only the LAN subnet when login on the LAN is turned
off" and "lets the LAN reach apps inside the VPN namespace" still pass: `SPEC_EXAMPLE`
binds to the LAN.

- [ ] **Step 5: Regenerate the references, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src catalog docs/reference
git commit -m "feat: trust the LAN subnet only while the web UIs are on the LAN" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`pnpm docs:generate` prints `wrote docs/reference/stack-yaml.md` and
`wrote docs/reference/stack.schema.json` (the new `lan_subnet` description).

---

### Task 4: The shared admin: user name rules, a 12-character minimum, and a generated password

Spec §6.1: one user name (default `admin`) and one generated high-entropy password,
applied to every app with an admin login, unless you give your own with
`admin.password: { file: … }`. Rulings: the user name matches `^[A-Za-z0-9._-]{3,32}$`;
your own password needs at least 12 characters (`admin.password-too-short`); the
generated one is 24 base62 characters (about 143 bits), kept as `shared.adminPassword`
in `state/secrets.json`, and `plan` lists `admin.password` under the secrets to generate.

`shared` is an optional key in the store's version 1 format, so stores from before this
slice still read. An older Mediaplane would refuse a store that has it; no downgrade is
supported.

Decision: the password is generated for every stack that doesn't set `admin.password`,
whether or not an app uses it yet, so it exists before any app needs it.

**Files:**
- Create: `packages/engine/src/secrets/admin.ts`, `packages/engine/src/secrets/admin.test.ts`
- Modify: `packages/engine/src/config/schema.ts`, `packages/engine/src/config/secrets.ts`,
  `packages/engine/src/secrets/store.ts`, `packages/engine/src/secrets/generate.ts`,
  `packages/engine/src/secrets/values.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/src/config/load.test.ts`,
  `packages/engine/src/config/secrets.test.ts`, `packages/engine/src/secrets/store.test.ts`,
  `packages/engine/src/secrets/generate.test.ts`,
  `packages/engine/src/secrets/values.test.ts`, `packages/engine/src/plan/plan.test.ts`,
  `packages/engine/src/apply/apply.test.ts`, `packages/cli/src/run.test.ts`,
  `test/e2e/plan.e2e.test.ts`
- Generated: `docs/reference/stack-yaml.md`, `docs/reference/stack.schema.json`

**Interfaces:**
- **Consumes:** `readSecret(ref, home, env)`, `generateSecret`, `SecretStore`.
- **Produces:**
  - `SecretStore.shared?: { adminPassword?: string }`;
  - `GeneratedKind = 'hex32' | 'qbt' | 'password'`, and
    `generateSecret(kind: GeneratedKind, random?)`;
  - in `secrets/admin.ts`:
    - `ADMIN_PASSWORD_PATH = 'admin.password'`;
    - `adminPasswordToGenerate(config: StackConfig, store: SecretStore): boolean`;
    - `adminLogin(config: StackConfig, home: string, store: SecretStore, env: NodeJS.ProcessEnv): Promise<{ username: string; password: string }>`,
      which throws when there is no password yet;
  - `ADMIN_PASSWORD_MIN_LENGTH = 12` in `config/secrets.ts`, and the error
    `admin.password-too-short`;
  - `secretsToGenerate()` and `withGeneratedSecrets().generated` start with
    `admin.password` when it is to be generated.

- [ ] **Step 1: Write the failing tests**

Add to `describe('parseConfig', …)` in `packages/engine/src/config/load.test.ts`:

```ts
  it('takes admin user names of 3 to 32 letters, digits, ".", "_" or "-"', () => {
    expect(parseConfig(`${MINIMAL}admin: { username: media.admin_1-x }\n`).ok).toBe(true);
    for (const username of ['ad', 'media admin', 'admin:x', 'a'.repeat(33)]) {
      const [diagnostic] = diagnosticsOf(`${MINIMAL}admin: { username: "${username}" }\n`);
      expect(diagnostic).toMatchObject({ code: 'config.invalid', path: 'admin.username' });
      expect(diagnostic?.message).toContain('3 to 32 letters, digits');
    }
  });
```

Add to `packages/engine/src/config/secrets.test.ts`:

```ts
describe('the admin password', () => {
  const config = configWith('admin: { password: { env: FAKE_ADMIN_PASSWORD } }\n');

  it('must be at least 12 characters, and the error never shows it', async () => {
    const diagnostics = await checkSecretRefs(config, await homeWith({}), {
      FAKE_ADMIN_PASSWORD: 'fake-short1',
    });
    expect(diagnostics).toEqual([
      {
        severity: 'error',
        code: 'admin.password-too-short',
        message: 'admin.password is shorter than 12 characters',
        path: 'admin.password',
        hint: 'use a longer password, or leave admin.password out and Mediaplane generates one',
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain('fake-short1');
  });

  it('may be exactly 12 characters', async () => {
    expect(
      await checkSecretRefs(config, await homeWith({}), {
        FAKE_ADMIN_PASSWORD: 'fake-twelve1',
      }),
    ).toEqual([]);
  });
});
```

`packages/engine/src/secrets/admin.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureConfig } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { adminLogin, adminPasswordToGenerate } from './admin';
import { emptySecretStore, type SecretStore } from './store';

const BASE = 'version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\n';
const STORED: SecretStore = {
  version: 1,
  apps: {},
  shared: { adminPassword: 'fake-generated-password' },
};

describe('adminPasswordToGenerate', () => {
  it('is true until a password is stored, unless admin.password is set', () => {
    const generated = fixtureConfig(BASE);
    const yours = fixtureConfig(
      `${BASE}admin: { password: { file: secrets/admin-password } }\n`,
    );
    expect(adminPasswordToGenerate(generated, emptySecretStore())).toBe(true);
    expect(adminPasswordToGenerate(generated, STORED)).toBe(false);
    expect(adminPasswordToGenerate(yours, emptySecretStore())).toBe(false);
  });
});

describe('adminLogin', () => {
  it('uses the generated password', async () => {
    expect(await adminLogin(fixtureConfig(BASE), '/opt/mediaplane', STORED, {})).toEqual({
      username: 'admin',
      password: 'fake-generated-password',
    });
  });

  it('uses your own password from admin.password, over a stored one', async () => {
    const home = await tempDir('mediaplane-admin-');
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'admin-password'), 'fake-own-password\n');
    const config = fixtureConfig(
      `${BASE}admin: { username: media-admin, password: { file: secrets/admin-password } }\n`,
    );
    expect(await adminLogin(config, home, STORED, {})).toEqual({
      username: 'media-admin',
      password: 'fake-own-password',
    });
  });

  it('throws while there is no password yet', async () => {
    await expect(
      adminLogin(fixtureConfig(BASE), '/opt/mediaplane', emptySecretStore(), {}),
    ).rejects.toThrow('the admin password is not available yet');
  });
});
```

In `packages/engine/src/secrets/store.test.ts`:

- add `type SecretStore` to the import from `./store`;
- add to `describe('readSecretStore', …)`:

  ```ts
    it('rejects an unknown shared secret', async () => {
      const home = await homeWithStore(
        '{"version": 1, "apps": {}, "shared": {"fake": "fake-value"}}',
      );
      await expect(readSecretStore(home)).rejects.toThrow(
        'is not a Mediaplane secrets file',
      );
    });
  ```

- add to `describe('writeSecretStore', …)`:

  ```ts
    it('keeps the shared admin password', async () => {
      const home = await tempDir('mediaplane-store-');
      const store: SecretStore = {
        version: 1,
        apps: { sonarr: { apiKey: '0'.repeat(32) } },
        shared: { adminPassword: 'fake-admin-password' },
      };
      await writeSecretStore(home, store);
      expect(await readSecretStore(home)).toEqual(store);
    });

    it('writes no shared block when it holds nothing', async () => {
      const home = await tempDir('mediaplane-store-');
      await writeSecretStore(home, { version: 1, apps: {}, shared: {} });
      expect(JSON.parse(await readFile(join(home, SECRETS_PATH), 'utf8'))).toEqual({
        version: 1,
        apps: {},
      });
    });
  ```

In `packages/engine/src/secrets/generate.test.ts`:

- add to `describe('generateSecret', …)`:

  ```ts
    it('makes a password from 24 base62 characters', () => {
      expect(generateSecret('password', constant(171))).toBe('l'.repeat(24));
    });
  ```

- add `expect(generateSecret('password')).toMatch(/^[0-9A-Za-z]{24}$/);` to "uses real
  randomness by default";
- replace the two tests of `describe('withGeneratedSecrets', …)` with:

  ```ts
    it('fills in missing generated secrets and the admin password, and lists them', () => {
      const result = withGeneratedSecrets(
        stackOf(STACK),
        emptySecretStore(),
        constant(0xab),
      );
      expect(result.generated).toEqual(['admin.password', 'sonarr.apiKey']);
      expect(result.store).toEqual({
        version: 1,
        apps: { sonarr: { apiKey: 'ab'.repeat(16) } },
        shared: { adminPassword: 'l'.repeat(24) },
      });
    });

    it('never replaces a secret that already exists', () => {
      const existing: SecretStore = {
        version: 1,
        apps: { sonarr: { apiKey: '0'.repeat(32) } },
        shared: { adminPassword: 'fake-admin-password' },
      };
      const result = withGeneratedSecrets(stackOf(STACK), existing, constant(0xab));
      expect(result).toEqual({ store: existing, generated: [] });
    });

    it('generates no admin password when admin.password is set', () => {
      const yours = STACK.replace(
        'apps:',
        'admin: { password: { env: FAKE_ADMIN_PASSWORD } }\napps:',
      );
      const result = withGeneratedSecrets(
        stackOf(yours),
        emptySecretStore(),
        constant(0xab),
      );
      expect(result.generated).toEqual(['sonarr.apiKey']);
      expect(result.store.shared).toBeUndefined();
    });
  ```

- in "generates exactly what the plan says it will, in the same order", change
  `expect(planned).toHaveLength(4);` to `expect(planned).toHaveLength(5);` and add
  `expect(result.store.shared?.adminPassword).toMatch(/^[0-9A-Za-z]{24}$/);` at the end;
- in "still agrees when some secrets are already stored", change
  `expect(planned).toHaveLength(2);` to `expect(planned).toHaveLength(3);`.

In `packages/engine/src/secrets/values.test.ts`:

- replace the `stored` constant with:

  ```ts
  const stored: SecretStore = {
    version: 1,
    apps: { sonarr: { apiKey: '0'.repeat(32) } },
    shared: { adminPassword: 'fake-admin-password' },
  };
  ```

- in "lists generated secrets that are not in the store yet", expect
  `['admin.password', 'sonarr.apiKey']`.

In `packages/engine/src/plan/plan.test.ts`:

- in `makeHome`, replace the store literal with:

  ```ts
        JSON.stringify({
          version: 1,
          apps: { sonarr: { apiKey: '0'.repeat(32) } },
          shared: { adminPassword: 'fake-admin-password' },
        }),
  ```

- in "plans files, containers and secrets for a fresh home", expect
  `{ generate: ['admin.password', 'sonarr.apiKey'] }`.

In `packages/engine/src/apply/apply.test.ts`, in "generates keys, writes files, pulls,
starts, verifies and records":

- expect `result.actions[0]?.detail` to be `'generated admin.password, sonarr.apiKey'`;
- expect the stored secrets to equal:

  ```ts
      {
        version: 1,
        apps: { sonarr: { apiKey: 'ab'.repeat(16) } },
        shared: { adminPassword: 'l'.repeat(24) },
      }
  ```

- expect `records[0]?.plan.secrets.generate` to equal `['admin.password', 'sonarr.apiKey']`;
- add `expect(recorded).not.toContain('l'.repeat(24));` after the other two
  `not.toContain` lines.

In "never generates a secret twice", replace the `stored` literal with:

```ts
    const stored = JSON.stringify({
      version: 1,
      apps: { sonarr: { apiKey: '0'.repeat(32) } },
      shared: { adminPassword: 'fake-admin-password' },
    });
```

In `packages/cli/src/run.test.ts`:

- replace the import from `'@mediaplane/engine'` with:

  ```ts
  import {
    collectHostReport,
    COMPOSE_PATH,
    composeToYaml,
    ENV_PATH,
    invokingUser,
    nodeProbe,
    planStack,
    readSecretStore,
    renderEnvFile,
    secretValues,
    withGeneratedSecrets,
    writeSecretStore,
    type ContainerState,
    type HostRequest,
    type Runtime,
  } from '@mediaplane/engine';
  ```

- replace `currentHome` with this version, which stores whatever keys a first apply would
  generate, so it keeps up as the catalog grows:

  ```ts
  /** All zeros: the keys currentHome stores are never printed, so their value is moot. */
  const zeros = (size: number) => Buffer.alloc(size, 0);

  /** A home whose generated files and stored keys are what plan expects, as of `runtime`. */
  async function currentHome(runtime: Runtime): Promise<string> {
    const home = await makeHome();
    const { context } = await planStack({
      home,
      catalog,
      host: FIXTURE_HOST,
      env: {},
      runtime,
      probe: fakeProbe(),
    });
    if (context === undefined) throw new Error('the test stack must plan');
    const { store } = withGeneratedSecrets(context.stack, context.store, zeros);
    await writeSecretStore(home, store);
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, COMPOSE_PATH), composeToYaml(context.compose, home));
    await writeFile(
      join(home, ENV_PATH),
      renderEnvFile(await secretValues(context.stack, store, {})),
    );
    return home;
  }
  ```

- replace `secretsIn` with:

  ```ts
  /** The fake WireGuard key and every secret apply stored in the home: none may be printed. */
  async function secretsIn(home: string): Promise<string[]> {
    const store = await readSecretStore(home);
    const adminPassword = store.shared?.adminPassword;
    expect(adminPassword).toBeDefined();
    const generated = [
      ...Object.values(store.apps).flatMap((keys) => Object.values(keys)),
      ...(adminPassword === undefined ? [] : [adminPassword]),
    ];
    return ['fake-wireguard-key-for-tests', ...generated];
  }
  ```

- in "exits 2 and shows files, containers and secrets for a fresh home", expect
  `'Secrets to generate: admin.password, qbittorrent.apiKey, sonarr.apiKey\n'` and
  `'Plan: 2 files to write, 4 containers to change, 3 secrets to generate.'`;
- in "prints versioned JSON without file contents", expect `json.secrets.generate` to
  equal `['admin.password', 'qbittorrent.apiKey', 'sonarr.apiKey']`;
- in "applies with --yes, showing the plan and progress, then reports no changes", expect
  `'Plan: 2 files to write, 4 containers to change, 3 secrets to generate.'`;
- in `describe('mediaplane history', …)`, "lists change records and shows one in full"
  now expects
  `` `${id}  success  2 files written, 4 containers changed, 3 secrets generated\n` ``,
  and "prints versioned JSON" expects
  `changes: { files: 2, containers: 4, secrets: 3 }`;
- `readFile` is no longer used, so the first import becomes
  `import { mkdir, writeFile } from 'node:fs/promises';`.

In `test/e2e/plan.e2e.test.ts`, in "plans the whole video stack, accepted by Compose",
add `'admin.password',` as the first entry of the expected `result.secrets.generate`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/config packages/engine/src/secrets packages/engine/src/plan packages/engine/src/apply packages/cli`

Expected: FAIL.
- **load:** `ad` and the others are accepted.
- **secrets:** no `admin.password-too-short`.
- **admin:** `./admin` does not exist.
- **store:** the `shared` block is refused as an unknown key.
- **generate, values, plan, apply, run:** `admin.password` is never generated or listed.

- [ ] **Step 3: Implement**

In `packages/engine/src/config/schema.ts`:

- add after `const DOCKER_TAG = …`:

  ```ts
  /** An admin user name every M1 app accepts. */
  const ADMIN_USERNAME = /^[A-Za-z0-9._-]{3,32}$/;
  ```

- replace the whole `admin` field with:

  ```ts
    admin: z
      .strictObject({
        username: z
          .string()
          .regex(ADMIN_USERNAME, 'must be 3 to 32 letters, digits, ".", "_" or "-"')
          .default('admin')
          .describe(
            'The user name of the shared admin login: 3 to 32 letters, digits, ".", "_" or "-".',
          ),
        password: secretRefSchema
          .optional()
          .describe(
            'The admin password, as a secret reference, at least 12 characters long. Left out, Mediaplane generates one; "mediaplane credentials" shows it.',
          ),
      })
      .default({ username: 'admin' })
      .describe(
        "The shared admin login for the apps' web UIs, set up in each app as its slice lands: qBittorrent in Slice 3a, Sonarr, Radarr and Prowlarr in Slice 3b, and Jellyfin in Slice 6.",
      ),
  ```

In `packages/engine/src/config/secrets.ts`:

- add after the imports:

  ```ts
  /** The shortest admin password Mediaplane accepts from you (spec §6.1). */
  export const ADMIN_PASSWORD_MIN_LENGTH = 12;
  ```

- replace `checkSecretRefs` with:

  ```ts
  export async function checkSecretRefs(
    config: StackConfig,
    home: string,
    env: NodeJS.ProcessEnv,
  ): Promise<Diagnostic[]> {
    const diagnostics: Diagnostic[] = [];
    for (const { path, ref } of secretRefs(config)) {
      const value = await readSecret(ref, home, env);
      if (value === undefined) {
        const where = 'env' in ref ? `environment variable ${ref.env}` : `file ${ref.file}`;
        diagnostics.push(
          error('secret.missing', `${path}: ${where} is missing, empty or unreadable`, {
            path,
          }),
        );
      } else if (path === 'admin.password' && value.length < ADMIN_PASSWORD_MIN_LENGTH) {
        diagnostics.push(
          error(
            'admin.password-too-short',
            `admin.password is shorter than ${ADMIN_PASSWORD_MIN_LENGTH} characters`,
            {
              path,
              hint: 'use a longer password, or leave admin.password out and Mediaplane generates one',
            },
          ),
        );
      }
    }
    return diagnostics;
  }
  ```

In `packages/engine/src/secrets/store.ts`:

- replace `storeSchema` with:

  ```ts
  const storeSchema = z.strictObject({
    version: z.literal(1),
    apps: z.record(z.string(), z.record(z.string(), z.string())),
    /** Secrets the whole stack shares. Added in Slice 3a: older stores have none. */
    shared: z.strictObject({ adminPassword: z.string().optional() }).optional(),
  });
  ```

- change the type's comment to
  `/** Secrets Mediaplane generated, or apps created, per app, and the shared admin password. */`;
- in `writeSecretStore`, replace the `writeFileAtomic` call with:

  ```ts
    const adminPassword = store.shared?.adminPassword;
    await writeFileAtomic(
      join(home, SECRETS_PATH),
      `${JSON.stringify(
        {
          version: 1,
          apps,
          ...(adminPassword === undefined ? {} : { shared: { adminPassword } }),
        },
        null,
        2,
      )}\n`,
      0o600,
    );
  ```

`packages/engine/src/secrets/admin.ts`:

```ts
import type { StackConfig } from '../config/schema';
import { readSecret } from '../config/secrets';
import type { SecretStore } from './store';

/** How plan, apply and the change records name the shared admin password. */
export const ADMIN_PASSWORD_PATH = 'admin.password';

/** Whether apply must generate the admin password: none is stored, and none is yours. */
export function adminPasswordToGenerate(config: StackConfig, store: SecretStore): boolean {
  return config.admin.password === undefined && store.shared?.adminPassword === undefined;
}

/**
 * The shared admin login (spec §6.1): your password from admin.password, or the one
 * Mediaplane generated. plan checks that yours exists, and apply generates its own,
 * before either asks, so a missing one is a bug.
 */
export async function adminLogin(
  config: StackConfig,
  home: string,
  store: SecretStore,
  env: NodeJS.ProcessEnv,
): Promise<{ username: string; password: string }> {
  const ref = config.admin.password;
  const password =
    ref === undefined ? store.shared?.adminPassword : await readSecret(ref, home, env);
  if (password === undefined) throw new Error('the admin password is not available yet');
  return { username: config.admin.username, password };
}
```

In `packages/engine/src/secrets/generate.ts`, replace everything from the `BASE62` constant
to the end of the file with:

```ts
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** The largest multiple of 62 that fits in a byte: higher bytes would bias the alphabet. */
const BASE62_LIMIT = 248;

/** What Mediaplane can generate. */
export type GeneratedKind = 'hex32' | 'qbt' | 'password';

/**
 * A new secret (spec §6.1): 32 hex characters; qBittorrent's "qbt_" and 28 base62; or a
 * password of 24 base62, about 143 bits.
 */
export function generateSecret(
  kind: GeneratedKind,
  random: RandomBytes = randomBytes,
): string {
  if (kind === 'hex32') return random(16).toString('hex');
  if (kind === 'qbt') return `qbt_${base62(28, random)}`;
  return base62(24, random);
}

/** `length` base62 characters, from unbiased random bytes. */
function base62(length: number, random: RandomBytes): string {
  let text = '';
  while (text.length < length) {
    for (const byte of random(length)) {
      if (byte < BASE62_LIMIT && text.length < length) text += BASE62.charAt(byte % 62);
    }
  }
  return text;
}

/**
 * The store with every missing generated secret filled in, the admin password first.
 * Existing ones are kept.
 */
export function withGeneratedSecrets(
  stack: ResolvedStack,
  store: SecretStore,
  random: RandomBytes = randomBytes,
): { store: SecretStore; generated: string[] } {
  const apps: Record<string, Record<string, string>> = Object.fromEntries(
    Object.entries(store.apps).map(([id, secrets]) => [id, { ...secrets }]),
  );
  const generated: string[] = [];
  let shared = store.shared;
  if (adminPasswordToGenerate(stack.config, store)) {
    shared = { ...shared, adminPassword: generateSecret('password', random) };
    generated.push(ADMIN_PASSWORD_PATH);
  }
  for (const { app, name, kind } of missingGeneratedSecrets(stack, store)) {
    (apps[app] ??= {})[name] = generateSecret(kind, random);
    generated.push(`${app}.${name}`);
  }
  return {
    store: { version: 1, apps, ...(shared === undefined ? {} : { shared }) },
    generated,
  };
}
```

and add `import { ADMIN_PASSWORD_PATH, adminPasswordToGenerate } from './admin';` after
`import type { ResolvedStack } from '../resolver/resolve';`.

In `packages/engine/src/secrets/values.ts`:

- add `import { ADMIN_PASSWORD_PATH, adminPasswordToGenerate } from './admin';` after
  `import { compare } from '../util/sort';`;
- replace `secretsToGenerate` with:

  ```ts
  /**
   * The name of every secret Mediaplane must generate on the next apply, in the order
   * withGeneratedSecrets generates them: admin.password first, then "<app>.<secret>".
   */
  export function secretsToGenerate(stack: ResolvedStack, store: SecretStore): string[] {
    return [
      ...(adminPasswordToGenerate(stack.config, store) ? [ADMIN_PASSWORD_PATH] : []),
      ...missingGeneratedSecrets(stack, store).map(({ app, name }) => `${app}.${name}`),
    ];
  }
  ```

In `packages/engine/src/index.ts`, add `export * from './secrets/admin';` after
`export * from './secrets/values';`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages catalog scripts`

Expected: PASS. `scripts/docs/stack-reference.test.ts` still finds
`` - `admin.password` (secret reference): The admin password ``.

- [ ] **Step 5: Regenerate the references, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages test/e2e docs/reference
git commit -m "feat(engine): generate the shared admin password, and check yours" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`plan.e2e.test.ts` runs in Task 11.

---
### Task 5: Pre-start files in `plan`: the `configFiles` hook, and installs from before S3a

Spec §6.4: *"`config.xml` and `qBittorrent.conf` are written only when they do not exist
yet. After first start the API is the only write path, because the apps rewrite their own
files."* Rulings: a pure `configFiles?(ctx)` on `AppDefinition` renders them; `plan` lists
them as created before first start and marks them sensitive; an install from before S3a
(the file exists but lacks the key) fails `plan` with `<app>.not-seeded` and a hint, and is
never overwritten.

This task builds the engine side and tests it with fixture apps. Tasks 7 and 8 add the
real apps' files.

Decision: `plan` renders the files from a preview of the secrets apply would generate, in
memory, so it knows their paths before any key exists. It shows and keeps no content, and
apply renders them again with the keys it saves (qBittorrent's salt makes each rendering
different anyway). The cost is one PBKDF2 hash per plan, about 60 ms.

Decision: an existing file that Mediaplane can't read counts as seeded. After their first
start the LinuxServer.io images give `/config` to the stack's user, which may not be
Mediaplane's; there is then no way to tell, and installs from before S3a are the owner's
own dev installs only. Task 6's apply leaves such a file alone too.

Decision: `plan` and `apply` get the files from one helper,
`prestartFilesFor(stack, store, env, random?)` in `render/prestart.ts`, which looks up the
admin login (`adminLogin`) and calls `renderPrestartFiles`. `run.test.ts` uses it too
(Task 6).

Decision: the `<app>.not-seeded` hint points to "Set up before Slice 3a" in the app's own
README (`catalog/<app>/README.md`, written in Task 12), not to `docs/runbooks/`. The
per-app README is the runbook's natural home: the fix differs per app, and the README
already holds that app's other known issues.

**Files:**
- Modify: `packages/engine/src/catalog/types.ts`
- Create: `packages/engine/src/render/prestart.ts`,
  `packages/engine/src/render/prestart.test.ts`,
  `packages/engine/src/plan/prestart.ts`, `packages/engine/src/plan/prestart.test.ts`
- Modify: `packages/engine/src/plan/files.ts`, `packages/engine/src/plan/plan.ts`,
  `packages/engine/src/index.ts`, `packages/cli/src/output.ts`
- Create: `packages/cli/src/output.test.ts`
- Test: `packages/engine/src/plan/plan.test.ts`

**Interfaces:**
- **Consumes:** `AppContext` (with `publishesOnLan` and `lanClientSubnets`, Task 3),
  `adminLogin(config: StackConfig, home: string, store: SecretStore, env: NodeJS.ProcessEnv): Promise<{ username: string; password: string }>`
  and `withGeneratedSecrets` (Task 4), `RandomBytes`, `APPDATA_DIR`.
- **Produces:**
  - in `catalog/types.ts`:
    - `ConfigFile { path: string; content: string; seeded: RegExp }`, with `path`
      relative to the app's appdata folder;
    - `ConfigFileContext<Options> extends AppContext<Options>`, adding
      `admin: { username: string; password: string }`, `secret(name: string): string`
      (one of the app's generated secrets; throws when it is missing) and
      `random(size: number): Buffer`;
    - `AppDefinition.configFiles?(ctx: ConfigFileContext<Options>): ConfigFile[]`;
  - in `render/prestart.ts`: `PrestartFile { app: string; appName: string; path: string; content: string; seeded: RegExp }`,
    with `path` relative to the home (`appdata/<app>/<file>`),
    `renderPrestartFiles(stack: ResolvedStack, store: SecretStore, admin: { username: string; password: string }, random: RandomBytes): PrestartFile[]`,
    and
    `prestartFilesFor(stack: ResolvedStack, store: SecretStore, env: NodeJS.ProcessEnv, random: RandomBytes = randomBytes): Promise<PrestartFile[]>`,
    which renders them with `adminLogin(stack.config, stack.home, store, env)` and throws
    as `adminLogin` does when there is no password yet;
  - in `plan/prestart.ts`:
    `planPrestartFiles(home: string, files: readonly PrestartFile[]): Promise<{ changes: FileChange[]; diagnostics: Diagnostic[] }>`,
    and the error code `<app>.not-seeded`;
  - `FileChange.prestart?: boolean`; `PlanResult.files` lists the pre-start files after
    `generated/compose.yaml` and `generated/.env`, each `sensitive: true` and
    `prestart: true`, with `status` `create` or `unchanged`;
  - `plan` prints a pre-start file as
    `+ <path> (before first start; secret values, not shown)`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/render/prestart.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { AppDefinition, Catalog } from '../catalog/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import type { SecretStore } from '../secrets/store';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { prestartFilesFor, renderPrestartFiles } from './prestart';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  qbittorrent: { vpn: false }
  sonarr: {}
`;

const STORE: SecretStore = { version: 1, apps: { sonarr: { apiKey: 'fake-sonarr-key' } } };
const ADMIN = { username: 'media-admin', password: 'fake-admin-password' };
const sevens = (size: number) => Buffer.alloc(size, 7);

/** Sonarr writes one file, from everything a renderer is given. */
const configFiles: AppDefinition['configFiles'] = (ctx) => [
  {
    path: 'config/app.ini',
    content: [
      `key=${ctx.secret('apiKey')}`,
      `user=${ctx.admin.username}:${ctx.admin.password}`,
      `salt=${ctx.random(2).toString('hex')}`,
      `lan=${String(ctx.publishesOnLan)}`,
      '',
    ].join('\n'),
    seeded: /^key=/m,
  },
];

const WITH_FILES: Catalog = fixtureCatalog.map((app) =>
  app.id === 'sonarr' ? { ...app, configFiles } : app,
);

function stackWith(catalog: Catalog): ResolvedStack {
  const result = resolveStack(fixtureConfig(STACK), catalog, FIXTURE_HOST, '/opt/mediaplane');
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

describe('renderPrestartFiles', () => {
  it("puts each file in its app's appdata folder, from its keys and the admin login", () => {
    expect(renderPrestartFiles(stackWith(WITH_FILES), STORE, ADMIN, sevens)).toEqual([
      {
        app: 'sonarr',
        appName: 'sonarr',
        path: 'appdata/sonarr/config/app.ini',
        content:
          'key=fake-sonarr-key\nuser=media-admin:fake-admin-password\nsalt=0707\nlan=false\n',
        seeded: /^key=/m,
      },
    ]);
  });

  it('renders nothing for apps without pre-start files', () => {
    expect(renderPrestartFiles(stackWith(fixtureCatalog), STORE, ADMIN, sevens)).toEqual(
      [],
    );
  });

  it('refuses to render a file before its key exists', () => {
    expect(() =>
      renderPrestartFiles(stackWith(WITH_FILES), { version: 1, apps: {} }, ADMIN, sevens),
    ).toThrow('sonarr.apiKey has not been generated yet');
  });
});

describe('prestartFilesFor', () => {
  it('renders the files with the shared admin login from the store', async () => {
    const store: SecretStore = { ...STORE, shared: { adminPassword: 'fake-generated' } };
    const [file] = await prestartFilesFor(stackWith(WITH_FILES), store, {}, sevens);
    expect(file?.content).toBe(
      'key=fake-sonarr-key\nuser=admin:fake-generated\nsalt=0707\nlan=false\n',
    );
  });

  it('throws while there is no admin password yet', async () => {
    await expect(
      prestartFilesFor(stackWith(WITH_FILES), STORE, {}, sevens),
    ).rejects.toThrow('the admin password is not available yet');
  });
});
```

`packages/engine/src/plan/prestart.test.ts`:

```ts
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PrestartFile } from '../render/prestart';
import { tempDir } from '../testing/temp';
import { planPrestartFiles } from './prestart';

const FILE: PrestartFile = {
  app: 'sonarr',
  appName: 'Sonarr',
  path: 'appdata/sonarr/config.xml',
  content: '<Config><ApiKey>fake-key</ApiKey></Config>\n',
  seeded: /<ApiKey>[^<]+<\/ApiKey>/,
};

const AS_PLANNED = { diff: '', content: '', sensitive: true, prestart: true };

/** A home, with Sonarr's config.xml holding `content` when it is given. */
async function homeWith(content?: string): Promise<string> {
  const home = await tempDir('mediaplane-prestart-');
  if (content !== undefined) {
    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
    await writeFile(join(home, FILE.path), content);
  }
  return home;
}

describe('planPrestartFiles', () => {
  it('creates a file that is absent, and never shows its content', async () => {
    expect(await planPrestartFiles(await homeWith(), [FILE])).toEqual({
      changes: [{ path: FILE.path, status: 'create', ...AS_PLANNED }],
      diagnostics: [],
    });
  });

  it('leaves alone a file Mediaplane seeded, even after the app rewrote it', async () => {
    const home = await homeWith(
      '<Config>\n  <Port>8989</Port>\n  <ApiKey>rewritten-by-the-app</ApiKey>\n</Config>\n',
    );
    expect(await planPrestartFiles(home, [FILE])).toEqual({
      changes: [{ path: FILE.path, status: 'unchanged', ...AS_PLANNED }],
      diagnostics: [],
    });
  });

  it('reports a file from before Mediaplane seeded the app, and leaves it alone', async () => {
    const home = await homeWith('<Config>\n  <Port>8989</Port>\n</Config>\n');
    expect(await planPrestartFiles(home, [FILE])).toEqual({
      changes: [{ path: FILE.path, status: 'unchanged', ...AS_PLANNED }],
      diagnostics: [
        {
          severity: 'error',
          code: 'sonarr.not-seeded',
          message:
            'appdata/sonarr/config.xml was not written by Mediaplane, so it lacks the key Mediaplane gave Sonarr',
          hint: 'stop Sonarr, delete appdata/sonarr/config.xml in the Mediaplane home, then run apply again: it writes a new one before Sonarr starts. The settings in that file are lost; Sonarr\'s other data is kept. See "Set up before Slice 3a" in catalog/sonarr/README.md',
        },
      ],
    });
  });

  it('treats a file under something that is not a folder as absent', async () => {
    const home = await homeWith();
    await writeFile(join(home, 'appdata'), 'not a folder');
    expect((await planPrestartFiles(home, [FILE])).changes[0]?.status).toBe('create');
  });

  // root can read anything, so there is nothing to test when running as root.
  it.skipIf(process.getuid?.() === 0)(
    "leaves alone a file Mediaplane can't read, which the app owns",
    async () => {
      const home = await homeWith('<Config />\n');
      await chmod(join(home, FILE.path), 0o000);
      expect(await planPrestartFiles(home, [FILE])).toEqual({
        changes: [{ path: FILE.path, status: 'unchanged', ...AS_PLANNED }],
        diagnostics: [],
      });
    },
  );

  it('names the file when it cannot be read for another reason', async () => {
    const home = await homeWith();
    await mkdir(join(home, FILE.path), { recursive: true });
    await expect(planPrestartFiles(home, [FILE])).rejects.toThrow(
      `cannot read ${join(home, FILE.path)} (EISDIR)`,
    );
  });
});
```

In `packages/engine/src/plan/plan.test.ts`:

- add `import type { AppDefinition, Catalog } from '../catalog/types';` after the
  `vitest` import;
- add after the `HASHES` constant:

  ```ts
  /** Sonarr with one pre-start file, whose first line marks it as Mediaplane's. */
  const configFiles: AppDefinition['configFiles'] = (ctx) => [
    { path: 'config.ini', content: `key=${ctx.secret('apiKey')}\n`, seeded: /^key=/m },
  ];
  const WITH_FILES: Catalog = fixtureCatalog.map((app) =>
    app.id === 'sonarr' ? { ...app, configFiles } : app,
  );
  ```

- replace `planFor` with:

  ```ts
  function planFor(
    home: string,
    {
      runtime = fakeRuntime(),
      probe = fakeProbe(),
      env = {},
      catalog = fixtureCatalog,
    }: {
      runtime?: Runtime;
      probe?: HostProbe;
      env?: NodeJS.ProcessEnv;
      catalog?: Catalog;
    } = {},
  ) {
    return plan({ home, catalog, host: FIXTURE_HOST, env, runtime, probe });
  }
  ```

- add to `describe('plan', …)`:

  ```ts
    it('plans pre-start files to create before first start, never showing them', async () => {
      const result = await planFor(await makeHome(), { catalog: WITH_FILES });
      expect(result).toMatchObject({ ok: true, changed: true });
      expect(result.files.map((file) => file.path)).toEqual([
        COMPOSE_PATH,
        ENV_PATH,
        'appdata/sonarr/config.ini',
      ]);
      expect(result.files[2]).toEqual({
        path: 'appdata/sonarr/config.ini',
        status: 'create',
        diff: '',
        content: '',
        sensitive: true,
        prestart: true,
      });
    });

    it('leaves a pre-start file alone once it exists', async () => {
      const runtime = fakeRuntime({
        hashes: { ok: true, hashes: HASHES },
        containers: running(HASHES),
      });
      const home = await makeCurrentHome(runtime);
      await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
      await writeFile(join(home, 'appdata', 'sonarr', 'config.ini'), 'key=rewritten\n');
      const result = await planFor(home, { runtime, catalog: WITH_FILES });
      expect(result.changed).toBe(false);
      expect(result.files[2]).toMatchObject({
        path: 'appdata/sonarr/config.ini',
        status: 'unchanged',
      });
    });

    it('fails when a pre-start file is from before Mediaplane seeded the app', async () => {
      const home = await makeHome();
      await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
      await writeFile(join(home, 'appdata', 'sonarr', 'config.ini'), 'user=someone\n');
      const result = await planFor(home, { catalog: WITH_FILES });
      expect(result).toMatchObject({ ok: false, changed: false, files: [] });
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'sonarr.not-seeded', severity: 'error' }),
      );
    });
  ```

`packages/cli/src/output.test.ts`:

```ts
import type { PlanResult } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { printPlan } from './output';
import type { Io } from './run';

function capture() {
  const out: string[] = [];
  const io: Io = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: () => undefined,
    env: {},
  };
  return { io, stdout: () => out.join('') };
}

const PLAN: PlanResult = {
  ok: true,
  changed: true,
  files: [
    {
      path: 'appdata/sonarr/config.xml',
      status: 'create',
      diff: '',
      content: '',
      sensitive: true,
      prestart: true,
    },
  ],
  containers: [],
  secrets: { generate: [] },
  unhealthy: [],
  diagnostics: [],
};

describe('printPlan', () => {
  it('shows a pre-start file as written before first start, without its content', () => {
    const term = capture();
    printPlan(PLAN, { json: false }, term.io);
    expect(term.stdout()).toBe(
      '+ appdata/sonarr/config.xml (before first start; secret values, not shown)\n\nPlan: 1 file to write.\n',
    );
  });

  it('marks it in JSON', () => {
    const term = capture();
    printPlan(PLAN, { json: true }, term.io);
    expect(JSON.parse(term.stdout())).toMatchObject({
      files: [
        {
          path: 'appdata/sonarr/config.xml',
          status: 'create',
          diff: '',
          sensitive: true,
          prestart: true,
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/render packages/engine/src/plan packages/cli/src/output.test.ts`

Expected: FAIL. `./prestart` does not exist in `render/` or `plan/`; `plan.test.ts` fails
to type-check `configFiles` and lists no pre-start file; `output.test.ts` prints
`+ appdata/sonarr/config.xml (secret values, not shown)`.

- [ ] **Step 3: The types**

In `packages/engine/src/catalog/types.ts`, add after `AppContext`:

```ts
/**
 * A file the app reads when it starts, written into its appdata folder before its first
 * start, and only when absent (spec §6.4). The app rewrites it afterwards, so Mediaplane
 * never updates it.
 */
export interface ConfigFile {
  /** Relative to the app's appdata folder, such as "qBittorrent/qBittorrent.conf". */
  path: string;
  content: string;
  /**
   * Matches the file for as long as it holds what Mediaplane seeded (its key), even after
   * the app has rewritten it. An existing file that doesn't match is from an install made
   * before Mediaplane seeded the app, and plan reports it.
   */
  seeded: RegExp;
}

/** What a pre-start file renderer sees. It holds secrets: never log or print it. */
export interface ConfigFileContext<Options = Record<string, unknown>>
  extends AppContext<Options> {
  /** The shared admin login (spec §6.1). */
  admin: { username: string; password: string };
  /** One of this app's generated secrets, such as "apiKey". Throws when it is missing. */
  secret(name: string): string;
  /** Cryptographically random bytes, such as a password hash's salt. */
  random(size: number): Buffer;
}
```

and add to `AppDefinition`, after `validate?(…)`:

```ts
  /** Files to write into its appdata folder before its first start, if absent. Pure. */
  configFiles?(ctx: ConfigFileContext<Options>): ConfigFile[];
```

- [ ] **Step 4: Render, then plan**

`packages/engine/src/render/prestart.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type { ConfigFileContext } from '../catalog/types';
import { APPDATA_DIR } from '../paths';
import type { ResolvedStack } from '../resolver/resolve';
import { adminLogin } from '../secrets/admin';
import type { RandomBytes } from '../secrets/generate';
import type { SecretStore } from '../secrets/store';

/** One app's pre-start file, rendered. `content` holds secrets: never print or log it. */
export interface PrestartFile {
  app: string;
  /** The app's display name, such as "qBittorrent". */
  appName: string;
  /** Relative to the home: appdata/<app>/<the catalog's path>. */
  path: string;
  content: string;
  seeded: RegExp;
}

/** Every enabled app's pre-start files (spec §6.4), from the catalog's pure renderers. */
export function renderPrestartFiles(
  stack: ResolvedStack,
  store: SecretStore,
  admin: { username: string; password: string },
  random: RandomBytes,
): PrestartFile[] {
  return stack.apps.flatMap((app) => {
    const { def } = app;
    if (def.configFiles === undefined) return [];
    const secrets = store.apps[def.id] ?? {};
    const ctx: ConfigFileContext = {
      ...app.context,
      admin,
      secret: (name) => {
        const value = secrets[name];
        if (value === undefined) {
          throw new Error(`${def.id}.${name} has not been generated yet`);
        }
        return value;
      },
      random,
    };
    return def.configFiles(ctx).map((file) => ({
      app: def.id,
      appName: def.name,
      path: `${APPDATA_DIR}/${def.id}/${file.path}`,
      content: file.content,
      seeded: file.seeded,
    }));
  });
}

/**
 * The pre-start files, rendered with the shared admin login from `store` or from your
 * admin.password. plan and apply both use it. Throws when there is no password yet.
 */
export async function prestartFilesFor(
  stack: ResolvedStack,
  store: SecretStore,
  env: NodeJS.ProcessEnv,
  random: RandomBytes = randomBytes,
): Promise<PrestartFile[]> {
  const admin = await adminLogin(stack.config, stack.home, store, env);
  return renderPrestartFiles(stack, store, admin, random);
}
```

`packages/engine/src/plan/prestart.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { error, type Diagnostic } from '../diagnostics';
import type { PrestartFile } from '../render/prestart';
import type { FileChange } from './files';

/** What is at a pre-start file's path: nothing, or a file, with its text when readable. */
type Found = { exists: false } | { exists: true; text: string | undefined };

async function find(path: string): Promise<Found> {
  try {
    return { exists: true, text: await readFile(path, 'utf8') };
  } catch (cause) {
    const code =
      cause instanceof Error && 'code' in cause ? String(cause.code) : undefined;
    // ENOTDIR: a file stands where one of its folders should be, so it can't exist.
    if (code === 'ENOENT' || code === 'ENOTDIR') return { exists: false };
    // After its first start the app owns its appdata, and may keep Mediaplane out.
    if (code === 'EACCES' || code === 'EPERM') return { exists: true, text: undefined };
    throw new Error(`cannot read ${path}${code === undefined ? '' : ` (${code})`}`, {
      cause,
    });
  }
}

/**
 * What apply would do with each pre-start file (spec §6.4): create it when it is absent,
 * and leave it alone when it exists. A file that exists without what Mediaplane seeds is
 * from an install made before Slice 3a, which apply would never fix: an error.
 */
export async function planPrestartFiles(
  home: string,
  files: readonly PrestartFile[],
): Promise<{ changes: FileChange[]; diagnostics: Diagnostic[] }> {
  const changes: FileChange[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const found = await find(join(home, file.path));
    changes.push({
      path: file.path,
      status: found.exists ? 'unchanged' : 'create',
      diff: '',
      content: '',
      sensitive: true,
      prestart: true,
    });
    // A file Mediaplane can't read counts as seeded: there is no way to tell.
    if (found.exists && found.text !== undefined && !file.seeded.test(found.text)) {
      diagnostics.push(notSeeded(file));
    }
  }
  return { changes, diagnostics };
}

function notSeeded(file: PrestartFile): Diagnostic {
  const name = file.appName;
  return error(
    `${file.app}.not-seeded`,
    `${file.path} was not written by Mediaplane, so it lacks the key Mediaplane gave ${name}`,
    {
      hint: `stop ${name}, delete ${file.path} in the Mediaplane home, then run apply again: it writes a new one before ${name} starts. The settings in that file are lost; ${name}'s other data is kept. See "Set up before Slice 3a" in catalog/${file.app}/README.md`,
    },
  );
}
```

In `packages/engine/src/plan/files.ts`, add to `FileChange`, after `sensitive?: boolean;`:

```ts
  /**
   * A pre-start file (spec §6.4): created before the app's first start when absent, and
   * never updated. Always sensitive.
   */
  prestart?: boolean;
```

In `packages/engine/src/plan/plan.ts`:

- add these imports, each next to its neighbours in path order:

  ```ts
  import { prestartFilesFor } from '../render/prestart';
  import { withGeneratedSecrets } from '../secrets/generate';
  import { planPrestartFiles } from './prestart';
  ```

- replace the lines from `const values = await secretValues(stack, store, options.env);`
  through `const generate = secretsToGenerate(stack, store);` with:

  ```ts
    const values = await secretValues(stack, store, options.env);
    // The secrets a first apply would generate, in memory only, so the pre-start files
    // can be rendered. Their content is never shown or kept: apply renders them again
    // with the keys it saves.
    const preview = withGeneratedSecrets(stack, store).store;
    const prestart = await planPrestartFiles(
      home,
      await prestartFilesFor(stack, preview, options.env),
    );
    if (hasErrors(prestart.diagnostics)) {
      return failed([...diagnostics, ...prestart.diagnostics]);
    }
    const files = [
      ...(await diffFiles(home, [
        { path: COMPOSE_PATH, content: composeToYaml(compose, home) },
        // The secret values: compared with what is on disk, never shown or kept.
        { path: ENV_PATH, content: renderEnvFile(values), sensitive: true },
      ])),
      ...prestart.changes,
    ];
    const generate = secretsToGenerate(stack, store);
  ```

`prestartFilesFor` can't throw for want of a password here: plan has already returned an
error when your `admin.password` is missing (`secret.missing`), and the preview holds a
generated one. `stack.home` is plan's `home`: plan resolves the stack with it.

In `packages/engine/src/index.ts`, add `export * from './render/prestart';` after
`export * from './render/yaml';`, and `export * from './plan/prestart';` after
`export * from './plan/files';`.

In `packages/cli/src/output.ts`, in `printPlan`, replace the `for (const file of files)`
loop with:

```ts
  for (const file of files) {
    const mark = file.status === 'create' ? '+' : '~';
    io.stdout(
      file.prestart === true
        ? `${mark} ${file.path} (before first start; secret values, not shown)\n\n`
        : file.sensitive === true
          ? `${mark} ${file.path} (secret values, not shown)\n\n`
          : `${mark} ${file.path}\n${file.diff}\n`,
    );
  }
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run packages`

Expected: PASS. The real catalog has no `configFiles` yet, so every CLI test is unchanged.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages
git commit -m "feat: plan the files apps read at their first start" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Pre-start files in `apply`: written once, before the first start

Rulings: the files are written only if absent, in the `files` step, with exclusive
creation, mode 0600, and their parent folders created. The `files` step runs before
`pull`, `ownership` and `start`, so every file exists before its app first starts. The
LinuxServer.io images then give `/config` to the stack's user with `lsiown -R` (checked in
the pinned Sonarr, Prowlarr and qBittorrent images' `init-*-config` scripts), and Gluetun
runs as root, so no ownership step is needed.

Decision: the files are written with the existing `writeFileExclusive`: a private temporary
file, flushed, then hard-linked into place. `link()` fails when the file exists, so it is
never written over, and the file never exists half-written. The home already needs a
filesystem with hard links for its lock.

Decision: apply looks before it writes. `writeFileExclusive` opens its temporary file in
the target's folder before `link()` can report that the file exists. After an app's first
start, that folder belongs to the stack's user, which may not be Mediaplane's: the open
would fail with EACCES on every later apply, and each apply would write a temporary copy
of secret content. So `writePrestartFiles` first `lstat`s each target, and writes only
when that fails with ENOENT. Any other result (the file exists, EACCES, EPERM) means
skip, as plan's check counts such a file as there (Task 5).

**Files:**
- Create: `packages/engine/src/apply/prestart.ts`,
  `packages/engine/src/apply/prestart.test.ts`
- Modify: `packages/engine/src/apply/apply.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/src/apply/apply.test.ts`, `packages/cli/src/run.test.ts`

**Interfaces:**
- **Consumes:**
  - from `render/prestart.ts` (Task 5): `PrestartFile`, and
    `prestartFilesFor(stack: ResolvedStack, store: SecretStore, env: NodeJS.ProcessEnv, random: RandomBytes = randomBytes): Promise<PrestartFile[]>`,
    which renders every pre-start file with the shared admin login;
  - `writeFileExclusive(path, content, mode): Promise<boolean>`.
- **Produces:**
  - `writePrestartFiles(home: string, files: readonly PrestartFile[]): Promise<string[]>`,
    the paths it created, relative to the home. It writes a file only when `lstat` finds
    nothing at its path (ENOENT), and skips it on any other result, EACCES and EPERM
    included, without throwing;
  - the `files` step's detail, `wrote generated/compose.yaml and generated/.env`,
    followed by `; created <path>, <path>` when it created any.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/apply/prestart.test.ts`:

```ts
import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PrestartFile } from '../render/prestart';
import { tempDir } from '../testing/temp';
import { writePrestartFiles } from './prestart';

const file = (path: string, content: string): PrestartFile => ({
  app: 'qbittorrent',
  appName: 'qBittorrent',
  path,
  content,
  seeded: /^key=/m,
});

describe('writePrestartFiles', () => {
  it('creates each file, and its folders, private to its owner', async () => {
    const home = await tempDir('mediaplane-prestart-');
    const path = 'appdata/qbittorrent/qBittorrent/qBittorrent.conf';
    expect(await writePrestartFiles(home, [file(path, 'key=fake\n')])).toEqual([path]);
    expect(await readFile(join(home, path), 'utf8')).toBe('key=fake\n');
    expect((await stat(join(home, path))).mode & 0o777).toBe(0o600);
  });

  it('never writes over a file that exists, and creates nothing then', async () => {
    const home = await tempDir('mediaplane-prestart-');
    await mkdir(join(home, 'appdata', 'qbittorrent'), { recursive: true });
    const path = 'appdata/qbittorrent/app.conf';
    await writeFile(join(home, path), 'key=the-apps-own\n');
    expect(await writePrestartFiles(home, [file(path, 'key=fake\n')])).toEqual([]);
    expect(await readFile(join(home, path), 'utf8')).toBe('key=the-apps-own\n');
  });

  // root can write anywhere, so there is nothing to test when running as root.
  it.skipIf(process.getuid?.() === 0)(
    "leaves alone a file in a folder Mediaplane can't write to, which the app owns",
    async () => {
      const home = await tempDir('mediaplane-prestart-');
      const folder = join(home, 'appdata', 'qbittorrent');
      await mkdir(folder, { recursive: true });
      const path = 'appdata/qbittorrent/app.conf';
      await writeFile(join(home, path), 'key=the-apps-own\n');
      await chmod(folder, 0o555);
      try {
        expect(await writePrestartFiles(home, [file(path, 'key=fake\n')])).toEqual([]);
        // Not even a temporary file was made next to it.
        expect(await readdir(folder)).toEqual(['app.conf']);
      } finally {
        // So that the temporary folder can be removed.
        await chmod(folder, 0o755);
      }
    },
  );
});
```

In `packages/engine/src/apply/apply.test.ts`:

- change `import type { Catalog } from '../catalog/types';` to
  `import type { AppDefinition, Catalog } from '../catalog/types';`;
- add after the `modeOf` constant:

  ```ts
  /** Sonarr with one pre-start file, from its key and the admin login. */
  const configFiles: AppDefinition['configFiles'] = (ctx) => [
    {
      path: 'config/app.ini',
      content: `key=${ctx.secret('apiKey')}\nuser=${ctx.admin.username}\n`,
      seeded: /^key=/m,
    },
  ];
  const WITH_FILES: Catalog = fixtureCatalog.map((app) =>
    app.id === 'sonarr' ? { ...app, configFiles } : app,
  );
  ```

- add to `describe('apply', …)`:

  ```ts
    it('writes pre-start files before the first start, private, and never again', async () => {
      const home = await makeHome();
      const docker = fakeDocker(home);
      const path = join(home, 'appdata', 'sonarr', 'config', 'app.ini');
      let presentAtStart = false;
      const watching: Runtime = {
        ...docker,
        up: async (seconds, values) => {
          presentAtStart = (await readFile(path, 'utf8').catch(() => '')) !== '';
          return docker.up(seconds, values);
        },
      };
      const first = await apply(options(home, watching, { catalog: WITH_FILES }));
      expect(first.outcome).toBe('success');
      expect(presentAtStart).toBe(true);
      expect(first.actions[1]?.detail).toBe(
        'wrote generated/compose.yaml and generated/.env; created appdata/sonarr/config/app.ini',
      );
      expect(first.plan.files).toContainEqual({
        path: 'appdata/sonarr/config/app.ini',
        status: 'create',
        diff: '',
        content: '',
        sensitive: true,
        prestart: true,
      });
      expect(await readFile(path, 'utf8')).toBe(`key=${'ab'.repeat(16)}\nuser=admin\n`);
      expect(await modeOf(path)).toBe(0o600);

      // The app rewrites its own file; apply leaves it alone from now on.
      await writeFile(path, 'key=rewritten-by-the-app\n');
      const second = await apply(options(home, docker, { catalog: WITH_FILES }));
      expect(second.outcome).toBe('no-changes');
      expect(await readFile(path, 'utf8')).toBe('key=rewritten-by-the-app\n');
    });

    it('changes nothing when a pre-start file is from before Mediaplane seeded the app', async () => {
      const home = await makeHome();
      const path = join(home, 'appdata', 'sonarr', 'config', 'app.ini');
      await mkdir(join(home, 'appdata', 'sonarr', 'config'), { recursive: true });
      await writeFile(path, 'user=someone\n');
      const confirm = vi.fn(() => Promise.resolve(true));
      const result = await apply(
        options(home, fakeDocker(home), { catalog: WITH_FILES, confirm }),
      );
      expect(result.outcome).toBe('invalid');
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'sonarr.not-seeded', severity: 'error' }),
      );
      expect(confirm).not.toHaveBeenCalled();
      await expect(stat(join(home, 'generated'))).rejects.toThrow();
      expect(await readFile(path, 'utf8')).toBe('user=someone\n');
    });
  ```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/apply`

Expected: FAIL. `./prestart` does not exist, and apply writes no `app.ini` (its `files`
detail lacks `; created …`). The "from before Mediaplane seeded" test already passes,
because plan refuses it (Task 5).

- [ ] **Step 3: Implement**

`packages/engine/src/apply/prestart.ts`:

```ts
import { lstat, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PrestartFile } from '../render/prestart';
import { writeFileExclusive } from '../util/atomic';

/**
 * Whether nothing is at `path` yet. Anything else, even a path Mediaplane may not look
 * at (EACCES, EPERM), is the app's own, as plan's check counts it.
 */
async function absent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (cause) {
    return cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';
  }
}

/**
 * Write each pre-start file that does not exist yet (spec §6.4): all at once, 0600,
 * never over an existing file, with its folders created. Returns the paths it created,
 * relative to the home.
 */
export async function writePrestartFiles(
  home: string,
  files: readonly PrestartFile[],
): Promise<string[]> {
  const created: string[] = [];
  for (const file of files) {
    const path = join(home, file.path);
    // Look first: writeFileExclusive makes a temporary file next to the target, and
    // after its first start the app's folder may be closed to Mediaplane.
    if (!(await absent(path))) continue;
    await mkdir(dirname(path), { recursive: true });
    if (await writeFileExclusive(path, file.content, 0o600)) created.push(file.path);
  }
  return created;
}
```

In `packages/engine/src/apply/apply.ts`:

- add these imports, next to their neighbours in path order:

  ```ts
  import { prestartFilesFor } from '../render/prestart';
  import { writePrestartFiles } from './prestart';
  ```

- replace the `files` step with:

  ```ts
    await steps.run('files', async () => {
      values = await secretValues(stack, store, options.env);
      const written = await writeGenerated(
        home,
        composeToYaml(compose, home),
        renderEnvFile(values),
      );
      await ensureAppdataDirs(stack);
      // Before any app starts, and only where the app has no file of its own (spec §6.4).
      const created = await writePrestartFiles(
        home,
        await prestartFilesFor(stack, store, options.env, options.random),
      );
      return [
        `wrote ${written.join(' and ')}`,
        ...(created.length === 0 ? [] : [`created ${created.join(', ')}`]),
      ].join('; ');
    });
  ```

In `packages/engine/src/index.ts`, add `export * from './apply/prestart';` after
`export * from './apply/pull';`.

In `packages/cli/src/run.test.ts`:

- replace the import from `'@mediaplane/engine'` with:

  ```ts
  import {
    collectHostReport,
    COMPOSE_PATH,
    composeToYaml,
    ENV_PATH,
    invokingUser,
    nodeProbe,
    planStack,
    prestartFilesFor,
    readSecretStore,
    renderEnvFile,
    secretValues,
    withGeneratedSecrets,
    writePrestartFiles,
    writeSecretStore,
    type ContainerState,
    type HostRequest,
    type Runtime,
  } from '@mediaplane/engine';
  ```

- give `currentHome` a second parameter, and write the pre-start files the catalog
  declares, as a first apply would:

  ```ts
  /** A home whose generated files and stored keys are what plan expects, as of `runtime`. */
  async function currentHome(
    runtime: Runtime,
    { prestart = true }: { prestart?: boolean } = {},
  ): Promise<string> {
    const home = await makeHome();
    const { context } = await planStack({
      home,
      catalog,
      host: FIXTURE_HOST,
      env: {},
      runtime,
      probe: fakeProbe(),
    });
    if (context === undefined) throw new Error('the test stack must plan');
    const { store } = withGeneratedSecrets(context.stack, context.store, zeros);
    await writeSecretStore(home, store);
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, COMPOSE_PATH), composeToYaml(context.compose, home));
    await writeFile(
      join(home, ENV_PATH),
      renderEnvFile(await secretValues(context.stack, store, {})),
    );
    if (prestart) {
      const files = await prestartFilesFor(context.stack, store, {}, zeros);
      await writePrestartFiles(home, files);
    }
    return home;
  }
  ```

- in "counts only the steps that changed something as \"changed\" in JSON", replace the
  first two lines of the test body with:

  ```ts
      // Every key is stored already, so the keys step has nothing to do. No pre-start file
      // is written, so the appdata folder is free to be replaced by a file.
      const home = await currentHome(fakeRuntime(), { prestart: false });
  ```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages
git commit -m "feat(engine): write pre-start files once, before the apps first start" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Servarr's `config.xml` and Gluetun's control-server key

Spec §6.1: Sonarr's, Radarr's and Prowlarr's key is set through `<APP>__AUTH__APIKEY`
**and** written to `config.xml` before first start, because an env-only key is never
persisted: if the variable were ever lost, the app would silently make a new key. Rulings:
`config.xml` holds `ApiKey`, `AuthenticationMethod` and `AuthenticationRequired`, nothing
that needs a restart (those stay in the environment, spec §6.4). A pre-written file with
just these three is kept, and the app adds the rest of its settings (checked on the pinned
Sonarr and Radarr images; Prowlarr runs the same code).

Gluetun v3.41.3 answers `GET /v1/vpn/status` and `/v1/publicip/ip` on port 8000 to anyone
on the stack's network, with only a deprecation warning. A role in
`/gluetun/auth/config.toml` with `auth = "apikey"` makes them answer 401 without the key and
200 with the `X-API-Key` header (checked by hand on the pinned image; Slice 3d's
end-to-end test checks it, and Task 12 adds that to the roadmap). Ruling: Mediaplane
writes that file before Gluetun first starts, with a generated `controlApiKey` (32 hex),
for those two routes only. S3d's `vpn-check` uses it.

**Files:**
- Modify: `catalog/_shared/servarr.ts`, `catalog/sonarr/app.ts`,
  `catalog/radarr/app.ts`, `catalog/prowlarr/app.ts`, `catalog/gluetun/app.ts`
- Test: `catalog/render.test.ts`, `catalog/catalog.test.ts`,
  `packages/cli/src/run.test.ts`
- Generated: `catalog/gluetun/README.md` (its facts block lists the new secret)

**Interfaces:**
- **Consumes:** `ConfigFile`, `ConfigFileContext` (Task 5), `renderPrestartFiles`
  (Task 5), `withGeneratedSecrets`, `emptySecretStore`, and
  `AppContext.lanClientSubnets: string[]` (Task 3: the LAN subnets while the web UIs are
  on the LAN, otherwise `[]`).
- **Produces:**
  - `servarrConfigFiles(ctx: ConfigFileContext): ConfigFile[]` in
    `catalog/_shared/servarr.ts`: `config.xml`, recognised by `<ApiKey>…</ApiKey>`;
  - Gluetun's secret `controlApiKey` (`{ generate: 'hex32' }`), so `plan` lists
    `gluetun.controlApiKey` among the secrets to generate;
  - Gluetun's pre-start file `auth/config.toml`, recognised by its `apikey = "…"` line.

- [ ] **Step 1: Write the failing tests**

In `catalog/render.test.ts`, replace the import from `'@mediaplane/engine'` with:

```ts
import {
  composeToYaml,
  emptySecretStore,
  parseConfig,
  renderCompose,
  renderPrestartFiles,
  resolveStack,
  withGeneratedSecrets,
  type Diagnostic,
  type HostFacts,
  type PrestartFile,
} from '@mediaplane/engine';
```

and add at the end of the file:

```ts
const zeros = (size: number) => Buffer.alloc(size, 0);

/** The pre-start files for `source`, with every generated key all zeros. */
function prestartFiles(source: string, host: HostFacts = HOST): PrestartFile[] {
  const result = resolve(source, host);
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  const { store } = withGeneratedSecrets(result.stack, emptySecretStore(), zeros);
  return renderPrestartFiles(
    result.stack,
    store,
    { username: 'admin', password: 'fake-admin-password' },
    zeros,
  );
}

const contentOf = (files: PrestartFile[], path: string) =>
  files.find((file) => file.path === path)?.content;

describe('pre-start files', () => {
  it('lists every file the stack writes before its apps first start', () => {
    expect(prestartFiles(SPEC_EXAMPLE).map((file) => file.path)).toEqual([
      'appdata/gluetun/auth/config.toml',
      'appdata/prowlarr/config.xml',
      'appdata/radarr/config.xml',
      'appdata/sonarr/config.xml',
    ]);
  });

  it('gives Sonarr, Radarr and Prowlarr their key and the forms login in config.xml', () => {
    const files = prestartFiles(SPEC_EXAMPLE);
    for (const app of ['prowlarr', 'radarr', 'sonarr']) {
      expect(contentOf(files, `appdata/${app}/config.xml`)).toBe(
        [
          '<Config>',
          `  <ApiKey>${'0'.repeat(32)}</ApiKey>`,
          '  <AuthenticationMethod>Forms</AuthenticationMethod>',
          '  <AuthenticationRequired>Enabled</AuthenticationRequired>',
          '</Config>',
          '',
        ].join('\n'),
      );
    }
  });

  it('lets local addresses skip the login in config.xml when login_on_lan is false', () => {
    const source = SPEC_EXAMPLE.replace(
      'network: { bind: lan }',
      'network: { bind: lan }\nsecurity: { login_on_lan: false }',
    );
    expect(contentOf(prestartFiles(source), 'appdata/sonarr/config.xml')).toContain(
      '<AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>',
    );
  });

  it("closes Gluetun's control server to all but reading the VPN status, with a key", () => {
    expect(contentOf(prestartFiles(SPEC_EXAMPLE), 'appdata/gluetun/auth/config.toml')).toBe(
      [
        '[[roles]]',
        'name = "mediaplane"',
        'routes = ["GET /v1/vpn/status", "GET /v1/publicip/ip"]',
        'auth = "apikey"',
        `apikey = "${'0'.repeat(32)}"`,
        '',
      ].join('\n'),
    );
  });

  it('knows its own files, and not a config.xml Sonarr wrote without one', () => {
    const files = prestartFiles(SPEC_EXAMPLE);
    for (const file of files) expect(file.seeded.test(file.content)).toBe(true);
    const sonarr = files.find((file) => file.path === 'appdata/sonarr/config.xml');
    // What Sonarr writes itself when it starts with only the environment variable.
    const ownFile =
      '<Config>\n  <BindAddress>*</BindAddress>\n  <Port>8989</Port>\n  <UrlBase></UrlBase>\n</Config>\n';
    expect(sonarr?.seeded.test(ownFile)).toBe(false);
  });
});
```

In `catalog/catalog.test.ts`, add inside `describe.each(…)`, after "has unique container
ports per protocol":

```ts
    it('writes pre-start files only into its own appdata volume', () => {
      expect(app.configFiles === undefined || app.volumes.appdata !== undefined).toBe(true);
    });
```

In `packages/cli/src/run.test.ts`:

- in "exits 2 and shows files, containers and secrets for a fresh home", replace the
  `Secrets to generate` and `Plan:` expectations with:

  ```ts
      expect(term.stdout()).toContain(
        '+ appdata/gluetun/auth/config.toml (before first start; secret values, not shown)\n',
      );
      expect(term.stdout()).toContain(
        '+ appdata/sonarr/config.xml (before first start; secret values, not shown)\n',
      );
      expect(term.stdout()).toContain(
        'Secrets to generate: admin.password, gluetun.controlApiKey, qbittorrent.apiKey, sonarr.apiKey\n',
      );
      expect(term.stdout()).toContain(
        'Plan: 4 files to write, 4 containers to change, 4 secrets to generate.',
      );
  ```

- in "prints versioned JSON without file contents", expect `json.secrets.generate` to
  equal
  `['admin.password', 'gluetun.controlApiKey', 'qbittorrent.apiKey', 'sonarr.apiKey']`;
- in "applies with --yes, showing the plan and progress, then reports no changes", expect
  `'Plan: 4 files to write, 4 containers to change, 4 secrets to generate.'`;
- in `describe('mediaplane history', …)`, "lists change records and shows one in full"
  now expects
  `` `${id}  success  4 files written, 4 containers changed, 4 secrets generated\n` ``,
  and "prints versioned JSON" expects
  `changes: { files: 4, containers: 4, secrets: 4 }`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run catalog packages/cli`

Expected: FAIL. No app has pre-start files yet, so the path list is empty, and the CLI's
plan still shows 2 files and 3 secrets.

- [ ] **Step 3: Implement**

Replace `catalog/_shared/servarr.ts` with:

```ts
import type { AppContext, ConfigFile, ConfigFileContext } from '@mediaplane/engine';

/** When Sonarr, Radarr and Prowlarr ask for the login: everywhere, or not locally. */
function authenticationRequired(ctx: AppContext): string {
  return ctx.config.security.login_on_lan ? 'Enabled' : 'DisabledForLocalAddresses';
}

/**
 * Auth env vars shared by Sonarr, Radarr and Prowlarr (design §6.1).
 * Values are case-sensitive. AUTH__ENABLED is deliberately never set (legacy flag).
 */
export function servarrEnv(prefix: string, ctx: AppContext): Record<string, string> {
  const env: Record<string, string> = {
    [`${prefix}__AUTH__METHOD`]: 'Forms',
    [`${prefix}__AUTH__REQUIRED`]: authenticationRequired(ctx),
  };
  // Empty unless the web UI is on the LAN: only LAN clients need trusting.
  if (!ctx.config.security.login_on_lan && ctx.lanClientSubnets.length > 0) {
    env[`${prefix}__SERVER__TRUSTEDNETWORKS`] = ctx.lanClientSubnets.join(',');
  }
  return env;
}

/**
 * config.xml, written before the first start (design §6.1): the API key, so the app keeps
 * it even if its environment variable is ever lost, and the forms login. Sonarr, Radarr
 * and Prowlarr keep these and add the rest of their settings. The admin user itself goes
 * through their API, from Slice 3b.
 */
export function servarrConfigFiles(ctx: ConfigFileContext): ConfigFile[] {
  return [
    {
      path: 'config.xml',
      content: [
        '<Config>',
        `  <ApiKey>${ctx.secret('apiKey')}</ApiKey>`,
        '  <AuthenticationMethod>Forms</AuthenticationMethod>',
        `  <AuthenticationRequired>${authenticationRequired(ctx)}</AuthenticationRequired>`,
        '</Config>',
        '',
      ].join('\n'),
      seeded: /<ApiKey>[^<]+<\/ApiKey>/,
    },
  ];
}
```

In each of `catalog/sonarr/app.ts`, `catalog/radarr/app.ts` and
`catalog/prowlarr/app.ts`:

- change the second import to
  `import { servarrConfigFiles, servarrEnv } from '../_shared/servarr';`;
- delete the line `    { step: 'config-file', path: 'config.xml' },` from
  `credentials`;
- add `  configFiles: servarrConfigFiles,` on the line after `  env: (ctx) => …,`.

In `catalog/gluetun/app.ts`:

- replace `secrets` with:

  ```ts
    secrets: {
      // Mediaplane's key to the control server, for reading the VPN's status (Slice 3d).
      controlApiKey: { generate: 'hex32' },
      wireguardKey: { userProvided: 'vpn.private_key' },
    },
  ```

- add after `validate`:

  ```ts
    // Without this file, Gluetun's control server answers anyone on the stack's network.
    configFiles: (ctx) => [
      {
        path: 'auth/config.toml',
        content: [
          '[[roles]]',
          'name = "mediaplane"',
          'routes = ["GET /v1/vpn/status", "GET /v1/publicip/ip"]',
          'auth = "apikey"',
          `apikey = "${ctx.secret('controlApiKey')}"`,
          '',
        ].join('\n'),
        seeded: /^apikey = "[^"]+"$/m,
      },
    ],
  ```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run catalog packages`

Expected: PASS. "exits 0 when nothing would change" still passes: `currentHome` (Task 6)
now writes Gluetun's and Sonarr's files, which plan finds seeded.

- [ ] **Step 5: Regenerate the facts, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add catalog packages/cli
git commit -m "feat(catalog): seed config.xml and Gluetun's control-server key" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`pnpm docs:generate` prints `wrote catalog/gluetun/README.md`: its facts list
`controlApiKey`.

---

### Task 8: qBittorrent's `qBittorrent.conf`

Spec §6.1: qBittorrent (≥ 5.2) gets a generated `qbt_` key and the shared admin in
`qBittorrent.conf` before first start, with `WebUI\Password_PBKDF2` (PBKDF2-HMAC-SHA512,
100 000 iterations, 16-byte salt, 64-byte key). Without the file, the image copies its own
default, and qBittorrent prints a new temporary password at every start.

Every line below was checked on the pinned image (5.2.4, WebAPI 2.15.1) with a file
written by exactly this code: login with the password gives 204 and a wrong one 401;
`Authorization: Bearer <key>` gives 200 and no key 403; no temporary password appears in
the log; the preferences read back `save_path` `/data/torrents`, `auto_tmm_enabled`
`true`, `upnp` `false`, `bypass_local_auth` `false`, `web_ui_domain_list` `*`, and the two
whitelisted subnets. qBittorrent rewrites the file 0644, keeping `WebUI\APIKey`.

- `[LegalNotice] Accepted=true`: the image's default has it; without it qBittorrent asks
  for confirmation.
- `Session\DefaultSavePath=/data/torrents/`: downloads land under the data folder's
  `torrents/` (spec §4.1).
- `Session\DisableAutoTMMByDefault=false`: Automatic Torrent Management, so a torrent
  follows its category's save path (ruling D11; S3c adds the categories).
- `Connection\UPnP=false`: the stack opens no port on your router.
- `WebUI\LocalHostAuth=true`: localhost signs in too.
- `WebUI\Address=*` and `WebUI\ServerDomains=*`: as the image's default. The Host-header
  check that stays is the port's (spec §6.1).
- `WebUI\AuthSubnetWhitelist`: the LAN may skip the login only with `login_on_lan: false`
  (spec §6.1). Decision: and only when the web UI is published on the LAN, as for
  Servarr's trusted networks (Task 3). Both read `AppContext.lanClientSubnets`, which the
  resolver leaves empty unless the web UIs are on the LAN. Subnets are joined with a comma
  and no space: qBittorrent keeps a space as part of the next subnet.

Decision: the `config-file` seeding step leaves the catalog types, now that every file
comes from `configFiles(ctx)`.

**Files:**
- Create: `catalog/qbittorrent/conf.ts`, `catalog/qbittorrent/conf.test.ts`
- Modify: `catalog/qbittorrent/app.ts`, `packages/engine/src/catalog/types.ts`
- Modify, only if gitleaks flags the test hash: `.gitleaks.toml` (Step 5)
- Test: `catalog/render.test.ts`, `packages/cli/src/run.test.ts`

**Interfaces:**
- **Consumes:** `ConfigFileContext` (Task 5); from Task 3,
  `AppContext.publishesOnLan: boolean` (`network.bind` is `lan` or `all`) and
  `AppContext.lanClientSubnets: string[]` (`publishesOnLan ? lanSubnets : []`).
- **Produces:**
  - `passwordHash(password: string, salt: Buffer): string` and
    `qbittorrentConf<Options>(ctx: ConfigFileContext<Options>): string` in
    `catalog/qbittorrent/conf.ts`;
  - qBittorrent's pre-start file `qBittorrent/qBittorrent.conf`, recognised by its
    `WebUI\APIKey=` line;
  - qBittorrent's warning `network.no-lan-subnet`;
  - `CredentialStep` is `env` or `bootstrap-api`.

- [ ] **Step 1: Write the failing tests**

`catalog/qbittorrent/conf.test.ts`:

```ts
import {
  emptySecretStore,
  parseConfig,
  renderPrestartFiles,
  resolveStack,
  withGeneratedSecrets,
  type HostFacts,
  type PrestartFile,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { passwordHash } from './conf';

const HOST: HostFacts = {
  arch: 'arm64',
  privateAddresses: [{ address: '192.168.1.10', cidr: '192.168.1.10/24' }],
};

const ones = (size: number) => Buffer.alloc(size, 1);

/**
 * PBKDF2-HMAC-SHA512 of "fake-admin-password", 100 000 iterations, with ones(16) as the
 * salt, in qBittorrent's form. Python's hashlib.pbkdf2_hmac gives the same.
 */
const HASH =
  '@ByteArray(AQEBAQEBAQEBAQEBAQEBAQ==:r0Q4oywi3mIwU2ggkQH4pgel9HhG105YrlE2A7+LiLKEIkcSWnFrKqJON3yIWcdKS5arqTmYfUve8Xbfk0Aa/A==)';

/** A stack with qBittorrent (no VPN), and `lines` for its network and security. */
function resolveWith(lines: string, host: HostFacts = HOST) {
  const parsed = parseConfig(
    `version: 1\npaths: { data: /srv/data }\n${lines}media_server: jellyfin\napps:\n  qbittorrent: { vpn: false }\n`,
  );
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return resolveStack(parsed.config, catalog, host, '/opt/mediaplane');
}

/** qBittorrent's pre-start file for that stack: every key all zeros, the salt ones(16). */
function confFile(lines: string, host?: HostFacts): PrestartFile {
  const { stack, diagnostics } = resolveWith(lines, host);
  if (stack === undefined) throw new Error(JSON.stringify(diagnostics));
  const { store } = withGeneratedSecrets(stack, emptySecretStore(), (size) =>
    Buffer.alloc(size, 0),
  );
  const admin = { username: 'media-admin', password: 'fake-admin-password' };
  const file = renderPrestartFiles(stack, store, admin, ones).find(
    (rendered) => rendered.app === 'qbittorrent',
  );
  if (file === undefined) throw new Error('qBittorrent has no pre-start file');
  return file;
}

describe('passwordHash', () => {
  it("is PBKDF2-HMAC-SHA512 with 100 000 rounds, in qBittorrent's form", () => {
    expect(passwordHash('fake-admin-password', ones(16))).toBe(HASH);
  });
});

describe('qBittorrent.conf', () => {
  it('sets the shared login, the API key, the save path and automatic management', () => {
    const file = confFile('network: { bind: localhost }\n');
    expect(file.path).toBe('appdata/qbittorrent/qBittorrent/qBittorrent.conf');
    expect(file.content).toBe(
      [
        '[BitTorrent]',
        'Session\\DefaultSavePath=/data/torrents/',
        'Session\\DisableAutoTMMByDefault=false',
        '',
        '[LegalNotice]',
        'Accepted=true',
        '',
        '[Preferences]',
        'Connection\\UPnP=false',
        `WebUI\\APIKey=qbt_${'0'.repeat(28)}`,
        'WebUI\\Address=*',
        'WebUI\\AuthSubnetWhitelistEnabled=false',
        'WebUI\\LocalHostAuth=true',
        `WebUI\\Password_PBKDF2="${HASH}"`,
        'WebUI\\ServerDomains=*',
        'WebUI\\Username=media-admin',
        '',
      ].join('\n'),
    );
  });

  it('lets the LAN skip the login with login_on_lan: false and the web UI on the LAN', () => {
    const file = confFile('network: { bind: lan }\nsecurity: { login_on_lan: false }\n');
    expect(file.content).toContain(
      'WebUI\\AuthSubnetWhitelist=192.168.1.0/24\nWebUI\\AuthSubnetWhitelistEnabled=true\n',
    );
  });

  it('joins several subnets with a comma and no space', () => {
    const twoLans: HostFacts = {
      arch: 'arm64',
      privateAddresses: [
        { address: '10.0.0.5', cidr: '10.0.0.5/24' },
        { address: '192.168.1.10', cidr: '192.168.1.10/24' },
      ],
    };
    const file = confFile(
      'network: { bind: lan }\nsecurity: { login_on_lan: false }\n',
      twoLans,
    );
    expect(file.content).toContain('WebUI\\AuthSubnetWhitelist=10.0.0.0/24,192.168.1.0/24\n');
  });

  it('asks everyone to sign in while the web UI is only on this machine', () => {
    const file = confFile('network: { bind: localhost }\nsecurity: { login_on_lan: false }\n');
    expect(file.content).toContain('WebUI\\AuthSubnetWhitelistEnabled=false\n');
    expect(file.content).not.toContain('WebUI\\AuthSubnetWhitelist=');
  });

  it("knows it after qBittorrent rewrites it, but not the image's own default", () => {
    const { seeded } = confFile('network: { bind: localhost }\n');
    expect(seeded.test('[Preferences]\nWebUI\\APIKey=qbt_rewritten\nWebUI\\Port=8080\n')).toBe(
      true,
    );
    expect(
      seeded.test(
        '[LegalNotice]\nAccepted=true\n\n[Preferences]\nWebUI\\Address=*\nWebUI\\ServerDomains=*\n',
      ),
    ).toBe(false);
  });

  it('warns that the LAN must sign in when Mediaplane knows no LAN subnet', () => {
    const { diagnostics } = resolveWith(
      'network: { bind: all }\nsecurity: { login_on_lan: false }\n',
      { ...HOST, cloud: 'Oracle Cloud' },
    );
    expect(diagnostics).toContainEqual({
      severity: 'warning',
      code: 'network.no-lan-subnet',
      message:
        'security.login_on_lan is false, but Mediaplane knows no LAN subnet, so qBittorrent asks your LAN for a login too',
      path: 'network.lan_subnet',
      hint: 'set network.lan_subnet to your LAN, such as 192.168.1.0/24',
    });
  });
});
```

In `catalog/render.test.ts`, in "lists every file the stack writes before its apps first
start", add `'appdata/qbittorrent/qBittorrent/qBittorrent.conf',` after
`'appdata/prowlarr/config.xml',`.

In `packages/cli/src/run.test.ts`:

- in "exits 2 and shows files, containers and secrets for a fresh home", add:

  ```ts
      expect(term.stdout()).toContain(
        '+ appdata/qbittorrent/qBittorrent/qBittorrent.conf (before first start; secret values, not shown)\n',
      );
  ```

  and change the `Plan:` expectation to
  `'Plan: 5 files to write, 4 containers to change, 4 secrets to generate.'`;
- in "applies with --yes, showing the plan and progress, then reports no changes", expect
  `'Plan: 5 files to write, 4 containers to change, 4 secrets to generate.'`;
- in `describe('mediaplane history', …)`, "lists change records and shows one in full"
  now expects
  `` `${id}  success  5 files written, 4 containers changed, 4 secrets generated\n` ``,
  and "prints versioned JSON" expects
  `changes: { files: 5, containers: 4, secrets: 4 }`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run catalog packages/cli`

Expected: FAIL. `./conf` does not exist, and no `qBittorrent.conf` is planned.

- [ ] **Step 3: Implement**

`catalog/qbittorrent/conf.ts`:

```ts
import { pbkdf2Sync } from 'node:crypto';
import type { ConfigFileContext } from '@mediaplane/engine';

/**
 * qBittorrent's WebUI\Password_PBKDF2 value (design §6.1): PBKDF2-HMAC-SHA512 with
 * 100 000 iterations, a 16-byte salt and a 64-byte key, as "@ByteArray(<salt>:<key>)" in
 * base64.
 */
export function passwordHash(password: string, salt: Buffer): string {
  const key = pbkdf2Sync(password, salt, 100_000, 64, 'sha512');
  return `@ByteArray(${salt.toString('base64')}:${key.toString('base64')})`;
}

/**
 * qBittorrent.conf, written before qBittorrent first starts (design §6.1, §6.4).
 * qBittorrent keeps these settings and adds its own. Without this file, the image starts
 * with a new temporary password every time.
 */
export function qbittorrentConf<Options>(ctx: ConfigFileContext<Options>): string {
  // The LAN may skip the login only when you said so, and only if the UI is on the LAN
  // (lanClientSubnets is empty otherwise).
  const whitelist = ctx.config.security.login_on_lan ? [] : ctx.lanClientSubnets;
  return [
    '[BitTorrent]',
    'Session\\DefaultSavePath=/data/torrents/',
    // Automatic Torrent Management: a torrent follows its category's save path.
    'Session\\DisableAutoTMMByDefault=false',
    '',
    '[LegalNotice]',
    'Accepted=true',
    '',
    '[Preferences]',
    'Connection\\UPnP=false',
    `WebUI\\APIKey=${ctx.secret('apiKey')}`,
    'WebUI\\Address=*',
    // A comma with no space: qBittorrent would keep a space as part of the next subnet.
    ...(whitelist.length === 0
      ? ['WebUI\\AuthSubnetWhitelistEnabled=false']
      : [
          `WebUI\\AuthSubnetWhitelist=${whitelist.join(',')}`,
          'WebUI\\AuthSubnetWhitelistEnabled=true',
        ]),
    'WebUI\\LocalHostAuth=true',
    `WebUI\\Password_PBKDF2="${passwordHash(ctx.admin.password, ctx.random(16))}"`,
    'WebUI\\ServerDomains=*',
    `WebUI\\Username=${ctx.admin.username}`,
    '',
  ].join('\n');
}
```

In `catalog/qbittorrent/app.ts`:

- add `import { qbittorrentConf } from './conf';` after `import { z } from 'zod';`;
- replace the `credentials` line with `  credentials: [],`;
- replace `validate` with:

  ```ts
    validate: (ctx) => [
      ...(ctx.options.vpn
        ? []
        : [
            warning(
              'qbittorrent.no-vpn',
              'qBittorrent is running without a VPN (apps.qbittorrent.vpn: false)',
              {
                path: 'apps.qbittorrent.vpn',
                hint: 'peers will see your real IP address; add a vpn: block and remove vpn: false',
              },
            ),
          ]),
      ...(!ctx.config.security.login_on_lan &&
      ctx.publishesOnLan &&
      ctx.lanClientSubnets.length === 0
        ? [
            warning(
              'network.no-lan-subnet',
              'security.login_on_lan is false, but Mediaplane knows no LAN subnet, so qBittorrent asks your LAN for a login too',
              {
                path: 'network.lan_subnet',
                hint: 'set network.lan_subnet to your LAN, such as 192.168.1.0/24',
              },
            ),
          ]
        : []),
    ],
  ```

- add after `validate`:

  ```ts
    // The shared login and the key, before the image's default can set a temporary password.
    configFiles: (ctx) => [
      {
        path: 'qBittorrent/qBittorrent.conf',
        content: qbittorrentConf(ctx),
        seeded: /^WebUI\\APIKey=.+$/m,
      },
    ],
  ```

In `packages/engine/src/catalog/types.ts`, replace `CredentialStep` with:

```ts
/**
 * How secrets and first-run setup reach the app, in order. Files written before the
 * first start come from configFiles instead.
 */
export type CredentialStep =
  | { step: 'env'; var: string; secret: string }
  | { step: 'bootstrap-api'; action: string };
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run catalog packages scripts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add catalog packages
git commit -m "feat(catalog): seed qBittorrent.conf with the shared login and its key" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`pnpm docs:generate` writes nothing here. If the pre-commit gitleaks hook flags the test
hash in `conf.test.ts`, it is a false positive on a fake value: add the exact line's
pattern to the `.gitleaks.toml` allowlist rather than weakening the test. Then stage that
file too, and run the same commit again:

```bash
git add catalog packages .gitleaks.toml
git commit -m "feat(catalog): seed qBittorrent.conf with the shared login and its key" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: `mediaplane credentials`

Spec §5.2: `credentials [app]` shows the shared admin login and per-app URLs, and the
password is never printed in `--json` unless `--reveal` is given. Spec §6.1:
"`mediaplane credentials` shows them" (the user name and the generated password). Ruling:
human output, plus `--json` as `mediaplane.credentials/v1`; exit 1 with a hint before the
password exists; apps whose login is still to come are marked with their slice.

Decision: the human output shows a generated password, as the spec says; your own password
(from `admin.password`) is shown only with `--reveal`, since you already have it; `--json`
holds the password only with `--reveal`, whichever it is.

Decision: each app with a published web UI declares `login` in the catalog: `'shared'` once
the shared login works there (qBittorrent, from Task 8), or the slice that brings it. Apps
without a web UI (Gluetun, Byparr, FlareSolverr) are not listed.

Decision: URLs come from the resolved stack (its bind addresses and published ports), which
needs the host facts but not the running containers, so `credentials` works before the
stack is up. With `bind: all`, it names `127.0.0.1` and the host's private addresses
instead of `0.0.0.0`.

**Files:**
- Modify: `packages/engine/src/catalog/types.ts`
- Modify: `catalog/sonarr/app.ts`, `catalog/radarr/app.ts`, `catalog/prowlarr/app.ts`,
  `catalog/qbittorrent/app.ts`, `catalog/jellyfin/app.ts`, `catalog/plex/app.ts`,
  `catalog/seerr/app.ts`
- Create: `packages/engine/src/credentials.ts`,
  `packages/engine/src/credentials.test.ts`, `packages/cli/src/credentials.ts`,
  `packages/cli/src/credentials.test.ts`
- Modify: `packages/engine/src/index.ts`, `packages/cli/src/run.ts`
- Test: `catalog/catalog.test.ts`, `scripts/docs/cli-reference.test.ts`
- Generated: `docs/reference/cli.md`

**Interfaces:**
- **Consumes:** `loadConfigFile`, `checkSecretRefs`, `readSecretStore`, `resolveStack`,
  `adminLogin`, `adminPasswordToGenerate`, `ADMIN_PASSWORD_PATH` (Task 4),
  `formatDiagnostic`, `printError`.
- **Produces:**
  - `AppDefinition.login?: 'shared' | { comingIn: string }`;
  - in `packages/engine/src/credentials.ts`:
    - `CredentialsOptions { home: string; catalog: Catalog; host: HostFacts | (() => Promise<HostFacts>); env: NodeJS.ProcessEnv }`;
    - `AppLogin = { app: string; name: string; urls: string[] } & ({ login: 'shared' } | { login: 'not-yet'; comingIn: string })`;
    - `CredentialsResult`, either `{ ok: true; username: string; password: string; source: { kind: 'generated' } | { kind: 'yours'; ref: string }; apps: AppLogin[] }`
      or `{ ok: false; diagnostics: Diagnostic[] }`;
    - `credentials(options: CredentialsOptions): Promise<CredentialsResult>`, and the
      error `credentials.not-yet`;
  - in `packages/cli/src/credentials.ts`: `CREDENTIALS_JSON_SCHEMA` and
    `printCredentials(result, app, { json, reveal }, io): number` (the exit code);
  - the command `mediaplane credentials [app] [--home] [--reveal] [--json]`, and
    `EXIT_CODES.credentials`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/credentials.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AppDefinition, Catalog } from './catalog/types';
import { credentials } from './credentials';
import type { HostFacts } from './host/facts';
import { SECRETS_PATH } from './paths';
import { FIXTURE_HOST, fixtureCatalog } from './testing/fixtures';
import { tempDir } from './testing/temp';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  qbittorrent: { vpn: false }
  sonarr: {}
`;

/** qBittorrent has the shared login, Sonarr's is to come, and Jellyfin says nothing. */
const LOGINS: Record<string, AppDefinition['login']> = {
  qbittorrent: 'shared',
  sonarr: { comingIn: 'Slice 3b' },
};
const CATALOG: Catalog = fixtureCatalog.map((app) => ({ ...app, login: LOGINS[app.id] }));

/** A home with `stack`, and, when `stored`, a generated admin password in the store. */
async function homeWith({ stack = STACK, stored = true } = {}): Promise<string> {
  const home = await tempDir('mediaplane-credentials-');
  await writeFile(join(home, 'stack.yaml'), stack);
  if (stored) {
    await mkdir(join(home, 'state'));
    await writeFile(
      join(home, SECRETS_PATH),
      JSON.stringify({
        version: 1,
        apps: {},
        shared: { adminPassword: 'fake-admin-password' },
      }),
    );
  }
  return home;
}

const loginFor = (
  home: string,
  { host = FIXTURE_HOST, env = {} }: { host?: HostFacts; env?: NodeJS.ProcessEnv } = {},
) => credentials({ home, catalog: CATALOG, host, env });

const YOURS = STACK.replace(
  'apps:',
  'admin: { username: media-admin, password: { file: secrets/admin-password } }\napps:',
);

describe('credentials', () => {
  it('gives the shared login, and where each app with a login is published', async () => {
    expect(await loginFor(await homeWith())).toEqual({
      ok: true,
      username: 'admin',
      password: 'fake-admin-password',
      source: { kind: 'generated' },
      apps: [
        {
          app: 'qbittorrent',
          name: 'qbittorrent',
          urls: ['http://127.0.0.1:8080'],
          login: 'shared',
        },
        {
          app: 'sonarr',
          name: 'sonarr',
          urls: ['http://127.0.0.1:8989'],
          login: 'not-yet',
          comingIn: 'Slice 3b',
        },
      ],
    });
  });

  it("names this host's addresses when the web UIs are on every interface", async () => {
    const home = await homeWith({ stack: STACK.replace('bind: localhost', 'bind: all') });
    const result = await loginFor(home);
    expect(result.ok && result.apps[0]?.urls).toEqual([
      'http://127.0.0.1:8080',
      'http://192.168.1.10:8080',
    ]);
  });

  it('uses your own password, and says which file it comes from', async () => {
    const home = await homeWith({ stack: YOURS, stored: false });
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'admin-password'), 'fake-own-password\n');
    expect(await loginFor(home)).toMatchObject({
      ok: true,
      username: 'media-admin',
      password: 'fake-own-password',
      source: { kind: 'yours', ref: 'secrets/admin-password' },
    });
  });

  it('names the environment variable your password comes from', async () => {
    const stack = STACK.replace(
      'apps:',
      'admin: { password: { env: FAKE_ADMIN_PASSWORD } }\napps:',
    );
    const home = await homeWith({ stack, stored: false });
    expect(
      await loginFor(home, { env: { FAKE_ADMIN_PASSWORD: 'fake-own-password' } }),
    ).toMatchObject({
      ok: true,
      source: { kind: 'yours', ref: 'the environment variable FAKE_ADMIN_PASSWORD' },
    });
  });

  it('says to run apply first while no password has been generated', async () => {
    expect(await loginFor(await homeWith({ stored: false }))).toEqual({
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'credentials.not-yet',
          message: 'the admin password has not been generated yet',
          hint: 'run "mediaplane apply": it generates the password before it starts any app',
        },
      ],
    });
  });

  it('reports your password file when it is missing or too short', async () => {
    const home = await homeWith({ stack: YOURS, stored: false });
    expect(await loginFor(home)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'secret.missing', path: 'admin.password' }],
    });
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'admin-password'), 'fake-short\n');
    expect(await loginFor(home)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'admin.password-too-short' }],
    });
  });

  it('shows the login even when another secret, such as the VPN key, is missing', async () => {
    const stack = STACK.replace(
      'apps:',
      'vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }\napps:',
    );
    expect((await loginFor(await homeWith({ stack }))).ok).toBe(true);
  });

  it('reports a missing stack.yaml, or one that does not resolve', async () => {
    expect(await loginFor(await tempDir('mediaplane-credentials-'))).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'config.missing' }],
    });
    const home = await homeWith({ stack: STACK.replace('sonarr: {}', 'sonar: {}') });
    expect(await loginFor(home)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'app.unknown' }],
    });
  });

  it('asks for the host facts only once it needs them', async () => {
    const host = vi.fn(() => Promise.resolve(FIXTURE_HOST));
    await credentials({
      home: await homeWith({ stored: false }),
      catalog: CATALOG,
      host,
      env: {},
    });
    expect(host).not.toHaveBeenCalled();
    await credentials({ home: await homeWith(), catalog: CATALOG, host, env: {} });
    expect(host).toHaveBeenCalledTimes(1);
  });
});
```

`packages/cli/src/credentials.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FIXTURE_HOST, fakeProbe, fakeRuntime, tempDir } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { run, type CliDeps, type Io } from './run';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  qbittorrent: {}
`;
const PASSWORD = 'fake-admin-password-0001';

async function makeHome({ stack = STACK, stored = true } = {}): Promise<string> {
  const home = await tempDir('mediaplane-cli-');
  await writeFile(join(home, 'stack.yaml'), stack);
  if (stored) {
    await mkdir(join(home, 'state'));
    await writeFile(
      join(home, 'state', 'secrets.json'),
      JSON.stringify({ version: 1, apps: {}, shared: { adminPassword: PASSWORD } }),
    );
  }
  return home;
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    env: {},
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

const deps: Partial<CliDeps> = {
  host: () => Promise.resolve(FIXTURE_HOST),
  runtime: () => fakeRuntime(),
  probe: () => fakeProbe(),
};

describe('mediaplane credentials', () => {
  it('shows the shared login, and where each app is', async () => {
    const term = capture();
    expect(await run(['credentials', '--home', await makeHome()], term.io, deps)).toBe(0);
    expect(term.stdout()).toBe(
      [
        'Admin login for the apps:',
        '  user name  admin',
        `  password   ${PASSWORD}`,
        '',
        'Jellyfin     http://127.0.0.1:8096  (its login arrives in Slice 6)',
        'qBittorrent  http://127.0.0.1:8080',
        'Sonarr       http://127.0.0.1:8989  (its login arrives in Slice 3b)',
        '',
      ].join('\n'),
    );
  });

  it('leaves the password out of JSON unless --reveal is given', async () => {
    const home = await makeHome();
    const hidden = capture();
    expect(await run(['credentials', '--home', home, '--json'], hidden.io, deps)).toBe(0);
    expect(hidden.stdout()).not.toContain(PASSWORD);
    expect(JSON.parse(hidden.stdout())).toEqual({
      schema: 'mediaplane.credentials/v1',
      username: 'admin',
      password: null,
      passwordSource: 'generated',
      apps: [
        {
          app: 'jellyfin',
          name: 'Jellyfin',
          urls: ['http://127.0.0.1:8096'],
          login: 'not-yet',
          comingIn: 'Slice 6',
        },
        {
          app: 'qbittorrent',
          name: 'qBittorrent',
          urls: ['http://127.0.0.1:8080'],
          login: 'shared',
        },
        {
          app: 'sonarr',
          name: 'Sonarr',
          urls: ['http://127.0.0.1:8989'],
          login: 'not-yet',
          comingIn: 'Slice 3b',
        },
      ],
    });
    const shown = capture();
    expect(
      await run(['credentials', '--home', home, '--json', '--reveal'], shown.io, deps),
    ).toBe(0);
    expect(JSON.parse(shown.stdout())).toMatchObject({ password: PASSWORD });
  });

  it('shows one app, and fails for one without a web login', async () => {
    const home = await makeHome();
    const one = capture();
    expect(await run(['credentials', 'qbittorrent', '--home', home], one.io, deps)).toBe(
      0,
    );
    expect(one.stdout()).toContain('\nqBittorrent  http://127.0.0.1:8080\n');
    expect(one.stdout()).not.toContain('Sonarr');
    const none = capture();
    expect(await run(['credentials', 'gluetun', '--home', home], none.io, deps)).toBe(1);
    expect(none.stderr()).toBe('error: no app "gluetun" with a web login in this stack\n');
  });

  it('keeps your own password hidden unless --reveal is given', async () => {
    const home = await makeHome({
      stack: STACK.replace(
        'apps:',
        'admin: { password: { file: secrets/admin-password } }\napps:',
      ),
      stored: false,
    });
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'admin-password'), 'fake-own-password\n');
    const hidden = capture();
    expect(await run(['credentials', '--home', home], hidden.io, deps)).toBe(0);
    expect(hidden.stdout()).toContain(
      '  password   yours, from secrets/admin-password (--reveal shows it)\n',
    );
    expect(hidden.stdout()).not.toContain('fake-own-password');
    const shown = capture();
    expect(await run(['credentials', '--home', home, '--reveal'], shown.io, deps)).toBe(0);
    expect(shown.stdout()).toContain('  password   fake-own-password\n');
  });

  it('says to run apply first, as an error, before the password exists', async () => {
    const home = await makeHome({ stored: false });
    const term = capture();
    expect(await run(['credentials', '--home', home], term.io, deps)).toBe(1);
    expect(term.stderr()).toBe(
      'error: the admin password has not been generated yet\n  hint: run "mediaplane apply": it generates the password before it starts any app\n',
    );
    const json = capture();
    expect(await run(['credentials', '--home', home, '--json'], json.io, deps)).toBe(1);
    expect(JSON.parse(json.stdout())).toEqual({
      schema: 'mediaplane.error/v1',
      ok: false,
      error: { message: 'the admin password has not been generated yet' },
    });
  });
});
```

In `catalog/catalog.test.ts`, add inside `describe.each(…)`:

```ts
    it('says how you sign in, exactly when it publishes a web UI', () => {
      const published = app.ports.some((port) => port.publish !== false);
      expect(app.login !== undefined).toBe(published);
    });
```

In `scripts/docs/cli-reference.test.ts`, change the list of commands to
`['plan', 'apply', 'status', 'history', 'init', 'credentials']`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/credentials.test.ts packages/cli catalog scripts`

Expected: FAIL. `./credentials` does not exist in either package, `run` has no
`credentials` command (Commander answers `unknown command`), the catalog declares no
`login`, and the CLI reference has no `mediaplane credentials` section.

- [ ] **Step 3: Implement the engine side**

In `packages/engine/src/catalog/types.ts`, add to `AppDefinition` after `configFiles`:

```ts
  /**
   * How you sign in to its web UI: 'shared' once the shared admin login works there, or
   * the slice that brings a login. Every app with a published web UI says, and
   * `mediaplane credentials` lists them.
   */
  login?: 'shared' | { comingIn: string };
```

`packages/engine/src/credentials.ts`:

```ts
import { join, resolve } from 'node:path';
import type { Catalog } from './catalog/types';
import { loadConfigFile } from './config/load';
import type { SecretRef } from './config/schema';
import { checkSecretRefs } from './config/secrets';
import { error, type Diagnostic } from './diagnostics';
import type { HostFacts } from './host/facts';
import { STACK_PATH } from './paths';
import { resolveStack, type ResolvedApp } from './resolver/resolve';
import { ADMIN_PASSWORD_PATH, adminLogin, adminPasswordToGenerate } from './secrets/admin';
import { readSecretStore } from './secrets/store';
import { compare } from './util/sort';

export interface CredentialsOptions {
  home: string;
  catalog: Catalog;
  /** Facts about the host, or how to get them once they are needed. */
  host: HostFacts | (() => Promise<HostFacts>);
  env: NodeJS.ProcessEnv;
}

/** One app's web UI, and how you sign in to it. */
export type AppLogin = {
  app: string;
  name: string;
  /** Where its web UI is published: one URL per address. */
  urls: string[];
} & ({ login: 'shared' } | { login: 'not-yet'; comingIn: string });

export type CredentialsResult =
  | {
      ok: true;
      username: string;
      /** In plain text: print it only where the user asked to see it. */
      password: string;
      /** generated: Mediaplane's, in state/secrets.json. yours: from admin.password. */
      source: { kind: 'generated' } | { kind: 'yours'; ref: string };
      apps: AppLogin[];
    }
  | { ok: false; diagnostics: Diagnostic[] };

/** The shared admin login, and the web address of each app that has a login (spec §5.2). */
export async function credentials(options: CredentialsOptions): Promise<CredentialsResult> {
  const home = resolve(options.home);
  const loaded = await loadConfigFile(join(home, STACK_PATH));
  if (!loaded.ok) return { ok: false, diagnostics: loaded.diagnostics };
  const { config } = loaded;
  // Only the admin password matters here: a missing VPN key doesn't hide the login.
  const problems = (await checkSecretRefs(config, home, options.env)).filter(
    (diagnostic) => diagnostic.path === ADMIN_PASSWORD_PATH,
  );
  if (problems.length > 0) return { ok: false, diagnostics: problems };
  const store = await readSecretStore(home);
  if (adminPasswordToGenerate(config, store)) {
    return {
      ok: false,
      diagnostics: [
        error('credentials.not-yet', 'the admin password has not been generated yet', {
          hint: 'run "mediaplane apply": it generates the password before it starts any app',
        }),
      ],
    };
  }
  const host = typeof options.host === 'function' ? await options.host() : options.host;
  const resolved = resolveStack(config, options.catalog, host, home);
  if (resolved.stack === undefined) {
    return {
      ok: false,
      diagnostics: resolved.diagnostics.filter((d) => d.severity === 'error'),
    };
  }
  const login = await adminLogin(config, home, store, options.env);
  const addresses = webAddresses(resolved.stack.bindAddresses, host);
  return {
    ok: true,
    username: login.username,
    password: login.password,
    source:
      config.admin.password === undefined
        ? { kind: 'generated' }
        : { kind: 'yours', ref: describeRef(config.admin.password) },
    apps: resolved.stack.apps.flatMap((app) => appLogin(app, addresses)),
  };
}

function describeRef(ref: SecretRef): string {
  return 'file' in ref ? ref.file : `the environment variable ${ref.env}`;
}

/**
 * Where a browser reaches the web UIs. bind: all publishes on every interface, so name
 * this host's own addresses rather than 0.0.0.0.
 */
function webAddresses(bindAddresses: readonly string[], host: HostFacts): string[] {
  if (!bindAddresses.includes('0.0.0.0')) return [...bindAddresses];
  return ['127.0.0.1', ...host.privateAddresses.map((a) => a.address).sort(compare)];
}

function appLogin(app: ResolvedApp, addresses: readonly string[]): AppLogin[] {
  const { login, id, name } = app.def;
  if (login === undefined) return [];
  const urls = app.ports
    .filter((port) => port.protocol === 'tcp')
    .flatMap((port) => addresses.map((address) => `http://${address}:${port.host}`));
  return [
    login === 'shared'
      ? { app: id, name, urls, login: 'shared' }
      : { app: id, name, urls, login: 'not-yet', comingIn: login.comingIn },
  ];
}
```

In `packages/engine/src/index.ts`, add `export * from './credentials';` after
`export * from './status';`.

Add a `login` line to the catalog, just before `  experimental: false,` in each file:

- `catalog/qbittorrent/app.ts`: `  login: 'shared',`
- `catalog/sonarr/app.ts`, `catalog/radarr/app.ts`, `catalog/prowlarr/app.ts`:
  `  login: { comingIn: 'Slice 3b' },`
- `catalog/jellyfin/app.ts`, `catalog/plex/app.ts`: `  login: { comingIn: 'Slice 6' },`
- `catalog/seerr/app.ts`: `  login: { comingIn: 'Slice 7' },`

- [ ] **Step 4: Implement the command**

`packages/cli/src/credentials.ts`:

```ts
import type { AppLogin, CredentialsResult } from '@mediaplane/engine';
import { formatDiagnostic, printError } from './output';
import type { Io } from './run';

export const CREDENTIALS_JSON_SCHEMA = 'mediaplane.credentials/v1';

/**
 * `mediaplane credentials [app]` (spec §5.2): the shared login and where each app is.
 * The human output shows a generated password; --json leaves the password out unless
 * --reveal is given, and your own password needs --reveal either way. Returns the exit
 * code.
 */
export function printCredentials(
  result: CredentialsResult,
  app: string | undefined,
  options: { json: boolean; reveal: boolean },
  io: Io,
): number {
  if (!result.ok) {
    if (options.json) {
      printError(result.diagnostics.map((d) => d.message).join('; '), { json: true }, io);
    } else {
      for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
    }
    return 1;
  }
  const apps = app === undefined ? result.apps : result.apps.filter((a) => a.app === app);
  if (app !== undefined && apps.length === 0) {
    printError(`no app "${app}" with a web login in this stack`, options, io);
    return 1;
  }
  if (options.json) {
    const shown = {
      schema: CREDENTIALS_JSON_SCHEMA,
      username: result.username,
      password: options.reveal ? result.password : null,
      passwordSource: result.source.kind,
      apps,
    };
    io.stdout(`${JSON.stringify(shown, null, 2)}\n`);
    return 0;
  }
  const password =
    result.source.kind === 'generated' || options.reveal
      ? result.password
      : `yours, from ${result.source.ref} (--reveal shows it)`;
  io.stdout(
    `Admin login for the apps:\n  user name  ${result.username}\n  password   ${password}\n\n`,
  );
  const width = Math.max(...apps.map((entry) => entry.name.length)) + 2;
  for (const entry of apps) io.stdout(`${entry.name.padEnd(width)}${where(entry)}\n`);
  return 0;
}

function where(entry: AppLogin): string {
  const urls = entry.urls.length === 0 ? 'not published' : entry.urls.join(', ');
  return entry.login === 'shared'
    ? urls
    : `${urls}  (its login arrives in ${entry.comingIn})`;
}
```

In `packages/cli/src/run.ts`:

- add `credentials,` to the import from `'@mediaplane/engine'` (after `createDockerRuntime,`),
  and `import { printCredentials } from './credentials';` after
  `import { init, type InitOptions } from './init';`;
- add to `EXIT_CODES`, after `history`:

  ```ts
    credentials: [
      '0: the login was shown',
      '1: an error: no stack.yaml, no password yet, or no such app',
    ],
  ```

- register the command after `history`, before `init`:

  ```ts
    program
      .command('credentials')
      .description("Show the shared admin login and each app's web address")
      .argument('[app]', 'show only this app')
      .option('--home <dir>', 'Mediaplane home directory', defaultHome)
      .option(
        '--reveal',
        'show the password in --json output, and show your own password (admin.password)',
      )
      .option('--json', 'print machine-readable JSON, without the password unless --reveal')
      .addHelpText('after', exitCodesHelp('credentials'))
      .action(
        async (
          app: string | undefined,
          options: { home: string; json?: boolean; reveal?: boolean },
        ) => {
          const home = resolve(options.home);
          const runtime = deps.runtime(home, project);
          const result = await credentials({
            home,
            catalog,
            // In the image, the host helper: needed for the LAN addresses.
            host: () => deps.host(runtime),
            env: io.env,
          });
          setExitCode(
            printCredentials(
              result,
              app,
              { json: options.json === true, reveal: options.reveal === true },
              io,
            ),
          );
        },
      );
  ```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run packages catalog scripts`

Expected: PASS, including "keeps every exit-code line within 80 columns".

- [ ] **Step 6: Regenerate the CLI reference, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages catalog scripts docs/reference
git commit -m "feat(cli): mediaplane credentials shows the shared login and each app" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`pnpm docs:generate` prints `wrote docs/reference/cli.md`.

---

### Task 10: `init`'s five new questions

Ruling: `init` asks all five questions, each with a flag for non-TTY use:

1. the admin user name (`--admin-user`);
2. whether to generate the password, or use a file (`--admin-password-file`);
3. LAN or localhost, with `localhost` the default on a cloud VM (`--bind`);
4. the LAN subnet, when the bind is `lan` (`--lan-subnet`);
5. the VPN's WireGuard address, when there is a VPN provider (`--vpn-addresses`).

This closes the gap `deploy/README.md` notes ("`init` has no option for it"), and writes
`network.lan_subnet` explicitly, where the schema checks it is private and you can see it.
Mullvad needs `vpn.addresses`, which `init` never wrote.

Decision: the questions come in this order: media server, data folder, VPN provider,
WireGuard address (with a provider), `lan` or `localhost`, LAN subnet (with `lan`), login
on the LAN, admin user name, then generate the password or name a file. With `lan`, init
offers the subnet it sees when there is exactly one, and otherwise asks you to type it.
On a cloud VM it never offers one: the VM's private network is not a LAN (Task 3), and
one keypress would satisfy `network.cloud-lan`. There it always asks you to type it.

Decision: without a terminal, `--bind lan` with no `--lan-subnet` writes no subnet, so plan
detects it, except on a cloud VM, where init refuses as plan would (`network.cloud-lan`).
`--admin-password-file` must be a path inside the home, because the container sees nothing
else. Init never writes the password file itself: its next steps say where to put it.
`--vpn-addresses` without a VPN provider is refused, rather than dropped without a word:
`--vpn-addresses needs --vpn-provider`.

**Files:**
- Modify: `packages/engine/src/config/starter.ts`, `packages/cli/src/init.ts`,
  `packages/cli/src/run.ts`
- Test: `packages/engine/src/config/starter.test.ts`, `packages/cli/src/init.test.ts`
- Generated: `docs/reference/cli.md`

**Interfaces:**
- **Consumes:** `networkOf`, the schema's `admin.username` and `lan_subnet` rules (Tasks 3
  and 4), which `init` applies by parsing what it writes.
- **Produces:**
  - `StarterAnswers` gains `vpnAddresses: string | undefined`,
    `lanSubnet: string | undefined`, `adminUser: string` and
    `adminPasswordFile: string | undefined`;
  - `InitOptions` gains `vpnAddresses?`, `bind?`, `lanSubnet?`, `adminUser?` and
    `adminPasswordFile?` (all `string`);
  - `DEFAULT_PASSWORD_FILE = 'secrets/admin-password'` in `packages/cli/src/init.ts`;
  - the flags `--vpn-addresses <cidr>`, `--bind <where>`, `--lan-subnet <cidr>`,
    `--admin-user <name>` and `--admin-password-file <path>`;
  - the error `--vpn-addresses needs --vpn-provider`;
  - on a cloud VM, `askLanSubnet` never offers the detected subnet: you type it.

- [ ] **Step 1: Write the failing tests**

In `packages/engine/src/config/starter.test.ts`:

- replace `ANSWERS` with:

  ```ts
  const ANSWERS: StarterAnswers = {
    mediaServer: 'jellyfin',
    dataPath: '/srv/data',
    vpnProvider: 'mullvad',
    vpnAddresses: undefined,
    loginOnLan: true,
    timezone: 'Europe/London',
    user: { uid: 1000, gid: 1000 },
    bind: 'lan',
    lanSubnet: undefined,
    adminUser: 'admin',
    adminPasswordFile: undefined,
  };
  ```

- add to `describe('starterStack', …)`:

  ```ts
    it('writes the admin user, and leaves the password to Mediaplane', () => {
      const config = configOf(ANSWERS);
      expect(config.admin).toEqual({ username: 'admin' });
      expect(starterStack(ANSWERS)).toContain('# Mediaplane generates the password.');
    });

    it('points at your own password file when you have one', () => {
      const config = configOf({
        ...ANSWERS,
        adminUser: 'media-admin',
        adminPasswordFile: 'secrets/admin-password',
      });
      expect(config.admin).toEqual({
        username: 'media-admin',
        password: { file: 'secrets/admin-password' },
      });
    });

    it('writes the LAN subnet and the WireGuard address when given', () => {
      const config = configOf({
        ...ANSWERS,
        lanSubnet: '192.168.1.0/24',
        vpnAddresses: '10.64.0.2/32',
      });
      expect(config.network).toEqual({ bind: 'lan', lan_subnet: '192.168.1.0/24' });
      expect(config.vpn?.addresses).toBe('10.64.0.2/32');
    });
  ```

In `packages/cli/src/init.test.ts`:

- replace `capture` with a version that records the questions:

  ```ts
  function capture(answers?: string[]) {
    const out: string[] = [];
    const err: string[] = [];
    const questions: string[] = [];
    const io: Io = {
      stdout: (text) => {
        out.push(text);
      },
      stderr: (text) => {
        err.push(text);
      },
      env: {},
      ...(answers === undefined
        ? {}
        : {
            ask: (question: string) => {
              questions.push(question);
              return Promise.resolve(answers.shift() ?? '');
            },
          }),
    };
    return {
      io,
      questions,
      stdout: () => out.join(''),
      stderr: () => err.join(''),
    };
  }
  ```

- replace "asks on a terminal for what the flags leave out" with:

  ```ts
    it('asks on a terminal for what the flags leave out', async () => {
      const home = await newHome();
      const term = capture(['plex', '/srv/media', '', 'localhost', 'n', '', '']);
      expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
      expect(term.questions).toEqual([
        'Media server, jellyfin or plex [jellyfin]: ',
        'Data folder for downloads and media [/srv/data]: ',
        'VPN provider for qBittorrent, e.g. mullvad (empty for none): ',
        'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [lan]: ',
        'Ask for a login from your own network too? [Y/n] ',
        'Admin user name for the apps [admin]: ',
        'Generate the admin password? [Y/n] ',
      ]);
      const config = await stackIn(home);
      expect(config).toMatchObject({
        media_server: 'plex',
        paths: { data: '/srv/media' },
        network: { bind: 'localhost' },
        security: { login_on_lan: false },
        admin: { username: 'admin' },
      });
      expect(config.vpn).toBeUndefined();
      expect(config.admin.password).toBeUndefined();
      expect(term.stdout()).toContain(
        `Save your Plex token in ${join(home, 'secrets', 'plex-token')}.`,
      );
      expect(term.stdout()).toContain(
        'Then "mediaplane credentials" shows the admin login and where each app is.',
      );
    });

    it('asks for the VPN address, the LAN subnet and your own password file', async () => {
      const home = await newHome();
      const term = capture([
        'jellyfin',
        '/srv/data',
        'mullvad',
        '10.64.0.2/32',
        'lan',
        'y',
        '',
        'media-admin',
        'n',
        'secrets/my-admin-password',
      ]);
      expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
      expect(term.questions).toEqual([
        'Media server, jellyfin or plex [jellyfin]: ',
        'Data folder for downloads and media [/srv/data]: ',
        'VPN provider for qBittorrent, e.g. mullvad (empty for none): ',
        "Your provider's WireGuard address, if its config file has one, e.g. 10.64.0.2/32 (empty to skip): ",
        'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [lan]: ',
        'Your LAN looks like 192.168.1.0/24. Use it? [Y/n] ',
        'Ask for a login from your own network too? [Y/n] ',
        'Admin user name for the apps [admin]: ',
        'Generate the admin password? [Y/n] ',
        'File holding your password, inside the Mediaplane home [secrets/admin-password]: ',
      ]);
      expect(await stackIn(home)).toMatchObject({
        network: { bind: 'lan', lan_subnet: '192.168.1.0/24' },
        security: { login_on_lan: true },
        vpn: { provider: 'mullvad', addresses: '10.64.0.2/32' },
        admin: {
          username: 'media-admin',
          password: { file: 'secrets/my-admin-password' },
        },
      });
      expect(term.stdout()).toContain(
        `Put your admin password, at least 12 characters, in ${join(home, 'secrets', 'my-admin-password')}.`,
      );
    });

    it('lets you type the LAN subnet when the one it sees is not it', async () => {
      const home = await newHome();
      const term = capture(['jellyfin', '/srv/data', '', 'lan', 'n', '10.10.0.0/16']);
      expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
      expect(term.questions).toContain('Your LAN subnet, e.g. 192.168.1.0/24: ');
      expect((await stackIn(home)).network).toEqual({
        bind: 'lan',
        lan_subnet: '10.10.0.0/16',
      });
    });

    it("never offers a cloud VM's own subnet as your LAN: you type it", async () => {
      const home = await newHome();
      const term = capture(['jellyfin', '/srv/data', '', 'lan', '10.10.0.0/16']);
      expect(await run(['init', '--home', home], term.io, deps('Oracle Cloud'))).toBe(0);
      expect(term.questions.slice(3, 5)).toEqual([
        'Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [localhost]: ',
        'Your LAN subnet, e.g. 192.168.1.0/24: ',
      ]);
      expect((await stackIn(home)).network).toEqual({
        bind: 'lan',
        lan_subnet: '10.10.0.0/16',
      });
    });

    it('takes every answer as a flag when it cannot ask', async () => {
      const home = await newHome();
      const args = [
        'init',
        '--home',
        home,
        '--media-server',
        'jellyfin',
        '--data',
        '/srv/data',
        '--vpn-provider',
        'mullvad',
        '--vpn-addresses',
        '10.64.0.2/32',
        '--bind',
        'lan',
        '--lan-subnet',
        '192.168.1.0/24',
        '--admin-user',
        'media-admin',
        '--admin-password-file',
        'secrets/admin-password',
      ];
      expect(await run(args, capture().io, deps())).toBe(0);
      expect(await stackIn(home)).toMatchObject({
        network: { bind: 'lan', lan_subnet: '192.168.1.0/24' },
        vpn: { addresses: '10.64.0.2/32' },
        admin: { username: 'media-admin', password: { file: 'secrets/admin-password' } },
      });
    });

    it.each([
      [['--bind', 'all'], '--bind must be lan or localhost, not "all"'],
      [
        ['--admin-password-file', '/etc/fake-password'],
        '--admin-password-file must be a path inside the Mediaplane home, such as secrets/admin-password',
      ],
      [
        ['--admin-password-file', '../fake-password'],
        '--admin-password-file must be a path inside the Mediaplane home, such as secrets/admin-password',
      ],
      [['--admin-user', 'ad'], 'admin.username: must be 3 to 32 letters, digits'],
      [['--bind', 'lan', '--lan-subnet', '203.0.113.0/24'], 'a private (RFC 1918) subnet'],
      [['--vpn-addresses', '10.64.0.2/32'], '--vpn-addresses needs --vpn-provider'],
    ])('refuses %j, and writes nothing', async (extra, message) => {
      const home = await newHome();
      const term = capture();
      const args = ['init', '--home', home, '--media-server', 'jellyfin', '--data', '/srv/data'];
      expect(await run([...args, ...extra], term.io, deps())).toBe(1);
      expect(term.stderr()).toContain(message);
      await expect(stat(join(home, 'stack.yaml'))).rejects.toThrow();
    });

    it('refuses --bind lan on a cloud VM without --lan-subnet', async () => {
      const home = await newHome();
      const term = capture();
      const args = [
        'init',
        '--home',
        home,
        '--media-server',
        'jellyfin',
        '--data',
        '/srv/data',
        '--bind',
        'lan',
      ];
      expect(await run(args, term.io, deps('Oracle Cloud'))).toBe(1);
      expect(term.stderr()).toContain(
        'this looks like a VM on Oracle Cloud, where bind: lan needs your LAN subnet: add --lan-subnet, or use --bind localhost',
      );
    });
  ```

`FIXTURE_HOST` has one private address, `192.168.1.10/24`, so init offers
`192.168.1.0/24`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/config/starter.test.ts packages/cli/src/init.test.ts`

Expected: FAIL. The starter writes no `admin:` block, no `lan_subnet` and no
`addresses`; init neither asks the new questions nor knows the new flags (Commander
answers `error: unknown option '--vpn-addresses'`). `pnpm typecheck` fails too:
`StarterAnswers` has no `adminUser`.

- [ ] **Step 3: Implement the starter**

In `packages/engine/src/config/starter.ts`, replace `StarterAnswers` with:

```ts
export interface StarterAnswers {
  mediaServer: 'jellyfin' | 'plex';
  /** The data folder for downloads and media (absolute). */
  dataPath: string;
  /** Gluetun VPN provider, e.g. "mullvad"; undefined for no VPN. */
  vpnProvider: string | undefined;
  /** The WireGuard address, for providers that need one; undefined to leave it out. */
  vpnAddresses: string | undefined;
  loginOnLan: boolean;
  timezone: string;
  /** The user and group the apps run as. */
  user: { uid: number; gid: number };
  bind: 'lan' | 'localhost';
  /** Your LAN, such as 192.168.1.0/24; undefined to detect it when plan runs. */
  lanSubnet: string | undefined;
  /** The shared admin login's user name. */
  adminUser: string;
  /** A file in the home with your own admin password; undefined to have one generated. */
  adminPasswordFile: string | undefined;
}
```

and replace the array in `starterStack`, from `'network:',` through the end of the
`vpn` spread, with:

```ts
    'network:',
    answers.bind === 'localhost'
      ? '  # localhost keeps the web UIs on this machine; lan publishes them on your network.'
      : "  # lan publishes the web UIs on this machine's private address; localhost keeps them local.",
    `  bind: ${answers.bind}`,
    ...(answers.lanSubnet === undefined ? [] : [`  lan_subnet: ${scalar(answers.lanSubnet)}`]),
    'security:',
    '  # Ask for a login even from your own network.',
    `  login_on_lan: ${String(answers.loginOnLan)}`,
    'admin:',
    '  # The login for the web UIs of the apps. "mediaplane credentials" shows it.',
    `  username: ${scalar(answers.adminUser)}`,
    ...(answers.adminPasswordFile === undefined
      ? ['  # Mediaplane generates the password. For your own, add password: { file: … }.']
      : [`  password: { file: ${scalar(answers.adminPasswordFile)} }`]),
    `media_server: ${answers.mediaServer}`,
    ...(answers.mediaServer === 'plex'
      ? ['plex:', '  token: { file: secrets/plex-token }']
      : []),
    ...(vpn === undefined
      ? []
      : [
          'vpn:',
          `  provider: ${scalar(vpn)}`,
          '  private_key: { file: secrets/wg.key }',
          ...(answers.vpnAddresses === undefined
            ? []
            : [`  addresses: ${scalar(answers.vpnAddresses)}`]),
        ]),
```

- [ ] **Step 4: Implement init**

Replace `packages/cli/src/init.ts` with:

```ts
import { chmod, mkdir } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import {
  invokingUser,
  networkOf,
  parseConfig,
  STACK_PATH,
  starterStack,
  writeFileExclusive,
  type HostFacts,
  type StarterAnswers,
} from '@mediaplane/engine';
import { formatDiagnostic, printError } from './output';
import type { Io } from './run';

export const INIT_JSON_SCHEMA = 'mediaplane.init/v1';

/** Where init suggests you keep your own admin password, inside the home. */
export const DEFAULT_PASSWORD_FILE = 'secrets/admin-password';

export interface InitOptions {
  home: string;
  mediaServer?: string;
  data?: string;
  vpnProvider?: string;
  vpnAddresses?: string;
  bind?: string;
  lanSubnet?: string;
  loginOnLan: boolean;
  adminUser?: string;
  adminPasswordFile?: string;
  timezone: string;
  json?: boolean;
}

/** `mediaplane init`: write a starter stack.yaml and secrets/, never overwriting. */
export async function init(
  options: InitOptions,
  io: Io,
  host: HostFacts,
): Promise<number> {
  const asJson = options.json === true;
  const home = resolve(options.home);
  const stackPath = join(home, STACK_PATH);
  const answers = await gatherAnswers(options, io, host);
  if (typeof answers === 'string') {
    printError(answers, { json: asJson }, io);
    return 1;
  }
  const text = starterStack(answers);
  const parsed = parseConfig(text);
  if (!parsed.ok) {
    if (asJson)
      printError(parsed.diagnostics.map((d) => d.message).join('; '), { json: true }, io);
    else
      for (const diagnostic of parsed.diagnostics)
        io.stderr(formatDiagnostic(diagnostic));
    return 1;
  }
  await mkdir(home, { recursive: true });
  // All at once and only if absent, so a failed write never leaves half a stack.yaml.
  if (!(await writeFileExclusive(stackPath, text, 0o644))) {
    printError(
      `${stackPath} already exists; init never overwrites it`,
      { json: asJson },
      io,
    );
    return 1;
  }
  const secrets = join(home, 'secrets');
  await mkdir(secrets, { recursive: true });
  await chmod(secrets, 0o700);

  const next = [
    ...(answers.vpnProvider === undefined
      ? []
      : [`Put your VPN's WireGuard private key in ${join(secrets, 'wg.key')}.`]),
    ...(answers.mediaServer === 'plex'
      ? [`Save your Plex token in ${join(secrets, 'plex-token')}.`]
      : []),
    ...(answers.adminPasswordFile === undefined
      ? []
      : [
          `Put your admin password, at least 12 characters, in ${join(home, answers.adminPasswordFile)}.`,
        ]),
    `Create ${answers.dataPath} and make sure uid ${String(answers.user.uid)} (gid ${String(answers.user.gid)}) can write to it.`,
    'Run "mediaplane plan" to check everything, then "mediaplane apply".',
    'Then "mediaplane credentials" shows the admin login and where each app is.',
  ];
  if (asJson) {
    io.stdout(
      `${JSON.stringify({ schema: INIT_JSON_SCHEMA, ok: true, stackPath, next }, null, 2)}\n`,
    );
    return 0;
  }
  io.stdout(`Wrote ${stackPath}.\n`);
  if (host.cloud !== undefined && answers.bind === 'localhost') {
    io.stdout(
      `This looks like a VM on ${host.cloud}, so the web UIs stay on localhost (network.bind).\n`,
    );
  }
  io.stdout(`\nNext steps:\n${next.map((step) => `  - ${step}\n`).join('')}`);
  return 0;
}

type Ask = (question: string) => Promise<string>;

async function gatherAnswers(
  options: InitOptions,
  io: Io,
  host: HostFacts,
): Promise<StarterAnswers | string> {
  let mediaServer = options.mediaServer;
  let dataPath = options.data;
  let vpnProvider = options.vpnProvider;
  let vpnAddresses = options.vpnAddresses;
  let bind = options.bind;
  let lanSubnet = options.lanSubnet;
  let loginOnLan = options.loginOnLan;
  let adminUser = options.adminUser;
  let adminPasswordFile = options.adminPasswordFile;
  const defaultBind = host.cloud === undefined ? 'lan' : 'localhost';
  const ask = options.json === true ? undefined : io.ask;
  if (ask !== undefined) {
    mediaServer ??=
      (await ask('Media server, jellyfin or plex [jellyfin]: ')).trim() || 'jellyfin';
    dataPath ??=
      (await ask('Data folder for downloads and media [/srv/data]: ')).trim() ||
      '/srv/data';
    if (vpnProvider === undefined) {
      const answer = (
        await ask('VPN provider for qBittorrent, e.g. mullvad (empty for none): ')
      ).trim();
      vpnProvider = answer === '' ? undefined : answer;
    }
    if (vpnProvider !== undefined && vpnAddresses === undefined) {
      const answer = (
        await ask(
          "Your provider's WireGuard address, if its config file has one, e.g. 10.64.0.2/32 (empty to skip): ",
        )
      ).trim();
      vpnAddresses = answer === '' ? undefined : answer;
    }
    bind ??=
      (
        await ask(
          `Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [${defaultBind}]: `,
        )
      ).trim() || defaultBind;
    if (bind === 'lan' && lanSubnet === undefined) lanSubnet = await askLanSubnet(ask, host);
    if (loginOnLan) {
      loginOnLan = !/^n/i.test(
        (await ask('Ask for a login from your own network too? [Y/n] ')).trim(),
      );
    }
    adminUser ??= (await ask('Admin user name for the apps [admin]: ')).trim() || 'admin';
    if (
      adminPasswordFile === undefined &&
      /^n/i.test((await ask('Generate the admin password? [Y/n] ')).trim())
    ) {
      adminPasswordFile =
        (
          await ask(
            `File holding your password, inside the Mediaplane home [${DEFAULT_PASSWORD_FILE}]: `,
          )
        ).trim() || DEFAULT_PASSWORD_FILE;
    }
  }
  if (mediaServer === undefined || dataPath === undefined) {
    return 'init needs --media-server and --data when it cannot ask (with --json, or when not run in a terminal)';
  }
  if (mediaServer !== 'jellyfin' && mediaServer !== 'plex') {
    return `--media-server must be jellyfin or plex, not "${mediaServer}"`;
  }
  bind ??= defaultBind;
  if (bind !== 'lan' && bind !== 'localhost') {
    return `--bind must be lan or localhost, not "${bind}"`;
  }
  if (bind === 'lan' && host.cloud !== undefined && lanSubnet === undefined) {
    return `this looks like a VM on ${host.cloud}, where bind: lan needs your LAN subnet: add --lan-subnet, or use --bind localhost`;
  }
  if (adminPasswordFile !== undefined && !insideHome(adminPasswordFile)) {
    return `--admin-password-file must be a path inside the Mediaplane home, such as ${DEFAULT_PASSWORD_FILE}`;
  }
  // The starter writes the address only in a vpn: block, so say so rather than drop it.
  if (vpnAddresses !== undefined && vpnProvider === undefined) {
    return '--vpn-addresses needs --vpn-provider';
  }
  return {
    mediaServer,
    dataPath,
    vpnProvider,
    vpnAddresses,
    loginOnLan,
    timezone: options.timezone,
    user: invokingUser(),
    bind,
    lanSubnet,
    adminUser: adminUser ?? 'admin',
    adminPasswordFile,
  };
}

/**
 * The LAN subnet: the one this host is on, if there is exactly one and you agree. A cloud
 * VM's private network is not a LAN, so there you always type it.
 */
async function askLanSubnet(ask: Ask, host: HostFacts): Promise<string | undefined> {
  const seen = [...new Set(host.privateAddresses.map((a) => networkOf(a.cidr)))];
  const [only] = seen;
  if (host.cloud === undefined && seen.length === 1 && only !== undefined) {
    const answer = (await ask(`Your LAN looks like ${only}. Use it? [Y/n] `)).trim();
    if (!/^n/i.test(answer)) return only;
  }
  const typed = (await ask('Your LAN subnet, e.g. 192.168.1.0/24: ')).trim();
  return typed === '' ? undefined : typed;
}

/** Whether `path` names a file inside the home, which is all the container sees. */
function insideHome(path: string): boolean {
  return !isAbsolute(path) && normalize(path).split('/')[0] !== '..';
}
```

In `packages/cli/src/run.ts`, in the `init` command, replace the options from
`.option('--vpn-provider <name>', …)` through `.option('--no-login-on-lan', …)` with:

```ts
    .option(
      '--vpn-provider <name>',
      'Gluetun VPN provider, e.g. mullvad; leave out for no VPN',
    )
    .option(
      '--vpn-addresses <cidr>',
      "your VPN provider's WireGuard address, if its config file has one, e.g. 10.64.0.2/32",
    )
    .option(
      '--bind <where>',
      'lan or localhost: publish the web UIs on your LAN, or keep them on this machine (default lan, or localhost on a cloud VM)',
    )
    .option(
      '--lan-subnet <cidr>',
      'your LAN with --bind lan, e.g. 192.168.1.0/24 (default: detected when plan runs)',
    )
    .option('--no-login-on-lan', "don't ask for a login from your own network")
    .option('--admin-user <name>', 'the admin user name for the apps (default admin)')
    .option(
      '--admin-password-file <path>',
      'a file inside the home holding your own admin password, at least 12 characters (default: Mediaplane generates one)',
    )
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run packages scripts`

Expected: PASS. The existing init tests still pass: "keeps the web UIs on localhost on a
cloud VM" gets `localhost` as the default, and still prints its note.

- [ ] **Step 6: Regenerate the CLI reference, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages docs/reference
git commit -m "feat(cli): init asks for the admin login, the LAN and the VPN address" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: End-to-end: the seeded files and qBittorrent's login on real Docker

What S3a proves on real Docker (rulings, the S3a "Proves" column):

- after `apply`, each Servarr `config.xml` holds the key Mediaplane generated;
- qBittorrent's `auth/login` takes the shared password that
  `mediaplane credentials --json --reveal` shows (204), and its Bearer key works (200);
- qBittorrent's log has no temporary password;
- a second `apply` reports no changes and leaves the files alone.

It must not claim the Servarr admin login: that is S3b's.

Decision: these checks extend the existing apply test's stack (`stackFor`: Sonarr,
Radarr, Prowlarr, qBittorrent without the VPN, Seerr, Jellyfin, `bind: localhost`), which
already starts every app. A second stack would add about three minutes on each CI runner.
Gluetun's key file is covered by unit tests here; S3d's kill-switch test runs Gluetun for
real.

**Files:**
- Modify: `test/e2e/apply.e2e.test.ts`, `test/e2e/plan.e2e.test.ts`, `test/e2e/helpers.ts`

**Interfaces:**
- **Consumes:** `apply`, `readSecretStore`, the `credentials` command (Task 9), `REPO`
  from the helpers, `PlanResult.files[].prestart` (Task 5).
- **Produces:** nothing new.

- [ ] **Step 1: Write the checks**

In `test/e2e/apply.e2e.test.ts`:

- replace the import from `'@mediaplane/engine'` with:

  ```ts
  import {
    apply,
    COMPOSE_PATH,
    createDockerRuntime,
    detectHostFacts,
    nodeExec,
    nodeProbe,
    readSecretStore,
    renderEnvFile,
    type ApplyOptions,
    type ExecResult,
  } from '@mediaplane/engine';
  ```

- change the helpers import to
  `import { BUSYBOX, composeDown, ejectArguments, makeHome, REPO } from './helpers';`;
- add after the `PROJECT` constant:

  ```ts
  const MAIN = join(REPO, 'packages', 'cli', 'src', 'main.ts');

  /** `mediaplane <args>`, run from source as a user would, for the test's project. */
  function mediaplane(...args: string[]): Promise<ExecResult> {
    return nodeExec(process.execPath, ['--import', 'tsx', MAIN, ...args], {
      cwd: REPO,
      env: { ...process.env, MEDIAPLANE_COMPOSE_PROJECT: PROJECT },
      timeoutMs: 120_000,
    });
  }

  /** The pre-start files every apply of the video stack plans. */
  const PRESTART = [
    'appdata/prowlarr/config.xml',
    'appdata/qbittorrent/qBittorrent/qBittorrent.conf',
    'appdata/radarr/config.xml',
    'appdata/sonarr/config.xml',
  ];
  ```

- in "starts the video stack healthy, then has nothing left to do", insert after
  `expect((await stat(join(home, 'appdata', 'seerr'))).uid).toBe(1000);`:

  ```ts
      // Slice 3a: the files Mediaplane wrote before the apps first started.
      expect(
        first.plan.files.filter((f) => f.prestart === true).map((f) => [f.path, f.status]),
      ).toEqual(PRESTART.map((path) => [path, 'create']));
      const store = await readSecretStore(home);
      for (const app of ['prowlarr', 'radarr', 'sonarr']) {
        const xml = await readFile(join(home, 'appdata', app, 'config.xml'), 'utf8');
        expect(xml).toContain(`<ApiKey>${store.apps[app]?.apiKey ?? 'none stored'}</ApiKey>`);
      }

      // qBittorrent takes the shared login that credentials shows, and its own key.
      const shown = await mediaplane('credentials', '--home', home, '--json', '--reveal');
      expect(shown.code, shown.stderr).toBe(0);
      const login = JSON.parse(shown.stdout) as {
        username: string;
        password: string;
        apps: { app: string; urls: string[]; login: string }[];
      };
      expect(login.apps.find((a) => a.app === 'qbittorrent')).toMatchObject({
        login: 'shared',
        urls: ['http://127.0.0.1:8080'],
      });
      const signIn = await fetch('http://127.0.0.1:8080/api/v2/auth/login', {
        method: 'POST',
        body: new URLSearchParams({ username: login.username, password: login.password }),
      });
      expect(signIn.status).toBe(204);
      const version = await fetch('http://127.0.0.1:8080/api/v2/app/version', {
        headers: { authorization: `Bearer ${store.apps.qbittorrent?.apiKey ?? ''}` },
      });
      expect(version.status).toBe(200);
      const qbittorrent = containers.find((c) => c.service === 'qbittorrent');
      const log = await nodeExec('docker', ['logs', qbittorrent?.id ?? 'missing'], {
        cwd: '/',
      });
      expect(log.code, log.stderr).toBe(0);
      expect(log.stdout + log.stderr).not.toMatch(/temporary password/i);
  ```

- replace `expect(second.outcome).toBe('no-changes');` with:

  ```ts
      expect(second.outcome).toBe('no-changes');
      // Nothing ran, so nothing was written: the files are the apps' own from now on.
      expect(second.actions).toEqual([]);
      expect(
        second.plan.files.filter((f) => f.prestart === true).map((f) => [f.path, f.status]),
      ).toEqual(PRESTART.map((path) => [path, 'unchanged']));
  ```

In `test/e2e/plan.e2e.test.ts`, add at the end of "plans the whole video stack, accepted
by Compose":

```ts
    expect(
      result.files.filter((f) => f.prestart === true).map((f) => [f.path, f.status]),
    ).toEqual([
      ['appdata/prowlarr/config.xml', 'create'],
      ['appdata/qbittorrent/qBittorrent/qBittorrent.conf', 'create'],
      ['appdata/radarr/config.xml', 'create'],
      ['appdata/sonarr/config.xml', 'create'],
    ]);
```

In `test/e2e/helpers.ts`, change the first line of `stackFor`'s doc comment to
` * The M1 video stack without the VPN (the VPN gets its own end-to-end test in Slice 3d).`

- [ ] **Step 2: Run the type check, then the two tests**

```bash
pnpm typecheck && pnpm lint
docker volume ls -q | wc -l
ls -d "$(node -p 'require("os").tmpdir()')"/mediaplane-e2e-* 2>/dev/null | wc -l
pnpm test:e2e test/e2e/plan.e2e.test.ts test/e2e/apply.e2e.test.ts
```

Write down the two counts: Step 3 compares against them. Expected: both e2e files PASS
(about 30 seconds on the dev box with the images cached). If qBittorrent's login gives
401, check the conf's hash line first (Task 8); if it gives a connection error, check that
nothing else on this host listens on 8080.

- [ ] **Step 3: Run the whole end-to-end suite, and look for leftovers**

```bash
pnpm test:e2e
docker ps -a --filter name=mediaplane-e2e --format '{{.Names}}'
docker ps -a --filter label=io.mediaplane.helper --format '{{.Names}}'
docker image ls --format '{{.Repository}}:{{.Tag}}' | grep '^mediaplane-e2e' || true
docker volume ls -q | wc -l
ls -d "$(node -p 'require("os").tmpdir()')"/mediaplane-e2e-* 2>/dev/null | wc -l
```

Expected:
- every end-to-end file passes, including `deploy.e2e.test.ts`, whose image now writes
  the pre-start files from inside the Mediaplane container;
- the three `docker`/`grep` listings print nothing;
- the volume count and the `mediaplane-e2e-*` folder count equal those from Step 2.
  Folders left by runs from before Task 1 may exist; the suite adds none.

- [ ] **Step 4: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add test/e2e
git commit -m "test(e2e): check the seeded files and qBittorrent's shared login" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Docs: threat model, app READMEs, install guide, architecture, spec §11, roadmap

Every slice writes its spec §9 docs as it goes (owner, 2026-10-09). The generated
references were refreshed by the tasks that changed them (3, 4, 7, 9, 10). This task
writes the hand-written ones. Every statement must be true of the code as it now is;
anything planned names its slice. Diagrams stay within 40 columns, in `text` blocks.

**Files:**
- Modify: `docs/security/threat-model.md`
- Modify: `catalog/sonarr/README.md`, `catalog/radarr/README.md`,
  `catalog/prowlarr/README.md`, `catalog/qbittorrent/README.md`,
  `catalog/gluetun/README.md`
- Modify: `deploy/README.md`, `docs/architecture.md`, `README.md`
- Modify: `docs/design/m1-engine-cli.md` (§5.2, §11), `docs/plans/m1-roadmap.md`

**Interfaces:**
- **Consumes:** what Tasks 1 to 11 built, and only that.
- **Produces:** the "Set up before Slice 3a" sections that the `<app>.not-seeded` hint
  (Task 5) points to, in the Sonarr, Radarr, Prowlarr, qBittorrent and Gluetun READMEs.

- [ ] **Step 1: The threat model**

In `docs/security/threat-model.md`:

1. In the first paragraph, change `up to and including Slice 2c` to
   `up to and including Slice 3a`.
2. In "What it protects", replace the row that starts `| Generated API keys` with these
   two rows (`pnpm format` realigns the table):

   ```markdown
   | Generated API keys | `state/secrets.json` and `generated/.env`, both 0600, and the apps' own files in `appdata/` | They open the apps' APIs |
   | The shared admin password | `state/secrets.json` (0600), or your own `admin.password` file | It opens qBittorrent today, and more apps from Slice 3b |
   ```

3. In "What runs, and who can reach it", replace the bullet that starts
   `- **The apps.**` with:

   ```markdown
   - **The apps.**
     - They are unmodified upstream images, pinned by digest, and never get the Docker
       socket.
     - Only their web UIs are published, bound as `network.bind` says. Everything else stays
       on the stack's own Docker network.
     - Before an app's first start, Mediaplane writes the files it reads when it starts:
       Sonarr's, Radarr's and Prowlarr's `config.xml`, qBittorrent's `qBittorrent.conf` and
       Gluetun's `auth/config.toml`. Each is written once, 0600, and only if absent.
     - With a VPN, qBittorrent has no network of its own. It uses Gluetun's, so it has no
       route out when the VPN is down. The automated test for that arrives in Slice 3d.
     - Gluetun's control server (port 8000) is never published, and answers only requests
       that carry Mediaplane's key (see T11; Slice 3d's end-to-end test checks this).
   ```

4. In T2, replace everything from `Controls today:` to the end of the section with:

   ```markdown
   Controls today:

   - Only web UIs are published: on the host's private addresses (`lan`), on localhost, or
     on every interface with a warning (`all`).
   - qBittorrent asks for the shared admin login from its first start. Mediaplane writes
     the login into `qBittorrent.conf` before qBittorrent runs, so the image never starts
     with its temporary password. It asks on localhost too.
   - Sonarr, Radarr and Prowlarr ask for a login from the LAN too, by default
     (`security.login_on_lan`).
   - With `login_on_lan: false`, qBittorrent lets only `network.lan_subnet` skip its
     login, and only while the web UIs are on the LAN. Sonarr, Radarr and Prowlarr let
     any local address in (see What remains). The subnet must be private (RFC 1918): a
     public range, or `0.0.0.0/0`, is refused.

   What remains:

   - On a home network, `init` offers `bind: lan`, so the web UIs are on your LAN.
   - Until the wiring lands (Slices 6 and 7), Jellyfin's wizard and Seerr's setup are open
     to whoever reaches them first. Complete them right after the first `apply`, or keep
     `bind: localhost` until you have.
   - Sonarr, Radarr and Prowlarr have no user until Slice 3b creates the shared admin
     there, or you do. Until then, with `login_on_lan: true` nobody can sign in, and with
     `false` anyone on a local address gets in without a login. For them, "local" means
     any private address, not just `lan_subnet`.
   ```

5. In T3, in "Controls today", replace the bullet that starts
   `` - On a detected cloud VM, `init` writes `bind: localhost` `` (two lines) with these
   two:

   ```markdown
   - On a detected cloud VM, `init` suggests `bind: localhost`, and `lan` needs a LAN
     subnet: `init` asks you to type it, never offering the VM's own, and `plan` refuses
     `bind: lan` unless `network.lan_subnet` is set.
   - On a cloud VM, Mediaplane trusts no LAN subnet unless `network.lan_subnet` names one:
     no login bypass, and no way in through Gluetun's firewall. `plan` warns
     (`network.no-lan-subnet`) when the web UIs are on the LAN without a known subnet.
   ```

6. In T5, add to "Controls today", after the `Given to Compose…` bullet:

   ```markdown
   - The files apps read at their first start are written 0600, all at once, and never
     over an existing file. `plan` lists them without their content.
   ```

   and in "What remains", replace `` - `appdata/` holds credentials too: treat it as
   sensitive. `` with:

   ```markdown
   - `appdata/` holds credentials too: the apps' keys, and qBittorrent's password hash.
     qBittorrent rewrites its file readable by every user on the host (0644). Treat
     `appdata/` as sensitive, and keep other users out of the home.
   ```

7. Add after T9:

   ```markdown
   ### T10. One password opens every app

   Controls today:

   - The shared admin password is generated with `crypto.randomBytes`: 24 letters and
     digits, about 143 bits. It is kept in `state/secrets.json` (0600).
   - A password of your own (`admin.password`) must be at least 12 characters.
   - `mediaplane credentials` shows it. Its `--json` output leaves it out unless you add
     `--reveal`. `plan`, `apply`, errors and change records never show it.
   - qBittorrent keeps only a hash of it: PBKDF2-HMAC-SHA512, 100 000 rounds, with a
     random salt.

   What remains:

   - One password opens every app that uses it: qBittorrent today, Sonarr, Radarr and
     Prowlarr from Slice 3b, and Jellyfin from Slice 6. A leak from one is a leak for all.
   - From Slice 3b, Sonarr, Radarr and Prowlarr give their password hash to anyone who
     holds their API key. Prowlarr holds Sonarr's and Radarr's keys from Slice 5.
   - Changing `admin.username`, `admin.password` or `login_on_lan` after qBittorrent's
     first start doesn't reach qBittorrent, whose file is written only once. Slice 3c
     manages those settings through its API.

   ### T11. Something on the stack's network uses Gluetun's control server

   Controls today:

   - Its port, 8000, is never published.
   - Before Gluetun's first start, Mediaplane writes `appdata/gluetun/auth/config.toml`. It
     gives a generated key two read-only routes, `GET /v1/vpn/status` and
     `GET /v1/publicip/ip`, and nothing else. Requests without the key are refused
     (Slice 3d's end-to-end test checks this). Without that file, Gluetun v3.41 answers
     anyone on the stack's network.

   What remains:

   - A Gluetun that started before Slice 3a reads the file only when it next starts.
   - The key is kept in `state/secrets.json` and in Gluetun's appdata, both 0600.
   ```

- [ ] **Step 2: Sonarr's, Radarr's and Prowlarr's READMEs**

In `catalog/sonarr/README.md`, replace everything from `## What Mediaplane does today`
up to, not including, `## Changing it` with:

```markdown
## What Mediaplane does today

- **Its API key.** Generated once, and passed in `SONARR__AUTH__APIKEY`.
- **`config.xml`, before its first start.** Mediaplane writes
  `appdata/sonarr/config.xml` with the API key and the login settings below, only if the
  file doesn't exist. Sonarr keeps them and adds the rest of its settings, so it keeps
  its key even if the variable is ever lost. Mediaplane never writes the file again.
- **Its login.** `SONARR__AUTH__METHOD` is `Forms`. `SONARR__AUTH__REQUIRED` is
  `Enabled`, or `DisabledForLocalAddresses` when `security.login_on_lan` is `false`. In
  that case, while the web UI is published on your LAN (`network.bind` `lan` or `all`),
  `SONARR__SERVER__TRUSTEDNETWORKS` lists your LAN subnet.
- **What it needs.** A download client. Listing Sonarr does not turn one on: list
  `qbittorrent` too, or `plan` reports an error.
- **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
  address.

## Not built yet

The wiring arrives in Slices 3b to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):

- **Slice 3b:** the shared admin login, which `mediaplane credentials` shows.
- **Slice 3c:** qBittorrent as its download client, and the `/data/media/tv` root folder.
- **Slice 5:** Prowlarr's link to it.
- **Slice 6:** the media server connection that refreshes your library on import.
- **Slice 7:** Seerr's link to it.

```

and replace everything from `## Known issues` to the end of the file with:

````markdown
## Known issues

- **No one can sign in yet.** Mediaplane turns the forms login on, but no user exists
  until Slice 3b creates the shared admin login.
  - With the default `security.login_on_lan: true`, Sonarr shows a login page that has no
    account to sign in to.
  - With `security.login_on_lan: false`, anyone who reaches Sonarr from a local address
    (a private network such as your LAN) gets in without a login.
  - To get in today, set `security.login_on_lan: false`, run `apply`, and set a user name
    and password under Settings, General, Security. Then set `login_on_lan` back to
    `true` and run `apply` again. While `login_on_lan` is `false`, anyone on your network
    gets in, so do this straight away, or keep `network.bind: localhost` while you do.
    From Slice 3b, `apply` sets the shared admin login instead.
- **Set up before Slice 3a.** If Sonarr first started before Mediaplane wrote its
  `config.xml`, the file has no API key, and `plan` stops with `sonarr.not-seeded`. To fix
  it, stop Sonarr, delete the file, and apply again: Mediaplane writes a new one before
  Sonarr starts. You lose the settings kept in that file, such as a URL base you set in
  Sonarr. Your library and history stay.

  ```bash
  docker stop mediaplane-sonarr-1
  rm /opt/mediaplane/appdata/sonarr/config.xml
  mediaplane apply
  ```

  Use your own home, and the container name `docker ps` shows. Use `sudo rm` if your user
  doesn't own the file. Slice 4 does this for you.
````

In `catalog/radarr/README.md`, replace everything from `## What Mediaplane does today` up
to, not including, `## Changing it` with:

```markdown
## What Mediaplane does today

- **Its API key.** Generated once, and passed in `RADARR__AUTH__APIKEY`.
- **`config.xml`, before its first start.** Mediaplane writes
  `appdata/radarr/config.xml` with the API key and the login settings below, only if the
  file doesn't exist. Radarr keeps them and adds the rest of its settings, so it keeps
  its key even if the variable is ever lost. Mediaplane never writes the file again.
- **Its login.** `RADARR__AUTH__METHOD` is `Forms`. `RADARR__AUTH__REQUIRED` is
  `Enabled`, or `DisabledForLocalAddresses` when `security.login_on_lan` is `false`. In
  that case, while the web UI is published on your LAN (`network.bind` `lan` or `all`),
  `RADARR__SERVER__TRUSTEDNETWORKS` lists your LAN subnet.
- **What it needs.** A download client. Listing Radarr does not turn one on: list
  `qbittorrent` too, or `plan` reports an error.
- **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
  address.

## Not built yet

The wiring arrives in Slices 3b to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):

- **Slice 3b:** the shared admin login, which `mediaplane credentials` shows.
- **Slice 3c:** qBittorrent as its download client, and the `/data/media/movies` root
  folder.
- **Slice 5:** Prowlarr's link to it.
- **Slice 6:** the media server connection that refreshes your library on import.
- **Slice 7:** Seerr's link to it.

```

and replace everything from `## Known issues` to the end of the file with:

````markdown
## Known issues

- **No one can sign in yet.** Mediaplane turns the forms login on, but no user exists
  until Slice 3b creates the shared admin login.
  - With the default `security.login_on_lan: true`, Radarr shows a login page that has no
    account to sign in to.
  - With `security.login_on_lan: false`, anyone who reaches Radarr from a local address
    (a private network such as your LAN) gets in without a login.
  - To get in today, set `security.login_on_lan: false`, run `apply`, and set a user name
    and password under Settings, General, Security. Then set `login_on_lan` back to
    `true` and run `apply` again. While `login_on_lan` is `false`, anyone on your network
    gets in, so do this straight away, or keep `network.bind: localhost` while you do.
    From Slice 3b, `apply` sets the shared admin login instead.
- **Set up before Slice 3a.** If Radarr first started before Mediaplane wrote its
  `config.xml`, the file has no API key, and `plan` stops with `radarr.not-seeded`. To fix
  it, stop Radarr, delete the file, and apply again: Mediaplane writes a new one before
  Radarr starts. You lose the settings kept in that file, such as a URL base you set in
  Radarr. Your library and history stay.

  ```bash
  docker stop mediaplane-radarr-1
  rm /opt/mediaplane/appdata/radarr/config.xml
  mediaplane apply
  ```

  Use your own home, and the container name `docker ps` shows. Use `sudo rm` if your user
  doesn't own the file. Slice 4 does this for you.
````

In `catalog/prowlarr/README.md`, replace everything from `## What Mediaplane does today`
up to, not including, `## What stays yours` with:

```markdown
## What Mediaplane does today

- **Its API key.** Generated once, and passed in `PROWLARR__AUTH__APIKEY`.
- **`config.xml`, before its first start.** Mediaplane writes
  `appdata/prowlarr/config.xml` with the API key and the login settings below, only if
  the file doesn't exist. Prowlarr keeps them and adds the rest of its settings, so it
  keeps its key even if the variable is ever lost. Mediaplane never writes the file again.
- **Its login.** `PROWLARR__AUTH__METHOD` is `Forms`. `PROWLARR__AUTH__REQUIRED` is
  `Enabled`, or `DisabledForLocalAddresses` when `security.login_on_lan` is `false`. In
  that case, while the web UI is published on your LAN (`network.bind` `lan` or `all`),
  `PROWLARR__SERVER__TRUSTEDNETWORKS` lists your LAN subnet.
- **Byparr.** Listing Prowlarr also turns on Byparr, the Cloudflare challenge solver,
  unless you list FlareSolverr instead or set `byparr: { enabled: false }`.
- **Its web UI,** published as `network.bind` says. `mediaplane credentials` shows its
  address.

```

replace the `## Not built yet` section, up to, not including, `## Changing it`, with:

```markdown
## Not built yet

- **Slice 3b:** the shared admin login, which `mediaplane credentials` shows.
- **Slice 5:**
  - the links to Sonarr and Radarr, with full sync;
  - Byparr registered as Prowlarr's indexer proxy, with the tag `cloudflare`. Tag your
    Cloudflare-protected indexers `cloudflare` to route them through it.

See the [roadmap](../../docs/plans/m1-roadmap.md).

```

and replace everything from `## Known issues` to the end of the file with:

````markdown
## Known issues

- **No one can sign in yet.** Mediaplane turns the forms login on, but no user exists
  until Slice 3b creates the shared admin login.
  - With the default `security.login_on_lan: true`, Prowlarr shows a login page that has
    no account to sign in to.
  - With `security.login_on_lan: false`, anyone who reaches Prowlarr from a local address
    (a private network such as your LAN) gets in without a login.
  - To get in today, set `security.login_on_lan: false`, run `apply`, and set a user name
    and password under Settings, General, Security. Then set `login_on_lan` back to
    `true` and run `apply` again. While `login_on_lan` is `false`, anyone on your network
    gets in, so do this straight away, or keep `network.bind: localhost` while you do.
    From Slice 3b, `apply` sets the shared admin login instead.
- **Set up before Slice 3a.** If Prowlarr first started before Mediaplane wrote its
  `config.xml`, the file has no API key, and `plan` stops with `prowlarr.not-seeded`. To
  fix it, stop Prowlarr, delete the file, and apply again: Mediaplane writes a new one
  before Prowlarr starts. You lose the settings kept in that file, such as a URL base you
  set in Prowlarr. Your indexers stay.

  ```bash
  docker stop mediaplane-prowlarr-1
  rm /opt/mediaplane/appdata/prowlarr/config.xml
  mediaplane apply
  ```

  Use your own home, and the container name `docker ps` shows. Use `sudo rm` if your user
  doesn't own the file. Slice 4 does this for you.
````

- [ ] **Step 3: qBittorrent's and Gluetun's READMEs**

In `catalog/qbittorrent/README.md`, replace everything from
`## What Mediaplane does today` up to, not including, `## Changing it` with:

```markdown
## What Mediaplane does today

- **Behind the VPN** (`apps.qbittorrent.vpn: true`, the default):
  - qBittorrent uses Gluetun's network (`network_mode: service:gluetun`), so its traffic
    leaves through Gluetun's VPN tunnel and firewall;
  - it starts only once Gluetun is healthy, and Compose restarts it when it updates
    Gluetun;
  - its web UI is published on Gluetun's service;
  - `stack.yaml` needs a `vpn:` block, or `plan` reports an error.
- **Without the VPN** (`vpn: false`), it has its own network, and `plan` warns every time.
- **One port, inside and out.** qBittorrent checks the `Host` header, so the published
  port and its own port must match. `apps.qbittorrent.port` changes both, through
  `WEBUI_PORT`, and `apps.qbittorrent.env` refuses `WEBUI_PORT`.
- **`qBittorrent.conf`, before its first start.** Mediaplane writes
  `appdata/qbittorrent/qBittorrent/qBittorrent.conf`, only if it doesn't exist, with:
  - **the shared admin login:** the user name, and a PBKDF2 hash of the password, never
    the password itself. `mediaplane credentials` shows the login;
  - **its API key** (`WebUI\APIKey`), generated once and kept in `state/secrets.json`.
    Other apps use it from Slice 3c, as `Authorization: Bearer`;
  - **the save path** `/data/torrents/`;
  - **Automatic Torrent Management on,** so a torrent follows its category's save path.
    That includes torrents you add by hand;
  - **UPnP off,** so nothing opens a port on your router;
  - **a login on localhost too** (`WebUI\LocalHostAuth`);
  - **your LAN without a login** (`WebUI\AuthSubnetWhitelist`), only with
    `security.login_on_lan: false` and the web UI published on your LAN. It lists your LAN
    subnets, separated by commas. If Mediaplane knows no LAN subnet, `plan` warns
    (`network.no-lan-subnet`).

  qBittorrent keeps these and adds its own settings, and starts with no temporary
  password. Mediaplane never writes the file again: from then on, change settings in
  qBittorrent's web UI.

## Not built yet

- **Slice 3c:** the `tv` and `movies` categories, with save paths under
  `/data/torrents/`, and the settings above managed through qBittorrent's API.
- **Slice 3d:** the automated kill-switch test, which checks that qBittorrent has no
  network when the VPN is down, and `mediaplane vpn-check`.

See the [roadmap](../../docs/plans/m1-roadmap.md).

```

and replace everything from `## Known issues` to the end of the file with:

````markdown
## Known issues

- **`stack.yaml` reaches qBittorrent only at its first start.** Changing
  `admin.username`, `admin.password`, `security.login_on_lan` or `network.lan_subnet`
  afterwards doesn't change qBittorrent, until Slice 3c manages them through its API.
  Change them in qBittorrent's settings meanwhile.
- **Set up before Slice 3a.** If qBittorrent first started before Mediaplane wrote its
  `qBittorrent.conf`, it runs with the image's own file. That file has no API key, and
  gives a new temporary password at every start. `plan` stops with
  `qbittorrent.not-seeded`. To fix it, stop qBittorrent, delete the file, and apply again:
  Mediaplane writes a new one before qBittorrent starts. You lose the settings kept in
  that file, such as speed limits. Your torrents stay.

  ```bash
  docker stop mediaplane-qbittorrent-1
  rm /opt/mediaplane/appdata/qbittorrent/qBittorrent/qBittorrent.conf
  mediaplane apply
  ```

  Stop it first: qBittorrent writes the file again when it stops. Use your own home, and
  the container name `docker ps` shows. Use `sudo rm` if your user doesn't own the file.
  Slice 4 does this for you.
````

In `catalog/gluetun/README.md`, replace everything from `## What Mediaplane does today`
up to, not including, `## Changing it` with:

```markdown
## What Mediaplane does today

- **The VPN, from `stack.yaml`'s `vpn:` block:**
  - `VPN_SERVICE_PROVIDER` is `vpn.provider`, and `VPN_TYPE` is `wireguard`;
  - `WIREGUARD_PRIVATE_KEY` comes from `vpn.private_key`, through `generated/.env`, so it
    never appears in `compose.yaml`;
  - `WIREGUARD_ADDRESSES` is `vpn.addresses`, when you set it. `mediaplane init` asks for
    it.
- **Your LAN.** While the web UIs are published on your LAN (`network.bind` `lan` or
  `all`), `FIREWALL_OUTBOUND_SUBNETS` lists your LAN subnet, so that your own network can
  reach qBittorrent's web UI. With `bind: localhost` it is left out: Docker on this
  machine reaches the web UI from the stack's own network, which Gluetun already lets
  through (Slice 3d's end-to-end test checks this). If the web UIs are on your LAN but
  Mediaplane knows no LAN subnet, such as on a cloud VM without `network.lan_subnet`,
  `plan` warns (`network.no-lan-subnet`).
- **What it needs from the host.** It gets `NET_ADMIN` and `/dev/net/tun`, and `plan`
  reports an error when `/dev/net/tun` is missing.
- **Its control server** (port 8000) is never published. Apps in its network must not
  use port 8000.
- **A key for the control server, before its first start.** Mediaplane writes
  `appdata/gluetun/auth/config.toml`, only if it doesn't exist. It lets a generated key
  (`controlApiKey`, kept in `state/secrets.json`) read `GET /v1/vpn/status` and
  `GET /v1/publicip/ip`, and nothing else. Requests without the key are refused
  (Slice 3d's end-to-end test checks this). Without the file, Gluetun answers anyone on
  the stack's network. Slice 3d's `mediaplane vpn-check` uses the key.

## Not built yet

- **Slice 3d:** the automated kill-switch test, against a local WireGuard server, and
  `mediaplane vpn-check`, which compares qBittorrent's public address with the host's.

See the [roadmap](../../docs/plans/m1-roadmap.md).

```

and replace everything from `## Known issues` to the end of the file with:

```markdown
## Known issues

- **A wrong key never connects.** Gluetun's health check needs a working tunnel. With a
  wrong or fake key, Gluetun never becomes healthy and keeps retrying. `apply` then fails
  within about half a minute, naming `gluetun` as unhealthy, and qBittorrent does not
  start.
- **Set up before Slice 3a.** A Gluetun that was already running reads its key file only
  when it next starts: restart it once, with `docker restart mediaplane-gluetun-1`. If
  `appdata/gluetun/auth/config.toml` was there already, without an `apikey` line, `plan`
  stops with `gluetun.not-seeded`. Keep a copy of your own roles, delete the file and
  apply again, then add your roles below Mediaplane's and restart Gluetun.
```

- [ ] **Step 4: The install guide**

In `deploy/README.md`:

1. Replace the quoted pre-alpha banner (the `>` lines after the first paragraph) with:

   ```markdown
   > Mediaplane is pre-alpha. The apps are not wired together yet (Slices 3b to 7 do that).
   > On a home network, `init` offers to publish their web UIs on your LAN. Until the
   > wiring lands:
   >
   > - Jellyfin's setup wizard and Seerr's setup are open to anyone on your LAN until you
   >   complete them, so complete them first;
   > - Sonarr, Radarr and Prowlarr ask for a login that has no user yet (Slice 3b creates
   >   it).
   >
   > qBittorrent has the shared admin login from its first start: `mediaplane credentials`
   > shows it. To keep the web UIs on this machine only, answer `localhost` when `init`
   > asks (see [First run](#first-run)).
   ```

2. In "First run", replace the code block with:

   ```bash
   mediaplane init         # asks a few questions, then writes /opt/mediaplane/stack.yaml
   mediaplane plan         # checks the host and shows what apply would do
   mediaplane apply        # asks before it changes anything; --yes skips the question
   mediaplane status
   mediaplane credentials  # the admin login, and where each app is
   ```

3. Replace the bullet that starts `- **Who can reach the apps.**`, with its two sub-bullets,
   with:

   ```markdown
   - **Who can reach the apps.** `init` asks whether to publish the web UIs on your LAN
     (`network.bind: lan`), so you can open them from your other devices, or to keep them
     on this machine (`localhost`). On a cloud VM it suggests `localhost`. With `lan`, it
     offers the LAN subnet it sees (on a cloud VM, you type it), and writes it as
     `network.lan_subnet`, which must be a private range. Without a terminal, pass
     `--bind` and `--lan-subnet`. Until the wiring lands (Slices 3b to 7):
     - Jellyfin's setup wizard and Seerr's setup are open to anyone on your LAN until you
       complete them. Complete them right after the first `apply`.
     - Sonarr, Radarr and Prowlarr ask for a login that has no user yet. Their READMEs,
       such as [Sonarr's](../catalog/sonarr/README.md), say how to create one.
   - **The admin login.** `init` asks for its user name (`--admin-user`), and whether
     Mediaplane should generate its password or read yours from a file in the home
     (`--admin-password-file`, at least 12 characters). After `apply`,
     `mediaplane credentials` shows the login and each app's address. Its `--json` output
     leaves the password out unless you add `--reveal`. qBittorrent uses this login today;
     Sonarr, Radarr and Prowlarr follow in Slice 3b.
   - **The VPN address.** With a VPN provider, `init` asks for your WireGuard address
     (`--vpn-addresses`), which providers such as Mullvad need. It is the `Address` line
     in the WireGuard file your provider gives you.
   ```

4. In "Troubleshooting", add before the item for `` `Error response from daemon: Forbidden` ``:

   ```markdown
   - `… was not written by Mediaplane, so it lacks the key Mediaplane gave …`

     The app first started before Mediaplane wrote its settings file. Its README, under
     "Set up before Slice 3a", shows how to replace the file.

   - `the admin password has not been generated yet`

     `mediaplane credentials` needs an `apply` first: apply generates the password before
     it starts any app.

   ```

- [ ] **Step 5: Architecture and the README**

In `docs/architecture.md`:

1. In the first paragraph, change `(Slices 1 to 2c)` to `(Slices 1 to 3a)`.
2. In "The engine", replace the `**secrets**` bullet with:

   ```markdown
   - **secrets** (`packages/engine/src/secrets`): generates each key once, and the shared
     admin password, and keeps them in `state/secrets.json`.
   - **pre-start files** (`render/prestart.ts`, `plan/prestart.ts` and
     `apply/prestart.ts` in `packages/engine/src`): the files some apps read when they
     start, from each app's `configFiles` in the catalog.
   ```

   and add after the `**status**` bullet:

   ```markdown
   - **credentials** (`packages/engine/src/credentials.ts`): the shared admin login, and
     where each app's web UI is.
   ```

3. In "Not built yet", change `(Slices 3 to 7)` to `(Slices 3b to 7)`.
4. In "`plan`", replace the diagram's last two boxes, from `render` to the end of the
   block, with:

   ```text
   render
     │ compose.yaml, .env,
     │ pre-start files
     ▼
   diff
     files, containers,
     keys to generate,
     apps not healthy yet
   ```

5. In "`apply`", replace the diagram with:

   ```text
   lock
    → plan, then ask
    → generate keys
    → write files, and
      pre-start files
      if absent
    → pull images
    → set appdata owners
    → up --wait
    → plan again
    → write change record
    → unlock
   ```

   and add after the `**Keys are saved before any container starts.**` bullet:

   ```markdown
   - **Pre-start files are written once, before the first start.** Some apps read a file
     when they start: Sonarr's, Radarr's and Prowlarr's `config.xml`, qBittorrent's
     `qBittorrent.conf` and Gluetun's `auth/config.toml`. Apply writes each one only when
     it is absent, in the files step, 0600, and never again, because the apps rewrite
     them. `plan` lists them as `before first start`, without their content. A file that
     is there but lacks Mediaplane's key is from an install made before Slice 3a: `plan`
     stops with `<app>.not-seeded`.
   - **Pulls are retried.** When a registry times out, drops the connection, answers with
     a 5xx error or rate-limits, apply pulls again, up to three times, after 5, 15 and 45
     seconds.
   ```

6. In "The home", add after the `**generated/**` bullet:

   ```markdown
   - **`appdata/<app>/`** is each app's. Mediaplane creates the folder and writes its
     pre-start files once, then leaves it alone. It holds keys and qBittorrent's password
     hash, so treat it as sensitive.
   ```

   and replace the bullet that starts `- **The home's filesystem must support hard links,**`
   (two lines) with:

   ```markdown
   - **The home's filesystem must support hard links,** because the lock, `init`'s
     `stack.yaml` and the pre-start files are created with one.
   ```

7. In "What comes next", replace the first list item with:

   ```markdown
   - the VPN's kill-switch test and `vpn-check` (Slice 3d), then the wiring, app by app
     (Slices 3b to 7);
   ```

In `README.md`:

1. Replace the status box's `**Next:**` and `**Who can reach them:**` bullets with:

   ```markdown
   > - **Next:** wiring the apps together. Until that lands, each app still needs
   >   setting up by hand. Jellyfin's wizard and Seerr's setup are open to anyone who
   >   can reach them until you complete them, so complete them first. qBittorrent has
   >   the shared admin login from its first start (`mediaplane credentials` shows it).
   >   Sonarr, Radarr and Prowlarr ask for a login that doesn't exist yet; their READMEs
   >   say how to set one.
   > - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
   >   your LAN (`network.bind: lan`) or keep them on this machine (`localhost`).
   ```

2. In "What works so far", add after the `` Write a starter `stack.yaml` (`init`) `` row:

   ```markdown
   | One admin login, generated, set in qBittorrent before it first starts (`credentials`) | Done |
   ```

   `pnpm format` realigns the table.

- [ ] **Step 6: The spec**

In `docs/design/m1-engine-cli.md`:

1. In the §5.2 table, in the `init` row, replace
   `(media server, data path, VPN provider, login on the LAN)` with
   `(media server, data path, VPN provider and its WireGuard address, LAN or localhost and the LAN subnet, login on the LAN, the admin user name, and whether to generate its password)`.
2. Add at the end of §11:

   ```markdown
   ### Slice 3a: shared admin and pre-start files (2026-10-10)

   - **S3 ships in four parts:** S3a (the shared admin and pre-start files), S3d (the
     VPN's kill-switch test and `vpn-check`), S3b (the wiring framework) and S3c (the
     download path), in that order. The roadmap gives each part's scope.
   - **Pre-start files come from each app's `configFiles(ctx)`** (§4.3, §6.4), a pure
     renderer that replaces the `config-file` seeding step. Apply writes them in its files
     step, before any pull or start, only when they are absent: all at once, mode 0600,
     with their folders created. `plan` lists them as created "before first start", and
     never shows their content.
   - **Installs from before Slice 3a are reported, never overwritten.** A `config.xml`
     without `ApiKey`, or a `qBittorrent.conf` without `WebUI\APIKey`, fails `plan` with
     `<app>.not-seeded`, and its hint gives the steps. Slice 4 automates the fix, with the
     rest of "restore the key at the source" (§6.3).
   - **The shared admin (§6.1).** `admin.username` is 3 to 32 letters, digits, `.`, `_`
     or `-`. A password of your own must be at least 12 characters
     (`admin.password-too-short`). Otherwise Mediaplane generates 24 base62 characters,
     keeps them in `state/secrets.json` as `shared.adminPassword`, and `plan` lists
     `admin.password` among the secrets to generate. In Slice 3a only qBittorrent gets the
     login, through its pre-start file. Sonarr, Radarr and Prowlarr get it through their
     API in Slice 3b, though their `config.xml` already sets `AuthenticationMethod` and
     `AuthenticationRequired`.
   - **`credentials` (§5.2)** prints the login, and the web address of each app that has a
     login. Its human output shows a generated password, as §6.1 says. `--json`
     (`mediaplane.credentials/v1`) leaves the password `null` unless `--reveal` is given.
     A password of your own is shown only with `--reveal`. Apps whose login is still to
     come say which slice brings it.
   - **`init` asks five more questions (§5.2),** each with a flag: the admin user name,
     whether to generate the password or read it from a file, `lan` or `localhost`
     (`localhost` on a cloud VM), the LAN subnet with `lan`, and the WireGuard address
     with a VPN provider.
   - **qBittorrent's Automatic Torrent Management is on**
     (`Session\DisableAutoTMMByDefault=false`), so a torrent follows its category's save
     path (§6.2). It applies to torrents you add by hand too.
   - **Gluetun's control server needs a key (§6.1).** Its pre-start `auth/config.toml`
     gives a generated `controlApiKey` the routes `GET /v1/vpn/status` and
     `GET /v1/publicip/ip`, and no other (Slice 3d's end-to-end test checks this).
     Without it, Gluetun v3.41 answers anyone on the stack's network.
   - **The LAN is trusted only while the web UIs are on it (§6.1).**
     `FIREWALL_OUTBOUND_SUBNETS`, Servarr's `SERVER__TRUSTEDNETWORKS` and qBittorrent's
     `AuthSubnetWhitelist` are set only for `network.bind: lan` or `all`.
     `network.lan_subnet` must lie inside an RFC 1918 range. On a cloud VM without it,
     Mediaplane trusts no subnet. `plan` warns (`network.no-lan-subnet`) when the web UIs
     are on the LAN but no subnet is known.
   - **Mediaplane's own network joins `TRUSTEDNETWORKS` in M2, not M1** (§6.1). That
     setting names the proxies whose `X-Forwarded-For` header Sonarr believes.
     Mediaplane's own calls use API keys and send no such header, so the setting waits for
     the M2 panel, which proxies requests.
   - **Apply retries a pull** (§5 step 7, §5.1) after a temporary registry error: a TLS
     or I/O timeout, a reset connection, a 5xx answer or a rate limit. It tries three more
     times, after 5, 15 and 45 seconds.
   - **Change records grow by additive, optional fields within `mediaplane.change/v1`**
     (§5 step 12). Older records still parse. A field that changes meaning needs a v2.
     Slice 3a adds none; S3b's wiring actions will.
   ```

- [ ] **Step 7: The roadmap**

In `docs/plans/m1-roadmap.md`:

1. **"Detailed plans so far".** Change the S2c line to end in `(done).`, and add:
   `` - Slice 3a: [`m1-s3a-admin-and-seed-files.md`](m1-s3a-admin-and-seed-files.md). ``
2. **A new section after "S2 is delivered in three parts"**, before "Every slice writes
   its own docs as it goes":

   ```markdown
   ### S3 is delivered in four parts (decided 2026-10-09)

   S3 is too large for one plan, so it ships as four sub-slices, in the order below. Each
   one ends green, just like a full slice.

   - **S3a: shared admin and pre-start files.**
     - Delivers: the shared admin login, with a generated password, and
       `mediaplane credentials`; `init`'s questions for the admin, the LAN and the
       WireGuard address; files written before an app's first start, only if absent
       (`config.xml` for Sonarr, Radarr and Prowlarr, `qBittorrent.conf` with the shared
       login and its key, and Gluetun's control-server key); the S3 network inputs below;
       pull retries, and tests that clean up after themselves.
     - Proves: `config.xml` holds the generated key; qBittorrent takes the shared password
       from `credentials`, and its key; it prints no temporary password; a second apply
       changes nothing.
   - **S3d: VPN.**
     - Delivers: the kill-switch test against a local WireGuard server, `vpn-check`, the
       CI `modprobe wireguard` step, and the "VPN down" runbook.
     - Proves: success criterion 5.
   - **S3b: the wiring framework.**
     - Delivers: how the Mediaplane container reaches the apps (an owner's decision, then
       ADR 0011), the typed HTTP client, the integration contract, `resources.json`, the
       wiring steps, and the Servarr admin login as its first resource.
     - Proves: the shared login works in Sonarr, Radarr and Prowlarr, from source and from
       the image.
   - **S3c: the download path.**
     - Delivers: qBittorrent's categories and settings through its API, and Sonarr's and
       Radarr's download clients and root folders, on the VPN topology.
     - Proves: part of success criterion 1.

   S3d comes second because it is small, it settles early whether GitHub's runners can
   load WireGuard, and it gives S3c a real Gluetun to wire through.
   ```

   It is a list, not a table like the S2 split, so it reads on a phone.

3. **"Every slice writes its own docs as it goes".** In the runbooks list, change
   `"VPN down" and "wiring failed" in S3;` to `"VPN down" in S3d, and "wiring failed" in S3b;`.
4. **"Things S1 encodes".** In the four rows whose last cell is `S3`, change it to `S3d`.
5. **"Inputs for later slices from the reviews".**
   - In the intro paragraph, add at the end: `Slice 3a (2026-10-10) added the last S3
     item, the S3d list, two S4 items, an S6 item and an M2 item.`
   - Change the heading `**S3:**` to `**S3:** S3a handles the first five, except
     Mediaplane's network in TRUSTEDNETWORKS, which moved to M2. The rest are for S3b and
     S3c.`
   - Add at the end of the S3 list:

     ```markdown
     - **qBittorrent's settings after its first start.** `admin.username`,
       `admin.password`, `login_on_lan` and the LAN subnet reach qBittorrent only through
       its pre-start file (S3a). S3c manages them through its API.
     ```

   - Add a new list after the S3 list, before `**S4:**`:

     ```markdown
     **S3d:**

     - **Gluetun's control server refuses requests without the key.** S3a writes
       `auth/config.toml`, and this was checked only by hand on the pinned image. Check
       in the end-to-end test that `GET /v1/vpn/status` answers 401 without `X-API-Key`,
       and 200 with it.
     - **qBittorrent's web UI on localhost, behind Gluetun.** Since S3a,
       `FIREWALL_OUTBOUND_SUBNETS` is set only while the web UIs are on the LAN. Check in
       the end-to-end test that with `bind: localhost` the web UI still answers on
       `127.0.0.1`, as a hand check found in S3a. If it doesn't, the cloud-VM default has
       regressed.
     ```

   - Replace the S4 item that starts `- **An override can move an appdata mount.**` (three
     lines) with:

     ```markdown
     - **An override can move an appdata mount.** When `compose.override.yaml`
       remaps an app's appdata mount, the ownership helper's chown runs on the
       override's host path, not on `appdata/<app>`. Pre-start files (S3a) are still
       written to `appdata/<app>`, so the app starts without them, and nothing reports
       it.
     ```

   - Add to the S4 list:

     ```markdown
     - **Installs from before Slice 3a.** `plan` reports a `config.xml` without `ApiKey`,
       or a `qBittorrent.conf` without `WebUI\APIKey`, as `<app>.not-seeded`, and the app
       READMEs give the manual fix. Automate it: stop the app, add the stored key to its
       file, and start it ("restore the key at the source", spec §6.3).
     - **FlareSolverr's anonymous volume.** Its image declares `VOLUME /config`, and the
       catalog mounts nothing there, so every container it creates leaves an anonymous
       volume behind. Mount a folder there, or document it. (The end-to-end helpers
       remove them with `down -v` since S3a.)
     ```

   - Add to the S6 list:

     ```markdown
     - **A login of your own for Plex, and for Seerr on Plex.** Plex's login is always
       your plex.tv account, never the shared admin (spec §6.1). With Plex, Seerr's
       first sign-in uses that account too. The catalog's `login` (S3a) is `'shared'`
       or the slice that brings it, so `credentials` says their login arrives in
       Slice 6 (Plex) or Slice 7 (Seerr). Give `login` a value for your own account,
       and use it for both.
     ```

   - Replace the **M2** paragraph with:

     ```markdown
     **M2 (the panel):**

     - `trigger: 'cli'` is a literal in `mediaplane.change/v1`. Fields may be added
       within v1 when they are optional (spec §11, Slice 3a); decide whether a new
       trigger is one, or needs a v2, before the panel writes change records.
     - **Servarr `TRUSTEDNETWORKS` and Mediaplane's network (ruling R12).** Once the panel
       proxies requests to the apps, add its network, so Sonarr believes the
       `X-Forwarded-For` header it sends (spec §11, Slice 3a).
     ```

- [ ] **Step 8: Check, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git grep -nE "Slices? 3([^a-d0-9]|$)" -- '*.md' '*.ts' ':!docs/plans/m1-s*'
git add README.md deploy/README.md catalog docs
git commit -m "docs: the shared admin, pre-start files and credentials, and the S3 split" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `pnpm docs:generate` writes nothing, every check passes, and the `git grep`
prints nothing: no doc still says "Slice 3" where it means one of its parts.

---

## Slice 3a completion checklist

- [ ] On this aarch64 machine, this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements.
- [ ] The temporary-folder count from Task 1, Step 5 is unchanged after `pnpm test`, and
  `pnpm test:e2e` leaves no `mediaplane-e2e-*` container or image, and no new folder or
  volume (Task 11, Step 3).
- [ ] By hand, against a scratch home (run from source, or through the image as in
  `deploy/README.md`):
  - `mediaplane init` asks the new questions, and writes `admin`, `network.lan_subnet`
    and `vpn.addresses` as answered;
  - `mediaplane credentials` before `apply` exits 1 with the hint to run apply;
  - `mediaplane plan` lists `admin.password` and the pre-start files
    `(before first start; secret values, not shown)`;
  - after `mediaplane apply --yes` on a stack with `bind: localhost`, the qBittorrent web
    UI at the address `mediaplane credentials` shows accepts the login it shows, and a
    second `apply` prints `No changes.`

  Then remove the stack, its volumes (`down -v`) and the scratch home.
- [ ] No committed file contains a real path, user name, host name or address from this
  machine: `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing
  outside the GitHub URLs.
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B main.. | grep -c Claude-Session` prints `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the owner:
  - their own dev installs from before S3a now stop at `plan` with
    `sonarr.not-seeded`, `radarr.not-seeded`, `prowlarr.not-seeded` or
    `qbittorrent.not-seeded`; the app READMEs' "Set up before Slice 3a" gives the fix
    (for the owner's manual-steps list);
  - the rulings logged for them to confirm or reverse: Automatic Torrent Management on,
    and `credentials` showing a generated password in its human output;
  - S3b waits for their decision on how the Mediaplane container reaches the apps.
