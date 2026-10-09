# M1 Slice 2b: apply — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mediaplane apply` makes the running stack match `stack.yaml`, and
containers come up healthy on amd64 and arm64. A second `apply` reports `No changes`
and modifies nothing.

`apply` runs these stages in order (spec §5):

1. take the lock;
2. plan, which also validates the config and runs preflight;
3. ask for confirmation;
4. generate the keys;
5. write `compose.yaml` and `.env` atomically;
6. pull the images;
7. fix the ownership of app data folders;
8. start the stack with `up --wait`;
9. verify by planning again;
10. record the change.

This slice also adds `status`, `history` and `init`, and clears the roadmap's S2b
blockers.

**Architecture:**

- **Keys.** They are generated with a cryptographic random source, which tests can
  replace, and saved to `state/secrets.json` (0600) before anything starts. They are
  never generated twice.
- **The `.env` file.** `plan` renders `generated/.env` (0600) from the secret values.
  It now lists the file as a change, but never shows its contents.
- **Apply steps.** `apply()` in the engine runs each step through a small runner. Once a
  step fails, the later ones are marked `skipped` and the outcome is recorded. A re-run
  converges forward, with no automatic rollback (ADR 0004).
- **Docker calls.** Every one still goes through the `Runtime`. It gains `pull`, `up`
  and `chown`, which runs a throwaway `docker compose run` container. Every call now has
  a timeout. The runtime refuses any Compose project that is not `mediaplane` or
  `mediaplane-<name>`.
- **The CLI.** It asks for confirmation through an injectable `ask` function, which
  exists only on a terminal. Otherwise `--yes` is required.

**Tech Stack:** as Slice 2a (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4), plus Node's `crypto`, `readline/promises` and `fs` (`open`
with `wx`, `rename`, `fsync`). No new npm dependencies.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §3.2 (`keys`, `runtime`, `history`);
- §4.1 (on-disk layout and modes);
- §5 (the apply flow), §5.1 (failure handling) and §5.2 (the `init`, `apply`,
  `status` and `history` commands);
- §6.1 (key formats) and §6.4;
- §7.2(2) and (4).

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md), especially the S2b row of
the S2 split, and the "S2b (blockers for `apply`)" list under "Inputs for later slices
from the reviews".

## Global Constraints

Everything in the Slice 1 and Slice 2a Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md`, `docs/plans/m1-s2a-plan-against-docker.md`):

- fake values only, because the repo is public;
- neutral framing;
- determinism;
- `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes nothing;
- Docker is reached only through the `Runtime`;
- secret values never appear in diagnostics, error messages, logs, plan output or JSON
  output;
- unit tests never need Docker, except the spawned tests in
  `packages/cli/src/main.test.ts`;
- never push.

These are added:

- **`apply` writes only inside the Mediaplane home.** That covers `generated/`,
  `state/` and `appdata/<app>/`. Before it takes the lock, it checks that `stack.yaml`
  exists, so it never creates `state/` in a folder that isn't a Mediaplane home.
- **File modes (spec §4.1, §7.2(4)):**

  | File | Mode |
  |---|---|
  | `generated/compose.yaml` and `generated/compose.prev.yaml` | 0644 |
  | `generated/.env` | 0600 |
  | `state/` and `state/history/` | 0700 |
  | `state/secrets.json`, `state/lock` and `state/history/*.json` | 0600 |
  | `secrets/`, created by `init` | 0700 |

  Every file is written atomically: a temp file, then `fsync`, then `rename`.
- **Keys** come from `crypto.randomBytes` and are never generated twice. There are two
  formats: 32 lowercase hex characters, or `qbt_` plus 28 base62 characters without
  modulo bias (spec §6.1).
- **Managed projects only.** The runtime refuses any Compose project that is not
  `mediaplane` or `mediaplane-<name>`, where the name is `[a-z0-9][a-z0-9_-]*`. It never
  accepts `mediaplane-system` (spec §7.2(2)).
- **Converge forward (ADR 0004).** After a failed step, the later steps are `skipped`.
  Nothing is rolled back, and the change record still gets written.
- **Exit codes:**
  - `apply`: 0 for success or no changes; 1 for failed, cancelled or invalid.
  - `plan`: unchanged.
  - `status`, `history` and `init`: 0 on success, 1 on error.
- **New JSON schemas.** `mediaplane.apply/v1`, `mediaplane.status/v1`,
  `mediaplane.history/v1`, `mediaplane.init/v1` and `mediaplane.change/v1` (the change
  record). `mediaplane.plan/v1` gains an optional `sensitive` flag on file entries, an
  additive change.
- **End-to-end projects are always named `mediaplane-e2e-<pid>[-<suffix>]`.**
  End-to-end test files run one at a time, because they share host ports.
- **Before every commit, run**
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test`.

## File structure (new and changed in this slice)

```
catalog/byparr/app.ts            (changed) its own 30 s health check
packages/engine/src/
├── paths.ts                     (new) every path inside the home (spec §4.1)
├── util/atomic.ts               (new) writeFileAtomic, ensureDir
├── state/lock.ts                (new) acquireLock, LockedError
├── secrets/generate.ts          (new) generateSecret, withGeneratedSecrets, RandomBytes
├── secrets/store.ts             (changed) writeSecretStore
├── render/env.ts                (new) renderEnvFile, envValue
├── runtime/exec.ts              (changed) timeoutMs
├── runtime/types.ts             (changed) CommandResult; Runtime.pull/up/chown
├── runtime/docker.ts            (changed) project guard, timeouts, robust ps, pull/up/chown
├── plan/containers.ts           (changed) several containers per service; own ports by port
├── plan/predict.ts              (changed) several containers per service
├── plan/files.ts                (changed) sensitive files
├── plan/plan.ts                 (changed) .env in the plan; planStack() returns its context
├── preflight/checks.ts          (changed) ownPortKey
├── history/records.ts           (new) change records: write, list, read
├── apply/ownership.ts           (new) appdata folders and the owners apps need
├── apply/apply.ts               (new) apply()
├── status.ts                    (new) status()
├── config/starter.ts            (new) starterStack()
└── testing/fakes.ts             (changed) fakeRuntime commands, fakeDocker, parseEnvFile
packages/cli/src/run.ts          (changed) apply, status, history, init; Io.ask
packages/cli/src/output.ts       (changed) printApply, printStep, printStatus, printHistory
packages/cli/src/main.ts         (changed) a terminal `ask` via readline
test/e2e/helpers.ts              (new) shared e2e helpers
test/e2e/apply.e2e.test.ts       (new) apply the real video stack
docs/adr/0004-converge-forward-apply.md (new)
```

**Tasks:**

1. Catalog and test-environment fixes.
2. Runtime hardening.
3. Planner robustness.
4. Paths, atomic writes and the lock.
5. Keys and the `.env` file.
6. Runtime commands for apply.
7. Change history.
8. Appdata ownership.
9. `.env` in the plan, and the plan's context.
10. `apply()`.
11. The CLI's `apply`, `status` and `history` commands.
12. The CLI's `init` command.
13. End-to-end apply, CI and docs.

**Out of scope here:** wiring, bootstrap and first-run setup (S3, S6, S7), including
Jellyfin's bootstrap-before-publish, which comes in S6. Until S6 lands, a freshly
applied Jellyfin shows its first-run wizard to anyone who can reach its port, so the
README's status stays "not ready for use". Key recovery from appdata is S4. `status`
shows Gluetun's container health, and the full VPN check (`vpn-check`, egress IP) is S3.
The Mediaplane image and socket proxy are S2c.

---

### Task 1: Catalog and test-environment fixes

**Files:**
- Modify: `catalog/byparr/app.ts`, `catalog/catalog.test.ts`, `catalog/render.test.ts`,
  `packages/cli/src/main.test.ts`, `packages/cli/src/run.test.ts`,
  `docs/plans/m1-roadmap.md`

**Interfaces:**
- **Consumes:** the existing catalog, `render()` in `catalog/render.test.ts`, and the
  CLI test helpers.
- **Produces:**
  - **Byparr's health check.** Byparr gains
    `health: { test: ['CMD', 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:8191/health'] }`.
  - **The spawned CLI tests** use free ports, not the default ones.
  - **The empty-`MEDIAPLANE_HOME` test** no longer depends on whether
    `/opt/mediaplane` exists.

**Why each fix:**

- **Byparr.** The image's own `HEALTHCHECK` runs every 15 minutes, and its first run
  fires before the server listens. Byparr therefore reports `starting` for 15 minutes,
  and `up --wait` times out. Observed on 2026-10-09 with byparr 3.0.4: with the
  explicit check it was healthy in 12 s, and its `/health` endpoint returns 200.
- **Ports.** The roadmap's S2b list calls out that the spawned tests need ports 8989,
  8080 and 8096 free, so they fail on a host running a real stack.
- **Gluetun.** Its health check can only be verified with a WireGuard server, which
  arrives in S3. So the roadmap row moves from S2b to S3.

- [ ] **Step 1: Write the failing tests**

Add to `describe('the real catalog', …)` in `catalog/render.test.ts`:

```ts
  it('gives Byparr a health check that passes within a minute', () => {
    expect(render(SPEC_EXAMPLE).compose.services.byparr?.healthcheck).toEqual({
      test: ['CMD', 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:8191/health'],
      interval: '30s',
      timeout: '10s',
      retries: 5,
      start_period: '60s',
    });
  });
```

Add inside the per-app `describe.each` in `catalog/catalog.test.ts`:

```ts
    it('names no secret env<Name>, which would collide with apps.<id>.env', () => {
      // secretEnvName(id, 'envToken') is MP_<ID>_ENV_TOKEN, the same variable as
      // apps.<id>.env.TOKEN (appEnvSecretName).
      for (const name of Object.keys(app.secrets)) expect(name).not.toMatch(/^env[A-Z]/);
    });
```

In `packages/cli/src/run.test.ts`, replace the test "treats an empty MEDIAPLANE_HOME as
unset" with:

```ts
  it('treats an empty MEDIAPLANE_HOME as unset', async () => {
    const homes: string[] = [];
    const term = capture({ MEDIAPLANE_HOME: '' });
    await run(['plan'], term.io, {
      ...deps(),
      runtime: (home) => {
        homes.push(home);
        return fakeRuntime();
      },
    });
    expect(homes).toEqual(['/opt/mediaplane']);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run catalog packages/cli/src/run.test.ts`

Expected:
- **The Byparr test fails:** `healthcheck` is undefined.
- **The other two pass.** The catalog guard holds today, and the rewritten home test
  passes too. Both are regression guards.

- [ ] **Step 3: Implement**

In `catalog/byparr/app.ts`, replace `health: 'none',` with:

```ts
  // The image's own HEALTHCHECK runs every 15 minutes and first fires before the server
  // listens, so `up --wait` would wait a quarter of an hour. Check every 30 s instead.
  health: {
    test: ['CMD', 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:8191/health'],
  },
```

In `packages/cli/src/main.test.ts`:

1. Change the `node:net` import (add one if there is none) to
   `import { createServer, type AddressInfo, type Server } from 'node:net';`.
2. Add these helpers above `stackFor`:

   ```ts
   function listen(): Promise<Server> {
     return new Promise((done) => {
       const server = createServer();
       server.listen(0, '127.0.0.1', () => {
         done(server);
       });
     });
   }

   /**
    * Ports nothing on this host listens on, so the spawned plan passes preflight even on a
    * machine that runs a real stack on the default ports.
    */
   async function freePorts(): Promise<{ sonarr: number; qbittorrent: number; jellyfin: number }> {
     const held = [await listen(), await listen(), await listen()] as const;
     const portOf = (server: Server) => (server.address() as AddressInfo).port;
     const ports = {
       sonarr: portOf(held[0]),
       qbittorrent: portOf(held[1]),
       jellyfin: portOf(held[2]),
     };
     await Promise.all(
       held.map(
         (server) =>
           new Promise<void>((done) => {
             server.close(() => {
               done();
             });
           }),
       ),
     );
     return ports;
   }

   const PORTS = await freePorts();
   ```

3. Replace the `apps:` block in `stackFor` with:

   ```ts
   apps:
     sonarr: { port: ${PORTS.sonarr} }
     qbittorrent: { vpn: false, port: ${PORTS.qbittorrent} }
     jellyfin: { port: ${PORTS.jellyfin} }
   ```

   Listing the media server under `apps:` only adds settings; it was checked to resolve
   on 2026-10-09.

In `docs/plans/m1-roadmap.md`, in the table "Things S1 encodes that later slices must
verify against real containers", replace the row
`| Gluetun's built-in health check with \`depends_on: service_healthy\` | S2b |` with:

```markdown
| Gluetun's built-in health check with `depends_on: service_healthy`. It needs a working tunnel, so it is verified with S3's local WireGuard server | S3 |
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run catalog packages/cli`

Expected: PASS. `main.test.ts` still prints `+ generated/compose.yaml`, and `+ create
sonarr` for the stack on free ports.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "fix: give Byparr a prompt health check and free the tests from default ports"
```

---

### Task 2: Runtime hardening

**Files:**
- Modify: `packages/engine/src/runtime/exec.ts`, `packages/engine/src/runtime/docker.ts`
- Test: `packages/engine/src/runtime/exec.test.ts`,
  `packages/engine/src/runtime/docker.test.ts`

**Interfaces:**
- **Consumes:** the existing `Exec`/`nodeExec`, `createDockerRuntime` and
  `parseContainers`.
- **Produces:**
  - **`ExecOptions.timeoutMs?: number`.** When it runs out, the child gets SIGTERM and
    the promise rejects with an `Error` whose `code` is `'ETIMEDOUT'`.
  - **`SYSTEM_PROJECT = 'mediaplane-system'`** and
    **`isManagedProject(project): boolean`**.
  - **`createDockerRuntime` throws a `RuntimeError`** for a project that isn't managed.
    The message starts `refusing to manage the Compose project "<name>"`.
  - **`DOCKER_TIMEOUTS = { query: 60_000 }`.** Every runtime call passes a timeout. A
    timeout becomes the `RuntimeError`
    `docker <label> did not finish within <s>s; check that the Docker daemon is responding`.
  - **`parseContainers` handles bad output.** Output that isn't JSON throws a
    `RuntimeError`, and JSON values that aren't objects are skipped.

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine/src/runtime/exec.test.ts`:

```ts
  it('stops a command that runs past its timeout', async () => {
    const started = Date.now();
    await expect(
      nodeExec(node, ['-e', 'setTimeout(() => {}, 10_000)'], { timeoutMs: 200 }),
    ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
```

In `packages/engine/src/runtime/docker.test.ts`:

1. Every `createDockerRuntime({ …, project: 'p', … })` becomes
   `project: 'mediaplane-test'`. Expected argument arrays change `'p'` to
   `'mediaplane-test'` to match. Projects already named `mediaplane` stay as they are.
2. Change the `./docker` import to
   `import { createDockerRuntime, isManagedProject, parseContainers, parseHashes } from './docker';`.
3. Add:

```ts
describe('isManagedProject', () => {
  it.each(['mediaplane', 'mediaplane-test', 'mediaplane-e2e-1234-hash'])(
    'manages %s',
    (project) => {
      expect(isManagedProject(project)).toBe(true);
    },
  );

  it.each(['mediaplane-system', 'other', 'mediaplane_x', 'Mediaplane', 'mediaplane-', ''])(
    'refuses %j',
    (project) => {
      expect(isManagedProject(project)).toBe(false);
    },
  );

  it('is enforced when the runtime is created', () => {
    expect(() =>
      createDockerRuntime({ home: '/opt/mediaplane', project: 'mediaplane-system' }),
    ).toThrow('refusing to manage the Compose project "mediaplane-system"');
  });
});
```

Add inside `describe('createDockerRuntime', …)`:

```ts
  it('gives up on a docker call that hangs', async () => {
    const seen: (ExecOptions | undefined)[] = [];
    const exec: Exec = (_command, _args, options) => {
      seen.push(options);
      return Promise.reject(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
    };
    await expect(
      createDockerRuntime({ home, project: 'mediaplane', exec }).versions(),
    ).rejects.toThrow(
      'docker version did not finish within 60s; check that the Docker daemon is responding',
    );
    expect(seen[0]?.timeoutMs).toBe(60_000);
  });
```

Add inside `describe('parseContainers', …)`:

```ts
  it('reports output that is not JSON as a RuntimeError', () => {
    expect(() => parseContainers('Error: something unexpected\n')).toThrow(RuntimeError);
  });

  it('skips JSON lines that are not objects', () => {
    expect(
      parseContainers(`[]\nnull\n"text"\n${PS_SONARR}\n`).map((c) => c.service),
    ).toEqual(['sonarr']);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/runtime`

Expected: FAIL.
- **The timeout tests:** the option is ignored.
- **The project tests:** `isManagedProject` doesn't exist.
- **The non-JSON test:** `JSON.parse` throws a plain `SyntaxError`.

- [ ] **Step 3: Implement**

Replace `packages/engine/src/runtime/exec.ts` with:

```ts
import { spawn } from 'node:child_process';

export interface ExecOptions {
  input?: string | undefined;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Stop the command (SIGTERM) and reject with code "ETIMEDOUT" after this many ms. */
  timeoutMs?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Exec = (
  command: string,
  args: readonly string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

/** Run a command without a shell, so arguments are never interpreted. */
export const nodeExec: Exec = (command, args, options = {}) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], {
      env: options.env ?? process.env,
      cwd: options.cwd,
    });
    let stdout = '';
    let stderr = '';
    const timeoutMs = options.timeoutMs;
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            child.kill('SIGTERM');
            reject(
              Object.assign(
                new Error(`${command} timed out after ${String(timeoutMs / 1000)}s`),
                { code: 'ETIMEDOUT' },
              ),
            );
          }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on('error', () => {
      // The command exited before reading its input; its exit code tells the story.
    });
    child.stdin.end(options.input ?? '');
  });
```

In `packages/engine/src/runtime/docker.ts`:

1. **Constants and the guard.** Add below `OVERRIDE_PATH`:

   ```ts
   /** Mediaplane's own deployment (spec §4.4): read-only to Mediaplane, never managed. */
   export const SYSTEM_PROJECT = 'mediaplane-system';

   /** How long a docker call may take before Mediaplane gives up on it, in ms. */
   export const DOCKER_TIMEOUTS = { query: 60_000 } as const;

   /**
    * Whether Mediaplane may act on a Compose project: "mediaplane" or "mediaplane-<name>",
    * never its own "mediaplane-system" (spec §7.2(2)).
    */
   export function isManagedProject(project: string): boolean {
     return (
       /^mediaplane(?:-[a-z0-9][a-z0-9_-]*)?$/.test(project) && project !== SYSTEM_PROJECT
     );
   }
   ```

2. **Refuse other projects.** At the top of `createDockerRuntime`:

   ```ts
     if (!isManagedProject(options.project)) {
       throw new RuntimeError(
         `refusing to manage the Compose project "${options.project}": Mediaplane only manages "mediaplane" or "mediaplane-<name>", and never "${SYSTEM_PROJECT}"`,
       );
     }
   ```

3. **A label and a timeout on every call.** Replace the inner `docker()` helper with:

   ```ts
     async function docker(
       label: string,
       args: readonly string[],
       extra: { input?: string; env?: Record<string, string>; timeoutMs?: number } = {},
     ): Promise<ExecResult> {
       const timeoutMs = extra.timeoutMs ?? DOCKER_TIMEOUTS.query;
       try {
         return await exec('docker', args, {
           input: extra.input,
           env: { ...baseEnv, ...extra.env },
           cwd: '/',
           timeoutMs,
         });
       } catch (cause) {
         throw new RuntimeError(spawnFailure(label, timeoutMs, cause), { cause });
       }
     }
   ```

   Update its callers to pass a label as the first argument:
   - `'version'` for `docker version`;
   - `'compose version'`;
   - `'compose config'` in `configHashes`;
   - `'compose ps'` in `containers`.

4. **Turn spawn failures into messages.** Replace the `isNotFound` helper with:

   ```ts
   function spawnFailure(label: string, timeoutMs: number, cause: unknown): string {
     if (hasCode(cause, 'ENOENT')) return 'docker was not found on PATH';
     if (hasCode(cause, 'ETIMEDOUT')) {
       return `docker ${label} did not finish within ${String(timeoutMs / 1000)}s; check that the Docker daemon is responding`;
     }
     return `could not run docker: ${cause instanceof Error ? cause.message : String(cause)}`;
   }

   function hasCode(cause: unknown, code: string): boolean {
     return cause instanceof Error && 'code' in cause && cause.code === code;
   }
   ```

5. **Parse `ps` output safely.** In `parseContainers`, replace
   `.map((line) => { const raw = JSON.parse(line) as PsLine;` and the closing of that
   `.map(...)` with a `.flatMap` that:
   - parses each line;
   - throws on bad JSON;
   - skips anything that isn't an object;
   - otherwise returns `[{ … }]` with the same fields as today.

   ```ts
       .flatMap((line) => {
         let parsed: unknown;
         try {
           parsed = JSON.parse(line) as unknown;
         } catch {
           throw new RuntimeError(
             `docker compose ps printed a line that is not JSON: ${line.slice(0, 120)}`,
           );
         }
         if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
         const raw = parsed as PsLine;
         // …the existing body, unchanged, building the ContainerState…
         return [state];
       });
   ```

   Build the existing object literal into `const state: ContainerState = { … };`, then
   `return [state];`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/runtime && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "fix(engine): time out docker calls, refuse unmanaged projects, tolerate odd ps output"
```

---

### Task 3: Planner robustness

**Files:**
- Modify: `packages/engine/src/plan/containers.ts`, `packages/engine/src/plan/predict.ts`,
  `packages/engine/src/preflight/checks.ts`, `packages/engine/src/plan/plan.ts`
- Test: `packages/engine/src/plan/containers.test.ts`,
  `packages/engine/src/plan/predict.test.ts`,
  `packages/engine/src/preflight/checks.test.ts`, `packages/engine/src/plan/plan.test.ts`

**Interfaces:**
- **Consumes:** `ContainerState`, `RuntimeError`, `predictContainers` and
  `runPreflight`.
- **Produces:**
  - **`groupByService(current): Map<string, ContainerState[]>`.** Used by
    `planContainers`, `ownPorts` and `predictContainers`.
  - **`planContainers` with several containers per service** (an override's `scale`, or
    leftovers):
    - `recreate` if any one of them is stale;
    - otherwise `start` if any one isn't running;
    - otherwise `unchanged`.
  - **`ownPortKey(protocol, port): string`,** for example `"tcp/8989"`.
    `ownPorts(containers)` now returns `ownPortKey()`s, and preflight skips a port the
    project already publishes, at any address.
  - **`plan()` handles a `RuntimeError` thrown while predicting containers** (for
    example a timed-out `config --hash`). It reports it as the same
    `docker.unavailable` diagnostic as `versions()` and `containers()`.

These come from the roadmap's S2b list:

- changing `network.bind` while the containers run gave a false
  `preflight.port-in-use`;
- a `RuntimeError` from `configHashes` escaped `plan()`;
- several containers for one service let the last one win.

- [ ] **Step 1: Write the failing tests**

In `packages/engine/src/plan/containers.test.ts`, replace the `ownPorts` test with:

```ts
describe('ownPorts', () => {
  it('collects every published port, whatever the address', () => {
    const ports = ownPorts([
      container('sonarr', {
        published: [{ address: '127.0.0.1', port: 8989, protocol: 'tcp' }],
      }),
      container('plex', {
        published: [
          { address: '0.0.0.0', port: 32400, protocol: 'tcp' },
          { address: '192.168.1.10', port: 32400, protocol: 'tcp' },
        ],
      }),
    ]);
    expect([...ports].sort()).toEqual(['tcp/32400', 'tcp/8989']);
  });
});
```

Add to `describe('planContainers', …)`:

```ts
  it('recreates a service if any of its several containers is stale', () => {
    expect(
      planContainers({ sonarr: HASH_A }, [
        container('sonarr'),
        container('sonarr', { id: 'id-sonarr-2', configHash: HASH_B }),
      ]),
    ).toEqual([{ service: 'sonarr', action: 'recreate' }]);
  });

  it('starts a service if any of its current containers is stopped', () => {
    expect(
      planContainers({ sonarr: HASH_A }, [
        container('sonarr'),
        container('sonarr', { id: 'id-sonarr-2', state: 'exited' }),
      ]),
    ).toEqual([{ service: 'sonarr', action: 'start' }]);
  });

  it('keeps a service whose containers are all current and running', () => {
    expect(
      planContainers({ sonarr: HASH_A }, [
        container('sonarr'),
        container('sonarr', { id: 'id-sonarr-2' }),
      ]),
    ).toEqual([{ service: 'sonarr', action: 'unchanged' }]);
  });
```

In `packages/engine/src/preflight/checks.test.ts`:

1. Add `ownPortKey` to the `./checks` import.
2. Replace the test "ignores ports this project's own containers publish" with:

```ts
  it("ignores ports this project's own containers publish, at any address", async () => {
    const probe = fakeProbe({ busyPorts: [portKey('tcp', '127.0.0.1', 8989)] });
    expect(
      await runPreflight(input({ ownPorts: new Set([ownPortKey('tcp', 8989)]) }), probe),
    ).toEqual([]);
  });

  it("still checks ports the project's containers don't publish", async () => {
    const probe = fakeProbe({ busyPorts: [portKey('tcp', '127.0.0.1', 8989)] });
    expect(
      codes(
        await runPreflight(input({ ownPorts: new Set([ownPortKey('tcp', 7878)]) }), probe),
      ),
    ).toEqual(['preflight.port-in-use']);
  });
```

Add to `describe('predictContainers', …)` in `packages/engine/src/plan/predict.test.ts`:

```ts
  it("uses a host's running container when it has several", async () => {
    const runningId = idOf('gluetun-b');
    const current = [
      container('gluetun', hashesOf(COMPOSE).gluetun, { id: idOf('gluetun-a'), state: 'exited' }),
      container('gluetun', hashesOf(COMPOSE).gluetun, { id: runningId }),
      container('qbittorrent', hashesOf(withHostId(runningId)).qbittorrent),
      container('sonarr', hashesOf(COMPOSE).sonarr),
    ];
    const result = await predictContainers(COMPOSE, VALUES, fakeRuntime(), current);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.changes.find((c) => c.service === 'qbittorrent')?.action).toBe('unchanged');
  });
```

Add to `describe('plan', …)` in `packages/engine/src/plan/plan.test.ts`, adding
`RuntimeError` to a `../runtime/types` import:

```ts
  it('explains a Docker that stops answering while predicting containers', async () => {
    const runtime: Runtime = {
      ...fakeRuntime(),
      configHashes: () =>
        Promise.reject(new RuntimeError('docker compose config did not finish within 60s')),
    };
    const result = await planFor(await makeHome(), { runtime });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'docker.unavailable',
        message: 'docker compose config did not finish within 60s',
      }),
    );
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/plan packages/engine/src/preflight`

Expected: FAIL.

- **The `ownPorts` and `ownPortKey` tests:** today's keys include the address.
- **The several-containers tests:** the last container wins, so the
  `recreate`/`start` expectations fail.
- **The predict test:** the exited container's ID is used.
- **The plan test:** the `RuntimeError` escapes as a rejection.

- [ ] **Step 3: Implement**

Replace `packages/engine/src/plan/containers.ts` with:

```ts
import { ownPortKey } from '../preflight/checks';
import type { ContainerState } from '../runtime/types';
import { compare } from '../util/sort';

export type ContainerAction = 'create' | 'recreate' | 'start' | 'remove' | 'unchanged';

export interface ContainerChange {
  service: string;
  action: ContainerAction;
}

/** The project's containers by service. A service can have several (scale, leftovers). */
export function groupByService(
  current: readonly ContainerState[],
): Map<string, ContainerState[]> {
  const groups = new Map<string, ContainerState[]>();
  for (const container of current) {
    const group = groups.get(container.service) ?? [];
    group.push(container);
    groups.set(container.service, group);
  }
  return groups;
}

/**
 * What `docker compose up` will do to each service, given the config hash Compose
 * computes for the new configuration and the hash labels on the existing containers.
 * Compose reconciles every container of a service, so a service is unchanged only when
 * all of its containers are current and running.
 */
export function planContainers(
  desired: Record<string, string>,
  current: readonly ContainerState[],
): ContainerChange[] {
  const groups = groupByService(current);
  const changes: ContainerChange[] = Object.keys(desired)
    .sort(compare)
    .map((service): ContainerChange => {
      const containers = groups.get(service) ?? [];
      if (containers.length === 0) return { service, action: 'create' };
      if (containers.some((c) => c.configHash !== desired[service]))
        return { service, action: 'recreate' };
      if (containers.some((c) => c.state !== 'running')) return { service, action: 'start' };
      return { service, action: 'unchanged' };
    });
  const removed = [...groups.keys()]
    .filter((service) => !Object.hasOwn(desired, service))
    .sort(compare)
    .map((service): ContainerChange => ({ service, action: 'remove' }));
  return [...changes, ...removed];
}

/** ownPortKey()s the project's containers publish now, at any address. */
export function ownPorts(containers: readonly ContainerState[]): Set<string> {
  return new Set(
    containers.flatMap((container) =>
      container.published.map((p) => ownPortKey(p.protocol, p.port)),
    ),
  );
}
```

In `packages/engine/src/preflight/checks.ts`:

- Add below `portKey`:

  ```ts
  /**
   * A port the stack's own containers publish, whatever the address, so a re-apply that
   * changes network.bind is not blocked by the stack's own containers.
   */
  export function ownPortKey(protocol: 'tcp' | 'udp', port: number): string {
    return `${protocol}/${String(port)}`;
  }
  ```

- Change the `PreflightInput.ownPorts` doc comment to `/** ownPortKey()s this project's
  containers already publish (re-applies must not trip on them). */`.
- In `checkPorts`, replace
  `if (input.ownPorts.has(portKey(port.protocol, address, port.host))) continue;` with
  `if (input.ownPorts.has(ownPortKey(port.protocol, port.host))) continue;`.

In `packages/engine/src/plan/predict.ts`:

- Import `groupByService` from `./containers`.
- Replace
  `const byService = new Map(current.map((container) => [container.service, container]));`
  with:

  ```ts
    const groups = groupByService(current);
    // A host with several containers: Compose joins the guest to a running one.
    const hostOf = (service: string) => {
      const containers = groups.get(service) ?? [];
      return containers.find((c) => c.state === 'running') ?? containers[0];
    };
  ```

- In the guest loop, use `const host = hostOf(guest.host);`, and
  `groups.has(guest.service)` in place of both `byService.has(guest.service)` calls.

In `packages/engine/src/plan/plan.ts`:

- Add this helper below `failed()`:

  ```ts
  function dockerUnavailable(cause: RuntimeError): Diagnostic {
    return error('docker.unavailable', cause.message, {
      hint: 'start Docker, and make sure your user can run "docker ps" (for example, add it to the docker group)',
    });
  }
  ```

- Use the helper in the existing `catch`:
  `return failed([...diagnostics, dockerUnavailable(cause)]);`.
- Wrap the `predictContainers(...)` call:

  ```ts
    let predicted: PredictResult;
    try {
      predicted = await predictContainers(
        compose,
        await secretValues(stack, store, options.env),
        options.runtime,
        current,
      );
    } catch (cause) {
      if (!(cause instanceof RuntimeError)) throw cause;
      return failed([...diagnostics, dockerUnavailable(cause)]);
    }
  ```

  Import `type PredictResult` from `./predict`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "fix(engine): plan services with several containers and own ports at any address"
```

---

### Task 4: Paths, atomic writes and the lock

**Files:**
- Create: `packages/engine/src/paths.ts`, `packages/engine/src/util/atomic.ts`,
  `packages/engine/src/state/lock.ts`
- Modify: `packages/engine/src/plan/plan.ts`, `packages/engine/src/secrets/store.ts`,
  `packages/engine/src/runtime/docker.ts`, `packages/engine/src/index.ts`, and every
  file that imports `COMPOSE_PATH`, `SECRETS_PATH` or `OVERRIDE_PATH`
- Test: create `packages/engine/src/util/atomic.test.ts` and
  `packages/engine/src/state/lock.test.ts`

**Interfaces:**
- **Consumes:** nothing new.
- **Produces:**
  - **`paths.ts`** defines every location inside the home, relative to it:
    - `COMPOSE_PATH = 'generated/compose.yaml'`
    - `COMPOSE_PREV_PATH = 'generated/compose.prev.yaml'`
    - `ENV_PATH = 'generated/.env'`
    - `OVERRIDE_PATH = 'compose.override.yaml'`
    - `STACK_PATH = 'stack.yaml'`
    - `STATE_DIR = 'state'`
    - `SECRETS_PATH = 'state/secrets.json'`
    - `LOCK_PATH = 'state/lock'`
    - `HISTORY_DIR = 'state/history'`
    - `APPDATA_DIR = 'appdata'`

    `COMPOSE_PATH`, `SECRETS_PATH` and `OVERRIDE_PATH` move here from `plan/plan.ts`,
    `secrets/store.ts` and `runtime/docker.ts`, so there is exactly one definition of
    each. Every import is updated.
  - **`writeFileAtomic(path, content, mode = 0o644): Promise<void>`.** It writes a temp
    file next to `path`, flushes it, renames it into place, and applies `mode` exactly
    (not filtered by the umask). On failure it throws
    `Error("cannot write <path> (<CODE>)")` and leaves no temp file behind.
  - **`ensureDir(path, mode): Promise<void>`.** It creates the directory and its parents
    (`mkdir -p`) and sets `mode` on it exactly.
  - **The lock:**
    - `interface LockInfo { pid: number; host: string; startedAt: string }`
    - `interface Lock { release(): Promise<void> }`
    - `class LockedError extends Error { readonly holder: LockInfo | undefined }`
    - `acquireLock(home, now?): Promise<Lock>`. It creates `state/` (0700) and creates
      `state/lock` (0600) exclusively. A lock whose process is dead (same host, the pid
      no longer exists) is cleared once and retried. Otherwise it throws `LockedError`
      with one of these messages:
      - `another apply is running (pid <pid> on <host>, started <startedAt>)`
      - `state/lock exists but cannot be read`

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/util/atomic.test.ts`:

```ts
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureDir, writeFileAtomic } from './atomic';

const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

describe('writeFileAtomic', () => {
  it('writes the content with the exact mode, creating parent folders', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-atomic-'));
    const path = join(dir, 'generated', '.env');
    await writeFileAtomic(path, "MP_X='fake'\n", 0o600);
    expect(await readFile(path, 'utf8')).toBe("MP_X='fake'\n");
    expect(await modeOf(path)).toBe(0o600);
  });

  it('replaces an existing file and leaves no temporary file behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-atomic-'));
    const path = join(dir, 'compose.yaml');
    await writeFile(path, 'old\n');
    await writeFileAtomic(path, 'new\n');
    expect(await readFile(path, 'utf8')).toBe('new\n');
    expect(await modeOf(path)).toBe(0o644);
    expect(await readdir(dir)).toEqual(['compose.yaml']);
  });

  it('names the file when it cannot be written', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-atomic-'));
    await writeFile(join(dir, 'not-a-folder'), '');
    const path = join(dir, 'not-a-folder', 'compose.yaml');
    await expect(writeFileAtomic(path, 'x')).rejects.toThrow(`cannot write ${path}`);
  });
});

describe('ensureDir', () => {
  it('creates the folder with the exact mode, and tightens an existing one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-atomic-'));
    const state = join(dir, 'state');
    await ensureDir(state, 0o700);
    expect(await modeOf(state)).toBe(0o700);
    const loose = join(dir, 'loose');
    await ensureDir(loose, 0o755);
    await ensureDir(loose, 0o700);
    expect(await modeOf(loose)).toBe(0o700);
  });
});
```

`packages/engine/src/state/lock.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCK_PATH } from '../paths';
import { acquireLock, LockedError } from './lock';

const NOW = () => new Date('2026-10-09T09:43:12.000Z');

async function homeWithLock(content: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-lock-'));
  await mkdir(join(home, 'state'));
  await writeFile(join(home, LOCK_PATH), content);
  return home;
}

/** The pid of a process that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  return child.pid ?? 999_999;
}

describe('acquireLock', () => {
  it('records who holds the lock, with private modes, and releases it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-lock-'));
    const lock = await acquireLock(home, NOW);
    expect(JSON.parse(await readFile(join(home, LOCK_PATH), 'utf8'))).toEqual({
      pid: process.pid,
      host: hostname(),
      startedAt: '2026-10-09T09:43:12.000Z',
    });
    expect((await stat(join(home, 'state'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, LOCK_PATH))).mode & 0o777).toBe(0o600);
    await lock.release();
    await expect(stat(join(home, LOCK_PATH))).rejects.toThrow();
    await (await acquireLock(home, NOW)).release();
  });

  it('refuses while another live process holds it, saying who and since when', async () => {
    const holder = { pid: process.pid, host: hostname(), startedAt: '2026-10-09T09:00:00.000Z' };
    const home = await homeWithLock(JSON.stringify(holder));
    const failure = acquireLock(home, NOW);
    await expect(failure).rejects.toBeInstanceOf(LockedError);
    await expect(failure).rejects.toThrow(
      `another apply is running (pid ${String(process.pid)} on ${hostname()}, started 2026-10-09T09:00:00.000Z)`,
    );
  });

  it('clears a lock left by a process that has died', async () => {
    const holder = { pid: deadPid(), host: hostname(), startedAt: '2026-10-09T09:00:00.000Z' };
    const home = await homeWithLock(JSON.stringify(holder));
    const lock = await acquireLock(home, NOW);
    expect(JSON.parse(await readFile(join(home, LOCK_PATH), 'utf8'))).toMatchObject({
      pid: process.pid,
    });
    await lock.release();
  });

  it("never clears another host's lock, which it can't check", async () => {
    const holder = { pid: deadPid(), host: 'fake-other-host', startedAt: '2026-10-09T09:00:00.000Z' };
    const home = await homeWithLock(JSON.stringify(holder));
    await expect(acquireLock(home, NOW)).rejects.toBeInstanceOf(LockedError);
  });

  it('refuses when the lock file cannot be read', async () => {
    const home = await homeWithLock('not json');
    await expect(acquireLock(home, NOW)).rejects.toThrow('state/lock exists but cannot be read');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/util/atomic.test.ts packages/engine/src/state`

Expected: FAIL, because `./atomic`, `../paths` and `./lock` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/engine/src/paths.ts`:

```ts
/** Where everything lives inside the Mediaplane home (spec §4.1), relative to it. */
export const STACK_PATH = 'stack.yaml';
export const OVERRIDE_PATH = 'compose.override.yaml';
export const COMPOSE_PATH = 'generated/compose.yaml';
export const COMPOSE_PREV_PATH = 'generated/compose.prev.yaml';
export const ENV_PATH = 'generated/.env';
export const STATE_DIR = 'state';
export const SECRETS_PATH = 'state/secrets.json';
export const LOCK_PATH = 'state/lock';
export const HISTORY_DIR = 'state/history';
export const APPDATA_DIR = 'appdata';
```

Move the three existing constants:

- **Delete** `export const COMPOSE_PATH …` from `plan/plan.ts`,
  `export const SECRETS_PATH …` from `secrets/store.ts`, and
  `export const OVERRIDE_PATH …` from `runtime/docker.ts`.
- **Import** them from `../paths` in those files instead. `plan.ts` also uses
  `STACK_PATH`: replace `join(home, 'stack.yaml')` with `join(home, STACK_PATH)`.
- **Update every other importer.** Run
  `grep -rn "COMPOSE_PATH\|SECRETS_PATH\|OVERRIDE_PATH" packages catalog test` and point
  each import at the `paths` module. Inside the engine that is
  `'../paths'`; from the CLI, catalog and `test/` it is `'@mediaplane/engine'`.
- **Export the module.** Add `export * from './paths';` to
  `packages/engine/src/index.ts`, along with `export * from './util/atomic';` and
  `export * from './state/lock';`.

`packages/engine/src/util/atomic.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Replace `path` with `content` all at once: write a temporary file next to it, flush it
 * to disk, then rename it over the original. Readers see the old file or the new one,
 * never half of either.
 */
export async function writeFileAtomic(
  path: string,
  content: string,
  mode = 0o644,
): Promise<void> {
  const temp = `${path}.tmp-${String(process.pid)}-${randomBytes(4).toString('hex')}`;
  try {
    await mkdir(dirname(path), { recursive: true });
    const file = await open(temp, 'wx', mode);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    // open()'s mode is filtered by the umask; set the one we mean.
    await chmod(temp, mode);
    await rename(temp, path);
  } catch (cause) {
    await rm(temp, { force: true });
    const code = cause instanceof Error && 'code' in cause ? String(cause.code) : undefined;
    throw new Error(`cannot write ${path}${code === undefined ? '' : ` (${code})`}`, {
      cause,
    });
  }
}

/** Create a folder and its parents, and give the folder exactly `mode`. */
export async function ensureDir(path: string, mode: number): Promise<void> {
  await mkdir(path, { recursive: true, mode });
  await chmod(path, mode);
}
```

`packages/engine/src/state/lock.ts`:

```ts
import { open, readFile, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { LOCK_PATH, STATE_DIR } from '../paths';
import { ensureDir } from '../util/atomic';

export interface LockInfo {
  pid: number;
  host: string;
  startedAt: string;
}

export interface Lock {
  release(): Promise<void>;
}

/** Another apply holds the lock; `holder` says who, when the lock file can be read. */
export class LockedError extends Error {
  override readonly name = 'LockedError';
  readonly holder: LockInfo | undefined;

  constructor(holder: LockInfo | undefined) {
    super(
      holder === undefined
        ? `${LOCK_PATH} exists but cannot be read`
        : `another apply is running (pid ${String(holder.pid)} on ${holder.host}, started ${holder.startedAt})`,
    );
    this.holder = holder;
  }
}

/**
 * Take the single-writer lock (spec §5, stage 1): create state/lock exclusively, recording
 * the pid, host and start time. A lock left by a dead process on this host is cleared.
 */
export async function acquireLock(
  home: string,
  now: () => Date = () => new Date(),
): Promise<Lock> {
  await ensureDir(join(home, STATE_DIR), 0o700);
  const path = join(home, LOCK_PATH);
  const info: LockInfo = {
    pid: process.pid,
    host: hostname(),
    startedAt: now().toISOString(),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(info)}\n`, 'utf8');
      } finally {
        await file.close();
      }
      return { release: () => rm(path, { force: true }) };
    } catch (cause) {
      if (!hasCode(cause, 'EEXIST')) throw cause;
      const holder = await readHolder(path);
      if (holder === undefined || !isDead(holder)) throw new LockedError(holder);
      await rm(path, { force: true });
    }
  }
  throw new LockedError(await readHolder(path));
}

async function readHolder(path: string): Promise<LockInfo | undefined> {
  try {
    const data = JSON.parse(await readFile(path, 'utf8')) as Partial<LockInfo>;
    if (
      typeof data.pid === 'number' &&
      typeof data.host === 'string' &&
      typeof data.startedAt === 'string'
    ) {
      return { pid: data.pid, host: data.host, startedAt: data.startedAt };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Only a process on this host can be checked; one on another host is assumed alive. */
function isDead(holder: LockInfo): boolean {
  if (holder.host !== hostname()) return false;
  try {
    process.kill(holder.pid, 0);
    return false;
  } catch (cause) {
    return hasCode(cause, 'ESRCH');
  }
}

function hasCode(cause: unknown, code: string): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === code;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine && pnpm typecheck`

Expected: PASS. The moved constants still resolve everywhere.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): add the home's path map, atomic writes and the apply lock"
```

---

### Task 5: Keys and the `.env` file

**Files:**
- Create: `packages/engine/src/secrets/generate.ts`, `packages/engine/src/render/env.ts`
- Modify: `packages/engine/src/secrets/store.ts`, `packages/engine/src/testing/fakes.ts`,
  `packages/engine/src/index.ts`
- Test: create `packages/engine/src/secrets/generate.test.ts` and
  `packages/engine/src/render/env.test.ts`; modify
  `packages/engine/src/secrets/store.test.ts`

**Interfaces:**
- **Consumes:**
  - from Task 4: `writeFileAtomic`, `ensureDir`, `STATE_DIR`, `SECRETS_PATH`;
  - `SecretStore`, `secretsToGenerate`, `ResolvedStack` and `compare`.
- **Produces:**
  - **`type RandomBytes = (size: number) => Buffer`**, which is `crypto.randomBytes` by
    default.
  - **`generateSecret(kind: 'hex32' | 'qbt', random?: RandomBytes): string`.** It
    returns 32 lowercase hex characters, or `qbt_` plus 28 base62 characters
    (`0-9A-Za-z`), without modulo bias: bytes of 248 or more are discarded.
  - **`withGeneratedSecrets(stack, store, random?): { store: SecretStore; generated: string[] }`.**
    It fills in every missing `generate` secret and never replaces an existing one.
    `generated` lists `"<app>.<secret>"` in `secretsToGenerate` order.
  - **`writeSecretStore(home, store): Promise<void>`.** It writes `state/` as 0700 and
    `state/secrets.json` as 0600, atomically, with apps and secret names sorted.
  - **`renderEnvFile(values): string`.** It writes a two-line header, then one
    `NAME=<value>` line per variable, sorted by name, and ends with a newline.
  - **`envValue(value): string`.** Values are single-quoted, which is literal. A value
    that contains `'`, `\n`, `\r` or `\t` is double-quoted instead, with `\`, `"`, `$`,
    newline, carriage return and tab escaped as `\\ \" \$ \n \r \t`. Checked against
    Compose 5.5.1 on 2026-10-09.
  - **`parseEnvFile(text): Record<string, string>`.** The inverse of `renderEnvFile`. It
    lives in `testing/fakes.ts`, so tests and fakes can read the file back.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/secrets/generate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { emptySecretStore } from './store';
import { generateSecret, withGeneratedSecrets, type RandomBytes } from './generate';

const constant =
  (byte: number): RandomBytes =>
  (size) =>
    Buffer.alloc(size, byte);

function stackOf(source: string): ResolvedStack {
  const result = resolveStack(fixtureConfig(source), fixtureCatalog, FIXTURE_HOST, '/opt/mediaplane');
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  qbittorrent: { vpn: false }
  sonarr: {}
`;

describe('generateSecret', () => {
  it('makes 32 hex characters from 16 random bytes', () => {
    expect(generateSecret('hex32', constant(0xab))).toBe('ab'.repeat(16));
  });

  it("makes qBittorrent's qbt_ key from base62 characters", () => {
    // 171 % 62 = 47, which is "l" in 0-9A-Za-z.
    expect(generateSecret('qbt', constant(171))).toBe(`qbt_${'l'.repeat(28)}`);
  });

  it('discards bytes that would bias the base62 alphabet', () => {
    let call = 0;
    const random: RandomBytes = (size) => Buffer.alloc(size, call++ === 0 ? 0xff : 0x00);
    expect(generateSecret('qbt', random)).toBe(`qbt_${'0'.repeat(28)}`);
  });

  it('uses real randomness by default', () => {
    expect(generateSecret('hex32')).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSecret('qbt')).toMatch(/^qbt_[0-9A-Za-z]{28}$/);
    expect(generateSecret('hex32')).not.toBe(generateSecret('hex32'));
  });
});

describe('withGeneratedSecrets', () => {
  it('fills in missing generated secrets and lists them', () => {
    const result = withGeneratedSecrets(stackOf(STACK), emptySecretStore(), constant(0xab));
    expect(result.generated).toEqual(['sonarr.apiKey']);
    expect(result.store).toEqual({ version: 1, apps: { sonarr: { apiKey: 'ab'.repeat(16) } } });
  });

  it('never replaces a secret that already exists', () => {
    const existing = { version: 1 as const, apps: { sonarr: { apiKey: '0'.repeat(32) } } };
    const result = withGeneratedSecrets(stackOf(STACK), existing, constant(0xab));
    expect(result).toEqual({ store: existing, generated: [] });
  });
});
```

Add to `packages/engine/src/secrets/store.test.ts`, extending its imports with `stat`,
`readFile`, `writeSecretStore` and `SECRETS_PATH` from `../paths`:

```ts
describe('writeSecretStore', () => {
  it('writes a sorted, private store that reads back', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-store-'));
    const store = {
      version: 1 as const,
      apps: { sonarr: { apiKey: '0'.repeat(32) }, qbittorrent: { apiKey: `qbt_${'0'.repeat(28)}` } },
    };
    await writeSecretStore(home, store);
    expect(await readSecretStore(home)).toEqual(store);
    const text = await readFile(join(home, SECRETS_PATH), 'utf8');
    expect(text.indexOf('qbittorrent')).toBeLessThan(text.indexOf('sonarr'));
    expect((await stat(join(home, SECRETS_PATH))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, 'state'))).mode & 0o777).toBe(0o700);
  });
});
```

`packages/engine/src/render/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseEnvFile } from '../testing/fakes';
import { envValue, renderEnvFile } from './env';

describe('envValue', () => {
  it.each([
    ['plain-value', "'plain-value'"],
    ['', "''"],
    ['  spaced  ', "'  spaced  '"],
    ['$HOME ${X} "dq" # hash = eq \\back', "'$HOME ${X} \"dq\" # hash = eq \\back'"],
    ["it's", '"it\'s"'],
    ["it's \"q\" $X \\b", '"it\'s \\"q\\" \\$X \\\\b"'],
    ['line1\nline2', '"line1\\nline2"'],
    ['cr\rtab\t', '"cr\\rtab\\t"'],
  ])('%j → %s', (value, expected) => {
    expect(envValue(value)).toBe(expected);
  });
});

describe('renderEnvFile', () => {
  it('writes a header and one sorted line per variable', () => {
    expect(renderEnvFile({ MP_SONARR_API_KEY: 'fake-b', MP_GLUETUN_WIREGUARD_KEY: 'fake-a' })).toBe(
      [
        '# Generated by Mediaplane. DO NOT EDIT: rewritten on every apply.',
        '# The secret values compose.yaml refers to. Keep this file private (mode 0600).',
        "MP_GLUETUN_WIREGUARD_KEY='fake-a'",
        "MP_SONARR_API_KEY='fake-b'",
        '',
      ].join('\n'),
    );
  });

  it('reads back exactly', () => {
    const values = {
      MP_A: "it's \"q\" $X \\b",
      MP_B: 'line1\nline2\ttab\rcr',
      MP_C: '',
      MP_D: '$HOME ${X}',
    };
    expect(parseEnvFile(renderEnvFile(values))).toEqual(values);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/secrets packages/engine/src/render/env.test.ts`

Expected: FAIL. `./generate`, `./env` and `parseEnvFile` don't exist, and
`writeSecretStore` is missing.

- [ ] **Step 3: Implement**

`packages/engine/src/secrets/generate.ts`:

```ts
import { randomBytes } from 'node:crypto';
import type { ResolvedStack } from '../resolver/resolve';
import { compare } from '../util/sort';
import type { SecretStore } from './store';

/** Cryptographically random bytes. Tests pass a deterministic source instead. */
export type RandomBytes = (size: number) => Buffer;

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** The largest multiple of 62 that fits in a byte: higher bytes would bias the alphabet. */
const BASE62_LIMIT = 248;

/** A new secret: 32 hex characters, or qBittorrent's "qbt_" + 28 base62 (spec §6.1). */
export function generateSecret(
  kind: 'hex32' | 'qbt',
  random: RandomBytes = randomBytes,
): string {
  if (kind === 'hex32') return random(16).toString('hex');
  let key = '';
  while (key.length < 28) {
    for (const byte of random(28)) {
      if (byte < BASE62_LIMIT && key.length < 28) key += BASE62.charAt(byte % 62);
    }
  }
  return `qbt_${key}`;
}

/** The store with every missing generated secret filled in. Existing ones are kept. */
export function withGeneratedSecrets(
  stack: ResolvedStack,
  store: SecretStore,
  random: RandomBytes = randomBytes,
): { store: SecretStore; generated: string[] } {
  const apps: Record<string, Record<string, string>> = Object.fromEntries(
    Object.entries(store.apps).map(([id, secrets]) => [id, { ...secrets }]),
  );
  const generated: string[] = [];
  for (const app of stack.apps) {
    const secrets = Object.entries(app.def.secrets).sort(([a], [b]) => compare(a, b));
    for (const [name, source] of secrets) {
      if (!('generate' in source) || apps[app.def.id]?.[name] !== undefined) continue;
      (apps[app.def.id] ??= {})[name] = generateSecret(source.generate, random);
      generated.push(`${app.def.id}.${name}`);
    }
  }
  return { store: { version: 1, apps }, generated };
}
```

Add to `packages/engine/src/secrets/store.ts`, importing `writeFileAtomic` and
`ensureDir` from `../util/atomic`, `STATE_DIR` and `SECRETS_PATH` from `../paths`, and
`compare` from `../util/sort`:

```ts
/** Save the store atomically, private to its owner: state/ 0700, the file 0600 (§7.2(4)). */
export async function writeSecretStore(home: string, store: SecretStore): Promise<void> {
  const sorted = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => compare(a, b)));
  const apps = Object.fromEntries(
    Object.entries(sorted(store.apps)).map(([id, secrets]) => [id, sorted(secrets)]),
  );
  await ensureDir(join(home, STATE_DIR), 0o700);
  await writeFileAtomic(
    join(home, SECRETS_PATH),
    `${JSON.stringify({ version: 1, apps }, null, 2)}\n`,
    0o600,
  );
}
```

`packages/engine/src/render/env.ts`:

```ts
import { compare } from '../util/sort';

const HEADER = [
  '# Generated by Mediaplane. DO NOT EDIT: rewritten on every apply.',
  '# The secret values compose.yaml refers to. Keep this file private (mode 0600).',
];

/** generated/.env: the value of every ${MP_…} variable compose.yaml references. */
export function renderEnvFile(values: Record<string, string>): string {
  const lines = Object.entries(values)
    .sort(([a], [b]) => compare(a, b))
    .map(([name, value]) => `${name}=${envValue(value)}`);
  return [...HEADER, ...lines, ''].join('\n');
}

/**
 * One value in Compose's .env syntax. Single quotes keep everything literal. A value with
 * a single quote or a line break uses double quotes instead, where \ " $ and line breaks
 * must be escaped. (Checked against Compose 5.5.1, 2026-10-09.)
 */
export function envValue(value: string): string {
  if (!/['\n\r\t]/.test(value)) return `'${value}'`;
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('$', '\\$')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  return `"${escaped}"`;
}
```

Add to `packages/engine/src/testing/fakes.ts`:

```ts
const UNESCAPE: Record<string, string> = { n: '\n', r: '\r', t: '\t' };

/** The inverse of renderEnvFile, for tests and fakes. */
export function parseEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    const name = line.slice(0, equals);
    const raw = line.slice(equals + 1);
    values[name] = raw.startsWith('"')
      ? raw.slice(1, -1).replace(/\\(.)/g, (_match, char: string) => UNESCAPE[char] ?? char)
      : raw.slice(1, -1);
  }
  return values;
}
```

Add `export * from './secrets/generate';` and `export * from './render/env';` to
`packages/engine/src/index.ts`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): generate keys and render the private .env file"
```

---

### Task 6: Runtime commands for apply

**Files:**
- Modify: `packages/engine/src/runtime/types.ts`, `packages/engine/src/runtime/docker.ts`,
  `packages/engine/src/testing/fakes.ts`
- Test: `packages/engine/src/runtime/docker.test.ts`; create
  `packages/engine/src/testing/fakes.test.ts`

**Interfaces:**
- **Consumes:**
  - from Task 2: `docker()` with a label and timeout, `redact`, `isManagedProject`;
  - from Task 4: `COMPOSE_PATH`, `ENV_PATH`, `OVERRIDE_PATH`;
  - from Task 5: `parseEnvFile`.
- **Produces:**
  - **`type CommandResult = { ok: true } | { ok: false; error: string }`.** The `error`
    is the last three lines of Compose's stderr, with every value in `values` replaced
    by `***`.
  - **New `Runtime` methods**, each running on the written project
    (`-p <project> --project-directory <home> -f generated/compose.yaml
    [-f compose.override.yaml] --env-file generated/.env`):

    | Method | Runs | Timeout |
    |---|---|---|
    | `pull(values)` | `pull --policy missing --quiet` | 30 min |
    | `up(waitSeconds, values)` | `up --detach --wait --wait-timeout <waitSeconds> --remove-orphans --quiet-pull` | `waitSeconds` + 120 s |
    | `chown(service, path, owner, values)` | `run --rm --no-deps --no-tty --user 0:0 --entrypoint chown <service> -R <uid>:<gid> <path>` | 5 min |

    `DOCKER_TIMEOUTS` becomes `{ query: 60_000, pull: 1_800_000, run: 300_000 }`.
  - **`fakeRuntime(options)`** accepts `pull`, `up` and `chown` results, plus a `calls`
    array it appends to:
    - `'versions'`, `'configHashes'`, `'containers'`, `'pull'`, `'up'`;
    - `'chown <service> <uid>:<gid> <path>'`.
  - **`fakeDocker(home, options?)`.** A stateful fake, with the same options plus
    `upChangesNothing?: boolean`. After a successful `up`, `containers()` reports one
    running, healthy container per service, `fake-<service>`. Each label is the
    `fakeHash` of the written `compose.yaml` and `.env`. Like Compose, it hashes a guest
    with `network_mode: container:fake-<host>`. It returns `Runtime & { calls: string[] }`.

The three commands were checked on Docker 29.8 / Compose 5.5.1, on 2026-10-09:

- **`pull --policy missing`** skips images that are already present.
- **The `compose run` chown** gave Seerr's `appdata` folder `1000:1000`.
- **`up --wait`** exits non-zero with "application not healthy after …" when a health
  check never passes.

- [ ] **Step 1: Write the failing tests**

Add to `describe('createDockerRuntime', …)` in
`packages/engine/src/runtime/docker.test.ts`:

```ts
  const projectArgs = (dir: string) => [
    'compose',
    '-p',
    'mediaplane-test',
    '--project-directory',
    dir,
    '-f',
    join(dir, 'generated/compose.yaml'),
    '--env-file',
    join(dir, 'generated/.env'),
  ];

  it('pulls missing images for the written project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-runtime-'));
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane-test', exec });
    expect(await runtime.pull({})).toEqual({ ok: true });
    expect(calls[0]?.args).toEqual([...projectArgs(dir), 'pull', '--policy', 'missing', '--quiet']);
    expect(calls[0]?.options?.timeoutMs).toBe(1_800_000);
  });

  it('starts the project and waits for it to be healthy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-runtime-'));
    await writeFile(join(dir, 'compose.override.yaml'), 'services: {}\n');
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane-test', exec });
    expect(await runtime.up(600, {})).toEqual({ ok: true });
    expect(calls[0]?.args).toEqual([
      'compose',
      '-p',
      'mediaplane-test',
      '--project-directory',
      dir,
      '-f',
      join(dir, 'generated/compose.yaml'),
      '-f',
      join(dir, 'compose.override.yaml'),
      '--env-file',
      join(dir, 'generated/.env'),
      'up',
      '--detach',
      '--wait',
      '--wait-timeout',
      '600',
      '--remove-orphans',
      '--quiet-pull',
    ]);
    expect(calls[0]?.options?.timeoutMs).toBe(720_000);
  });

  it('runs chown as root in a throwaway container of the service', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-runtime-'));
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane-test', exec });
    expect(await runtime.chown('seerr', '/app/config', { uid: 1000, gid: 1000 }, {})).toEqual({
      ok: true,
    });
    expect(calls[0]?.args).toEqual([
      ...projectArgs(dir),
      'run',
      '--rm',
      '--no-deps',
      '--no-tty',
      '--user',
      '0:0',
      '--entrypoint',
      'chown',
      'seerr',
      '-R',
      '1000:1000',
      '/app/config',
    ]);
  });

  it("reports a failed command with Compose's last lines, secrets replaced", async () => {
    const { exec } = recorder(() => ({
      code: 1,
      stdout: '',
      stderr: 'progress 1\nprogress 2\nContainer x Error\nfake-secret-value rejected\napplication not healthy after 10m0s\n',
    }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane-test', exec });
    expect(await runtime.up(600, { MP_X: 'fake-secret-value' })).toEqual({
      ok: false,
      error: 'Container x Error\n*** rejected\napplication not healthy after 10m0s',
    });
  });
```

`packages/engine/src/testing/fakes.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPOSE_PATH, ENV_PATH } from '../paths';
import { fakeDocker, fakeHash } from './fakes';

const COMPOSE = `services:
  gluetun:
    image: registry.test/gluetun:1
  qbittorrent:
    image: registry.test/qbittorrent:1
    network_mode: service:gluetun
`;

describe('fakeDocker', () => {
  it('starts what is written, hashing guests the way Compose does', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-fakes-'));
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, COMPOSE_PATH), COMPOSE);
    await writeFile(join(home, ENV_PATH), "MP_X='fake-x'\n");
    const docker = fakeDocker(home);
    expect(await docker.containers()).toEqual([]);
    expect(await docker.up(600, {})).toEqual({ ok: true });
    const containers = await docker.containers();
    expect(containers.map((c) => [c.service, c.id, c.state])).toEqual([
      ['gluetun', 'fake-gluetun', 'running'],
      ['qbittorrent', 'fake-qbittorrent', 'running'],
    ]);
    const asCompose = COMPOSE.replace('service:gluetun', 'container:fake-gluetun');
    expect(containers[1]?.configHash).toBe(fakeHash(asCompose, { MP_X: 'fake-x' }).qbittorrent);
    expect(docker.calls).toEqual(['containers', 'up', 'containers']);
  });

  it('can fail a step or leave the containers as they were', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-fakes-'));
    const failing = fakeDocker(home, { pull: { ok: false, error: 'fake registry down' } });
    expect(await failing.pull({})).toEqual({ ok: false, error: 'fake registry down' });
    const inert = fakeDocker(home, { upChangesNothing: true });
    expect(await inert.up(600, {})).toEqual({ ok: true });
    expect(await inert.containers()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/runtime packages/engine/src/testing`

Expected: FAIL. `pull`, `up`, `chown` and `fakeDocker` don't exist.

- [ ] **Step 3: Implement**

In `packages/engine/src/runtime/types.ts`:

- Add:

  ```ts
  /** A Compose command that ran: failed ones carry Compose's last stderr lines. */
  export type CommandResult = { ok: true } | { ok: false; error: string };
  ```

- Add these members to `Runtime`:

  ```ts
    /**
     * Pull images that aren't present yet for the written project (compose.yaml, the
     * user's override, .env). `values` are secret values to redact from errors.
     */
    pull(values: Record<string, string>): Promise<CommandResult>;
    /** `up --detach --wait --remove-orphans` on the written project. */
    up(waitSeconds: number, values: Record<string, string>): Promise<CommandResult>;
    /**
     * `chown -R uid:gid path` as root, in a throwaway container of `service` (`compose
     * run --rm --no-deps`), so the project's own image and mounts are used.
     */
    chown(
      service: string,
      path: string,
      owner: { uid: number; gid: number },
      values: Record<string, string>,
    ): Promise<CommandResult>;
  ```

In `packages/engine/src/runtime/docker.ts`:

1. Import `COMPOSE_PATH`, `ENV_PATH` and `OVERRIDE_PATH` from `../paths`, and
   `type CommandResult` from `./types`.
2. Change `DOCKER_TIMEOUTS` to:

   ```ts
   export const DOCKER_TIMEOUTS = { query: 60_000, pull: 1_800_000, run: 300_000 } as const;
   ```

3. Inside `createDockerRuntime`, add this helper next to `docker()`:

   ```ts
     /** The written project: compose.yaml, the user's override if present, and .env. */
     async function projectArgs(): Promise<string[]> {
       const override = join(options.home, OVERRIDE_PATH);
       return [
         'compose',
         '-p',
         options.project,
         '--project-directory',
         options.home,
         '-f',
         join(options.home, COMPOSE_PATH),
         ...((await exists(override)) ? ['-f', override] : []),
         '--env-file',
         join(options.home, ENV_PATH),
       ];
     }
   ```

4. Add these members to the returned object:

   ```ts
       async pull(values) {
         const result = await docker(
           'compose pull',
           [...(await projectArgs()), 'pull', '--policy', 'missing', '--quiet'],
           { timeoutMs: DOCKER_TIMEOUTS.pull },
         );
         return commandResult(result, values);
       },

       async up(waitSeconds, values) {
         const result = await docker(
           'compose up',
           [
             ...(await projectArgs()),
             'up',
             '--detach',
             '--wait',
             '--wait-timeout',
             String(waitSeconds),
             '--remove-orphans',
             '--quiet-pull',
           ],
           { timeoutMs: (waitSeconds + 120) * 1000 },
         );
         return commandResult(result, values);
       },

       async chown(service, path, owner, values) {
         const result = await docker(
           'compose run',
           [
             ...(await projectArgs()),
             'run',
             '--rm',
             '--no-deps',
             '--no-tty',
             '--user',
             '0:0',
             '--entrypoint',
             'chown',
             service,
             '-R',
             `${String(owner.uid)}:${String(owner.gid)}`,
             path,
           ],
           { timeoutMs: DOCKER_TIMEOUTS.run },
         );
         return commandResult(result, values);
       },
   ```

5. Add at module level:

   ```ts
   /** Success, or Compose's last three stderr lines with secret values replaced. */
   function commandResult(result: ExecResult, values: Record<string, string>): CommandResult {
     if (result.code === 0) return { ok: true };
     const lines = result.stderr
       .split('\n')
       .map((line) => line.trimEnd())
       .filter((line) => line !== '');
     return { ok: false, error: redact(lines.slice(-3).join('\n'), values) };
   }
   ```

In `packages/engine/src/testing/fakes.ts`:

- Add the imports `readFile` from `node:fs/promises`, `join` from `node:path`,
  `stringify` beside `parse` from `yaml`, `COMPOSE_PATH` and `ENV_PATH` from
  `../paths`, and `type CommandResult` from `../runtime/types`.
- Extend `fakeRuntime`:

```ts
export interface FakeRuntimeOptions {
  versions?: { engine: string; compose: string };
  containers?: ContainerState[];
  hashes?: HashesResult;
  /** When set, Docker is unreachable with this message. */
  unavailable?: string;
  pull?: CommandResult;
  up?: CommandResult;
  chown?: CommandResult;
  /** Each call is appended here, e.g. "pull" or "chown seerr 1000:1000 /app/config". */
  calls?: string[];
}

/** A Docker that answers from memory. */
export function fakeRuntime(options: FakeRuntimeOptions = {}): Runtime {
  const record = (call: string) => options.calls?.push(call);
  return {
    versions: () => {
      record('versions');
      return options.unavailable === undefined
        ? Promise.resolve(options.versions ?? { engine: '29.8.0', compose: '5.5.1' })
        : Promise.reject(new RuntimeError(options.unavailable));
    },
    configHashes: (compose, values) => {
      record('configHashes');
      return Promise.resolve(options.hashes ?? { ok: true, hashes: fakeHash(compose, values) });
    },
    containers: () => {
      record('containers');
      return Promise.resolve(options.containers ?? []);
    },
    pull: () => {
      record('pull');
      return Promise.resolve(options.pull ?? { ok: true });
    },
    up: () => {
      record('up');
      return Promise.resolve(options.up ?? { ok: true });
    },
    chown: (service, path, owner) => {
      record(`chown ${service} ${String(owner.uid)}:${String(owner.gid)} ${path}`);
      return Promise.resolve(options.chown ?? { ok: true });
    },
  };
}

/**
 * A Docker whose `up` starts what is written in `home`. Afterwards containers() reports a
 * running, healthy `fake-<service>` per service, labelled with the fakeHash of the written
 * compose.yaml and .env. Like Compose, it hashes a guest (`network_mode: service:<host>`)
 * as `container:<host's id>`.
 */
export function fakeDocker(
  home: string,
  options: FakeRuntimeOptions & { upChangesNothing?: boolean } = {},
): Runtime & { calls: string[] } {
  const calls: string[] = [];
  const base = fakeRuntime({ ...options, calls });
  let containers = options.containers ?? [];
  return {
    ...base,
    calls,
    containers: () => {
      calls.push('containers');
      return Promise.resolve(containers);
    },
    up: async (waitSeconds, values) => {
      const result = await base.up(waitSeconds, values);
      if (!result.ok || options.upChangesNothing === true) return result;
      const compose = parse(await readFile(join(home, COMPOSE_PATH), 'utf8')) as {
        services: Record<string, Record<string, unknown>>;
      };
      for (const config of Object.values(compose.services)) {
        const mode = config.network_mode;
        const host = typeof mode === 'string' ? /^service:(.+)$/.exec(mode)?.[1] : undefined;
        if (host !== undefined) config.network_mode = `container:fake-${host}`;
      }
      const env = parseEnvFile(await readFile(join(home, ENV_PATH), 'utf8'));
      containers = running(fakeHash(stringify(compose), env));
      return result;
    },
  };
}
```

`running()` already names containers `fake-<service>`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): add pull, up and chown to the runtime, with a stateful fake"
```

---

### Task 7: Change history

**Files:**
- Create: `packages/engine/src/history/records.ts`
- Modify: `packages/engine/src/index.ts`
- Test: create `packages/engine/src/history/records.test.ts`

**Interfaces:**
- **Consumes:**
  - from Task 4: `writeFileAtomic`, `ensureDir`, `HISTORY_DIR`;
  - from Task 5: `RandomBytes`;
  - `FileChange['status']` and `ContainerAction`.
- **Produces:**
  - `CHANGE_SCHEMA = 'mediaplane.change/v1'`.
  - **`changeRecordSchema`, a Zod schema,** with these types derived from it:
    - `ChangeRecord`;
    - `ActionResult = { step: ApplyStep; result: 'done' | 'failed' | 'skipped'; detail?: string; error?: string }`;
    - `ApplyStep = 'keys' | 'files' | 'pull' | 'ownership' | 'start' | 'verify'`.
  - **The record's fields:** `schema`, `id`, `trigger: 'cli'`, `startedAt`,
    `finishedAt` (ISO strings), `durationMs`, `outcome: 'success' | 'failed'`,
    `stackSha256`, `plan: { files: {path, status}[]; containers; secrets: { generate } }`
    and `actions`. Secret values never appear in a record (spec §5 step 12).
  - **`newRecordId(at: Date, random?): string`,** for example
    `20261009T094312Z-a1b2c3d4`. Ids sort by time and are unique within a second.
  - **`stackSha256(source: string): string`.**
  - **`writeRecord(home, record): Promise<void>`.** It writes
    `state/history/<id>.json`, with the folder at 0700 and the file at 0600.
  - **`listRecords(home): Promise<{ records: ChangeRecord[]; unreadable: string[] }>`.**
    Newest first. A missing folder gives no records; files that don't validate are listed
    in `unreadable` rather than throwing.
  - **`readRecord(home, id): Promise<ChangeRecord | undefined>`.** It returns
    `undefined` for an unknown id, or for one that doesn't match the id format, which
    also rules out path traversal.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/history/records.test.ts`:

```ts
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HISTORY_DIR } from '../paths';
import {
  CHANGE_SCHEMA,
  listRecords,
  newRecordId,
  readRecord,
  stackSha256,
  writeRecord,
  type ChangeRecord,
} from './records';

function record(id: string, outcome: ChangeRecord['outcome'] = 'success'): ChangeRecord {
  return {
    schema: CHANGE_SCHEMA,
    id,
    trigger: 'cli',
    startedAt: '2026-10-09T09:43:12.000Z',
    finishedAt: '2026-10-09T09:44:02.500Z',
    durationMs: 50_500,
    outcome,
    stackSha256: stackSha256('version: 1\n'),
    plan: {
      files: [{ path: 'generated/compose.yaml', status: 'create' }],
      containers: [{ service: 'sonarr', action: 'create' }],
      secrets: { generate: ['sonarr.apiKey'] },
    },
    actions: [
      { step: 'keys', result: 'done', detail: 'generated sonarr.apiKey' },
      { step: 'pull', result: 'failed', error: 'fake registry unreachable' },
      { step: 'start', result: 'skipped' },
    ],
  };
}

describe('newRecordId', () => {
  it('sorts by time and adds random hex', () => {
    const id = newRecordId(new Date('2026-10-09T09:43:12.345Z'), (size) => Buffer.alloc(size, 0xab));
    expect(id).toBe('20261009T094312Z-abababab');
  });
});

describe('stackSha256', () => {
  it('is the hex SHA-256 of the text', () => {
    expect(stackSha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('history records', () => {
  it('writes private records and reads them back, newest first', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-history-'));
    await writeRecord(home, record('20261009T094312Z-00000001'));
    await writeRecord(home, record('20261010T080000Z-00000002', 'failed'));
    const { records, unreadable } = await listRecords(home);
    expect(records.map((r) => r.id)).toEqual([
      '20261010T080000Z-00000002',
      '20261009T094312Z-00000001',
    ]);
    expect(unreadable).toEqual([]);
    expect(await readRecord(home, '20261009T094312Z-00000001')).toEqual(
      record('20261009T094312Z-00000001'),
    );
    expect((await stat(join(home, HISTORY_DIR))).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(home, HISTORY_DIR, '20261009T094312Z-00000001.json'))).mode & 0o777,
    ).toBe(0o600);
  });

  it('has no records before the first apply', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-history-'));
    expect(await listRecords(home)).toEqual({ records: [], unreadable: [] });
  });

  it('lists files it cannot read instead of failing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-history-'));
    await mkdir(join(home, HISTORY_DIR), { recursive: true });
    await writeFile(join(home, HISTORY_DIR, '20261009T094312Z-00000001.json'), '{"oops"');
    expect(await listRecords(home)).toEqual({
      records: [],
      unreadable: ['20261009T094312Z-00000001.json'],
    });
  });

  it('finds nothing for an unknown or malformed id', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-history-'));
    expect(await readRecord(home, '20261009T094312Z-ffffffff')).toBeUndefined();
    expect(await readRecord(home, '../../etc/passwd')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/history`

Expected: FAIL, because `./records` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/engine/src/history/records.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { HISTORY_DIR } from '../paths';
import type { RandomBytes } from '../secrets/generate';
import { ensureDir, writeFileAtomic } from '../util/atomic';
import { readIfExists } from '../util/fs';
import { compare } from '../util/sort';

export const CHANGE_SCHEMA = 'mediaplane.change/v1';

/** 20261009T094312Z-a1b2c3d4 */
const RECORD_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

const actionSchema = z.strictObject({
  step: z.enum(['keys', 'files', 'pull', 'ownership', 'start', 'verify']),
  result: z.enum(['done', 'failed', 'skipped']),
  detail: z.string().optional(),
  error: z.string().optional(),
});

/** One apply, as recorded in state/history/<id>.json. Never holds a secret value. */
export const changeRecordSchema = z.strictObject({
  schema: z.literal(CHANGE_SCHEMA),
  id: z.string().regex(RECORD_ID),
  trigger: z.literal('cli'),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  durationMs: z.int().min(0),
  outcome: z.enum(['success', 'failed']),
  stackSha256: z.string().regex(/^[0-9a-f]{64}$/),
  plan: z.strictObject({
    files: z.array(
      z.strictObject({
        path: z.string(),
        status: z.enum(['create', 'update', 'unchanged']),
      }),
    ),
    containers: z.array(
      z.strictObject({
        service: z.string(),
        action: z.enum(['create', 'recreate', 'start', 'remove', 'unchanged']),
      }),
    ),
    secrets: z.strictObject({ generate: z.array(z.string()) }),
  }),
  actions: z.array(actionSchema),
});

export type ChangeRecord = z.infer<typeof changeRecordSchema>;
export type ActionResult = z.infer<typeof actionSchema>;
export type ApplyStep = ActionResult['step'];

/** A record id that sorts by time and is unique within a second. */
export function newRecordId(at: Date, random: RandomBytes = randomBytes): string {
  const stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `${stamp}-${random(4).toString('hex')}`;
}

export function stackSha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

export async function writeRecord(home: string, record: ChangeRecord): Promise<void> {
  await ensureDir(join(home, HISTORY_DIR), 0o700);
  await writeFileAtomic(
    join(home, HISTORY_DIR, `${record.id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    0o600,
  );
}

/** Every record, newest first. Files that don't validate are listed, not thrown. */
export async function listRecords(
  home: string,
): Promise<{ records: ChangeRecord[]; unreadable: string[] }> {
  let names: string[];
  try {
    names = await readdir(join(home, HISTORY_DIR));
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      return { records: [], unreadable: [] };
    }
    throw cause;
  }
  const records: ChangeRecord[] = [];
  const unreadable: string[] = [];
  for (const name of names.filter((n) => n.endsWith('.json')).sort(compare).reverse()) {
    const record = parseRecord(await readFile(join(home, HISTORY_DIR, name), 'utf8'));
    if (record === undefined) unreadable.push(name);
    else records.push(record);
  }
  return { records, unreadable };
}

/** One record, or undefined for an unknown id (or one that isn't a record id at all). */
export async function readRecord(
  home: string,
  id: string,
): Promise<ChangeRecord | undefined> {
  if (!RECORD_ID.test(id)) return undefined;
  const text = await readIfExists(join(home, HISTORY_DIR, `${id}.json`));
  return text === undefined ? undefined : parseRecord(text);
}

function parseRecord(text: string): ChangeRecord | undefined {
  try {
    const parsed = changeRecordSchema.safeParse(JSON.parse(text) as unknown);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
```

Add `export * from './history/records';` to `packages/engine/src/index.ts`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/history && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): record each apply in state/history"
```

---

### Task 8: Appdata ownership

**Files:**
- Create: `packages/engine/src/apply/ownership.ts`
- Test: create `packages/engine/src/apply/ownership.test.ts`

**Interfaces:**
- **Consumes:**
  - `ResolvedStack` and `ResolvedApp`, where `def.runAs` is `'puid-env'`,
    `'user-directive'`, `'image-default'` or `` `fixed:${number}` ``, and
    `def.volumes.appdata` is the container path;
  - `HostProbe.stat`;
  - from Task 4: `APPDATA_DIR`.
- **Produces:**
  - **`requiredOwner(app, stack): { uid; gid } | undefined`.** It is the stack's `user`
    for `user-directive`, `N:N` for `fixed:N`, and `undefined` otherwise.
    linuxserver images (`puid-env`) chown their own `/config`, and `image-default` apps
    run as root.
  - **`appdataPath(stack, app): string`,** which is `<home>/appdata/<id>`. This matches
    the renderer's volume.
  - **`ensureAppdataDirs(stack): Promise<void>`.** It creates each app's appdata folder
    as the Mediaplane user, so Docker doesn't create it as root.
  - **`interface OwnershipFix { service; hostPath; containerPath; uid; gid }`.**
  - **`ownershipFixes(stack, probe): Promise<OwnershipFix[]>`.** Appdata folders whose
    owner differs from what their app needs, in app order. A missing folder counts as
    needing a fix.

Seerr runs as uid 1000 (`fixed:1000`). Its folder, created by Mediaplane as another
user, must be chowned before it starts, or Seerr cannot write its settings. This was
verified on 2026-10-09: the `compose run` chown gave the folder `1000:1000`, and Seerr
went healthy.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/apply/ownership.test.ts`:

```ts
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Catalog } from '../catalog/types';
import type { PathStat } from '../preflight/probe';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { fakeProbe } from '../testing/fakes';
import { FIXTURE_HOST, fixtureApp, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { ensureAppdataDirs, ownershipFixes, requiredOwner } from './ownership';

const CATALOG: Catalog = [
  ...fixtureCatalog,
  fixtureApp({ id: 'requests', category: 'requests', runAs: 'fixed:2000', volumes: { appdata: '/app/config' } }),
  fixtureApp({ id: 'solver', category: 'indexer', runAs: 'user-directive', volumes: { appdata: '/data' } }),
];

function stackIn(home: string): ResolvedStack {
  const source = `version: 1
user: { uid: 1500, gid: 1600 }
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  requests: {}
  solver: {}
`;
  const result = resolveStack(fixtureConfig(source), CATALOG, FIXTURE_HOST, home);
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

const owned = (uid: number, gid: number): PathStat => ({
  isDirectory: true,
  isCharacterDevice: false,
  uid,
  gid,
  mode: 0o40755,
  dev: 1,
});

describe('requiredOwner', () => {
  it('is fixed:N, the stack user for user-directive, and nothing otherwise', () => {
    const stack = stackIn('/opt/mediaplane');
    const owner = (id: string) => {
      const app = stack.apps.find((a) => a.def.id === id);
      if (app === undefined) throw new Error(`no ${id}`);
      return requiredOwner(app, stack);
    };
    expect(owner('requests')).toEqual({ uid: 2000, gid: 2000 });
    expect(owner('solver')).toEqual({ uid: 1500, gid: 1600 });
    expect(owner('jellyfin')).toBeUndefined();
  });
});

describe('ownershipFixes', () => {
  it('lists folders that are missing or owned by someone else', async () => {
    const stack = stackIn('/opt/mediaplane');
    const probe = fakeProbe({
      stats: {
        '/opt/mediaplane/appdata/requests': undefined,
        '/opt/mediaplane/appdata/solver': owned(1002, 1002),
      },
    });
    expect(await ownershipFixes(stack, probe)).toEqual([
      { service: 'requests', hostPath: '/opt/mediaplane/appdata/requests', containerPath: '/app/config', uid: 2000, gid: 2000 },
      { service: 'solver', hostPath: '/opt/mediaplane/appdata/solver', containerPath: '/data', uid: 1500, gid: 1600 },
    ]);
  });

  it('is empty when every folder already has the right owner', async () => {
    const stack = stackIn('/opt/mediaplane');
    const probe = fakeProbe({
      stats: {
        '/opt/mediaplane/appdata/requests': owned(2000, 2000),
        '/opt/mediaplane/appdata/solver': owned(1500, 1600),
      },
    });
    expect(await ownershipFixes(stack, probe)).toEqual([]);
  });
});

describe('ensureAppdataDirs', () => {
  it("creates every app's appdata folder", async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-ownership-'));
    await ensureAppdataDirs(stackIn(home));
    expect((await readdir(join(home, 'appdata'))).sort()).toEqual(['jellyfin', 'requests', 'solver']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/apply`

Expected: FAIL, because `./ownership` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/engine/src/apply/ownership.ts`:

```ts
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { APPDATA_DIR } from '../paths';
import type { HostProbe } from '../preflight/probe';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';

export interface OwnershipFix {
  service: string;
  hostPath: string;
  /** Where the app mounts the folder; chown runs on this path inside its container. */
  containerPath: string;
  uid: number;
  gid: number;
}

/**
 * The owner an app's appdata folder must have, when the app needs a specific one.
 * linuxserver images (puid-env) chown their own /config, and image-default apps run as root.
 */
export function requiredOwner(
  app: ResolvedApp,
  stack: ResolvedStack,
): { uid: number; gid: number } | undefined {
  if (app.def.runAs === 'user-directive') return stack.config.user;
  const fixed = /^fixed:(\d+)$/.exec(app.def.runAs)?.[1];
  return fixed === undefined ? undefined : { uid: Number(fixed), gid: Number(fixed) };
}

/** <home>/appdata/<id>, the folder the renderer mounts as the app's appdata volume. */
export function appdataPath(stack: ResolvedStack, app: ResolvedApp): string {
  return join(stack.home, APPDATA_DIR, app.def.id);
}

/** Create every app's appdata folder now, so Docker doesn't create it as root. */
export async function ensureAppdataDirs(stack: ResolvedStack): Promise<void> {
  for (const app of stack.apps) {
    if (app.def.volumes.appdata !== undefined) {
      await mkdir(appdataPath(stack, app), { recursive: true });
    }
  }
}

/** Appdata folders whose owner differs from what their app runs as (missing ones too). */
export async function ownershipFixes(
  stack: ResolvedStack,
  probe: HostProbe,
): Promise<OwnershipFix[]> {
  const fixes: OwnershipFix[] = [];
  for (const app of stack.apps) {
    const containerPath = app.def.volumes.appdata;
    const owner = requiredOwner(app, stack);
    if (containerPath === undefined || owner === undefined) continue;
    const hostPath = appdataPath(stack, app);
    const stat = await probe.stat(hostPath);
    if (stat?.uid === owner.uid && stat.gid === owner.gid) continue;
    fixes.push({ service: app.def.id, hostPath, containerPath, ...owner });
  }
  return fixes;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/apply && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): work out which appdata folders need a different owner"
```

---

### Task 9: `.env` in the plan, and the plan's context

**Files:**
- Modify: `packages/engine/src/plan/files.ts`, `packages/engine/src/plan/plan.ts`,
  `packages/cli/src/output.ts`
- Test: `packages/engine/src/plan/plan.test.ts`, `packages/engine/src/plan/files.test.ts`,
  `packages/cli/src/run.test.ts`

**Interfaces:**
- **Consumes:**
  - from Task 3: `dockerUnavailable` and the try/catch around `predictContainers`;
  - from Task 4: `COMPOSE_PATH`, `ENV_PATH`, `STACK_PATH`;
  - from Task 5: `renderEnvFile`.
- **Produces:**
  - **`RenderedFile.sensitive?: boolean` and `FileChange.sensitive?: boolean`.** A
    sensitive file is compared with what is on disk, giving `create`, `update` or
    `unchanged`. Its `diff` and `content` are always `''`, so secret values never enter
    a `PlanResult`.
  - **`generated/.env` in every plan's `files`,** after `compose.yaml`, marked
    `sensitive: true`. `changed` counts it.
  - **`interface PlanContext { stack: ResolvedStack; compose: ComposeFile; store: SecretStore; current: ContainerState[] }`.**
  - **`planStack(options): Promise<{ result: PlanResult; context: PlanContext | undefined }>`.**
    `plan(options)` returns `(await planStack(options)).result`. `context` is
    `undefined` whenever `result.ok` is false.
  - **The CLI.** The human plan prints a sensitive file as
    `+ generated/.env (secret values, not shown)` (or `~`) with no diff. The JSON keeps
    `sensitive: true` and still omits `content`.

The `.env` file holds the secret values, and Compose reads it through `--env-file`. A
deleted or hand-edited `.env` must show up in `plan`, so the next `apply` rewrites it,
but its contents must never be shown.

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine/src/plan/files.test.ts` (use its existing imports, and add
`mkdtemp`, `mkdir`, `writeFile`, `tmpdir` and `join` as needed):

```ts
  it('compares a sensitive file without ever diffing or keeping its content', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-files-'));
    await mkdir(join(home, 'generated'));
    const file = { path: 'generated/.env', content: "MP_X='fake-new'\n", sensitive: true };
    expect(await diffFiles(home, [file])).toEqual([
      { path: 'generated/.env', status: 'create', diff: '', content: '', sensitive: true },
    ]);
    await writeFile(join(home, 'generated/.env'), "MP_X='fake-old'\n");
    expect((await diffFiles(home, [file]))[0]).toMatchObject({ status: 'update', diff: '', content: '' });
    await writeFile(join(home, 'generated/.env'), file.content);
    expect((await diffFiles(home, [file]))[0]).toMatchObject({ status: 'unchanged', content: '' });
  });
```

In `packages/engine/src/plan/plan.test.ts`:

1. Import `ENV_PATH` from `../paths`, `renderEnvFile` from `../render/env`, and
   `planStack` beside `plan` from `./plan`.
2. Add a helper next to `makeHome`:

   ```ts
   /** The .env of a current home: the fixture's VPN key and the stored sonarr key. */
   async function writeCurrentEnv(home: string): Promise<void> {
     await writeFile(
       join(home, ENV_PATH),
       renderEnvFile({
         MP_GLUETUN_WIREGUARD_KEY: 'fake-wireguard-key-for-tests',
         MP_SONARR_API_KEY: '0'.repeat(32),
       }),
     );
   }
   ```

3. In **every** test that writes `compose.yaml` to reach a no-changes plan, call
   `await writeCurrentEnv(home);` right after writing `compose.yaml`. At least "reports
   no changes when files, containers and secrets are current" and "keeps the VPN guest
   unchanged when it and its host are current" do this. In those tests, change any
   `expect(result.files).toEqual([expect.objectContaining({ status: 'unchanged' })]);`
   to:

   ```ts
       expect(result.files).toEqual([
         expect.objectContaining({ path: COMPOSE_PATH, status: 'unchanged' }),
         expect.objectContaining({ path: ENV_PATH, status: 'unchanged', sensitive: true }),
       ]);
   ```

4. In "plans files, containers and secrets for a fresh home", replace the `files`
   assertion with:

   ```ts
       expect(result.files).toEqual([
         expect.objectContaining({ path: COMPOSE_PATH, status: 'create' }),
         { path: ENV_PATH, status: 'create', diff: '', content: '', sensitive: true },
       ]);
   ```

5. Add:

   ```ts
     it('notices a stale .env without showing what is in it', async () => {
       const home = await makeHome({ withStore: true });
       const runtime = fakeRuntime({ hashes: { ok: true, hashes: HASHES }, containers: running(HASHES) });
       const first = await planFor(home, { runtime });
       await mkdir(join(home, 'generated'));
       await writeFile(join(home, COMPOSE_PATH), first.files[0]?.content ?? '');
       await writeFile(join(home, ENV_PATH), "MP_SONARR_API_KEY='fake-edited-by-hand'\n");
       const result = await planFor(home, { runtime });
       expect(result.changed).toBe(true);
       expect(result.files[1]).toEqual({
         path: ENV_PATH,
         status: 'update',
         diff: '',
         content: '',
         sensitive: true,
       });
       expect(JSON.stringify(result)).not.toContain('fake-wireguard-key-for-tests');
     });

     it('gives apply the resolved stack, compose and store of a successful plan', async () => {
       const ok = await planStack({
         home: await makeHome(),
         catalog: fixtureCatalog,
         host: FIXTURE_HOST,
         env: {},
         runtime: fakeRuntime(),
         probe: fakeProbe(),
       });
       expect(ok.context?.stack.apps.map((a) => a.def.id)).toEqual([
         'gluetun',
         'jellyfin',
         'qbittorrent',
         'sonarr',
       ]);
       expect(Object.keys(ok.context?.compose.services ?? {})).toHaveLength(4);
       const failed = await planStack({
         home: await makeHome({ withSecret: false }),
         catalog: fixtureCatalog,
         host: FIXTURE_HOST,
         env: {},
         runtime: fakeRuntime(),
         probe: fakeProbe(),
       });
       expect(failed).toMatchObject({ result: { ok: false }, context: undefined });
     });
   ```

In `packages/cli/src/run.test.ts`:

1. Import `renderEnvFile` beside `plan` from `@mediaplane/engine`.
2. In "exits 2 and shows files, containers and secrets for a fresh home", change the
   summary line to
   `'Plan: 2 files to write, 4 containers to change, 2 secrets to generate.'` and add
   `expect(term.stdout()).toContain('+ generated/.env (secret values, not shown)\n');`.
3. In "prints versioned JSON without file contents", add:

   ```ts
       expect(json.files[1]).toEqual({
         path: 'generated/.env',
         status: 'create',
         diff: '',
         sensitive: true,
       });
   ```

4. In "exits 0 when nothing would change", after writing `compose.yaml`, add:

   ```ts
       await writeFile(
         join(home, 'generated', '.env'),
         renderEnvFile({
           MP_GLUETUN_WIREGUARD_KEY: 'fake-wireguard-key-for-tests',
           MP_SONARR_API_KEY: '0'.repeat(32),
         }),
       );
   ```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/plan packages/cli`

Expected: FAIL. `sensitive` is ignored, `.env` isn't in the plan, and `planStack`
doesn't exist.

- [ ] **Step 3: Implement**

In `packages/engine/src/plan/files.ts`:

- Add `/** Holds secret values: compared with what is on disk, never diffed or kept. */
  sensitive?: boolean;` to both `RenderedFile` and `FileChange`.
- Add `/** Empty for a sensitive file. */` to the comments on `FileChange.diff` and
  `FileChange.content`.
- In `diffFiles`, right after `const current = await readIfExists(...)`, add:

  ```ts
      if (file.sensitive === true) {
        const status =
          current === undefined ? 'create' : current === file.content ? 'unchanged' : 'update';
        return { path: file.path, status, diff: '', content: '', sensitive: true };
      }
  ```

Replace `packages/engine/src/plan/plan.ts` with:

```ts
import { join, resolve } from 'node:path';
import type { Catalog } from '../catalog/types';
import { loadConfigFile } from '../config/load';
import { checkSecretRefs } from '../config/secrets';
import { error, hasErrors, type Diagnostic } from '../diagnostics';
import type { HostFacts } from '../host/facts';
import { COMPOSE_PATH, ENV_PATH, STACK_PATH } from '../paths';
import { runPreflight } from '../preflight/checks';
import type { HostProbe } from '../preflight/probe';
import { renderCompose, type ComposeFile } from '../render/compose';
import { renderEnvFile } from '../render/env';
import { composeToYaml } from '../render/yaml';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
import { readSecretStore, type SecretStore } from '../secrets/store';
import { secretsToGenerate, secretValues } from '../secrets/values';
import { ownPorts, type ContainerChange } from './containers';
import { diffFiles, type FileChange } from './files';
import { predictContainers, type PredictResult } from './predict';

export interface PlanOptions {
  home: string;
  catalog: Catalog;
  host: HostFacts;
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  probe: HostProbe;
}

export interface PlanResult {
  /** False when any diagnostic is an error; files and containers are then empty. */
  ok: boolean;
  changed: boolean;
  files: FileChange[];
  containers: ContainerChange[];
  /** Names ("sonarr.apiKey"), never values. */
  secrets: { generate: string[] };
  diagnostics: Diagnostic[];
}

/** What apply builds on after a successful plan, so it never works it out differently. */
export interface PlanContext {
  stack: ResolvedStack;
  compose: ComposeFile;
  store: SecretStore;
  current: ContainerState[];
}

/** Everything apply would do, without doing it. Writes nothing. */
export async function plan(options: PlanOptions): Promise<PlanResult> {
  return (await planStack(options)).result;
}

/** plan(), plus the context apply builds on (undefined whenever the plan failed). */
export async function planStack(
  options: PlanOptions,
): Promise<{ result: PlanResult; context: PlanContext | undefined }> {
  const home = resolve(options.home);
  if (home.includes(':')) {
    return failed([
      error('home.invalid', `the Mediaplane home ${home} must not contain ":"`, {
        hint: 'Docker uses ":" to separate volume paths; choose a path without one',
      }),
    ]);
  }
  const loaded = await loadConfigFile(join(home, STACK_PATH));
  if (!loaded.ok) return failed(loaded.diagnostics);

  const diagnostics = await checkSecretRefs(loaded.config, home, options.env);
  const resolved = resolveStack(loaded.config, options.catalog, options.host, home);
  diagnostics.push(...resolved.diagnostics);
  if (resolved.stack === undefined || hasErrors(diagnostics)) return failed(diagnostics);
  const stack = resolved.stack;

  let versions: { engine: string; compose: string };
  let current: ContainerState[];
  try {
    versions = await options.runtime.versions();
    current = await options.runtime.containers();
  } catch (cause) {
    if (!(cause instanceof RuntimeError)) throw cause;
    return failed([...diagnostics, dockerUnavailable(cause)]);
  }

  diagnostics.push(
    ...(await runPreflight({ stack, versions, ownPorts: ownPorts(current) }, options.probe)),
  );
  if (hasErrors(diagnostics)) return failed(diagnostics);

  const compose = renderCompose(stack);
  const store = await readSecretStore(home);
  const values = await secretValues(stack, store, options.env);
  const files = await diffFiles(home, [
    { path: COMPOSE_PATH, content: composeToYaml(compose, home) },
    // The secret values: compared with what is on disk, never shown or kept.
    { path: ENV_PATH, content: renderEnvFile(values), sensitive: true },
  ]);
  const generate = secretsToGenerate(stack, store);
  let predicted: PredictResult;
  try {
    predicted = await predictContainers(compose, values, options.runtime, current);
  } catch (cause) {
    if (!(cause instanceof RuntimeError)) throw cause;
    return failed([...diagnostics, dockerUnavailable(cause)]);
  }
  if (!predicted.ok) {
    return failed([
      ...diagnostics,
      error(
        'compose.invalid',
        `docker compose rejected the configuration: ${predicted.error}`,
        { hint: 'if you have a compose.override.yaml next to stack.yaml, check it' },
      ),
    ]);
  }
  const containers = predicted.changes;
  return {
    result: {
      ok: true,
      changed:
        files.some((file) => file.status !== 'unchanged') ||
        containers.some((change) => change.action !== 'unchanged') ||
        generate.length > 0,
      files,
      containers,
      secrets: { generate },
      diagnostics,
    },
    context: { stack, compose, store, current },
  };
}

function failed(diagnostics: Diagnostic[]): { result: PlanResult; context: undefined } {
  return {
    result: {
      ok: false,
      changed: false,
      files: [],
      containers: [],
      secrets: { generate: [] },
      diagnostics,
    },
    context: undefined,
  };
}

function dockerUnavailable(cause: RuntimeError): Diagnostic {
  return error('docker.unavailable', cause.message, {
    hint: 'start Docker, and make sure your user can run "docker ps" (for example, add it to the docker group)',
  });
}
```

In `packages/cli/src/output.ts`, inside `printPlan`, replace the loop that prints the
changed files with:

```ts
  for (const file of files) {
    const mark = file.status === 'create' ? '+' : '~';
    io.stdout(
      file.sensitive === true
        ? `${mark} ${file.path} (secret values, not shown)\n\n`
        : `${mark} ${file.path}\n${file.diff}\n`,
    );
  }
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine packages/cli && pnpm typecheck`

Expected: PASS. The spawned tests in `main.test.ts` still see
`+ generated/compose.yaml`.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): plan the private .env without showing it, and expose the plan context"
```

---

### Task 10: `apply()`

**Files:**
- Create: `packages/engine/src/apply/apply.ts`
- Modify: `packages/engine/src/index.ts`
- Test: create `packages/engine/src/apply/apply.test.ts`

**Interfaces:**
- **Consumes:**
  - `planStack`, `plan`, `PlanOptions` and `PlanResult` (Task 9);
  - `withGeneratedSecrets` and `RandomBytes` (Task 5), and `writeSecretStore`;
  - `renderEnvFile` (Task 5) and `composeToYaml`;
  - `writeFileAtomic` (Task 4) and `readIfExists`;
  - `acquireLock` and `LockedError` (Task 4);
  - `ensureAppdataDirs` and `ownershipFixes` (Task 8);
  - `CHANGE_SCHEMA`, `newRecordId`, `stackSha256`, `writeRecord`, `ActionResult` and
    `ApplyStep` (Task 7);
  - `Runtime.pull`, `up`, `chown` and `containers` (Task 6);
  - `fakeDocker` (Task 6) in tests.
- **Produces:**
  - `DEFAULT_WAIT_SECONDS = 600`.
  - **`type StepEvent`:** `{ step; phase: 'start' }` or
    `{ step; phase: 'end'; action: ActionResult }`.
  - **`interface ApplyOptions extends PlanOptions`,** adding:
    - `confirm(plan): Promise<boolean>`;
    - `onStep?(event)`;
    - `random?: RandomBytes`;
    - `now?(): Date`;
    - `waitSeconds?: number`.
  - **`type ApplyOutcome`:**
    `'success' | 'failed' | 'no-changes' | 'cancelled' | 'invalid'`.
  - **`interface ApplyResult`:**
    - `outcome`;
    - `plan: PlanResult` (the plan shown);
    - `actions: ActionResult[]`;
    - `recordId: string | undefined`;
    - `diagnostics: Diagnostic[]` (the plan's warnings, plus one error per failed step).
  - **`apply(options): Promise<ApplyResult>`.** Its steps, in order, are `keys`,
    `files`, `pull`, `ownership`, `start` and `verify`. Each failed step adds the
    diagnostic `apply.<step>-failed`. A held lock gives `apply.locked`.
  - **`unhealthyServices(containers): string[]`,** for example `['byparr (starting)',
    'seerr (exited)']`, sorted.

**How each outcome behaves:**

| Outcome | When | Files written | Record |
|---|---|---|---|
| `invalid` | `stack.yaml` is missing, the plan has errors, or the lock is held | none | none |
| `no-changes` | the plan shows nothing to do; `confirm` is never called | none | none |
| `cancelled` | `confirm` resolves `false` | none | none |
| `success` | every step is done | yes | yes |
| `failed` | a step failed; the later steps are `skipped` | up to the failed step | yes |

- **Writes happen only after confirmation.** Taking the lock creates `state/` (0700);
  everything else waits for `confirm`.
- **No outcome rolls back.** A failed step is not undone (ADR 0004).
- **The verify step** re-plans and fails if anything still differs (spec §5 step 11).

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/apply/apply.test.ts`:

```ts
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Catalog } from '../catalog/types';
import { listRecords } from '../history/records';
import { ENV_PATH, LOCK_PATH, SECRETS_PATH } from '../paths';
import type { ContainerState, Runtime } from '../runtime/types';
import { fakeDocker, fakeProbe } from '../testing/fakes';
import { FIXTURE_HOST, fixtureApp, fixtureCatalog } from '../testing/fixtures';
import { apply, unhealthyServices, type ApplyOptions } from './apply';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
  sonarr: {}
`;

/** Always 0xab, so generated secrets and record ids are predictable. */
const random = (size: number) => Buffer.alloc(size, 0xab);
const now = () => new Date('2026-10-09T09:43:12.000Z');
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

async function makeHome(stack = STACK): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-apply-'));
  await writeFile(join(home, 'stack.yaml'), stack);
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  return home;
}

function options(
  home: string,
  runtime: Runtime,
  extra: Partial<ApplyOptions> = {},
): ApplyOptions {
  return {
    home,
    catalog: fixtureCatalog,
    host: FIXTURE_HOST,
    env: {},
    runtime,
    probe: fakeProbe(),
    confirm: () => Promise.resolve(true),
    random,
    now,
    ...extra,
  };
}

describe('apply', () => {
  it('generates keys, writes files, pulls, starts, verifies and records', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const events: string[] = [];
    const result = await apply(
      options(home, docker, { onStep: (event) => events.push(`${event.step}:${event.phase}`) }),
    );
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.outcome).toBe('success');
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'done'],
      ['files', 'done'],
      ['pull', 'done'],
      ['ownership', 'done'],
      ['start', 'done'],
      ['verify', 'done'],
    ]);
    expect(result.actions[0]?.detail).toBe('generated sonarr.apiKey');
    expect(events.slice(0, 4)).toEqual(['keys:start', 'keys:end', 'files:start', 'files:end']);

    const env = await readFile(join(home, ENV_PATH), 'utf8');
    expect(env).toContain(`MP_SONARR_API_KEY='${'ab'.repeat(16)}'`);
    expect(env).toContain("MP_GLUETUN_WIREGUARD_KEY='fake-wireguard-key-for-tests'");
    expect(await modeOf(join(home, ENV_PATH))).toBe(0o600);
    expect(JSON.parse(await readFile(join(home, SECRETS_PATH), 'utf8'))).toEqual({
      version: 1,
      apps: { sonarr: { apiKey: 'ab'.repeat(16) } },
    });
    expect(await modeOf(join(home, SECRETS_PATH))).toBe(0o600);
    expect((await readdir(join(home, 'appdata'))).sort()).toEqual([
      'gluetun',
      'jellyfin',
      'qbittorrent',
      'sonarr',
    ]);
    expect(docker.calls.indexOf('pull')).toBeLessThan(docker.calls.indexOf('up'));
    await expect(stat(join(home, LOCK_PATH))).rejects.toThrow();

    const { records } = await listRecords(home);
    expect(records).toEqual([
      expect.objectContaining({ id: result.recordId, outcome: 'success', trigger: 'cli' }),
    ]);
    expect(result.recordId).toBe('20261009T094312Z-abababab');
    expect(records[0]?.plan.secrets.generate).toEqual(['sonarr.apiKey']);
    const recorded = JSON.stringify(records);
    expect(recorded).not.toContain('ab'.repeat(16));
    expect(recorded).not.toContain('fake-wireguard-key-for-tests');
  });

  it('reports no changes on a second apply, without asking or recording', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    expect((await apply(options(home, docker))).outcome).toBe('success');
    const confirm = vi.fn(() => Promise.resolve(true));
    const second = await apply(options(home, docker, { confirm }));
    expect(second.outcome).toBe('no-changes');
    expect(confirm).not.toHaveBeenCalled();
    expect((await listRecords(home)).records).toHaveLength(1);
  });

  it('changes nothing when the plan is declined', async () => {
    const home = await makeHome();
    const result = await apply(
      options(home, fakeDocker(home), { confirm: () => Promise.resolve(false) }),
    );
    expect(result).toMatchObject({ outcome: 'cancelled', actions: [], recordId: undefined });
    await expect(stat(join(home, 'generated'))).rejects.toThrow();
    await expect(stat(join(home, SECRETS_PATH))).rejects.toThrow();
    await expect(stat(join(home, LOCK_PATH))).rejects.toThrow();
  });

  it('refuses to run while another apply holds the lock', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'state'));
    await writeFile(
      join(home, LOCK_PATH),
      JSON.stringify({ pid: process.pid, host: hostname(), startedAt: '2026-10-09T09:00:00.000Z' }),
    );
    const confirm = vi.fn(() => Promise.resolve(true));
    const result = await apply(options(home, fakeDocker(home), { confirm }));
    expect(result.outcome).toBe('invalid');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'apply.locked' }),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(await readFile(join(home, LOCK_PATH), 'utf8')).toContain('2026-10-09T09:00:00.000Z');
  });

  it("doesn't create state/ in a folder without a stack.yaml", async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-apply-'));
    const result = await apply(options(home, fakeDocker(home)));
    expect(result.outcome).toBe('invalid');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'config.missing' }),
    );
    await expect(stat(join(home, 'state'))).rejects.toThrow();
  });

  it('stops at a failed pull, skips the rest and records the failure', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home, { pull: { ok: false, error: 'fake registry unreachable' } });
    const result = await apply(options(home, docker));
    expect(result.outcome).toBe('failed');
    expect(result.actions.map((a) => [a.step, a.result])).toEqual([
      ['keys', 'done'],
      ['files', 'done'],
      ['pull', 'failed'],
      ['ownership', 'skipped'],
      ['start', 'skipped'],
      ['verify', 'skipped'],
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'apply.pull-failed',
        message: 'fake registry unreachable',
      }),
    );
    expect(docker.calls).not.toContain('up');
    expect((await listRecords(home)).records[0]?.outcome).toBe('failed');
  });

  it('names the apps that did not become healthy', async () => {
    const home = await makeHome();
    const unhealthy: ContainerState = {
      service: 'sonarr',
      id: 'fake-sonarr',
      state: 'running',
      health: 'unhealthy',
      configHash: undefined,
      published: [],
    };
    const docker = fakeDocker(home, {
      containers: [unhealthy],
      up: { ok: false, error: 'application not healthy after 10m0s' },
    });
    const result = await apply(options(home, docker));
    expect(result.outcome).toBe('failed');
    const failure = result.diagnostics.find((d) => d.code === 'apply.start-failed');
    expect(failure?.message).toContain('sonarr (unhealthy)');
    expect(failure?.message).toContain('application not healthy after 10m0s');
  });

  it('fails verification when changes remain after starting', async () => {
    const home = await makeHome();
    const result = await apply(options(home, fakeDocker(home, { upChangesNothing: true })));
    expect(result.outcome).toBe('failed');
    expect(result.actions.at(-1)).toMatchObject({ step: 'verify', result: 'failed' });
    expect(result.diagnostics.find((d) => d.code === 'apply.verify-failed')?.message).toContain(
      'changes remain after apply',
    );
  });

  it('never generates a secret twice', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'state'));
    const stored = JSON.stringify({ version: 1, apps: { sonarr: { apiKey: '0'.repeat(32) } } });
    await writeFile(join(home, SECRETS_PATH), stored);
    const result = await apply(options(home, fakeDocker(home)));
    expect(result.actions[0]).toEqual({ step: 'keys', result: 'done', detail: 'none needed' });
    expect(await readFile(join(home, SECRETS_PATH), 'utf8')).toBe(stored);
  });

  it('gives appdata folders the owner their app needs before starting', async () => {
    const catalog: Catalog = [
      ...fixtureCatalog,
      fixtureApp({
        id: 'requests',
        category: 'requests',
        runAs: 'fixed:2000',
        volumes: { appdata: '/app/config' },
      }),
    ];
    const home = await makeHome(`${STACK}  requests: {}\n`);
    const docker = fakeDocker(home);
    const result = await apply(options(home, docker, { catalog }));
    expect(result.outcome).toBe('success');
    const chown = docker.calls.indexOf('chown requests 2000:2000 /app/config');
    expect(chown).toBeGreaterThan(docker.calls.indexOf('pull'));
    expect(chown).toBeLessThan(docker.calls.indexOf('up'));
    expect(result.actions.find((a) => a.step === 'ownership')?.detail).toBe(
      'requests → 2000:2000',
    );
  });
});

describe('unhealthyServices', () => {
  it('lists services that are not running or not healthy', () => {
    const base = { id: 'x', configHash: undefined, published: [] };
    expect(
      unhealthyServices([
        { ...base, service: 'sonarr', state: 'running', health: 'healthy' },
        { ...base, service: 'byparr', state: 'running', health: 'starting' },
        { ...base, service: 'seerr', state: 'exited', health: '' },
        { ...base, service: 'gluetun', state: 'running', health: '' },
      ]),
    ).toEqual(['byparr (starting)', 'seerr (exited)']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/apply`

Expected: FAIL, because `./apply` cannot be resolved.

- [ ] **Step 3: Implement**

`packages/engine/src/apply/apply.ts`:

```ts
import { join, resolve } from 'node:path';
import { error, type Diagnostic } from '../diagnostics';
import {
  CHANGE_SCHEMA,
  newRecordId,
  stackSha256,
  writeRecord,
  type ActionResult,
  type ApplyStep,
  type ChangeRecord,
} from '../history/records';
import { COMPOSE_PATH, COMPOSE_PREV_PATH, ENV_PATH, STACK_PATH } from '../paths';
import { plan, planStack, type PlanOptions, type PlanResult } from '../plan/plan';
import { renderEnvFile } from '../render/env';
import { composeToYaml } from '../render/yaml';
import type { CommandResult, ContainerState, Runtime } from '../runtime/types';
import { withGeneratedSecrets, type RandomBytes } from '../secrets/generate';
import { writeSecretStore } from '../secrets/store';
import { secretValues } from '../secrets/values';
import { acquireLock, LockedError, type Lock } from '../state/lock';
import { writeFileAtomic } from '../util/atomic';
import { readIfExists } from '../util/fs';
import { compare } from '../util/sort';
import { ensureAppdataDirs, ownershipFixes } from './ownership';

export const DEFAULT_WAIT_SECONDS = 600;

export type StepEvent =
  | { step: ApplyStep; phase: 'start' }
  | { step: ApplyStep; phase: 'end'; action: ActionResult };

export interface ApplyOptions extends PlanOptions {
  /** Shown the plan before anything changes; resolve true to go ahead. */
  confirm: (plan: PlanResult) => Promise<boolean>;
  /** Progress, as each step starts and ends. */
  onStep?: (event: StepEvent) => void;
  random?: RandomBytes;
  now?: () => Date;
  /** How long `up --wait` waits for every app to be healthy. */
  waitSeconds?: number;
}

export type ApplyOutcome = 'success' | 'failed' | 'no-changes' | 'cancelled' | 'invalid';

export interface ApplyResult {
  outcome: ApplyOutcome;
  /** The plan that was shown (empty when one could not be made). */
  plan: PlanResult;
  actions: ActionResult[];
  /** The change record's id, when one was written. */
  recordId: string | undefined;
  /** The plan's warnings, plus an error for each failed step. */
  diagnostics: Diagnostic[];
}

const STEP_HINTS: Record<ApplyStep, string> = {
  keys: 'check that this user can write to the Mediaplane home, then run apply again',
  files: 'check that this user can write to the Mediaplane home, then run apply again',
  pull: 'check the network connection and that the image registries are reachable, then run apply again',
  ownership: "the error comes from the app's own image; run apply again to retry",
  start: 'run "mediaplane status" to see each app, fix the cause, then run apply again',
  verify: 'run "mediaplane plan" to see what is still different',
};

/** Make the running stack match stack.yaml (spec §5). Converges forward (ADR 0004). */
export async function apply(options: ApplyOptions): Promise<ApplyResult> {
  const home = resolve(options.home);
  // Never create state/ in a folder that isn't a Mediaplane home; plan explains why.
  if ((await readIfExists(join(home, STACK_PATH))) === undefined) {
    return stopped('invalid', await plan(options));
  }
  let lock: Lock;
  try {
    lock = await acquireLock(home, options.now);
  } catch (cause) {
    if (!(cause instanceof LockedError)) throw cause;
    return stopped('invalid', emptyPlan(), [
      error('apply.locked', cause.message, {
        hint: 'wait for it to finish; if no apply is running, delete state/lock',
      }),
    ]);
  }
  try {
    return await applyLocked({ ...options, home });
  } finally {
    await lock.release();
  }
}

async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const stackSource = (await readIfExists(join(options.home, STACK_PATH))) ?? '';
  const { result: shown, context } = await planStack(options);
  if (!shown.ok || context === undefined) return stopped('invalid', shown);
  if (!shown.changed) return stopped('no-changes', shown);
  if (!(await options.confirm(shown))) return stopped('cancelled', shown);

  const { home, runtime } = options;
  const { stack, compose } = context;
  const steps = new Steps(options.onStep);
  let store = context.store;
  let values: Record<string, string> = {};

  await steps.run('keys', async () => {
    const result = withGeneratedSecrets(stack, store, options.random);
    if (result.generated.length > 0) await writeSecretStore(home, result.store);
    store = result.store;
    return result.generated.length === 0
      ? 'none needed'
      : `generated ${result.generated.join(', ')}`;
  });
  await steps.run('files', async () => {
    values = await secretValues(stack, store, options.env);
    await writeGenerated(home, composeToYaml(compose, home), renderEnvFile(values));
    await ensureAppdataDirs(stack);
    return `wrote ${COMPOSE_PATH} and ${ENV_PATH}`;
  });
  await steps.run('pull', async () => {
    succeeded(await runtime.pull(values));
    return 'images present';
  });
  await steps.run('ownership', async () => {
    const fixes = await ownershipFixes(stack, options.probe);
    for (const fix of fixes) {
      succeeded(
        await runtime.chown(fix.service, fix.containerPath, fix, values),
        `${fix.service}: `,
      );
    }
    return fixes.length === 0
      ? 'none needed'
      : fixes.map((f) => `${f.service} → ${String(f.uid)}:${String(f.gid)}`).join(', ');
  });
  await steps.run('start', async () => {
    const result = await runtime.up(options.waitSeconds ?? DEFAULT_WAIT_SECONDS, values);
    if (!result.ok) throw new Error(await startFailure(runtime, result.error));
    return 'every app is running and healthy';
  });
  await steps.run('verify', async () => {
    const after = await plan(options);
    if (!after.ok) {
      const first = after.diagnostics.find((d) => d.severity === 'error');
      throw new Error(`could not plan again: ${first?.message ?? 'unknown error'}`);
    }
    if (after.changed) throw new Error(`changes remain after apply: ${remaining(after)}`);
    return 'no changes remain';
  });

  const finishedAt = now();
  const record: ChangeRecord = {
    schema: CHANGE_SCHEMA,
    id: newRecordId(startedAt, options.random),
    trigger: 'cli',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    outcome: steps.failed ? 'failed' : 'success',
    stackSha256: stackSha256(stackSource),
    plan: {
      files: shown.files.map(({ path, status }) => ({ path, status })),
      containers: shown.containers,
      secrets: shown.secrets,
    },
    actions: steps.actions,
  };
  await writeRecord(home, record);
  return {
    outcome: record.outcome,
    plan: shown,
    actions: steps.actions,
    recordId: record.id,
    diagnostics: [...shown.diagnostics, ...steps.diagnostics],
  };
}

/** Runs apply's steps in order; after a failure the rest are skipped (ADR 0004). */
class Steps {
  readonly actions: ActionResult[] = [];
  readonly diagnostics: Diagnostic[] = [];
  readonly #onStep: ApplyOptions['onStep'];

  constructor(onStep: ApplyOptions['onStep']) {
    this.#onStep = onStep;
  }

  get failed(): boolean {
    return this.actions.some((action) => action.result === 'failed');
  }

  async run(step: ApplyStep, work: () => Promise<string>): Promise<void> {
    if (this.failed) {
      this.#finish({ step, result: 'skipped' });
      return;
    }
    this.#onStep?.({ step, phase: 'start' });
    try {
      this.#finish({ step, result: 'done', detail: await work() });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.diagnostics.push(error(`apply.${step}-failed`, message, { hint: STEP_HINTS[step] }));
      this.#finish({ step, result: 'failed', error: message });
    }
  }

  #finish(action: ActionResult): void {
    this.actions.push(action);
    this.#onStep?.({ step: action.step, phase: 'end', action });
  }
}

/** Services that are not running, or whose health check hasn't passed. */
export function unhealthyServices(containers: readonly ContainerState[]): string[] {
  return containers
    .filter((c) => c.state !== 'running' || (c.health !== '' && c.health !== 'healthy'))
    .map((c) => `${c.service} (${c.state === 'running' ? c.health : c.state})`)
    .sort(compare);
}

async function startFailure(runtime: Runtime, composeError: string): Promise<string> {
  let containers: ContainerState[] = [];
  try {
    containers = await runtime.containers();
  } catch {
    // Fall back to Compose's own message.
  }
  const unhealthy = unhealthyServices(containers);
  return unhealthy.length === 0
    ? `docker compose up failed: ${composeError}`
    : `these apps did not start healthy: ${unhealthy.join(', ')}. Compose said: ${composeError}`;
}

/** compose.yaml, keeping the previous one as compose.prev.yaml (spec §5 step 6), and .env. */
async function writeGenerated(home: string, compose: string, env: string): Promise<void> {
  const composePath = join(home, COMPOSE_PATH);
  const previous = await readIfExists(composePath);
  if (previous !== compose) {
    if (previous !== undefined) {
      await writeFileAtomic(join(home, COMPOSE_PREV_PATH), previous);
    }
    await writeFileAtomic(composePath, compose);
  }
  await writeFileAtomic(join(home, ENV_PATH), env, 0o600);
}

function succeeded(result: CommandResult, prefix = ''): void {
  if (!result.ok) throw new Error(`${prefix}${result.error}`);
}

function remaining(result: PlanResult): string {
  return [
    ...result.files.filter((f) => f.status !== 'unchanged').map((f) => f.path),
    ...result.containers
      .filter((c) => c.action !== 'unchanged')
      .map((c) => `${c.service} (${c.action})`),
    ...result.secrets.generate,
  ].join(', ');
}

function stopped(
  outcome: ApplyOutcome,
  shown: PlanResult,
  extra: Diagnostic[] = [],
): ApplyResult {
  return {
    outcome,
    plan: shown,
    actions: [],
    recordId: undefined,
    diagnostics: [...shown.diagnostics, ...extra],
  };
}

function emptyPlan(): PlanResult {
  return {
    ok: false,
    changed: false,
    files: [],
    containers: [],
    secrets: { generate: [] },
    diagnostics: [],
  };
}
```

Add `export * from './apply/ownership';` and `export * from './apply/apply';` to
`packages/engine/src/index.ts`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): apply the plan: keys, files, pull, ownership, start, verify, record"
```

---

### Task 11: The CLI's `apply`, `status` and `history` commands

**Files:**
- Create: `packages/engine/src/status.ts`
- Modify: `packages/engine/src/index.ts`, `packages/cli/src/run.ts`,
  `packages/cli/src/output.ts`, `packages/cli/src/main.ts`
- Test: create `packages/engine/src/status.test.ts`; modify
  `packages/cli/src/run.test.ts`

**Interfaces:**
- **Consumes:**
  - `apply`, `ApplyResult`, `StepEvent` and `unhealthyServices` (Task 10);
  - `listRecords`, `readRecord`, `ChangeRecord`, `ActionResult` and `ApplyStep`
    (Task 7);
  - `fakeDocker` (Task 6, from `@mediaplane/engine/testing`);
  - `printPlan` and `formatDiagnostic`.
- **Produces:**
  - **The engine's `status(home, runtime)`,** returning
    `Promise<{ containers: ContainerState[] /* sorted by service */; lastApply: ChangeRecord | undefined }>`.
  - **`Io.ask?: (question: string) => Promise<string>`.** It is present only when stdin
    and stdout are both a terminal; `main.ts` provides it with `readline/promises`.
  - **`mediaplane apply [--home] [--yes] [--json]`:**
    - **Without `--yes`:** it needs `Io.ask`, and refuses `--json` with the error
      `apply needs --yes when it cannot ask for confirmation (with --json, or when not
      run in a terminal)`.
    - **On a terminal:** it prints the plan, then asks `\nApply these changes? [y/N] `.
      Only `y` or `yes`, in any case, goes ahead.
    - **While running:** it prints progress lines `  <result> <label>: <detail>`.
    - **When it ends**, one line for each outcome:

      | Outcome | Output |
      |---|---|
      | success | `Apply complete. Change record: <id>` |
      | no changes | `No changes.` |
      | cancelled | `Apply cancelled; nothing was changed.` |
      | invalid | `Apply stopped before changing anything. Fix the errors above and run it again.` |
      | failed | `Apply failed: <n> done, <n> failed, <n> skipped. Run apply again to retry. Change record: <id>` |

    - **Exit codes:** 0 for success or no changes, 1 otherwise.
    - **`--json`** prints `{ schema: 'mediaplane.apply/v1', ok, changed, outcome, plan: {
      files /* no content */, containers, secrets }, actions, recordId /* or null */,
      diagnostics }`. `changed` is true when any step other than `verify` is done.
  - **`mediaplane status [app] [--home] [--json]`:**
    - **The table:** a `APP STATE HEALTH` header, then one row per container, then
      `Last apply: <startedAt>, <outcome> (<id>)` or `No apply has run yet.`.
    - **No containers:** it prints `No containers are running for this stack. Run
      "mediaplane apply" to start it.`.
    - **An unknown `app`:** the error is `no container for "<app>" in this stack`, and it
      exits 1.
    - **`--json`** prints `{ schema: 'mediaplane.status/v1', healthy, containers: [{
      service, state, health, published }], lastApply: <summary> | null }`.
  - **`mediaplane history [id] [--home] [--json]`:**
    - **Listing:** one line per record, newest first:
      `<id>  <outcome>  <n> files written, <n> containers changed, <n> secrets generated`,
      or `No changes have been applied yet.`. Unreadable files are warned about on
      stderr.
    - **One record:** it is shown in full, including every action.
    - **An unknown id:** the error is `no change record "<id>"; run "mediaplane history"
      to list them`, and it exits 1.
    - **`--json`** prints `{ schema: 'mediaplane.history/v1', records: [<summary>],
      unreadable }`, or the record itself, which uses the `mediaplane.change/v1` schema.
  - **A record summary** is
    `{ id, startedAt, durationMs, outcome, changes: { files, containers, secrets } }`,
    where each count covers changed items only.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/status.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGE_SCHEMA, writeRecord } from './history/records';
import { status } from './status';
import { fakeRuntime, running } from './testing/fakes';

describe('status', () => {
  it('lists containers by service and the newest change record', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-status-'));
    const record = {
      schema: CHANGE_SCHEMA,
      trigger: 'cli' as const,
      startedAt: '2026-10-09T09:43:12.000Z',
      finishedAt: '2026-10-09T09:44:12.000Z',
      durationMs: 60_000,
      outcome: 'success' as const,
      stackSha256: '0'.repeat(64),
      plan: { files: [], containers: [], secrets: { generate: [] } },
      actions: [],
    };
    await writeRecord(home, { ...record, id: '20261009T094312Z-00000001' });
    await writeRecord(home, { ...record, id: '20261010T094312Z-00000002' });
    const runtime = fakeRuntime({ containers: running({ sonarr: 'a', jellyfin: 'b' }) });
    const result = await status(home, runtime);
    expect(result.containers.map((c) => c.service)).toEqual(['jellyfin', 'sonarr']);
    expect(result.lastApply?.id).toBe('20261010T094312Z-00000002');
  });

  it('has no last apply before the first one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-status-'));
    expect(await status(home, fakeRuntime())).toEqual({ containers: [], lastApply: undefined });
  });
});
```

In `packages/cli/src/run.test.ts`:

1. Import `fakeDocker` beside the other `@mediaplane/engine/testing` imports.
2. Replace `capture` with a version that can answer questions:

   ```ts
   function capture(env: NodeJS.ProcessEnv = {}, answers?: string[]) {
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
       env,
       ...(answers === undefined
         ? {}
         : {
             ask: (question: string) => {
               questions.push(question);
               return Promise.resolve(answers.shift() ?? '');
             },
           }),
     };
     return { io, stdout: () => out.join(''), stderr: () => err.join(''), questions };
   }
   ```

3. Add these blocks:

```ts
describe('mediaplane apply', () => {
  it('applies with --yes, showing the plan and progress, then reports no changes', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const first = capture();
    expect(await run(['apply', '--home', home, '--yes'], first.io, deps(docker))).toBe(0);
    expect(first.stdout()).toContain(
      'Plan: 2 files to write, 4 containers to change, 2 secrets to generate.',
    );
    expect(first.stdout()).toContain('  done    images: images present\n');
    expect(first.stdout()).toMatch(/Apply complete\. Change record: \d{8}T\d{6}Z-[0-9a-f]{8}\n$/);
    const second = capture();
    expect(await run(['apply', '--home', home, '--yes'], second.io, deps(docker))).toBe(0);
    expect(second.stdout()).toBe('No changes.\n');
  });

  it('asks on a terminal, and changes nothing unless the answer is yes', async () => {
    const home = await makeHome();
    const declined = capture({}, ['n']);
    expect(await run(['apply', '--home', home], declined.io, deps(fakeDocker(home)))).toBe(1);
    expect(declined.questions).toEqual(['\nApply these changes? [y/N] ']);
    expect(declined.stderr()).toContain('Apply cancelled; nothing was changed.');
    const accepted = capture({}, ['YES']);
    expect(await run(['apply', '--home', home], accepted.io, deps(fakeDocker(home)))).toBe(0);
  });

  it('needs --yes when it cannot ask', async () => {
    const term = capture();
    expect(await run(['apply', '--home', await makeHome()], term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('apply needs --yes when it cannot ask for confirmation');
  });

  it('prints versioned JSON with --json --yes', async () => {
    const home = await makeHome();
    const term = capture();
    expect(
      await run(['apply', '--home', home, '--yes', '--json'], term.io, deps(fakeDocker(home))),
    ).toBe(0);
    const json = JSON.parse(term.stdout()) as Record<string, unknown> & {
      plan: { files: Record<string, unknown>[] };
      actions: { step: string; result: string }[];
    };
    expect(json).toMatchObject({
      schema: 'mediaplane.apply/v1',
      ok: true,
      changed: true,
      outcome: 'success',
    });
    expect(json.recordId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
    expect(json.plan.files[1]).toEqual({
      path: 'generated/.env',
      status: 'create',
      diff: '',
      sensitive: true,
    });
    expect(json.actions.map((a) => a.result)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
  });

  it('answers --json without --yes with a JSON error', async () => {
    const term = capture();
    expect(await run(['apply', '--home', await makeHome(), '--json'], term.io, deps())).toBe(1);
    expect(JSON.parse(term.stdout())).toMatchObject({
      schema: 'mediaplane.error/v1',
      ok: false,
    });
  });

  it('exits 1 and explains a failed step', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home, { pull: { ok: false, error: 'fake registry unreachable' } });
    const term = capture();
    expect(await run(['apply', '--home', home, '--yes'], term.io, deps(docker))).toBe(1);
    expect(term.stderr()).toContain('error: fake registry unreachable');
    expect(term.stderr()).toContain('hint: check the network connection');
    expect(term.stderr()).toContain(
      'Apply failed: 2 done, 1 failed, 3 skipped. Run apply again to retry.',
    );
  });

  it('refuses a Compose project it must not manage', async () => {
    const term = capture({ MEDIAPLANE_COMPOSE_PROJECT: 'mediaplane-system' });
    expect(
      await run(['plan', '--home', await makeHome()], term.io, {
        host: () => FIXTURE_HOST,
        probe: fakeProbe(),
      }),
    ).toBe(1);
    expect(term.stderr()).toContain(
      'refusing to manage the Compose project "mediaplane-system"',
    );
  });
});

describe('mediaplane status', () => {
  async function appliedHome() {
    const home = await makeHome();
    const docker = fakeDocker(home);
    await run(['apply', '--home', home, '--yes'], capture().io, deps(docker));
    return { home, docker };
  }

  it('shows each app and the last apply', async () => {
    const { home, docker } = await appliedHome();
    const term = capture();
    expect(await run(['status', '--home', home], term.io, deps(docker))).toBe(0);
    expect(term.stdout()).toContain('APP           STATE     HEALTH\n');
    expect(term.stdout()).toContain('sonarr        running   healthy\n');
    expect(term.stdout()).toMatch(/Last apply: \S+, success \(\d{8}T\d{6}Z-[0-9a-f]{8}\)\n/);
  });

  it('shows one app, and fails for one that is not in the stack', async () => {
    const { home, docker } = await appliedHome();
    const one = capture();
    expect(await run(['status', 'sonarr', '--home', home], one.io, deps(docker))).toBe(0);
    expect(one.stdout()).not.toContain('jellyfin');
    const missing = capture();
    expect(await run(['status', 'radarr', '--home', home], missing.io, deps(docker))).toBe(1);
    expect(missing.stderr()).toContain('no container for "radarr" in this stack');
  });

  it('prints versioned JSON', async () => {
    const { home, docker } = await appliedHome();
    const term = capture();
    await run(['status', '--home', home, '--json'], term.io, deps(docker));
    const json = JSON.parse(term.stdout()) as {
      schema: string;
      healthy: boolean;
      containers: unknown[];
      lastApply: { outcome: string } | null;
    };
    expect(json).toMatchObject({ schema: 'mediaplane.status/v1', healthy: true });
    expect(json.containers).toHaveLength(4);
    expect(json.lastApply?.outcome).toBe('success');
  });

  it('says when nothing is running yet', async () => {
    const home = await makeHome();
    const term = capture();
    expect(await run(['status', '--home', home], term.io, deps(fakeDocker(home)))).toBe(0);
    expect(term.stdout()).toBe(
      'No containers are running for this stack. Run "mediaplane apply" to start it.\nNo apply has run yet.\n',
    );
  });
});

describe('mediaplane history', () => {
  it('lists change records and shows one in full', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    const applied = capture();
    await run(['apply', '--home', home, '--yes', '--json'], applied.io, deps(docker));
    const id = (JSON.parse(applied.stdout()) as { recordId: string }).recordId;
    const list = capture();
    expect(await run(['history', '--home', home], list.io, deps(docker))).toBe(0);
    expect(list.stdout()).toBe(
      `${id}  success  2 files written, 4 containers changed, 2 secrets generated\n`,
    );
    const one = capture();
    expect(await run(['history', id, '--home', home], one.io, deps(docker))).toBe(0);
    expect(one.stdout()).toContain(`Change ${id}\n`);
    expect(one.stdout()).toContain('  done    containers: every app is running and healthy\n');
  });

  it('prints versioned JSON', async () => {
    const home = await makeHome();
    const docker = fakeDocker(home);
    await run(['apply', '--home', home, '--yes'], capture().io, deps(docker));
    const term = capture();
    await run(['history', '--home', home, '--json'], term.io, deps(docker));
    expect(JSON.parse(term.stdout())).toMatchObject({
      schema: 'mediaplane.history/v1',
      records: [
        { outcome: 'success', changes: { files: 2, containers: 4, secrets: 2 } },
      ],
      unreadable: [],
    });
  });

  it('fails for an unknown record, and says when there are none', async () => {
    const home = await makeHome();
    const unknown = capture();
    expect(await run(['history', 'nope', '--home', home], unknown.io, deps())).toBe(1);
    expect(unknown.stderr()).toContain('no change record "nope"');
    const empty = capture();
    expect(await run(['history', '--home', home], empty.io, deps())).toBe(0);
    expect(empty.stdout()).toBe('No changes have been applied yet.\n');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/status.test.ts packages/cli`

Expected: FAIL. `status` doesn't exist, and the CLI has no `apply`, `status` or
`history` commands.

- [ ] **Step 3: Implement**

`packages/engine/src/status.ts`:

```ts
import { listRecords, type ChangeRecord } from './history/records';
import type { ContainerState, Runtime } from './runtime/types';
import { compare } from './util/sort';

export interface StatusResult {
  /** The project's containers, sorted by service. */
  containers: ContainerState[];
  /** The newest change record, if any apply has run. */
  lastApply: ChangeRecord | undefined;
}

/** Each container's state and health, and the last apply (spec §5.2 `status`). */
export async function status(home: string, runtime: Runtime): Promise<StatusResult> {
  const containers = [...(await runtime.containers())].sort((a, b) =>
    compare(a.service, b.service),
  );
  const { records } = await listRecords(home);
  return { containers, lastApply: records[0] };
}
```

Add `export * from './status';` to `packages/engine/src/index.ts`.

Add to `packages/cli/src/output.ts`, importing `type ActionResult`,
`type ApplyResult`, `type ApplyStep`, `type ChangeRecord`, `type StatusResult`,
`type StepEvent` and `unhealthyServices` from `@mediaplane/engine`:

```ts
export const APPLY_JSON_SCHEMA = 'mediaplane.apply/v1';
export const STATUS_JSON_SCHEMA = 'mediaplane.status/v1';
export const HISTORY_JSON_SCHEMA = 'mediaplane.history/v1';

const STEP_LABELS: Record<ApplyStep, string> = {
  keys: 'secrets',
  files: 'files',
  pull: 'images',
  ownership: 'appdata ownership',
  start: 'containers',
  verify: 'verify',
};

const SLOW_STEPS: Partial<Record<ApplyStep, string>> = {
  pull: 'Pulling images (the first time can take several minutes)…',
  start: 'Starting containers and waiting until every app is healthy…',
};

/** Progress lines while apply runs. A failure's message comes once, at the end. */
export function printStep(event: StepEvent, io: Io): void {
  if (event.phase === 'start') {
    const note = SLOW_STEPS[event.step];
    if (note !== undefined) io.stdout(`${note}\n`);
    return;
  }
  const { action } = event;
  const detail = action.detail === undefined ? '' : `: ${action.detail}`;
  io.stdout(`  ${action.result.padEnd(7)} ${STEP_LABELS[action.step]}${detail}\n`);
}

export function printApply(result: ApplyResult, options: { json: boolean }, io: Io): void {
  if (options.json) {
    const { files, containers, secrets } = result.plan;
    io.stdout(
      `${JSON.stringify(
        {
          schema: APPLY_JSON_SCHEMA,
          ok: result.outcome === 'success' || result.outcome === 'no-changes',
          changed: result.actions.some((a) => a.result === 'done' && a.step !== 'verify'),
          outcome: result.outcome,
          plan: { files: files.map(({ content, ...file }) => file), containers, secrets },
          actions: result.actions,
          recordId: result.recordId ?? null,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
  const recordId = result.recordId ?? '';
  switch (result.outcome) {
    case 'invalid':
      io.stderr(
        '\nApply stopped before changing anything. Fix the errors above and run it again.\n',
      );
      return;
    case 'no-changes':
      io.stdout('No changes.\n');
      return;
    case 'cancelled':
      io.stderr('Apply cancelled; nothing was changed.\n');
      return;
    case 'success':
      io.stdout(`\nApply complete. Change record: ${recordId}\n`);
      return;
    case 'failed': {
      const count = (outcome: ActionResult['result']) =>
        String(result.actions.filter((a) => a.result === outcome).length);
      io.stderr(
        `\nApply failed: ${count('done')} done, ${count('failed')} failed, ${count('skipped')} skipped. Run apply again to retry. Change record: ${recordId}\n`,
      );
    }
  }
}

/** The short form of a change record used by `status` and `history --json`. */
function summary(record: ChangeRecord) {
  return {
    id: record.id,
    startedAt: record.startedAt,
    durationMs: record.durationMs,
    outcome: record.outcome,
    changes: {
      files: record.plan.files.filter((f) => f.status !== 'unchanged').length,
      containers: record.plan.containers.filter((c) => c.action !== 'unchanged').length,
      secrets: record.plan.secrets.generate.length,
    },
  };
}

export function printStatus(result: StatusResult, options: { json: boolean }, io: Io): void {
  if (options.json) {
    io.stdout(
      `${JSON.stringify(
        {
          schema: STATUS_JSON_SCHEMA,
          healthy:
            result.containers.length > 0 && unhealthyServices(result.containers).length === 0,
          containers: result.containers.map(({ service, state, health, published }) => ({
            service,
            state,
            health,
            published,
          })),
          lastApply: result.lastApply === undefined ? null : summary(result.lastApply),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (result.containers.length === 0) {
    io.stdout('No containers are running for this stack. Run "mediaplane apply" to start it.\n');
  } else {
    io.stdout(`${'APP'.padEnd(14)}${'STATE'.padEnd(10)}HEALTH\n`);
    for (const c of result.containers) {
      io.stdout(`${c.service.padEnd(14)}${c.state.padEnd(10)}${c.health === '' ? '-' : c.health}\n`);
    }
  }
  const last = result.lastApply;
  io.stdout(
    last === undefined
      ? 'No apply has run yet.\n'
      : `Last apply: ${last.startedAt}, ${last.outcome} (${last.id})\n`,
  );
}

export function printHistory(
  list: { records: ChangeRecord[]; unreadable: string[] },
  options: { json: boolean },
  io: Io,
): void {
  if (options.json) {
    io.stdout(
      `${JSON.stringify(
        { schema: HISTORY_JSON_SCHEMA, records: list.records.map(summary), unreadable: list.unreadable },
        null,
        2,
      )}\n`,
    );
    return;
  }
  for (const name of list.unreadable) io.stderr(`warning: could not read state/history/${name}\n`);
  if (list.records.length === 0) {
    io.stdout('No changes have been applied yet.\n');
    return;
  }
  for (const record of list.records) {
    const { changes } = summary(record);
    const parts = [
      count(changes.files, 'file', 'written'),
      count(changes.containers, 'container', 'changed'),
      count(changes.secrets, 'secret', 'generated'),
    ].filter((part): part is string => part !== undefined);
    io.stdout(
      `${record.id}  ${record.outcome.padEnd(7)}  ${parts.length === 0 ? 'no changes' : parts.join(', ')}\n`,
    );
  }
}

export function printRecord(record: ChangeRecord, options: { json: boolean }, io: Io): void {
  if (options.json) {
    io.stdout(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  io.stdout(`Change ${record.id}\n`);
  io.stdout(`  started  ${record.startedAt}, took ${String(Math.round(record.durationMs / 1000))}s\n`);
  io.stdout(`  outcome  ${record.outcome}\n`);
  io.stdout(`  stack    sha256:${record.stackSha256}\n`);
  for (const change of record.plan.containers.filter((c) => c.action !== 'unchanged')) {
    io.stdout(`  ${MARKS[change.action]} ${change.action.padEnd(9)} ${change.service}\n`);
  }
  if (record.plan.secrets.generate.length > 0) {
    io.stdout(`  secrets generated: ${record.plan.secrets.generate.join(', ')}\n`);
  }
  io.stdout('Steps:\n');
  for (const action of record.actions) {
    const detail = action.detail ?? action.error;
    io.stdout(
      `  ${action.result.padEnd(7)} ${STEP_LABELS[action.step]}${detail === undefined ? '' : `: ${detail}`}\n`,
    );
  }
}
```

`count()` and `MARKS` already exist in `output.ts`; reuse them unchanged.

Replace `packages/cli/src/run.ts` with:

```ts
import { resolve } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  listRecords,
  nodeProbe,
  plan,
  PROJECT_NAME,
  readRecord,
  status,
  type HostFacts,
  type HostProbe,
  type Runtime,
} from '@mediaplane/engine';
import { Command, CommanderError } from 'commander';
import {
  printApply,
  printError,
  printHistory,
  printPlan,
  printRecord,
  printStatus,
  printStep,
} from './output';
import { VERSION } from './version';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
  /** Ask the user something and return the answer; absent when not on a terminal. */
  ask?: (question: string) => Promise<string>;
}

/** What the CLI talks to: the real host by default, fakes in tests. */
export interface CliDeps {
  host: () => HostFacts;
  runtime: (home: string, project: string) => Runtime;
  probe: HostProbe;
}

export const DEFAULT_HOME = '/opt/mediaplane';

const defaultDeps: CliDeps = {
  host: () => detectHostFacts(),
  runtime: (home, project) => createDockerRuntime({ home, project }),
  probe: nodeProbe,
};

/** An environment variable's value, treating "" as unset. */
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Run the CLI with user arguments (no node/script prefix) and return the exit code. */
export async function run(
  argv: readonly string[],
  io: Io,
  overrides: Partial<CliDeps> = {},
): Promise<number> {
  const deps: CliDeps = { ...defaultDeps, ...overrides };
  const json = argv.includes('--json');
  const project = setting(io.env, 'MEDIAPLANE_COMPOSE_PROJECT') ?? PROJECT_NAME;
  const defaultHome = setting(io.env, 'MEDIAPLANE_HOME') ?? DEFAULT_HOME;
  let exitCode = 0;
  const program = new Command('mediaplane')
    .description('Deploy and wire a self-hosted media stack from one stack.yaml')
    .version(VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        io.stdout(text);
      },
      writeErr: (text) => {
        io.stderr(text);
      },
    });

  program
    .command('plan')
    .description('Show what apply would change, without changing anything')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--json', 'print machine-readable JSON')
    .action(async (options: { home: string; json?: boolean }) => {
      const home = resolve(options.home);
      const result = await plan({
        home,
        catalog,
        host: deps.host(),
        env: io.env,
        runtime: deps.runtime(home, project),
        probe: deps.probe,
      });
      printPlan(result, { json: options.json === true }, io);
      exitCode = result.ok ? (result.changed ? 2 : 0) : 1;
    });

  program
    .command('apply')
    .description('Make the running stack match stack.yaml')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--yes', 'apply without asking for confirmation')
    .option('--json', 'print machine-readable JSON (needs --yes)')
    .action(async (options: { home: string; yes?: boolean; json?: boolean }) => {
      const asJson = options.json === true;
      const yes = options.yes === true;
      const ask = io.ask;
      if (!yes && (asJson || ask === undefined)) {
        printError(
          'apply needs --yes when it cannot ask for confirmation (with --json, or when not run in a terminal)',
          { json: asJson },
          io,
        );
        exitCode = 1;
        return;
      }
      const home = resolve(options.home);
      const result = await apply({
        home,
        catalog,
        host: deps.host(),
        env: io.env,
        runtime: deps.runtime(home, project),
        probe: deps.probe,
        confirm: async (shown) => {
          if (!asJson) printPlan(shown, { json: false }, io);
          if (yes || ask === undefined) return true;
          const answer = await ask('\nApply these changes? [y/N] ');
          return /^y(es)?$/i.test(answer.trim());
        },
        onStep: asJson
          ? undefined
          : (event) => {
              printStep(event, io);
            },
      });
      printApply(result, { json: asJson }, io);
      exitCode = result.outcome === 'success' || result.outcome === 'no-changes' ? 0 : 1;
    });

  program
    .command('status')
    .description("Show each app's container, and the last apply")
    .argument('[app]', 'show only this app')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--json', 'print machine-readable JSON')
    .action(async (app: string | undefined, options: { home: string; json?: boolean }) => {
      const asJson = options.json === true;
      const home = resolve(options.home);
      const result = await status(home, deps.runtime(home, project));
      const containers =
        app === undefined
          ? result.containers
          : result.containers.filter((c) => c.service === app);
      if (app !== undefined && containers.length === 0) {
        printError(`no container for "${app}" in this stack`, { json: asJson }, io);
        exitCode = 1;
        return;
      }
      printStatus({ ...result, containers }, { json: asJson }, io);
    });

  program
    .command('history')
    .description('List change records, or show one in full')
    .argument('[id]', 'the change record to show')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--json', 'print machine-readable JSON')
    .action(async (id: string | undefined, options: { home: string; json?: boolean }) => {
      const asJson = options.json === true;
      const home = resolve(options.home);
      if (id === undefined) {
        printHistory(await listRecords(home), { json: asJson }, io);
        return;
      }
      const record = await readRecord(home, id);
      if (record === undefined) {
        printError(
          `no change record "${id}"; run "mediaplane history" to list them`,
          { json: asJson },
          io,
        );
        exitCode = 1;
        return;
      }
      printRecord(record, { json: asJson }, io);
    });

  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return cause.exitCode;
    // Anything else (an unreadable stack.yaml, an unsupported CPU) is described, not crashed on.
    printError(cause instanceof Error ? cause.message : String(cause), { json }, io);
    return 1;
  }
  return exitCode;
}
```

In `packages/cli/src/main.ts`, add `import { createInterface } from 'node:readline/promises';`
and pass `ask` only on a terminal:

```ts
const interactive = process.stdin.isTTY && process.stdout.isTTY;

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  env: process.env,
  ...(interactive
    ? {
        ask: async (question: string) => {
          const prompt = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return await prompt.question(question);
          } finally {
            prompt.close();
          }
        },
      }
    : {}),
});
```

If ESLint's strict rules object to how `isTTY` is tested, write the narrowest form it
accepts without changing behaviour. Depending on the `@types/node` typing, that is either
`process.stdin.isTTY === true && process.stdout.isTTY === true` or the plain `&&`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine packages/cli && pnpm typecheck`

Expected: PASS. The spawned tests in `main.test.ts` are not on a terminal, so `ask` is
absent there and their `plan` output is unchanged.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(cli): add apply, status and history"
```

---

### Task 12: The CLI's `init` command

**Files:**
- Create: `packages/engine/src/config/starter.ts`, `packages/cli/src/init.ts`
- Modify: `packages/engine/src/index.ts`, `packages/cli/src/run.ts`
- Test: create `packages/engine/src/config/starter.test.ts` and
  `packages/cli/src/init.test.ts`

**Interfaces:**
- **Consumes:**
  - `parseConfig` and `STACK_PATH`;
  - `HostFacts.cloud`;
  - `Io` (with `ask`), `CliDeps`, `printError` and `formatDiagnostic`.
- **Produces:**
  - **`interface StarterAnswers`:**
    - `mediaServer: 'jellyfin' | 'plex'`;
    - `dataPath: string`;
    - `vpnProvider: string | undefined`;
    - `loginOnLan: boolean`;
    - `timezone: string`;
    - `bind: 'lan' | 'localhost'`.
  - **`starterStack(answers): string`.** A commented `stack.yaml` that passes
    `parseConfig`. User-supplied strings are written as JSON strings, so any value stays
    valid YAML. The app set is sonarr, radarr, prowlarr, qbittorrent and seerr; with no
    VPN, qBittorrent gets `{ vpn: false }`. Plex adds `plex.token: { file:
    secrets/plex-token }`, and a VPN adds `vpn.private_key: { file: secrets/wg.key }`.
  - **`mediaplane init`**, with these options:
    - `--home`;
    - `--media-server <jellyfin|plex>`;
    - `--data <path>`;
    - `--vpn-provider <name>`;
    - `--no-login-on-lan`;
    - `--timezone <zone>`, defaulting to the system zone;
    - `--json`.

    It behaves like this:
    - **On a terminal,** without `--json`, it asks for anything not given by flags:
      media server `[jellyfin]`, data folder `[/srv/data]`, VPN provider (empty means
      none), and login on the LAN `[Y/n]`.
    - **Off a terminal,** `--media-server` and `--data` are required.
    - **On a cloud VM,** bind is `localhost`; otherwise it is `lan`.
    - **It never overwrites `stack.yaml`.** It writes the file with the `wx` flag, and
      creates `secrets/` as 0700.
    - **Afterwards,** it prints next steps, or with `--json` prints `{ schema:
      'mediaplane.init/v1', ok: true, stackPath, next: string[] }`.
    - **Exit codes:** 0 on success, 1 on any error. An invalid answer, such as a
      relative data path, is reported with the config diagnostics, and nothing is
      written.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/config/starter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseConfig } from './load';
import { starterStack, type StarterAnswers } from './starter';

const ANSWERS: StarterAnswers = {
  mediaServer: 'jellyfin',
  dataPath: '/srv/data',
  vpnProvider: 'mullvad',
  loginOnLan: true,
  timezone: 'Europe/London',
  bind: 'lan',
};

function configOf(answers: StarterAnswers) {
  const result = parseConfig(starterStack(answers));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.config;
}

describe('starterStack', () => {
  it('writes a valid stack with the chosen media server, data folder and VPN', () => {
    const config = configOf(ANSWERS);
    expect(config).toMatchObject({
      timezone: 'Europe/London',
      paths: { data: '/srv/data' },
      network: { bind: 'lan' },
      security: { login_on_lan: true },
      media_server: 'jellyfin',
      vpn: { provider: 'mullvad', private_key: { file: 'secrets/wg.key' } },
    });
    expect(Object.keys(config.apps)).toEqual(['sonarr', 'radarr', 'prowlarr', 'qbittorrent', 'seerr']);
    expect(starterStack(ANSWERS)).toContain('# Mediaplane stack');
  });

  it('turns the VPN off for qBittorrent when there is no provider', () => {
    const config = configOf({ ...ANSWERS, vpnProvider: undefined });
    expect(config.vpn).toBeUndefined();
    expect(config.apps.qbittorrent).toMatchObject({ vpn: false });
  });

  it('points Plex at a token file', () => {
    expect(configOf({ ...ANSWERS, mediaServer: 'plex' }).plex).toEqual({
      token: { file: 'secrets/plex-token' },
    });
  });

  it('keeps unusual values intact', () => {
    const config = configOf({ ...ANSWERS, dataPath: '/srv/my data #1', bind: 'localhost', loginOnLan: false });
    expect(config.paths.data).toBe('/srv/my data #1');
    expect(config.network.bind).toBe('localhost');
    expect(config.security.login_on_lan).toBe(false);
  });
});
```

`packages/cli/src/init.test.ts`:

```ts
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '@mediaplane/engine';
import { FIXTURE_HOST, fakeProbe, fakeRuntime } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { run, type CliDeps, type Io } from './run';

function capture(answers?: string[]) {
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
    ...(answers === undefined
      ? {}
      : { ask: () => Promise.resolve(answers.shift() ?? '') }),
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

const deps = (cloud?: string): Partial<CliDeps> => ({
  host: () => (cloud === undefined ? FIXTURE_HOST : { ...FIXTURE_HOST, cloud }),
  runtime: () => fakeRuntime(),
  probe: fakeProbe(),
});

const newHome = () => mkdtemp(join(tmpdir(), 'mediaplane-init-'));

async function stackIn(home: string) {
  const result = parseConfig(await readFile(join(home, 'stack.yaml'), 'utf8'));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.config;
}

describe('mediaplane init', () => {
  it('writes a starter stack and a private secrets folder from flags', async () => {
    const home = await newHome();
    const term = capture();
    const args = ['init', '--home', home, '--media-server', 'jellyfin', '--data', '/srv/data', '--vpn-provider', 'mullvad', '--timezone', 'Europe/London'];
    expect(await run(args, term.io, deps())).toBe(0);
    expect(await stackIn(home)).toMatchObject({
      media_server: 'jellyfin',
      paths: { data: '/srv/data' },
      network: { bind: 'lan' },
      vpn: { provider: 'mullvad' },
    });
    expect((await stat(join(home, 'secrets'))).mode & 0o777).toBe(0o700);
    expect(term.stdout()).toContain(`Wrote ${join(home, 'stack.yaml')}.`);
    expect(term.stdout()).toContain(`Put your VPN's WireGuard private key in ${join(home, 'secrets', 'wg.key')}.`);
  });

  it('never overwrites an existing stack.yaml', async () => {
    const home = await newHome();
    await writeFile(join(home, 'stack.yaml'), 'version: 1\n');
    const term = capture();
    const args = ['init', '--home', home, '--media-server', 'jellyfin', '--data', '/srv/data'];
    expect(await run(args, term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('already exists; init never overwrites it');
    expect(await readFile(join(home, 'stack.yaml'), 'utf8')).toBe('version: 1\n');
  });

  it('needs flags when it cannot ask', async () => {
    const term = capture();
    expect(await run(['init', '--home', await newHome()], term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('init needs --media-server and --data');
  });

  it('asks on a terminal for what the flags leave out', async () => {
    const home = await newHome();
    const term = capture(['plex', '/srv/media', '', 'n']);
    expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
    const config = await stackIn(home);
    expect(config).toMatchObject({ media_server: 'plex', paths: { data: '/srv/media' }, security: { login_on_lan: false } });
    expect(config.vpn).toBeUndefined();
    expect(term.stdout()).toContain(`Save your Plex token in ${join(home, 'secrets', 'plex-token')}.`);
  });

  it('keeps the web UIs on localhost on a cloud VM', async () => {
    const home = await newHome();
    const term = capture();
    const args = ['init', '--home', home, '--media-server', 'jellyfin', '--data', '/srv/data'];
    expect(await run(args, term.io, deps('Oracle Cloud'))).toBe(0);
    expect((await stackIn(home)).network.bind).toBe('localhost');
    expect(term.stdout()).toContain('This looks like an Oracle Cloud VM');
  });

  it('reports an invalid answer and writes nothing', async () => {
    const home = await newHome();
    const term = capture();
    const args = ['init', '--home', home, '--media-server', 'jellyfin', '--data', 'relative/path'];
    expect(await run(args, term.io, deps())).toBe(1);
    expect(term.stderr()).toContain('must be an absolute path');
    await expect(stat(join(home, 'stack.yaml'))).rejects.toThrow();
  });

  it('prints versioned JSON', async () => {
    const home = await newHome();
    const term = capture();
    const args = ['init', '--home', home, '--media-server', 'jellyfin', '--data', '/srv/data', '--json'];
    expect(await run(args, term.io, deps())).toBe(0);
    expect(JSON.parse(term.stdout())).toMatchObject({
      schema: 'mediaplane.init/v1',
      ok: true,
      stackPath: join(home, 'stack.yaml'),
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/config/starter.test.ts packages/cli/src/init.test.ts`

Expected: FAIL. `./starter` doesn't exist, and there is no `init` command.

- [ ] **Step 3: Implement**

`packages/engine/src/config/starter.ts`:

```ts
export interface StarterAnswers {
  mediaServer: 'jellyfin' | 'plex';
  /** The data folder for downloads and media (absolute). */
  dataPath: string;
  /** Gluetun VPN provider, e.g. "mullvad"; undefined for no VPN. */
  vpnProvider: string | undefined;
  loginOnLan: boolean;
  timezone: string;
  bind: 'lan' | 'localhost';
}

/** A YAML scalar for any user-supplied string: JSON strings are valid YAML. */
const scalar = (value: string) => JSON.stringify(value);

/** A commented starter stack.yaml (spec §5.2 `init`). */
export function starterStack(answers: StarterAnswers): string {
  const vpn = answers.vpnProvider;
  return [
    '# Mediaplane stack: the one file that describes your media stack.',
    '# Reference: https://github.com/cyclopsgd/Mediaplane',
    'version: 1',
    `timezone: ${scalar(answers.timezone)}`,
    '# The apps run as this user and group. Make sure they can write to the data folder.',
    'user: { uid: 1000, gid: 1000 }',
    'paths:',
    `  data: ${scalar(answers.dataPath)}`,
    'network:',
    answers.bind === 'localhost'
      ? '  # localhost keeps the web UIs on this machine; lan publishes them on your network.'
      : "  # lan publishes the web UIs on this machine's private address; localhost keeps them local.",
    `  bind: ${answers.bind}`,
    'security:',
    '  # Ask for a login even from your own network.',
    `  login_on_lan: ${String(answers.loginOnLan)}`,
    `media_server: ${answers.mediaServer}`,
    ...(answers.mediaServer === 'plex' ? ['plex:', '  token: { file: secrets/plex-token }'] : []),
    ...(vpn === undefined
      ? []
      : ['vpn:', `  provider: ${scalar(vpn)}`, '  private_key: { file: secrets/wg.key }']),
    'apps:',
    '  sonarr: {}',
    '  radarr: {}',
    '  prowlarr: {}',
    vpn === undefined ? '  qbittorrent: { vpn: false }' : '  qbittorrent: {}',
    '  seerr: {}',
    '',
  ].join('\n');
}
```

Add `export * from './config/starter';` to `packages/engine/src/index.ts`.

`packages/cli/src/init.ts`:

```ts
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  parseConfig,
  STACK_PATH,
  starterStack,
  type HostFacts,
  type StarterAnswers,
} from '@mediaplane/engine';
import { formatDiagnostic, printError } from './output';
import type { Io } from './run';

export const INIT_JSON_SCHEMA = 'mediaplane.init/v1';

export interface InitOptions {
  home: string;
  mediaServer?: string;
  data?: string;
  vpnProvider?: string;
  loginOnLan: boolean;
  timezone: string;
  json?: boolean;
}

/** `mediaplane init`: write a starter stack.yaml and secrets/, never overwriting. */
export async function init(options: InitOptions, io: Io, host: HostFacts): Promise<number> {
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
    if (asJson) printError(parsed.diagnostics.map((d) => d.message).join('; '), { json: true }, io);
    else for (const diagnostic of parsed.diagnostics) io.stderr(formatDiagnostic(diagnostic));
    return 1;
  }
  await mkdir(home, { recursive: true });
  try {
    await writeFile(stackPath, text, { flag: 'wx' });
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'EEXIST') {
      printError(`${stackPath} already exists; init never overwrites it`, { json: asJson }, io);
      return 1;
    }
    throw cause;
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
    `Create ${answers.dataPath} and make sure uid 1000 can write to it.`,
    'Run "mediaplane plan" to check everything, then "mediaplane apply".',
  ];
  if (asJson) {
    io.stdout(`${JSON.stringify({ schema: INIT_JSON_SCHEMA, ok: true, stackPath, next }, null, 2)}\n`);
    return 0;
  }
  io.stdout(`Wrote ${stackPath}.\n`);
  if (host.cloud !== undefined) {
    io.stdout(
      `This looks like an ${host.cloud} VM, so the web UIs stay on localhost (network.bind).\n`,
    );
  }
  io.stdout(`\nNext steps:\n${next.map((step) => `  - ${step}\n`).join('')}`);
  return 0;
}

async function gatherAnswers(
  options: InitOptions,
  io: Io,
  host: HostFacts,
): Promise<StarterAnswers | string> {
  let mediaServer = options.mediaServer;
  let dataPath = options.data;
  let vpnProvider = options.vpnProvider;
  let loginOnLan = options.loginOnLan;
  const ask = options.json === true ? undefined : io.ask;
  if (ask !== undefined) {
    mediaServer ??= (await ask('Media server, jellyfin or plex [jellyfin]: ')).trim() || 'jellyfin';
    dataPath ??= (await ask('Data folder for downloads and media [/srv/data]: ')).trim() || '/srv/data';
    if (vpnProvider === undefined) {
      const answer = (await ask('VPN provider for qBittorrent, e.g. mullvad (empty for none): ')).trim();
      vpnProvider = answer === '' ? undefined : answer;
    }
    if (loginOnLan) {
      loginOnLan = !/^n/i.test((await ask('Ask for a login from your own network too? [Y/n] ')).trim());
    }
  }
  if (mediaServer === undefined || dataPath === undefined) {
    return 'init needs --media-server and --data when it cannot ask (with --json, or when not run in a terminal)';
  }
  if (mediaServer !== 'jellyfin' && mediaServer !== 'plex') {
    return `--media-server must be jellyfin or plex, not "${mediaServer}"`;
  }
  return {
    mediaServer,
    dataPath,
    vpnProvider,
    loginOnLan,
    timezone: options.timezone,
    bind: host.cloud === undefined ? 'lan' : 'localhost',
  };
}
```

In `packages/cli/src/run.ts`:

- Add `import { init, type InitOptions } from './init';`.
- Register the command before the `try`:

```ts
  program
    .command('init')
    .description('Write a starter stack.yaml and a secrets/ folder (never overwrites)')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--media-server <name>', 'jellyfin or plex')
    .option('--data <path>', 'the data folder for downloads and media (absolute)')
    .option('--vpn-provider <name>', 'Gluetun VPN provider, e.g. mullvad; leave out for no VPN')
    .option('--no-login-on-lan', "don't ask for a login from your own network")
    .option(
      '--timezone <zone>',
      'timezone, e.g. Europe/London',
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
    .option('--json', 'print machine-readable JSON')
    .action(async (options: InitOptions) => {
      exitCode = await init(options, io, deps.host());
    });
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine packages/cli && pnpm typecheck`

Expected: PASS.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(cli): add init, which writes a starter stack.yaml"
```

---

### Task 13: End-to-end apply, CI and docs

**Files:**
- Create: `test/e2e/helpers.ts`, `test/e2e/apply.e2e.test.ts`,
  `docs/adr/0004-converge-forward-apply.md`
- Modify:
  - `test/e2e/plan.e2e.test.ts` (use the shared helpers);
  - `vitest.e2e.config.ts`;
  - `.github/workflows/ci.yml`;
  - `docs/adr/0002-compose-native-control-plane.md`;
  - `docs/design/m1-engine-cli.md` (§2.3 criterion 6);
  - `docs/plans/m1-roadmap.md`;
  - `README.md` and `CONTRIBUTING.md`.

**Interfaces:**
- **Consumes:** from `@mediaplane/engine`, `apply`, `ApplyOptions`,
  `createDockerRuntime`, `detectHostFacts`, `nodeExec`, `nodeProbe`, `renderEnvFile`,
  `COMPOSE_PATH` and `ENV_PATH`; from `@mediaplane/catalog`, `catalog`.
- **Produces:**
  - **The end-to-end proof.** On real Docker, the whole video stack comes up healthy,
    Seerr's appdata is owned by uid 1000, a second apply reports no changes, and the
    header's eject command recreates nothing.
  - **A check that Compose reads `.env` values back exactly.**
  - **A CI job that can hold the app images** (about 7 GB) and fits within its timeout.

- [ ] **Step 1: Share the e2e helpers**

`test/e2e/helpers.ts`:

```ts
import { rm } from 'node:fs/promises';
import { nodeExec, type ExecResult } from '@mediaplane/engine';

export const BUSYBOX =
  'busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e';

/** Remove a test project's containers and network, whatever it contains. */
export function composeDown(project: string): Promise<ExecResult> {
  return nodeExec('docker', ['compose', '-p', project, 'down', '--remove-orphans'], {
    cwd: '/',
  });
}

/**
 * Delete a test home, including files the apps created as other users (Seerr runs as
 * uid 1000). Those are removed as root, from a throwaway container.
 */
export async function removeHome(home: string): Promise<void> {
  await nodeExec(
    'docker',
    ['run', '--rm', '-v', `${home}:/home-to-remove`, BUSYBOX, 'rm', '-rf', '/home-to-remove/appdata', '/home-to-remove/data'],
    { cwd: '/' },
  );
  await rm(home, { recursive: true, force: true });
}
```

In `test/e2e/plan.e2e.test.ts`, delete the local `BUSYBOX` constant and `composeDown`
function, and add `import { BUSYBOX, composeDown } from './helpers';`.

In `vitest.e2e.config.ts`, add `fileParallelism: false,` inside `test`. The test files
publish the same host ports, so they must not overlap.

- [ ] **Step 2: Write the end-to-end tests**

`test/e2e/apply.e2e.test.ts`:

```ts
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  COMPOSE_PATH,
  createDockerRuntime,
  detectHostFacts,
  ENV_PATH,
  nodeExec,
  nodeProbe,
  renderEnvFile,
  type ApplyOptions,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { BUSYBOX, composeDown, removeHome } from './helpers';

const PROJECT = `mediaplane-e2e-${process.pid}-apply`;

/** The M1 video stack without the VPN; the apps run as the user who owns the data folder. */
function stackFor(data: string): string {
  return `version: 1
user: { uid: ${process.getuid?.() ?? 1000}, gid: ${process.getgid?.() ?? 1000} }
paths: { data: ${data} }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`;
}

describe('apply against real Docker', () => {
  it(
    'starts the video stack healthy, then has nothing left to do',
    async () => {
      const home = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
      await mkdir(join(home, 'data'));
      await writeFile(join(home, 'stack.yaml'), stackFor(join(home, 'data')));
      const runtime = createDockerRuntime({ home, project: PROJECT });
      const options: ApplyOptions = {
        home,
        catalog,
        host: detectHostFacts(),
        env: process.env,
        runtime,
        probe: nodeProbe,
        confirm: () => Promise.resolve(true),
      };
      try {
        const first = await apply(options);
        expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(first.outcome).toBe('success');
        const containers = await runtime.containers();
        expect(containers.map((c) => `${c.service} ${c.state} ${c.health}`).sort()).toEqual([
          'byparr running healthy',
          'jellyfin running healthy',
          'prowlarr running healthy',
          'qbittorrent running healthy',
          'radarr running healthy',
          'seerr running healthy',
          'sonarr running healthy',
        ]);
        expect((await stat(join(home, 'appdata', 'seerr'))).uid).toBe(1000);

        const second = await apply({
          ...options,
          confirm: () => Promise.reject(new Error('nothing should need confirming')),
        });
        expect(second.outcome).toBe('no-changes');

        // Ejectable: the command in compose.yaml's header recreates nothing.
        const ids = containers.map((c) => c.id).sort();
        const eject = await nodeExec(
          'docker',
          [
            'compose',
            '-p',
            PROJECT,
            '--project-directory',
            home,
            '-f',
            join(home, COMPOSE_PATH),
            '--env-file',
            join(home, ENV_PATH),
            'up',
            '-d',
          ],
          { cwd: '/' },
        );
        expect(eject.code, eject.stderr).toBe(0);
        expect((await runtime.containers()).map((c) => c.id).sort()).toEqual(ids);
      } finally {
        const down = await composeDown(PROJECT);
        await removeHome(home);
        expect(down.code, down.stderr).toBe(0);
      }
    },
    1_200_000,
  );

  it('writes .env values that Compose reads back exactly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
    const values = {
      MP_A: "it's \"q\" $X \\b",
      MP_B: 'line1\nline2\ttab',
      MP_C: '$HOME ${X} # not a comment',
      MP_D: '',
    };
    await writeFile(join(dir, '.env'), renderEnvFile(values));
    await writeFile(
      join(dir, 'compose.yaml'),
      [
        'services:',
        '  probe:',
        `    image: ${BUSYBOX}`,
        '    environment:',
        ...Object.keys(values).map((name) => `      ${name}: "\${${name}}"`),
        '',
      ].join('\n'),
    );
    const result = await nodeExec(
      'docker',
      [
        'compose',
        '-p',
        `mediaplane-e2e-${process.pid}-env`,
        '--project-directory',
        dir,
        '-f',
        join(dir, 'compose.yaml'),
        '--env-file',
        join(dir, '.env'),
        'config',
        '--format',
        'json',
      ],
      { cwd: '/' },
    );
    expect(result.code, result.stderr).toBe(0);
    const config = JSON.parse(result.stdout) as {
      services: { probe: { environment: Record<string, string> } };
    };
    // `config` prints a literal $ as $$.
    const environment = Object.fromEntries(
      Object.entries(config.services.probe.environment).map(([name, value]) => [
        name,
        value.replaceAll('$$', '$'),
      ]),
    );
    expect(environment).toEqual(values);
  });
});
```

- [ ] **Step 3: Run them locally, on this aarch64 machine with Docker**

Run: `pnpm test:e2e`

Expected: PASS (8 tests). The apply test takes a few minutes with the images cached.
Then run the leftover check:

```bash
docker ps -a --filter label=com.docker.compose.project --format '{{.Label "com.docker.compose.project"}}' | grep mediaplane-e2e || echo clean
ls -d /tmp/mediaplane-e2e-* 2>/dev/null | wc -l
```

Expected: `clean`, and `0` leftover apply homes. Homes from the plan tests may remain,
since they are never chowned. If any app is not healthy, read the failure diagnostic,
which names it, and `docker compose -p <project> logs <app>`. A wrong health check
belongs in the catalog: fix it there, the way Task 1 fixed Byparr.

- [ ] **Step 4: Update CI**

In `.github/workflows/ci.yml`, in the `e2e` job:

- Change `timeout-minutes: 20` to `timeout-minutes: 45`.
- Add this as its first step, before checkout:

```yaml
      # The apply test pulls about 7 GB of app images; make room for them.
      - name: Free disk space
        run: |
          sudo rm -rf /usr/local/lib/android /usr/share/dotnet /opt/ghc /opt/hostedtoolcache/CodeQL
          df -h /
```

- [ ] **Step 5: Write ADR 0004 and update the docs**

`docs/adr/0004-converge-forward-apply.md`:

```markdown
# 0004. Converge forward: apply has no automatic rollback

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

`apply` takes several steps in order:

1. generate keys;
2. write files;
3. pull images;
4. fix appdata ownership;
5. start the containers;
6. verify;
7. later, wire the apps together.

Any of them can fail: a registry is unreachable, an app never becomes healthy. Undoing
a half-applied stack would mean stopping containers that were running, restoring old
files and forgetting keys. That is riskier than the failure itself, and the old state
may not even have been working.

## Decision

`apply` converges forward:

- **Every step is idempotent.** After a step fails, the later steps are marked
  `skipped`, and the change record is still written with the outcome `failed`.
- **The fix is to run `apply` again.** It plans afresh and does only what is left.
- **Nothing is rolled back automatically.**

The order keeps failures cheap:

- **Images are pulled before anything is stopped.** A network failure leaves the
  running stack untouched.
- **Files are written atomically.** The previous `compose.yaml` is kept as
  `compose.prev.yaml`.
- **Keys are saved before any container starts.**
- **A lock stops two applies from running at once.**

## Consequences

- **A failed apply can leave the stack partly updated,** for example with new files but
  old containers. `plan` shows exactly what is left, and the change record shows which
  steps ran.
- **Rollback stays manual for now.** Snapshot-based rollback is reserved for version
  updates in M3, the one case where going forward can be worse, because of database
  migrations.
```

In `docs/adr/0002-compose-native-control-plane.md`, replace the `**Ejectable.**` bullet
with:

```markdown
- **Ejectable.** The generated project runs without Mediaplane. The header of
  `generated/compose.yaml` gives the exact command:
  `docker compose -p mediaplane --project-directory <home> -f <home>/generated/compose.yaml [-f <home>/compose.override.yaml] --env-file <home>/generated/.env up -d`.
```

Keep any text that followed the old bullet's first sentence, if it still applies.

In `docs/design/m1-engine-cli.md` §2.3, replace criterion 6 with:

```markdown
6. **Ejectable.** The generated Compose project runs without Mediaplane, using the
   exact `docker compose -p mediaplane --project-directory … -f … [-f …] --env-file …
   up -d` command printed in the generated file's header.
```

In `docs/plans/m1-roadmap.md`, change the heading `**S2b (blockers for \`apply\`):**`
to `**S2b (blockers for \`apply\`):** all of these are in the S2b plan.`.

In `README.md`:

1. **The status quote.** Replace it with:

   ```markdown
   > **Status: pre-alpha, not ready for use yet.**
   >
   > - **Works today:** `mediaplane plan` checks a real host and shows exactly what it
   >   would do. `mediaplane apply` then starts the stack and confirms that every app
   >   is healthy.
   > - **Next:** wiring the apps together. Until that lands, each app still needs
   >   setting up by hand, and Jellyfin's first-run page is open to anyone who can
   >   reach it.
   >
   > Watch the repo to follow along.
   ```

2. **The "What works so far" table.** Change the `mediaplane apply` row's status to
   `Done`, and add these rows after it:

   ```markdown
   | See each app's health and every past apply (`status`, `history`)                | Done            |
   | Write a starter `stack.yaml` (`init`)                                            | Done            |
   ```

3. **The "Try it" section.** After its last paragraph, add:

   ````markdown
   To actually start the stack, use a stack without the VPN. A fake WireGuard key can't
   connect, so Gluetun would never become healthy. Change the qBittorrent line to
   `qbittorrent: { vpn: false }`, delete the `vpn:` line, then run:

   ```bash
   pnpm --silent mediaplane apply --home .mediaplane-dev --yes
   pnpm --silent mediaplane status --home .mediaplane-dev
   ```

   This starts real containers on this machine, with the web UIs on `localhost`. To
   remove them, run `docker compose -p mediaplane down`, then
   `sudo rm -rf .mediaplane-dev`. Seerr's folder belongs to uid 1000, which is why
   `sudo` is needed.
   ````

In `CONTRIBUTING.md`, after the paragraph about the real-Docker tests, add:

```markdown
The apply end-to-end test pulls the full app stack the first time, about 7 GB, and
starts it, so allow several minutes. The test files run one at a time because they
share host ports.
```

- [ ] **Step 6: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm test:e2e
git add -A
git commit -m "test(e2e): apply the real video stack in CI, and document converge-forward apply"
```

If `pnpm test:coverage` is below a threshold, add a focused test for each uncovered
behaviour. Never lower the thresholds.

---

## Slice 2b completion checklist

- [ ] `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm test:e2e`
  passes on this aarch64 machine.
- [ ] The README's `apply` steps, run against a scratch `.mediaplane-dev`, bring
  every app up healthy. A second `apply` prints `No changes.` and exits 0. The scratch
  stack is then removed.
- [ ] No `mediaplane-e2e-*` containers are left (the leftover check prints `clean`).
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the owner.
