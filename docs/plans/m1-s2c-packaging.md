# M1 Slice 2c: packaging — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mediaplane runs as its own hardened container, next to a Docker socket proxy,
in the `mediaplane-system` Compose project. `plan` and `apply` work from inside that
container exactly as they do from source, and the stack they start still runs without
Mediaplane, using the command in the generated file's header (success criterion 6). The
slice also documents everything that exists so far (spec §9): the generated `stack.yaml`
and CLI references, the architecture, a README per app, a runbook, the threat model, and
ADRs 0006 and 0008.

**Architecture:**

- **The image.** The CLI is bundled with esbuild into one ES module and copied into a
  `node:24-alpine` image, together with the Docker CLI and the Compose plugin from the
  official `docker:29.8.1-cli` image. It runs as a non-root user and idles with
  `sleep infinity`; commands arrive through `docker exec mediaplane mediaplane <command>`.
- **The deployment.** `deploy/mediaplane.compose.yaml` runs two services:
  - `mediaplane`, with a read-only root, no capabilities, `no-new-privileges`, a fixed
    `hostname:` (so it can clear its own stale lock), the home mounted at its own path, and
    no route out of an internal network;
  - `socket-proxy` (wollomatic/socket-proxy), the only container that mounts
    `/var/run/docker.sock`. It accepts connections from `mediaplane` only, and only the
    Docker API calls the engine makes. Those calls were captured on 2026-10-09 by running
    `plan`, `apply` (create, recreate, remove, chown) and the host helper through the proxy
    in debug mode.
- **The host helper (spec §4.2).** Inside a container, the network interfaces, free ports
  and folders outside the home are the container's, not the host's. So when
  `MEDIAPLANE_IMAGE` is set (the deployment sets it), the engine runs a throwaway container
  of that same image on the host network, with read-only bind mounts, and asks it for a
  JSON report:
  - first the host facts: addresses, cloud and architecture;
  - then everything preflight needs: the data folder, devices, disk space, ports, and
    whether the home is really the same folder on the host.

  Running from source, nothing changes: the engine looks at the host itself.
- **CI, on both architectures, natively.** The repo is public, so GitHub's
  `ubuntu-24.04-arm` runners are free.
  - **An `image` matrix job** builds the image on `ubuntu-24.04` (amd64) and on
    `ubuntu-24.04-arm` (arm64), with no QEMU. Each runner scans its own image with Trivy,
    which fails on fixable critical vulnerabilities.
  - **The `e2e` job becomes a matrix** over the same two runners. On each it deploys the
    image with `deploy/mediaplane.compose.yaml` and runs `plan` and `apply` inside it,
    through the proxy.
  - **The check job** fails when the generated docs are stale.
- **Docs.** `pnpm docs:generate` writes these from code, and `pnpm docs:check` (in CI)
  fails when any of them is out of date:
  - `docs/reference/stack-yaml.md` and `docs/reference/stack.schema.json`, from the Zod
    schema and the catalog;
  - `docs/reference/cli.md`, from the Commander program;
  - a facts table in each `catalog/<app>/README.md`, from `app.ts`.

  Everything else is hand-written and describes only what is built.

**Tech Stack:** as Slice 2b (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3). Added: `esbuild` 0.28.2 as a direct dev dependency (it
is already in the lockfile through `tsx`), `yaml` as a root dev dependency (the version
the engine uses), and these images, each pinned by digest:

| Image | Version | Why |
|---|---|---|
| `node` | `24.21.0-alpine3.24` | Base of the Mediaplane image, and its bundle stage |
| `docker` | `29.8.1-cli` | Source of the Docker CLI and Compose v5.5.1 copied into the image |
| `wollomatic/socket-proxy` | `1.13.1` | The Docker socket proxy |
| `aquasec/trivy` | `0.74.0` | CI scan of the Mediaplane image |

Each version was at least two weeks old on 2026-10-09: the newer `docker 29.8.2`,
`trivy 0.75.0` and `compose 5.6.0` were not.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §2.1 (the image), §2.3 criterion 6;
- §3.3 (Compose bundled in the image);
- §4.1 (the home at the same path), §4.2 (`network.bind` and the helper container),
  §4.4 (Mediaplane's own deployment);
- §7 (the threat model, the socket proxy and container hardening; Trivy for the image);
- §8.2 (a multi-arch image build on every PR);
- §9 (the documentation set).

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md), especially:

- the S2c row of the S2 split;
- "CI architecture coverage";
- the "S2c" list under "Inputs for later slices from the reviews".

Owner decisions made after the roadmap (2026-10-09):

- **Trivy, for Mediaplane's own image only, moves from S8 to S2c.** Renovate,
  release-please, the SBOM and provenance, and the Trivy scans of catalog images stay in
  S8.
- **Docs are written as we go.** The generated references (`stack.yaml`, JSON Schema, CLI)
  move from S8 to S2c, with a CI freshness check. The `--json` output shapes stay in S8.
  Every later slice's plan includes a docs task for the §9 artefacts it touches.
- **arm64 CI moves from S8 to S2c,** because the repo is public and GitHub's
  `ubuntu-24.04-arm` runners are free for it. The image is built and tested natively on
  each architecture. A multi-arch manifest waits for publishing, in S8.

## Global Constraints

Everything in the Slice 1, 2a and 2b Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md`, `m1-s2a-plan-against-docker.md`, `m1-s2b-apply.md`):

- fake values only, because the repo is public, and nothing personal: no real paths,
  user names, addresses or hostnames in committed files;
- neutral framing;
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes nothing;
- Docker is reached only through the `Runtime`;
- secret values never appear in diagnostics, errors, logs, plan output or JSON output;
- unit tests never need Docker, except the spawned tests in
  `packages/cli/src/main.test.ts`;
- `apply` writes only inside the Mediaplane home, with the S2b file modes;
- the runtime refuses any Compose project that is not `mediaplane` or `mediaplane-<name>`,
  and never accepts `mediaplane-system`;
- end-to-end test files run one at a time;
- never push.

These are added:

- **Every image is pinned by digest, and every GitHub Action by commit SHA.** That
  includes images that CI pulls itself, such as Trivy.
  Use exactly the references in the Tech Stack table and in each task.
- **Docker and Compose flags.** Compose spells some long flags differently in v2 and v5:
  for example `--no-TTY` in v2 and `--no-tty` in v5. The restriction applies to Compose
  long flags. This slice adds only:
  - `docker run` and `docker build` flags, which are the Docker CLI's and the same in
    every supported version: `--rm`, `--init`, `--pull never`, `--network host`, `--user`,
    `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only`, `--label`,
    `--mount`, `--entrypoint`, `--tag`;
  - the Compose long flag `compose version --short`, which the runtime already uses;
  - in tests, Compose's `-p`, `-f`, `--env-file`, `up --detach --wait`, `ps --format json`
    and `down --remove-orphans`, which already run on v2.38 in CI and on v5.5.1 locally.

  Never add a Compose long flag without checking its spelling on both.
- **The Mediaplane container (spec §7.2(3)).**
  - It runs as `${MEDIAPLANE_UID:-1000}:${MEDIAPLANE_GID:-1000}`, never as root.
  - Its root filesystem is read-only, it drops every capability and sets
    `no-new-privileges`.
  - Its only mount is the home, at the same absolute path as on the host.
  - It never mounts `/var/run/docker.sock`, publishes no port, and is on an internal
    network.
  - Its `hostname:` is fixed to `mediaplane`.
- **The socket proxy (spec §7.2(2)).** Its allow-list is exactly the one in Task 9, and the
  unit test there pins it. Widening it needs a new captured call and a change to ADR 0008.
- **The host helper** runs only Mediaplane's own image (`MEDIAPLANE_IMAGE`), on the host
  network, as Mediaplane's own user, with every capability dropped, a read-only root and
  only read-only bind mounts. It never pulls, and is always `--rm`. The engine's own
  helper containers are unnamed and `--rm`, and leftovers are found by the
  `io.mediaplane.helper` label.
- **Running from source stays supported.** With `MEDIAPLANE_IMAGE` unset, the CLI looks at
  the host directly, and never runs the host helper or gives the no-proxy warning.
- **Names in end-to-end tests:**
  - projects: `mediaplane-e2e-<pid>[-<suffix>]`;
  - containers: `mediaplane-e2e-<pid>-<suffix>`;
  - images: `mediaplane-e2e:<pid>[-<suffix>]`.

  Every test removes what it created, images included.
- **Docs.**
  - Hand-written docs describe only behaviour that is built and tested. Anything planned
    says so plainly, with the slice that brings it.
  - Diagrams are plain-text code blocks no wider than 40 columns, never Mermaid, because
    Mermaid doesn't render in the GitHub mobile app.
  - Generated files carry a "generated, do not edit" line and are never edited by hand.
- **Before every commit, run**
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test`. From Task 13 on, also run
  `pnpm docs:check`.

## Decisions taken in this plan

The spec and roadmap leave these open. Each is marked `Decision:` where it is applied, and
the owner is confirming them (the alternatives are in the controller's notes):

1. The socket proxy is `wollomatic/socket-proxy` (Task 9).
2. The allow-list is the captured calls, plus Compose's network connect and disconnect and
   volume create and inspect, so overrides can add networks and volumes. It allows no
   deletes except of containers (Task 9).
3. The proxy runs as `nobody` in the socket's group, which needs `DOCKER_GID` (Task 9).
4. The proxy listens on TCP on an internal network, and accepts only the host name
   `mediaplane` (Task 9).
5. Bind-mount restrictions (`-allowbindmountfrom`) are off by default and documented
   (Task 9, Task 12).
6. The base image is `node:24-alpine`, with npm, yarn and corepack removed (Task 8).
7. The Docker CLI and Compose are copied from the `docker:29.8.1-cli` image (Task 8).
8. The CLI is bundled with esbuild into one file (Task 7).
9. The host helper runs Mediaplane's own image, named by `MEDIAPLANE_IMAGE`, with
   read-only mounts. It also covers ports, the data folder, devices, disk space and the
   home's path, not only addresses (Tasks 3 to 6).
10. The home is checked by comparing the device and inode of `stack.yaml` inside and on
    the host (Task 5).
11. `MEDIAPLANE_IMAGE` is required in the deploy file until S8 publishes images (Task 9).
12. The Mediaplane container's network is internal: no route out (Task 9).
13. The container idles with `sleep infinity` under Compose's `init: true` (Task 8).
14. Trivy runs as its pinned image on a `docker save` tarball of each architecture's
    image, on that architecture's runner, not as the Trivy GitHub Action (Task 11).
15. CI builds and tests each architecture natively, on `ubuntu-24.04` and
    `ubuntu-24.04-arm`, with no QEMU and no multi-arch manifest yet (owner's ruling,
    Task 11).
16. The JSON Schema is published at `docs/reference/stack.schema.json` (the owner's
    path), and spec §4.2's example URL is updated to match (Task 13).
17. Each catalog README has a generated facts block (Task 14).
18. A foreign `working_dir` is a warning, not an error, as the roadmap says (Task 1).
19. `init` writes the invoking user, or 1000 when that is root (Task 2).
20. Running from the image but talking to the raw socket gives the warning
    `docker.no-proxy` (Task 6).

## File structure (new and changed in this slice)

```
Dockerfile                          (new) the Mediaplane image
.dockerignore                       (new)
deploy/
├── mediaplane.compose.yaml         (new) mediaplane-system: Mediaplane + socket proxy
├── mediaplane                      (new) the one-line host shim
├── deploy.test.ts                  (new) hardening and the proxy allow-list
└── README.md                       (new) install, update, run without the proxy
scripts/
├── root.ts                         (new) the repository root
├── bundle.ts / bundle.test.ts      (new) esbuild bundle + third-party licences
├── docs.ts                         (new) docs:generate / docs:check
└── docs/
    ├── stack-reference.ts (+test)  (new) JSON Schema → stack-yaml.md
    ├── cli-reference.ts (+test)    (new) Commander → cli.md
    └── catalog-facts.ts (+test)    (new) app.ts → README facts block
packages/engine/src/
├── runtime/types.ts                (changed) workingDir, HelperMount, hostHelper,
│                                             RuntimeError.name
├── runtime/docker.ts               (changed) working_dir label, hostHelper, no-proxy warning
├── preflight/probe.ts              (changed) PathStat.ino, ProbeRequest, prepare, sameAsHost
├── preflight/checks.ts             (changed) preflightRequest, the home-path check
├── host/report.ts                  (new) what the helper reports, and HelperError
├── host/helper.ts                  (new) host facts and a probe through the helper
├── plan/containers.ts              (changed) otherHomes
├── plan/plan.ts                    (changed) foreign home, no-proxy, helper failures
├── util/atomic.ts                  (changed) a clear error without hard links
├── config/starter.ts               (changed) invokingUser, the schema line
├── config/schema.ts                (changed) .describe() on every field
├── config/json-schema.ts           (new) the published JSON Schema
├── render/compose.ts               (changed) HEALTHCHECK_DEFAULTS
├── testing/fakes.ts                (changed) hostHelper, PathStat.ino
└── testing/schema.ts               (new) the undocumented() test helper
packages/cli/src/
├── run.ts                          (changed) createProgram, helper deps, host-report,
│                                             exit codes, ENVIRONMENT
└── init.ts                         (changed) the invoking user
catalog/qbittorrent/app.ts, catalog/seerr/app.ts  (changed) option descriptions
catalog/catalog.test.ts             (changed) descriptions and the README facts
catalog/<app>/README.md             (new, ×10)
test/e2e/helpers.ts                 (changed) buildImage, removeAsRoot, ejectArguments
test/e2e/image.e2e.test.ts          (new) the image on its own
test/e2e/deploy.e2e.test.ts         (new) plan and apply inside the deployed image
.github/workflows/ci.yml            (changed) docs:check; image and e2e matrices
                                    over amd64 and arm64 runners
docs/reference/{stack-yaml.md, stack.schema.json, cli.md}  (new, generated)
docs/architecture.md                (new)
docs/security/threat-model.md       (new)
docs/runbooks/app-wont-start.md     (new)
docs/adr/0006-seerr-as-the-requests-app.md            (new)
docs/adr/0008-docker-socket-proxy-on-by-default.md    (new)
README.md, CONTRIBUTING.md, SECURITY.md, .gitignore   (changed)
docs/plans/m1-roadmap.md, docs/design/m1-engine-cli.md (changed)
package.json, tsconfig.json, vitest.config.ts          (changed)
```

**Tasks:**

1. A warning when another home created the project's containers.
2. The home's filesystem and owner: hard-link errors, and `init`'s user.
3. The host report: what the helper sees.
4. The runtime runs the host helper.
5. Host facts and preflight through the helper.
6. The CLI uses the helper inside the image, and warns without the proxy.
7. The CLI bundle.
8. The Mediaplane image.
9. `deploy/mediaplane.compose.yaml`, the socket proxy and the host shim.
10. End-to-end: plan and apply inside the deployed image.
11. CI: native amd64 and arm64 image builds, Trivy, and end-to-end tests on both.
12. Packaging docs: install guide, ADR 0008, the threat model.
13. Generated references: `stack.yaml`, JSON Schema, CLI.
14. A README for every app.
15. `docs/architecture.md`.
16. The "app won't start" runbook and ADR 0006.
17. README and roadmap: link the docs.

**Out of scope here:**

- **Publishing the image.** Release automation, GHCR pushes, the SBOM and provenance are
  S8. Until then the install guide builds the image from a checkout, and
  `MEDIAPLANE_IMAGE` names that local image.
- **A multi-arch image manifest** (S8, with publishing). CI builds and tests each
  architecture's image separately, on its own runner.
- **The panel's listener** (M2).
- **Reaching the apps' APIs from the Mediaplane container.** Its network is internal, so
  S3's wiring must attach it to the stack's network, and S6's Plex claim needs a route to
  plex.tv. Task 17 records both as inputs for those slices.

---
### Task 1: A warning when another home created the project's containers

Roadmap S2c input: *"Warn when the project's containers carry a
`com.docker.compose.project.working_dir` from a different home, which means another home
already manages a project with this name."* The runtime always passes
`--project-directory <home>`, so Compose records the home in that label. Decision: this is
a warning, not an error, as the roadmap says: a moved home is a legitimate reason for it.

**Files:**
- Modify: `packages/engine/src/runtime/types.ts` (`ContainerState`)
- Modify: `packages/engine/src/runtime/docker.ts` (`parseContainers`)
- Modify: `packages/engine/src/plan/containers.ts`, `packages/engine/src/plan/plan.ts`
- Test: `packages/engine/src/runtime/docker.test.ts`,
  `packages/engine/src/plan/containers.test.ts`, `packages/engine/src/plan/plan.test.ts`

**Interfaces:**
- **Consumes:** `parseContainers`, `planStack`, `warning`, `compare`, `unique`.
- **Produces:**
  - `ContainerState.workingDir?: string`, the label's value, absent when there is no
    label;
  - `otherHomes(current: readonly ContainerState[], home: string): Diagnostic[]` in
    `plan/containers.ts`;
  - the diagnostic code `project.other-home` (a warning), which `plan` adds right after it
    lists the containers.

- [ ] **Step 1: Write the failing tests**

Add to `describe('parseContainers', …)` in `packages/engine/src/runtime/docker.test.ts`:

```ts
  it('reads the folder Compose ran from, next to label values that contain commas', () => {
    const line = JSON.stringify({
      Service: 'sonarr',
      ID: SONARR_ID,
      State: 'running',
      Health: 'healthy',
      Labels:
        'com.docker.compose.project.config_files=/srv/a/generated/compose.yaml,/srv/a/compose.override.yaml,com.docker.compose.project.working_dir=/srv/a,com.docker.compose.service=sonarr',
      Publishers: [],
    });
    expect(parseContainers(line)[0]?.workingDir).toBe('/srv/a');
  });

  it('reads the folder when it is the last label', () => {
    const line = JSON.stringify({
      Service: 'sonarr',
      Labels: 'com.docker.compose.project.working_dir=/opt/mediaplane',
    });
    expect(parseContainers(line)[0]?.workingDir).toBe('/opt/mediaplane');
  });

  it('has no working folder when the label is absent', () => {
    expect(parseContainers(PS_SONARR)[0]).not.toHaveProperty('workingDir');
  });
```

In `packages/engine/src/plan/containers.test.ts`, change the import to
`import { otherHomes, ownPorts, planContainers } from './containers';` and add:

```ts
describe('otherHomes', () => {
  it('is quiet when every container came from this home, or has no label', () => {
    expect(
      otherHomes(
        [container('sonarr', { workingDir: '/opt/mediaplane' }), container('radarr')],
        '/opt/mediaplane',
      ),
    ).toEqual([]);
  });

  it('names each other folder once, sorted', () => {
    expect(
      otherHomes(
        [
          container('sonarr', { workingDir: '/srv/b' }),
          container('radarr', { workingDir: '/srv/a' }),
          container('prowlarr', { workingDir: '/srv/b' }),
        ],
        '/opt/mediaplane',
      ),
    ).toEqual([
      {
        severity: 'warning',
        code: 'project.other-home',
        message:
          "this stack's containers were created from /srv/a, /srv/b, not from this Mediaplane home (/opt/mediaplane)",
        hint: 'if another Mediaplane home still manages them, apply would take them over: check which home is in use before applying',
      },
    ]);
  });
});
```

Add to `describe('plan', …)` in `packages/engine/src/plan/plan.test.ts`:

```ts
  it("warns when the project's containers were created from another home", async () => {
    const home = await makeHome();
    const elsewhere: ContainerState = {
      service: 'sonarr',
      id: 'fake-sonarr',
      state: 'running',
      health: 'healthy',
      configHash: undefined,
      published: [],
      workingDir: '/srv/other-home',
    };
    const result = await planFor(home, {
      runtime: fakeRuntime({ containers: [elsewhere] }),
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'project.other-home', severity: 'warning' }),
    );
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/runtime/docker.test.ts packages/engine/src/plan`

Expected: FAIL.
- **`parseContainers`:** `workingDir` is `undefined`.
- **`containers.test.ts`:** fails to import `otherHomes`.
- **`plan.test.ts`:** no `project.other-home` diagnostic.

The "has no working folder" test already passes.

- [ ] **Step 3: Implement**

In `packages/engine/src/runtime/types.ts`, add to `ContainerState`, after `configHash`:

```ts
  /**
   * Compose's com.docker.compose.project.working_dir label: the project directory the
   * container was created from. Mediaplane always passes the home, so another folder
   * means another home, or a hand-run `docker compose`, created it.
   */
  workingDir?: string;
```

In `packages/engine/src/runtime/docker.ts`, inside `parseContainers`, replace the
`const state: ContainerState = { … };` statement with:

```ts
      const workingDir = labelValue(labels, 'com.docker.compose.project.working_dir');
      const state: ContainerState = {
        service: text(raw.Service),
        id: text(raw.ID),
        state: text(raw.State),
        health: text(raw.Health),
        configHash: /com\.docker\.compose\.config-hash=([0-9a-f]{64})/.exec(labels)?.[1],
        published: publishers.flatMap((p) =>
          typeof p.PublishedPort === 'number' && p.PublishedPort > 0
            ? [
                {
                  address: text(p.URL),
                  port: p.PublishedPort,
                  protocol: p.Protocol === 'udp' ? ('udp' as const) : ('tcp' as const),
                },
              ]
            : [],
        ),
        ...(workingDir === undefined ? {} : { workingDir }),
      };
```

and add this function below `text()`:

```ts
/**
 * One label's value from ps's "k=v,k=v" Labels string. Values can contain commas (the
 * config_files label lists several files), so a value runs up to the next ",<key>=".
 */
function labelValue(labels: string, key: string): string | undefined {
  const name = key.replaceAll('.', '\\.');
  return new RegExp(`(?:^|,)${name}=(.*?)(?=,[A-Za-z0-9_.-]+=|$)`).exec(labels)?.[1];
}
```

In `packages/engine/src/plan/containers.ts`, replace the first three import lines with:

```ts
import { warning, type Diagnostic } from '../diagnostics';
import { ownPortKey } from '../preflight/checks';
import type { ContainerState } from '../runtime/types';
import { compare, unique } from '../util/sort';
```

and add at the end of the file:

```ts
/**
 * A warning when the project's containers were created from a folder other than this home
 * (roadmap S2c). Usually another Mediaplane home manages a Compose project with the same
 * name, and apply would take its containers over.
 */
export function otherHomes(
  current: readonly ContainerState[],
  home: string,
): Diagnostic[] {
  const others = unique(
    current.flatMap((c) =>
      c.workingDir === undefined || c.workingDir === home ? [] : [c.workingDir],
    ),
  ).sort(compare);
  if (others.length === 0) return [];
  return [
    warning(
      'project.other-home',
      `this stack's containers were created from ${others.join(', ')}, not from this Mediaplane home (${home})`,
      {
        hint: 'if another Mediaplane home still manages them, apply would take them over: check which home is in use before applying',
      },
    ),
  ];
}
```

In `packages/engine/src/plan/plan.ts`:

- change the import from `./containers` to
  `import { notYetHealthy, otherHomes, ownPorts, type ContainerChange } from './containers';`;
- add `diagnostics.push(...otherHomes(current, home));` on the line after the `try`/`catch`
  that sets `versions` and `current`, before `diagnostics.push(...(await runPreflight(`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/runtime/docker.test.ts packages/engine/src/plan`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add packages/engine/src/runtime packages/engine/src/plan
git commit -m "feat(engine): warn when another home created the project's containers"
```

---

### Task 2: The home's filesystem and owner: hard-link errors, and `init`'s user

Two roadmap S2c inputs.

- **Hard links.** The lock and `init`'s `stack.yaml` are created with `link()`, so the home
  needs a filesystem with hard links. Task 12 documents that. Here, the error a user sees
  on such a filesystem (FAT, exFAT, some network shares) names the requirement instead of
  a bare `EPERM`.
- **`init` and uid 1000.** `init` wrote `user: { uid: 1000, gid: 1000 }` and told the user
  to make the data folder writable by uid 1000. Decision: it now writes the user who runs
  it, which inside the Mediaplane container is the user that owns the home. It falls back
  to 1000 when that is root, because the apps should never run as root.

**Files:**
- Modify: `packages/engine/src/util/atomic.ts`, `packages/engine/src/config/starter.ts`,
  `packages/cli/src/init.ts`
- Test: `packages/engine/src/state/lock.test.ts`,
  `packages/engine/src/config/starter.test.ts`, `packages/cli/src/init.test.ts`

**Interfaces:**
- **Consumes:** `writeFileExclusive`, `starterStack`, `init`.
- **Produces:**
  - `writeFileExclusive` throws `cannot create <path> (<code>): the Mediaplane home must be
    on a filesystem that supports hard links, such as ext4, XFS or Btrfs` for `EPERM`,
    `ENOTSUP`, `EOPNOTSUPP` and `ENOSYS` from `link()`, and
    `cannot create <path> (<code>)` for any other failure of `link()` except `EEXIST`;
  - `StarterAnswers.user: { uid: number; gid: number }`;
  - `invokingUser(ids?: { uid: number | undefined; gid: number | undefined }):
    { uid: number; gid: number }`, exported from the engine.

- [ ] **Step 1: Write the failing tests**

In `packages/engine/src/state/lock.test.ts`, replace the test "reports a filesystem without
hard links, leaving nothing behind" with:

```ts
  it('explains a filesystem without hard links, leaving nothing behind', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-lock-'));
    vi.mocked(link).mockRejectedValueOnce(failure('EPERM'));
    await expect(acquireLock(home, NOW)).rejects.toThrow(
      `cannot create ${join(home, LOCK_PATH)} (EPERM): the Mediaplane home must be on a filesystem that supports hard links`,
    );
    expect(await readdir(join(home, 'state'))).toEqual([]);
  });

  it('names the lock file for any other failure to create it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-lock-'));
    vi.mocked(link).mockRejectedValueOnce(failure('EIO'));
    await expect(acquireLock(home, NOW)).rejects.toThrow(
      `cannot create ${join(home, LOCK_PATH)} (EIO)`,
    );
  });
```

In `packages/engine/src/config/starter.test.ts`:

1. Change the import to
   `import { invokingUser, starterStack, type StarterAnswers } from './starter';`.
2. Add `user: { uid: 1000, gid: 1000 },` to `ANSWERS`, after `timezone`.
3. Add this test inside `describe('starterStack', …)`:

```ts
  it('runs the apps as the given user', () => {
    expect(configOf({ ...ANSWERS, user: { uid: 1001, gid: 1002 } }).user).toEqual({
      uid: 1001,
      gid: 1002,
    });
  });
```

4. Add at the end of the file:

```ts
describe('invokingUser', () => {
  it('is whoever runs init', () => {
    expect(invokingUser({ uid: 1001, gid: 1002 })).toEqual({ uid: 1001, gid: 1002 });
  });

  it('is 1000 for root, or where there are no POSIX ids', () => {
    expect(invokingUser({ uid: 0, gid: 0 })).toEqual({ uid: 1000, gid: 1000 });
    expect(invokingUser({ uid: undefined, gid: undefined })).toEqual({
      uid: 1000,
      gid: 1000,
    });
  });
});
```

In `packages/cli/src/init.test.ts`, add `invokingUser` to the `@mediaplane/engine` import,
and add to the test "writes a starter stack and a private secrets folder from flags":

```ts
    const { uid, gid } = invokingUser();
    expect((await stackIn(home)).user).toEqual({ uid, gid });
    expect(term.stdout()).toContain(
      `Create /srv/data and make sure uid ${String(uid)} (gid ${String(gid)}) can write to it.`,
    );
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/state packages/engine/src/config packages/cli/src/init.test.ts`

Expected: FAIL.
- **Lock tests:** the error is the raw `fake: EPERM` / `fake: EIO`.
- **Starter and init:** `invokingUser` does not exist, and `user` is always 1000.

- [ ] **Step 3: Implement**

In `packages/engine/src/util/atomic.ts`, add above `writeFileExclusive`:

```ts
/** What link() reports on a filesystem without hard links (FAT, exFAT, some network shares). */
const NO_HARD_LINKS = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);
```

and replace the inner `try { await link(temp, path); return true; } catch (cause) { … }`
with:

```ts
    try {
      await link(temp, path);
      return true;
    } catch (cause) {
      const code =
        cause instanceof Error && 'code' in cause ? String(cause.code) : undefined;
      if (code === 'EEXIST') return false;
      throw new Error(
        code !== undefined && NO_HARD_LINKS.has(code)
          ? `cannot create ${path} (${code}): the Mediaplane home must be on a filesystem that supports hard links, such as ext4, XFS or Btrfs`
          : `cannot create ${path}${code === undefined ? '' : ` (${code})`}`,
        { cause },
      );
    }
```

In `packages/engine/src/config/starter.ts`:

1. Add to `StarterAnswers`, after `timezone`:

   ```ts
     /** The user and group the apps run as. */
     user: { uid: number; gid: number };
   ```

2. In `starterStack`, replace `'user: { uid: 1000, gid: 1000 }',` with
   `` `user: { uid: ${String(answers.user.uid)}, gid: ${String(answers.user.gid)} }`, ``.
3. Add at the end of the file:

```ts
/**
 * The user `init` writes into the starter: whoever runs it. Inside the Mediaplane
 * container that is the user that owns the home. Root, or a platform without POSIX ids,
 * gets 1000 instead, because the apps should never run as root.
 */
export function invokingUser(
  ids: { uid: number | undefined; gid: number | undefined } = {
    uid: process.getuid?.(),
    gid: process.getgid?.(),
  },
): { uid: number; gid: number } {
  if (ids.uid === undefined || ids.gid === undefined || ids.uid === 0) {
    return { uid: 1000, gid: 1000 };
  }
  return { uid: ids.uid, gid: ids.gid };
}
```

In `packages/cli/src/init.ts`:

1. Add `invokingUser` to the `@mediaplane/engine` import.
2. In `gatherAnswers`, add `user: invokingUser(),` to the returned object, after
   `timezone: options.timezone,`.
3. Replace the line ``    `Create ${answers.dataPath} and make sure uid 1000 can write to it.`, `` with:

```ts
    `Create ${answers.dataPath} and make sure uid ${String(answers.user.uid)} (gid ${String(answers.user.gid)}) can write to it.`,
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/state packages/engine/src/config packages/cli/src/init.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add packages/engine/src/util packages/engine/src/state packages/engine/src/config packages/cli/src
git commit -m "fix: explain a home without hard links, and start init's stack as its user"
```

---
### Task 3: The host report: what the helper sees

The host helper (spec §4.2) is a throwaway container of the Mediaplane image on the host
network. It runs a hidden CLI command (Task 6), `mediaplane host-report <request>`, which
prints one JSON report. This task builds that report, its request, and both parsers, all
in the engine and all pure apart from the probe.

Decision: the helper runs Mediaplane's own image rather than, say, busybox, so it reuses
the engine's own `detectHostFacts()` and `nodeProbe`, and its answers are exactly what the
engine computes on a host. There is no parsing of `ip` or `stat` output.

Facts checked on 2026-10-09:

- An unprivileged container (`--user 1002:1002 --cap-drop ALL --read-only`) on
  `--network host` reads `/sys/class/dmi/id/{sys_vendor,chassis_asset_tag}` and sees the
  host's interfaces.
- It can `stat` a character device through a read-only bind mount of `/dev`.

**Files:**
- Create: `packages/engine/src/host/report.ts`, `packages/engine/src/host/report.test.ts`
- Modify: `packages/engine/src/preflight/probe.ts` (`PathStat.ino`),
  `packages/engine/src/runtime/types.ts` (`RuntimeError.name`),
  `packages/engine/src/testing/fakes.ts`, `packages/engine/src/index.ts`
- Test (fixture updates for `ino`): `packages/engine/src/preflight/checks.test.ts`,
  `packages/engine/src/apply/ownership.test.ts`

**Interfaces:**
- **Consumes:** `detectHostFacts`, `nodeProbe`, `portKey`, `RuntimeError`.
- **Produces** (all exported from `@mediaplane/engine`):
  - `PathStat.ino: number`, the inode number. Task 5 compares `dev` and `ino` to tell
    whether two views of a file are the same file.
  - `HOST_REPORT_SCHEMA = 'mediaplane.host-report/v1'`.
  - `HostRequest`:

    ```ts
    {
      facts: boolean;
      stat: { key: string; at: string }[];
      free: { key: string; at: string }[];
      ports: { address: string; port: number; protocol: 'tcp' | 'udp' }[];
    }
    ```

    `key` is the host path the engine asks about, and `at` is where the helper sees it.
  - `HostReport`:

    ```ts
    {
      schema: 'mediaplane.host-report/v1';
      facts?: HostFacts;
      stat: Record<string, PathStat | null>;
      free: Record<string, number | null>;
      ports: Record<string, boolean | null>;
    }
    ```

    `stat` and `free` are keyed by `key`, and `ports` by `portKey()`. `null` means "does
    not exist" (stat), or "can't tell" (free space and ports).
  - `collectHostReport(request, probe = nodeProbe, facts = () => detectHostFacts()):
    Promise<HostReport>`.
  - `parseHostRequest(text): HostRequest`, which throws `Error`.
  - `parseHostReport(stdout): HostReport`, which throws `HelperError`.
  - `class HelperError extends RuntimeError`: the host helper could not run, or answered
    something unreadable.

- [ ] **Step 1: Add `ino` to `PathStat`**

In `packages/engine/src/preflight/probe.ts`, add to `PathStat`, after `dev`:

```ts
  /** Inode number: with `dev`, it says whether two paths are the same file. */
  ino: number;
```

and add `ino: s.ino,` after `dev: s.dev,` in `nodeProbe.stat`.

Add `ino: 1,` after `dev: 1,` in:

- `healthyDir` in `packages/engine/src/testing/fakes.ts`;
- `dir()` in `packages/engine/src/preflight/checks.test.ts`;
- `owned()` in `packages/engine/src/apply/ownership.test.ts`.

Run: `pnpm typecheck`

Expected: no errors.

- [ ] **Step 2: Write the failing tests**

`packages/engine/src/host/report.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { HostProbe } from '../preflight/probe';
import { fakeProbe } from '../testing/fakes';
import { FIXTURE_HOST } from '../testing/fixtures';
import {
  collectHostReport,
  HelperError,
  HOST_REPORT_SCHEMA,
  parseHostReport,
  parseHostRequest,
  type HostRequest,
} from './report';

const REQUEST: HostRequest = {
  facts: false,
  stat: [
    { key: '/srv/data', at: '/mediaplane-host/0' },
    { key: '/srv/data/media', at: '/mediaplane-host/0/media' },
  ],
  free: [{ key: '/srv/data', at: '/mediaplane-host/0' }],
  ports: [{ address: '127.0.0.1', port: 8989, protocol: 'tcp' }],
};

describe('collectHostReport', () => {
  it('looks at each path where the helper sees it, and reports it by its host path', async () => {
    const seen: string[] = [];
    const base = fakeProbe({
      stats: { '/mediaplane-host/0/media': undefined },
      busyPorts: ['tcp/127.0.0.1:8989'],
    });
    const probe: HostProbe = {
      ...base,
      stat: (path) => {
        seen.push(path);
        return base.stat(path);
      },
    };
    const report = await collectHostReport(REQUEST, probe, () => FIXTURE_HOST);
    expect(seen).toEqual(['/mediaplane-host/0', '/mediaplane-host/0/media']);
    expect(report).toEqual({
      schema: HOST_REPORT_SCHEMA,
      stat: {
        '/srv/data': expect.objectContaining({ isDirectory: true, ino: 1 }),
        '/srv/data/media': null,
      },
      free: { '/srv/data': 100 * 1024 ** 3 },
      ports: { 'tcp/127.0.0.1:8989': false },
    });
  });

  it("reports the host's facts only when asked", async () => {
    const report = await collectHostReport(
      { facts: true, stat: [], free: [], ports: [] },
      fakeProbe(),
      () => FIXTURE_HOST,
    );
    expect(report.facts).toEqual(FIXTURE_HOST);
  });

  it("says when it can't tell", async () => {
    const probe: HostProbe = {
      ...fakeProbe(),
      freeBytes: () => Promise.resolve(undefined),
      portFree: () => Promise.resolve(undefined),
    };
    const report = await collectHostReport(REQUEST, probe, () => FIXTURE_HOST);
    expect(report.free).toEqual({ '/srv/data': null });
    expect(report.ports).toEqual({ 'tcp/127.0.0.1:8989': null });
  });
});

describe('parseHostRequest', () => {
  it('reads back what the engine sends', () => {
    expect(parseHostRequest(JSON.stringify(REQUEST))).toEqual(REQUEST);
  });

  it('refuses anything else', () => {
    expect(() => parseHostRequest('{"facts":true}')).toThrow(
      'the host helper was given a request it cannot read',
    );
    expect(() => parseHostRequest('not json')).toThrow(
      'the host helper was given a request it cannot read',
    );
  });
});

describe('parseHostReport', () => {
  it('reads the last line the helper printed', async () => {
    const report = await collectHostReport(REQUEST, fakeProbe(), () => FIXTURE_HOST);
    expect(parseHostReport(`some warning\n${JSON.stringify(report)}\n`)).toEqual(report);
  });

  it('refuses a report from another version, or none at all', () => {
    const other = JSON.stringify({ schema: 'mediaplane.host-report/v9' });
    expect(() => parseHostReport(other)).toThrow(HelperError);
    expect(() => parseHostReport('')).toThrow(
      'the host helper printed a report Mediaplane cannot read',
    );
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/host/report.test.ts`

Expected: FAIL. `./report` does not exist.

- [ ] **Step 4: Implement**

`packages/engine/src/host/report.ts`:

```ts
import { z } from 'zod';
import { portKey } from '../preflight/checks';
import { nodeProbe, type HostProbe, type PathStat } from '../preflight/probe';
import { RuntimeError } from '../runtime/types';
import { detectHostFacts, type HostFacts } from './facts';

/** The version of the host helper's report: the helper and the engine share one image. */
export const HOST_REPORT_SCHEMA = 'mediaplane.host-report/v1';

/** The host helper could not run, or printed something the engine cannot read. */
export class HelperError extends RuntimeError {
  override readonly name: string = 'HelperError';
}

/** A host path the engine asks about (`key`), and where the helper sees it (`at`). */
const lookupSchema = z.strictObject({
  key: z.string().regex(/^\//),
  at: z.string().regex(/^\//),
});

const hostRequestSchema = z.strictObject({
  facts: z.boolean(),
  stat: z.array(lookupSchema),
  free: z.array(lookupSchema),
  ports: z.array(
    z.strictObject({
      address: z.string().min(1),
      port: z.int().min(1).max(65535),
      protocol: z.enum(['tcp', 'udp']),
    }),
  ),
});

/** What the engine asks the host helper. */
export type HostRequest = z.infer<typeof hostRequestSchema>;

// dev and ino can exceed 2^53, so they are plain numbers; both sides round them alike.
const pathStatSchema = z.strictObject({
  isDirectory: z.boolean(),
  isCharacterDevice: z.boolean(),
  uid: z.int(),
  gid: z.int(),
  mode: z.int(),
  dev: z.number(),
  ino: z.number(),
});

const hostFactsSchema = z.strictObject({
  arch: z.enum(['amd64', 'arm64']),
  privateAddresses: z.array(z.strictObject({ address: z.string(), cidr: z.string() })),
  cloud: z.string().optional(),
});

const hostReportSchema = z.strictObject({
  schema: z.literal(HOST_REPORT_SCHEMA),
  facts: hostFactsSchema.optional(),
  stat: z.record(z.string(), pathStatSchema.nullable()),
  free: z.record(z.string(), z.number().nullable()),
  ports: z.record(z.string(), z.boolean().nullable()),
});

/**
 * What the host helper saw. stat and free are keyed by host path, ports by portKey().
 * null: the path does not exist, or (free space, ports) the helper can't tell.
 */
export type HostReport = z.infer<typeof hostReportSchema>;

/**
 * The host helper's answer (spec §4.2). It runs in a throwaway container of the Mediaplane
 * image on the host network, so the network interfaces, firmware and free ports it sees
 * are the host's. It sees host paths where the engine mounted them (`at`).
 */
export async function collectHostReport(
  request: HostRequest,
  probe: HostProbe = nodeProbe,
  facts: () => HostFacts = () => detectHostFacts(),
): Promise<HostReport> {
  const stat: Record<string, PathStat | null> = {};
  for (const { key, at } of request.stat) stat[key] = (await probe.stat(at)) ?? null;
  const free: Record<string, number | null> = {};
  for (const { key, at } of request.free) free[key] = (await probe.freeBytes(at)) ?? null;
  const ports: Record<string, boolean | null> = {};
  for (const { address, port, protocol } of request.ports) {
    ports[portKey(protocol, address, port)] =
      (await probe.portFree(address, port, protocol)) ?? null;
  }
  return {
    schema: HOST_REPORT_SCHEMA,
    ...(request.facts ? { facts: facts() } : {}),
    stat,
    free,
    ports,
  };
}

/** The helper's side: the request it was given on its command line. */
export function parseHostRequest(text: string): HostRequest {
  const parsed = hostRequestSchema.safeParse(parseJson(text));
  if (!parsed.success) {
    throw new Error(
      `the host helper was given a request it cannot read: ${firstIssue(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** The engine's side: the report on the last line of the helper's output. */
export function parseHostReport(stdout: string): HostReport {
  const last = stdout.trim().split('\n').at(-1) ?? '';
  const parsed = hostReportSchema.safeParse(parseJson(last));
  if (!parsed.success) {
    throw new HelperError(
      `the host helper printed a report Mediaplane cannot read: ${firstIssue(parsed.error)}`,
    );
  }
  return parsed.data;
}

/** JSON, or undefined (which every schema above rejects) for anything that isn't. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (issue === undefined) return 'no details';
  return issue.path.length === 0
    ? issue.message
    : `${issue.path.join('.')}: ${issue.message}`;
}
```

In `packages/engine/src/runtime/types.ts`, change `RuntimeError`'s name line to
`override readonly name: string = 'RuntimeError';`. A literal-typed `name` would stop a
subclass such as `HelperError` from naming itself.

In `packages/engine/src/index.ts`, add `export * from './host/report';` after
`export * from './host/facts';`.

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/host`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add packages/engine/src
git commit -m "feat(engine): add the host report the host helper prints"
```

---

### Task 4: The runtime runs the host helper

**Files:**
- Modify: `packages/engine/src/runtime/types.ts`, `packages/engine/src/runtime/docker.ts`,
  `packages/engine/src/testing/fakes.ts`
- Test: `packages/engine/src/runtime/docker.test.ts`,
  `packages/engine/src/testing/fakes.test.ts`

**Interfaces:**
- **Consumes:** `HostRequest` (Task 3) and the runtime's `docker()` helper.
- **Produces:**
  - `HelperMount { source: string; target: string }`: a read-only bind of the host's
    `source` at `target` in the helper.
  - `HelperResult`, either `{ ok: true; stdout: string }` or
    `{ ok: false; error: string; missingSource?: string }`. `missingSource` is a mount
    source the host doesn't have.
  - `Runtime.hostHelper(image, request, mounts, user): Promise<HelperResult>`, with
    `image: string`, `request: string`, `mounts: readonly HelperMount[]` and
    `user: { uid: number; gid: number }`.
  - `HELPER_LABEL = 'io.mediaplane.helper'`.
  - `bindMount(mount: HelperMount): string`: the `--mount` value.
  - `FakeRuntimeOptions.hostHelper?: (request: HostRequest, mounts: readonly HelperMount[])
    => HelperResult | Promise<HelperResult>`. The fake records
    `host-helper <target>…` and, without the option, fails with
    `this fake Docker has no host helper`.

The `docker run` arguments are the Docker CLI's own, the same in every supported Docker
version. `--pull never` needs Docker 20.10, and preflight requires 24.0. They are
`--rm --pull never --network host --user U:G --cap-drop ALL --security-opt
no-new-privileges --read-only --label io.mediaplane.helper=host-report
[--mount …]… --entrypoint mediaplane <image> host-report <request>`.

When a bind source is missing, Docker answers (observed with Docker 29.8 on 2026-10-09):
`docker: Error response from daemon: invalid mount config for type "bind": bind source
path does not exist: <path>`.

- [ ] **Step 1: Write the failing tests**

Add to `describe('createDockerRuntime', …)` in
`packages/engine/src/runtime/docker.test.ts`:

```ts
  it('runs the host helper on the host network, locked down, without pulling', async () => {
    const { exec, calls } = recorder(() => ok('{"schema":"mediaplane.host-report/v1"}\n'));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    const result = await runtime.hostHelper(
      'mediaplane:local',
      '{"facts":true}',
      [
        { source: '/dev', target: '/mediaplane-host/0' },
        { source: '/srv/my,data', target: '/mediaplane-host/1' },
      ],
      { uid: 1001, gid: 1002 },
    );
    expect(result).toEqual({ ok: true, stdout: '{"schema":"mediaplane.host-report/v1"}\n' });
    expect(calls[0]?.args).toEqual([
      'run',
      '--rm',
      '--pull',
      'never',
      '--network',
      'host',
      '--user',
      '1001:1002',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--read-only',
      '--label',
      'io.mediaplane.helper=host-report',
      '--mount',
      'type=bind,"source=/dev",target=/mediaplane-host/0,readonly',
      '--mount',
      'type=bind,"source=/srv/my,data",target=/mediaplane-host/1,readonly',
      '--entrypoint',
      'mediaplane',
      'mediaplane:local',
      'host-report',
      '{"facts":true}',
    ]);
    expect(calls[0]?.options?.timeoutMs).toBe(60_000);
  });

  it('names a mount source the host does not have', async () => {
    const { exec } = recorder(() => ({
      code: 125,
      stdout: '',
      stderr:
        'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /srv/data\n\nRun \'docker run --help\' for more information\n',
    }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    expect(
      await runtime.hostHelper(
        'mediaplane:local',
        '{}',
        [{ source: '/srv/data', target: '/mediaplane-host/0' }],
        { uid: 1000, gid: 1000 },
      ),
    ).toEqual({
      ok: false,
      error:
        'docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /srv/data\nRun \'docker run --help\' for more information',
      missingSource: '/srv/data',
    });
  });

  it('reports any other helper failure with its last lines', async () => {
    const { exec } = recorder(() => ({
      code: 125,
      stdout: '',
      stderr: 'docker: Error response from daemon: No such image: mediaplane:gone\n',
    }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    expect(
      await runtime.hostHelper('mediaplane:gone', '{}', [], { uid: 1000, gid: 1000 }),
    ).toEqual({
      ok: false,
      error: 'docker: Error response from daemon: No such image: mediaplane:gone',
    });
  });
```

Add a new `describe` at the end of the same file, and add `bindMount` to its import from
`./docker`:

```ts
describe('bindMount', () => {
  it('quotes the source, doubling any quote, because Docker reads --mount as CSV', () => {
    expect(bindMount({ source: '/srv/a "b"', target: '/mediaplane-host/0' })).toBe(
      'type=bind,"source=/srv/a ""b""",target=/mediaplane-host/0,readonly',
    );
  });
});
```

Add to `packages/engine/src/testing/fakes.test.ts`, and change its import from `./fakes`
to `import { fakeDocker, fakeHash, fakeRuntime } from './fakes';`:

```ts
describe('fakeRuntime().hostHelper', () => {
  it('fails unless the test gives it an answer, and records the mounts', async () => {
    const calls: string[] = [];
    const mounts = [{ source: '/srv/data', target: '/mediaplane-host/0' }];
    const user = { uid: 1000, gid: 1000 };
    const none = fakeRuntime({ calls });
    expect(await none.hostHelper('mediaplane:test', '{}', mounts, user)).toEqual({
      ok: false,
      error: 'this fake Docker has no host helper',
    });
    const answering = fakeRuntime({
      calls,
      hostHelper: (request) => ({ ok: true, stdout: JSON.stringify(request) }),
    });
    const request = JSON.stringify({ facts: true, stat: [], free: [], ports: [] });
    expect(await answering.hostHelper('mediaplane:test', request, mounts, user)).toEqual({
      ok: true,
      stdout: request,
    });
    expect(calls).toEqual(['host-helper /mediaplane-host/0', 'host-helper /mediaplane-host/0']);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/runtime packages/engine/src/testing`

Expected: FAIL. `hostHelper` and `bindMount` do not exist (and `pnpm typecheck` reports the
missing `Runtime` member).

- [ ] **Step 3: Implement**

In `packages/engine/src/runtime/types.ts`, add before `export interface Runtime`:

```ts
/** A read-only bind mount for the host helper: the host's `source`, at `target` inside. */
export interface HelperMount {
  source: string;
  target: string;
}

/** The host helper's output, or why it failed; `missingSource` is a source the host lacks. */
export type HelperResult =
  { ok: true; stdout: string } | { ok: false; error: string; missingSource?: string };
```

and add to `interface Runtime`, after `chown`:

```ts
  /**
   * Run the host helper (spec §4.2): a throwaway container of Mediaplane's own `image` on
   * the host network, as `user`, with no capabilities, a read-only root and `mounts`
   * bound read-only, running `mediaplane host-report <request>`. It never pulls.
   */
  hostHelper(
    image: string,
    request: string,
    mounts: readonly HelperMount[],
    user: { uid: number; gid: number },
  ): Promise<HelperResult>;
```

In `packages/engine/src/runtime/docker.ts`:

1. Add `type HelperMount` and `type HelperResult` to the import from `./types`.
2. Add below `DOCKER_TIMEOUTS`:

   ```ts
   /** The label on every host-helper container, so a leftover one is easy to find. */
   export const HELPER_LABEL = 'io.mediaplane.helper';
   ```

3. Add this method to the returned runtime, after `chown`:

```ts
    async hostHelper(image, request, mounts, user): Promise<HelperResult> {
      const result = await docker('run (host helper)', [
        'run',
        '--rm',
        '--pull',
        'never',
        '--network',
        'host',
        '--user',
        `${String(user.uid)}:${String(user.gid)}`,
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--read-only',
        '--label',
        `${HELPER_LABEL}=host-report`,
        ...mounts.flatMap((mount) => ['--mount', bindMount(mount)]),
        '--entrypoint',
        'mediaplane',
        image,
        'host-report',
        request,
      ]);
      if (result.code === 0) return { ok: true, stdout: result.stdout };
      const missing = /bind source path does not exist: (.+)$/m
        .exec(result.stderr)?.[1]
        ?.trim();
      return {
        ok: false,
        error: lastLines(result.stderr),
        ...(missing === undefined ? {} : { missingSource: missing }),
      };
    },
```

4. Replace `commandResult` with these two functions, so both share the "last three lines"
   rule:

```ts
/** Success, or Compose's last three stderr lines with secret values replaced. */
function commandResult(
  result: ExecResult,
  values: Record<string, string>,
): CommandResult {
  if (result.code === 0) return { ok: true };
  return { ok: false, error: redact(lastLines(result.stderr), values) };
}

/** The last three non-empty lines of a command's stderr. */
function lastLines(stderr: string): string {
  return stderr
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-3)
    .join('\n');
}

/**
 * The --mount value for a read-only bind. Docker reads it as CSV, so the source is quoted
 * (a path may contain a comma), with any quote in it doubled.
 */
export function bindMount(mount: HelperMount): string {
  return `type=bind,"source=${mount.source.replaceAll('"', '""')}",target=${mount.target},readonly`;
}
```

In `packages/engine/src/testing/fakes.ts`:

1. Add `type HelperMount` and `type HelperResult` to the import from `../runtime/types`,
   and add `import type { HostRequest } from '../host/report';`.
2. Add to `FakeRuntimeOptions`:

   ```ts
     /** Answers the host helper, given the parsed request; without it, the helper fails. */
     hostHelper?: (
       request: HostRequest,
       mounts: readonly HelperMount[],
     ) => HelperResult | Promise<HelperResult>;
   ```

3. Add to the object `fakeRuntime` returns, after `chown`:

```ts
    hostHelper: (_image, request, mounts) => {
      record(`host-helper ${mounts.map((m) => m.target).join(' ')}`.trimEnd());
      if (options.hostHelper === undefined) {
        return Promise.resolve({ ok: false, error: 'this fake Docker has no host helper' });
      }
      return Promise.resolve(
        options.hostHelper(JSON.parse(request) as HostRequest, mounts),
      );
    },
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/runtime packages/engine/src/testing`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add packages/engine/src
git commit -m "feat(engine): run the host helper through the runtime"
```

---
### Task 5: Host facts and preflight through the helper

Inside the Mediaplane container, preflight would be wrong about everything outside the
home:

- **Addresses.** `networkInterfaces()` lists the container's `eth0`, a private 172.x
  address, as if it were the LAN.
- **Ports.** Binding `127.0.0.1:8989` succeeds on the container's own loopback, so a port
  the host is using looks free.
- **The data folder and devices.** They are simply not there, so the data folder looks
  missing, and so does `/dev/net/tun`.
- **The home.** If it is mounted at a different path, Compose would bind the wrong
  folders, and nothing would notice (spec §4.1).

So preflight first hands the probe a list of everything it will ask about
(`preflightRequest`), and a probe can look it all up at once (`prepare`). The helper-backed
probe answers like this:

- **Paths inside the home** are looked at locally, where the home is mounted.
- **Everything else** comes from one helper run, with read-only bind mounts:
  - the data folder;
  - `/dev`, for devices;
  - `<home>/stack.yaml`, for the same-folder check.

  If the host lacks one of those folders, Docker refuses that mount. The probe then runs
  the helper again without it, and the paths inside it do not exist.
- **The home check.** `sameAsHost` compares the device and inode of `stack.yaml` here with
  what the host has at the same path. Decision: there is no other reliable way to prove
  "same folder" from inside a container without writing anything, and `plan` writes
  nothing.

**Files:**
- Create: `packages/engine/src/host/helper.ts`, `packages/engine/src/host/helper.test.ts`
- Modify: `packages/engine/src/preflight/probe.ts`, `packages/engine/src/preflight/checks.ts`,
  `packages/engine/src/plan/plan.ts`, `packages/engine/src/index.ts`
- Test: `packages/engine/src/preflight/checks.test.ts`, `packages/engine/src/plan/plan.test.ts`

**Interfaces:**
- **Consumes:** Task 3's `HostRequest`, `parseHostReport`, `HelperError` and `PathStat.ino`;
  Task 4's `Runtime.hostHelper` and `HelperMount`; `portKey`, `STACK_PATH`.
- **Produces:**
  - In `preflight/probe.ts`:
    - `ProbeRequest { stat: string[]; free: string[]; ports: { address: string; port:
      number; protocol: 'tcp' | 'udp' }[]; sameAsHost: string[] }`;
    - two optional `HostProbe` methods: `prepare?(request: ProbeRequest): Promise<void>`
      and `sameAsHost?(path: string): Promise<boolean | undefined>`.
  - In `preflight/checks.ts`:
    - `preflightRequest(input: PreflightInput): ProbeRequest`;
    - `runPreflight` calls `probe.prepare?.(preflightRequest(input))` before any check;
    - the error `preflight.home-path`, when `sameAsHost(<home>/stack.yaml)` is `false`.
  - In `host/helper.ts`:
    - `HELPER_ROOT = '/mediaplane-host'`;
    - `HelperOptions { runtime: Runtime; image: string; user: { uid: number; gid: number } }`;
    - `isInside(path, folder): boolean`;
    - `helperMountSources(paths: readonly string[]): string[]`;
    - `helperHostFacts(options: HelperOptions): Promise<HostFacts>`, which throws
      `HelperError`;
    - `helperProbe(options: HelperOptions & { home: string; local?: HostProbe }): HostProbe`.
  - In `plan()`: a `HelperError` from preflight becomes the error `host.helper-failed`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/host/helper.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeProbe, type HostProbe, type PathStat, type ProbeRequest } from '../preflight/probe';
import type { HelperMount, HelperResult } from '../runtime/types';
import { fakeProbe, fakeRuntime } from '../testing/fakes';
import { FIXTURE_HOST } from '../testing/fixtures';
import { helperHostFacts, helperMountSources, helperProbe, isInside } from './helper';
import { collectHostReport, HOST_REPORT_SCHEMA, type HostRequest } from './report';

const IMAGE = 'mediaplane:test';
const USER = { uid: 1000, gid: 1000 };
const HOME = '/opt/mediaplane';

const TUN: PathStat = {
  isDirectory: false,
  isCharacterDevice: true,
  uid: 0,
  gid: 0,
  mode: 0o20666,
  dev: 5,
  ino: 200,
};

const REQUEST: ProbeRequest = {
  stat: ['/srv/data', '/srv/data/media', '/dev/net/tun', '/opt/mediaplane/appdata/seerr'],
  free: ['/opt/mediaplane', '/srv/data'],
  ports: [{ address: '127.0.0.1', port: 8989, protocol: 'tcp' }],
  sameAsHost: ['/opt/mediaplane/stack.yaml'],
};

interface Seen {
  request: HostRequest;
  mounts: readonly HelperMount[];
}

/** A host helper that answers as the real one does, seeing the host through `host`. */
function answering(host: HostProbe = fakeProbe(), seen: Seen[] = []) {
  return async (request: HostRequest, mounts: readonly HelperMount[]): Promise<HelperResult> => {
    seen.push({ request, mounts });
    const report = await collectHostReport(request, host, () => FIXTURE_HOST);
    return { ok: true, stdout: `${JSON.stringify(report)}\n` };
  };
}

/** A host helper whose host is this machine: it looks at each host path directly. */
function thisMachine() {
  return async (request: HostRequest): Promise<HelperResult> => {
    const direct = (lookups: HostRequest['stat']) => lookups.map(({ key }) => ({ key, at: key }));
    const report = await collectHostReport(
      { ...request, stat: direct(request.stat), free: direct(request.free) },
      nodeProbe,
      () => FIXTURE_HOST,
    );
    return { ok: true, stdout: JSON.stringify(report) };
  };
}

async function homeWithStack(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-helper-'));
  await writeFile(join(home, 'stack.yaml'), 'version: 1\n');
  return home;
}

const NOTHING: ProbeRequest = { stat: [], free: [], ports: [], sameAsHost: [] };

describe('isInside', () => {
  it.each([
    ['/srv/data', '/srv/data', true],
    ['/srv/data/media', '/srv/data', true],
    ['/srv/data/..x', '/srv/data', true],
    ['/srv/data-2', '/srv/data', false],
    ['/srv', '/srv/data', false],
  ])('%s in %s is %s', (path, folder, expected) => {
    expect(isInside(path, folder)).toBe(expected);
  });
});

describe('helperMountSources', () => {
  it('mounts the fewest folders that show every path, and devices through /dev', () => {
    expect(
      helperMountSources([
        '/srv/data/media',
        '/dev/net/tun',
        '/srv/data',
        '/srv/data-2',
        '/opt/mediaplane/stack.yaml',
      ]),
    ).toEqual(['/dev', '/opt/mediaplane/stack.yaml', '/srv/data', '/srv/data-2']);
  });
});

describe('helperHostFacts', () => {
  it('asks the helper for the host facts, with nothing mounted', async () => {
    const seen: Seen[] = [];
    const runtime = fakeRuntime({ hostHelper: answering(fakeProbe(), seen) });
    expect(await helperHostFacts({ runtime, image: IMAGE, user: USER })).toEqual(FIXTURE_HOST);
    expect(seen).toEqual([
      { request: { facts: true, stat: [], free: [], ports: [] }, mounts: [] },
    ]);
  });

  it('explains a helper that cannot run', async () => {
    await expect(
      helperHostFacts({ runtime: fakeRuntime(), image: IMAGE, user: USER }),
    ).rejects.toThrow('the host helper failed: this fake Docker has no host helper');
  });

  it('explains a report without the facts', async () => {
    const runtime = fakeRuntime({
      hostHelper: () => ({
        ok: true,
        stdout: JSON.stringify({ schema: HOST_REPORT_SCHEMA, stat: {}, free: {}, ports: {} }),
      }),
    });
    await expect(helperHostFacts({ runtime, image: IMAGE, user: USER })).rejects.toThrow(
      'the host helper reported no host facts',
    );
  });
});

describe('helperProbe', () => {
  it('asks the helper about the host through read-only mounts, and looks at the home here', async () => {
    const seen: Seen[] = [];
    const host = fakeProbe({
      stats: { '/mediaplane-host/2/media': undefined, '/mediaplane-host/0/net/tun': TUN },
      busyPorts: ['tcp/127.0.0.1:8989'],
    });
    const local = fakeProbe({
      stats: { '/opt/mediaplane/appdata/seerr': undefined },
      freeBytes: 42,
    });
    const probe = helperProbe({
      runtime: fakeRuntime({ hostHelper: answering(host, seen) }),
      image: IMAGE,
      user: USER,
      home: HOME,
      local,
    });
    await probe.prepare?.(REQUEST);
    expect(seen[0]?.mounts).toEqual([
      { source: '/dev', target: '/mediaplane-host/0' },
      { source: '/opt/mediaplane/stack.yaml', target: '/mediaplane-host/1' },
      { source: '/srv/data', target: '/mediaplane-host/2' },
    ]);
    expect(seen[0]?.request).toEqual({
      facts: false,
      stat: [
        { key: '/dev/net/tun', at: '/mediaplane-host/0/net/tun' },
        { key: '/opt/mediaplane/stack.yaml', at: '/mediaplane-host/1' },
        { key: '/srv/data', at: '/mediaplane-host/2' },
        { key: '/srv/data/media', at: '/mediaplane-host/2/media' },
      ],
      free: [{ key: '/srv/data', at: '/mediaplane-host/2' }],
      ports: REQUEST.ports,
    });
    expect(await probe.stat('/dev/net/tun')).toEqual(TUN);
    expect(await probe.stat('/srv/data/media')).toBeUndefined();
    expect(await probe.stat('/opt/mediaplane/appdata/seerr')).toBeUndefined();
    expect(await probe.freeBytes('/opt/mediaplane')).toBe(42);
    expect(await probe.freeBytes('/srv/data')).toBe(100 * 1024 ** 3);
    expect(await probe.portFree('127.0.0.1', 8989, 'tcp')).toBe(false);
  });

  it('looks again without a folder the host does not have; nothing inside it exists', async () => {
    const tried: string[][] = [];
    const runtime = fakeRuntime({
      hostHelper: (request, mounts) => {
        tried.push(mounts.map((m) => m.source));
        if (mounts.some((m) => m.source === '/srv/data')) {
          return {
            ok: false,
            error: 'bind source path does not exist: /srv/data',
            missingSource: '/srv/data',
          };
        }
        return answering()(request, mounts);
      },
    });
    const probe = helperProbe({ runtime, image: IMAGE, user: USER, home: HOME });
    await probe.prepare?.(REQUEST);
    expect(tried).toEqual([
      ['/dev', '/opt/mediaplane/stack.yaml', '/srv/data'],
      ['/dev', '/opt/mediaplane/stack.yaml'],
    ]);
    expect(await probe.stat('/srv/data')).toBeUndefined();
    expect(await probe.freeBytes('/srv/data')).toBeUndefined();
  });

  it('reports any other helper failure', async () => {
    const probe = helperProbe({ runtime: fakeRuntime(), image: IMAGE, user: USER, home: HOME });
    await expect(probe.prepare?.(REQUEST)).rejects.toThrow(
      'the host helper failed: this fake Docker has no host helper',
    );
  });

  it('knows a home mounted at its own path is the same folder on the host', async () => {
    const home = await homeWithStack();
    const file = join(home, 'stack.yaml');
    const probe = helperProbe({
      runtime: fakeRuntime({ hostHelper: thisMachine() }),
      image: IMAGE,
      user: USER,
      home,
    });
    await probe.prepare?.({ ...NOTHING, sameAsHost: [file] });
    expect(await probe.sameAsHost?.(file)).toBe(true);
  });

  it('notices a home that is a different folder on the host, or not there at all', async () => {
    const home = await homeWithStack();
    const file = join(home, 'stack.yaml');
    const other = await nodeProbe.stat(file);
    const different = fakeRuntime({
      hostHelper: () => ({
        ok: true,
        stdout: JSON.stringify({
          schema: HOST_REPORT_SCHEMA,
          stat: { [file]: { ...other, ino: -1 } },
          free: {},
          ports: {},
        }),
      }),
    });
    const elsewhere = helperProbe({ runtime: different, image: IMAGE, user: USER, home });
    await elsewhere.prepare?.({ ...NOTHING, sameAsHost: [file] });
    expect(await elsewhere.sameAsHost?.(file)).toBe(false);

    const missing = fakeRuntime({
      hostHelper: (request, mounts) =>
        mounts.length > 0
          ? { ok: false, error: 'no such folder', missingSource: file }
          : thisMachine()(request),
    });
    const absent = helperProbe({ runtime: missing, image: IMAGE, user: USER, home });
    await absent.prepare?.({ ...NOTHING, sameAsHost: [file] });
    expect(await absent.sameAsHost?.(file)).toBe(false);
  });

  it('must be prepared before it is asked about the host', () => {
    const probe = helperProbe({ runtime: fakeRuntime(), image: IMAGE, user: USER, home: HOME });
    expect(() => probe.stat('/srv/data')).toThrow('call prepare() before asking about the host');
  });
});
```

Add to `packages/engine/src/preflight/checks.test.ts`:

1. Extend the imports:

   ```ts
   import { helperProbe } from '../host/helper';
   import { HOST_REPORT_SCHEMA } from '../host/report';
   import { fakeProbe, fakeRuntime } from '../testing/fakes';
   ```

   Replace the existing `fakeProbe` import with the last line. Add `preflightRequest` to
   the import from `./checks`, and `type HostProbe, type ProbeRequest` to the import from
   `./probe`.

2. Add these tests at the end of the file:

```ts
/** The fixture stack behind a VPN, whose Gluetun needs /dev/net/tun, published on the LAN. */
function vpnStack(): ResolvedStack {
  const catalog = fixtureCatalog.map((def) =>
    def.id === 'gluetun'
      ? fixtureApp({ ...def, extras: () => ({ devices: ['/dev/net/tun:/dev/net/tun'] }) })
      : def,
  );
  return stackOf(
    STACK.replace('  qbittorrent: { vpn: false }\n', '  qbittorrent: {}\n')
      .replace('bind: localhost', 'bind: lan')
      .concat('vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }\n'),
    catalog,
  );
}

describe('preflightRequest', () => {
  it('lists every path, folder and port preflight looks at', () => {
    expect(preflightRequest(input())).toEqual({
      stat: ['/srv/data', '/srv/data/torrents', '/srv/data/usenet', '/srv/data/media'],
      free: ['/opt/mediaplane', '/srv/data'],
      ports: [
        { address: '127.0.0.1', port: 8096, protocol: 'tcp' },
        { address: '127.0.0.1', port: 8080, protocol: 'tcp' },
        { address: '127.0.0.1', port: 8989, protocol: 'tcp' },
      ],
      sameAsHost: ['/opt/mediaplane/stack.yaml'],
    });
  });

  it("leaves out ports the project's own containers already publish", () => {
    const request = preflightRequest(input({ ownPorts: new Set([ownPortKey('tcp', 8989)]) }));
    expect(request.ports.map((p) => p.port)).toEqual([8096, 8080]);
  });

  it('is everything runPreflight then asks the probe', async () => {
    let prepared: ProbeRequest | undefined;
    const asked: string[] = [];
    const base = fakeProbe();
    const recording: HostProbe = {
      prepare: (request) => {
        prepared = request;
        return Promise.resolve();
      },
      stat: (path) => {
        asked.push(`stat ${path}`);
        return base.stat(path);
      },
      freeBytes: (path) => {
        asked.push(`free ${path}`);
        return base.freeBytes(path);
      },
      portFree: (address, port, protocol) => {
        asked.push(`port ${portKey(protocol, address, port)}`);
        return base.portFree(address, port, protocol);
      },
      sameAsHost: (path) => {
        asked.push(`same ${path}`);
        return Promise.resolve(true);
      },
    };
    await runPreflight(input({ stack: vpnStack() }), recording);
    const listed = [
      ...(prepared?.stat ?? []).map((path) => `stat ${path}`),
      ...(prepared?.free ?? []).map((path) => `free ${path}`),
      ...(prepared?.ports ?? []).map((p) => `port ${portKey(p.protocol, p.address, p.port)}`),
      ...(prepared?.sameAsHost ?? []).map((path) => `same ${path}`),
    ];
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((call) => !listed.includes(call))).toEqual([]);
    expect(prepared?.stat).toContain('/dev/net/tun');
  });
});

describe('runPreflight through the host helper', () => {
  it('reports a data folder the host lacks, and a home that is another folder there', async () => {
    const runtime = fakeRuntime({
      hostHelper: (request, mounts) => {
        if (mounts.some((m) => m.source === '/srv/data')) {
          return {
            ok: false,
            error: 'bind source path does not exist: /srv/data',
            missingSource: '/srv/data',
          };
        }
        const ports = request.ports.map((p): [string, boolean] => [
          portKey(p.protocol, p.address, p.port),
          true,
        ]);
        return {
          ok: true,
          stdout: JSON.stringify({
            schema: HOST_REPORT_SCHEMA,
            stat: {},
            free: {},
            ports: Object.fromEntries(ports),
          }),
        };
      },
    });
    const probe = helperProbe({
      runtime,
      image: 'mediaplane:test',
      user: { uid: 1000, gid: 1000 },
      home: '/opt/mediaplane',
      local: fakeProbe(),
    });
    expect(codes(await runPreflight(input(), probe))).toEqual([
      'preflight.home-path',
      'preflight.data-missing',
    ]);
  });
});
```

Add to `describe('plan', …)` in `packages/engine/src/plan/plan.test.ts`, with
`import { HelperError } from '../host/report';`:

```ts
  it('explains a host helper that cannot run', async () => {
    const probe: HostProbe = {
      ...fakeProbe(),
      prepare: () => Promise.reject(new HelperError('the host helper failed: no such image')),
    };
    const result = await planFor(await makeHome(), { probe });
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'host.helper-failed',
        message: 'the host helper failed: no such image',
      }),
    );
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/host packages/engine/src/preflight packages/engine/src/plan`

Expected: FAIL. `./helper`, `preflightRequest` and `ProbeRequest` do not exist.

- [ ] **Step 3: Extend the probe interface**

In `packages/engine/src/preflight/probe.ts`, add above `export interface HostProbe`:

```ts
/** Everything preflight will ask a probe, so that a probe can look it all up at once. */
export interface ProbeRequest {
  stat: string[];
  free: string[];
  ports: { address: string; port: number; protocol: 'tcp' | 'udp' }[];
  /** Files that must be the very same file on the Docker host (spec §4.1). */
  sameAsHost: string[];
}
```

and add to `interface HostProbe`, after `portFree`:

```ts
  /** Look up everything in `request` at once. Preflight calls it before any check. */
  prepare?(request: ProbeRequest): Promise<void>;
  /**
   * Whether `path` here is the same file the Docker host has at that path; undefined when
   * it can't tell. Only a probe inside a container can see a difference.
   */
  sameAsHost?(path: string): Promise<boolean | undefined>;
```

- [ ] **Step 4: Make preflight list what it asks**

In `packages/engine/src/preflight/checks.ts`:

1. Replace the imports with:

```ts
import { join } from 'node:path';
import { error, warning, withHint, type Diagnostic } from '../diagnostics';
import { STACK_PATH } from '../paths';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { unique } from '../util/sort';
import type { HostProbe, PathStat, ProbeRequest } from './probe';
```

2. Replace `runPreflight` with:

```ts
/** Host checks that fail fast, before anything is touched (spec §5, stage 3). */
export async function runPreflight(
  input: PreflightInput,
  probe: HostProbe,
): Promise<Diagnostic[]> {
  await probe.prepare?.(preflightRequest(input));
  return [
    ...checkVersions(input.versions),
    ...(await checkHome(input.stack, probe)),
    ...(await checkDisk(input.stack, probe)),
    ...(await checkDataRoot(input.stack, probe)),
    ...(await checkDevices(input.stack, probe)),
    ...(await checkPorts(input, probe)),
  ];
}

/** Everything runPreflight will ask the probe, so a probe can look it all up at once. */
export function preflightRequest(input: PreflightInput): ProbeRequest {
  const { stack } = input;
  const data = stack.config.paths.data;
  return {
    stat: unique([
      data,
      ...DATA_SUBDIRS.map((name) => `${data}/${name}`),
      ...devicesNeeded(stack).map((device) => device.hostPath),
    ]),
    free: unique([stack.home, data]),
    ports: portsToCheck(input).map(({ address, port, protocol }) => ({
      address,
      port,
      protocol,
    })),
    sameAsHost: [join(stack.home, STACK_PATH)],
  };
}

/** Each device an app maps in, by its host path. */
function devicesNeeded(stack: ResolvedStack): { app: ResolvedApp; hostPath: string }[] {
  return stack.apps.flatMap((app) =>
    (app.def.extras?.(app.context).devices ?? []).map((device) => ({
      app,
      hostPath: device.split(':')[0] ?? device,
    })),
  );
}

/**
 * Each published port, at each bind address, that must be free: the ones this project's
 * own containers don't already publish.
 */
function portsToCheck(input: PreflightInput): {
  app: ResolvedApp;
  address: string;
  port: number;
  protocol: 'tcp' | 'udp';
}[] {
  return input.stack.apps.flatMap((app) =>
    app.ports.flatMap((port) =>
      input.ownPorts.has(ownPortKey(port.protocol, port.host))
        ? []
        : input.stack.bindAddresses.map((address) => ({
            app,
            address,
            port: port.host,
            protocol: port.protocol,
          })),
    ),
  );
}

/**
 * The home must be the same folder on the Docker host, because the host's daemon resolves
 * every bind mount in compose.yaml (spec §4.1). Only a probe inside a container can tell.
 */
async function checkHome(stack: ResolvedStack, probe: HostProbe): Promise<Diagnostic[]> {
  if ((await probe.sameAsHost?.(join(stack.home, STACK_PATH))) !== false) return [];
  return [
    error(
      'preflight.home-path',
      `the Mediaplane home ${stack.home} is not the same folder on the Docker host, so Docker would mount the wrong files`,
      {
        hint: `mount the home at the same path inside the Mediaplane container as on the host, as mediaplane.compose.yaml does with MEDIAPLANE_HOME (${stack.home}:${stack.home})`,
      },
    ),
  ];
}
```

3. Replace `checkDevices` and `checkPorts` with versions that walk the same lists:

```ts
async function checkDevices(
  stack: ResolvedStack,
  probe: HostProbe,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const { app, hostPath } of devicesNeeded(stack)) {
    const stat = await probe.stat(hostPath);
    if (stat?.isCharacterDevice === true) continue;
    diagnostics.push(
      error(
        'preflight.device-missing',
        `${app.def.name} needs ${hostPath}, which does not exist on this host`,
        {
          path: `apps.${app.def.id}`,
          ...withHint(
            hostPath === '/dev/net/tun'
              ? 'load the TUN module: sudo modprobe tun'
              : undefined,
          ),
        },
      ),
    );
  }
  return diagnostics;
}

async function checkPorts(
  input: PreflightInput,
  probe: HostProbe,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const { app, address, port, protocol } of portsToCheck(input)) {
    if ((await probe.portFree(address, port, protocol)) !== false) continue;
    diagnostics.push(
      error(
        'preflight.port-in-use',
        `${address}:${port}/${protocol}, which ${app.def.name} needs, is already in use on this host`,
        {
          path: `apps.${app.def.id}.port`,
          hint: `stop whatever is using it, or set apps.${app.def.id}.port to a free port`,
        },
      ),
    );
  }
  return diagnostics;
}
```

- [ ] **Step 5: Write the helper-backed facts and probe**

`packages/engine/src/host/helper.ts`:

```ts
import { isAbsolute, relative } from 'node:path';
import { portKey } from '../preflight/checks';
import { nodeProbe, type HostProbe, type ProbeRequest } from '../preflight/probe';
import type { HelperMount, Runtime } from '../runtime/types';
import { compare, unique } from '../util/sort';
import type { HostFacts } from './facts';
import { HelperError, parseHostReport, type HostReport, type HostRequest } from './report';

/** Where the host helper sees the folders the engine mounts into it. */
export const HELPER_ROOT = '/mediaplane-host';

export interface HelperOptions {
  runtime: Runtime;
  /** The Mediaplane image this container runs (MEDIAPLANE_IMAGE). */
  image: string;
  /** Who the helper runs as: Mediaplane's own user. */
  user: { uid: number; gid: number };
}

/** Whether `path` is `folder` or inside it. */
export function isInside(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel));
}

/**
 * The folders to mount into the helper so that it sees every path: the fewest, since a
 * folder's mount shows everything inside it. Devices are seen through /dev.
 */
export function helperMountSources(paths: readonly string[]): string[] {
  const roots = unique(paths.map((path) => (isInside(path, '/dev') ? '/dev' : path))).sort(
    compare,
  );
  return roots.filter((root, i) => !roots.slice(0, i).some((other) => isInside(root, other)));
}

/**
 * Facts about the host, from the helper (spec §4.2): this container's own network
 * interfaces are not the host's.
 */
export async function helperHostFacts(options: HelperOptions): Promise<HostFacts> {
  const request: HostRequest = { facts: true, stat: [], free: [], ports: [] };
  const result = await options.runtime.hostHelper(
    options.image,
    JSON.stringify(request),
    [],
    options.user,
  );
  if (!result.ok) throw new HelperError(`the host helper failed: ${result.error}`);
  const facts = parseHostReport(result.stdout).facts;
  if (facts === undefined) throw new HelperError('the host helper reported no host facts');
  return facts;
}

/**
 * A HostProbe for Mediaplane in its container (spec §4.1, §4.2). Paths in the home are
 * looked at here, where the home is mounted at its own path. Everything else (the data
 * folder, devices, free space and ports) is the host's, so prepare() asks the host helper
 * for all of it at once, and the other methods answer from that report.
 */
export function helperProbe(
  options: HelperOptions & { home: string; local?: HostProbe },
): HostProbe {
  const local = options.local ?? nodeProbe;
  const { home } = options;
  let report: HostReport | undefined;

  const prepared = (): HostReport => {
    if (report === undefined) {
      throw new Error('helperProbe: call prepare() before asking about the host');
    }
    return report;
  };

  async function prepare(request: ProbeRequest): Promise<void> {
    const outside = (paths: readonly string[]) =>
      unique(paths.filter((path) => !isInside(path, home))).sort(compare);
    const stat = unique([...outside(request.stat), ...request.sameAsHost]).sort(compare);
    const free = outside(request.free);
    let sources = helperMountSources([...stat, ...free]);
    // Each pass mounts one folder fewer, so this ends.
    for (;;) {
      const mounts: HelperMount[] = sources.map((source, index) => ({
        source,
        target: `${HELPER_ROOT}/${String(index)}`,
      }));
      const lookups = (paths: readonly string[]) =>
        paths.flatMap((key) => {
          const mount = mounts.find((m) => isInside(key, m.source));
          return mount === undefined
            ? []
            : [{ key, at: `${mount.target}${key.slice(mount.source.length)}` }];
        });
      const helperRequest: HostRequest = {
        facts: false,
        stat: lookups(stat),
        free: lookups(free),
        ports: request.ports,
      };
      const result = await options.runtime.hostHelper(
        options.image,
        JSON.stringify(helperRequest),
        mounts,
        options.user,
      );
      if (result.ok) {
        report = parseHostReport(result.stdout);
        return;
      }
      // A folder the host doesn't have: nothing inside it exists. Look again without it.
      const missing = result.missingSource;
      if (missing === undefined || !sources.includes(missing)) {
        throw new HelperError(`the host helper failed: ${result.error}`);
      }
      sources = sources.filter((source) => source !== missing);
    }
  }

  return {
    prepare,
    stat(path) {
      if (isInside(path, home)) return local.stat(path);
      return Promise.resolve(prepared().stat[path] ?? undefined);
    },
    freeBytes(path) {
      if (isInside(path, home)) return local.freeBytes(path);
      return Promise.resolve(prepared().free[path] ?? undefined);
    },
    portFree(address, port, protocol) {
      return Promise.resolve(prepared().ports[portKey(protocol, address, port)] ?? undefined);
    },
    async sameAsHost(path) {
      const here = await local.stat(path);
      if (here === undefined) return undefined;
      const there = prepared().stat[path];
      return (
        there !== undefined && there !== null && there.dev === here.dev && there.ino === here.ino
      );
    },
  };
}
```

In `packages/engine/src/index.ts`, add `export * from './host/helper';` after
`export * from './host/report';`.

- [ ] **Step 6: Turn a helper failure into a plan error**

In `packages/engine/src/plan/plan.ts`:

1. Add `import { HelperError } from '../host/report';`.
2. Replace the statement
   `diagnostics.push(...(await runPreflight({ stack, versions, ownPorts: ownPorts(current) }, options.probe)));`
   with:

```ts
  try {
    diagnostics.push(
      ...(await runPreflight(
        { stack, versions, ownPorts: ownPorts(current) },
        options.probe,
      )),
    );
  } catch (cause) {
    if (cause instanceof HelperError)
      return failed([...diagnostics, helperFailed(cause)]);
    if (cause instanceof RuntimeError)
      return failed([...diagnostics, dockerUnavailable(cause)]);
    throw cause;
  }
```

3. Add below `dockerUnavailable`:

```ts
function helperFailed(cause: HelperError): Diagnostic {
  return error('host.helper-failed', cause.message, {
    hint: 'the host helper runs the image named by MEDIAPLANE_IMAGE: check that mediaplane.compose.yaml sets it, and that "docker image ls" lists that image',
  });
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm vitest run packages/engine`

Expected: PASS. Every existing preflight test passes unchanged: `fakeProbe` has no
`prepare` or `sameAsHost`, so the new check stays quiet.

- [ ] **Step 8: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage
git add packages/engine/src
git commit -m "feat(engine): see the host through the host helper when inside a container"
```

If coverage drops below a threshold, add a focused test for the uncovered branch. Never
lower the thresholds.

---
### Task 6: The CLI uses the helper inside the image, and warns without the proxy

`MEDIAPLANE_IMAGE` is set only by `deploy/mediaplane.compose.yaml` (Task 9), which names
the image the container runs. When it is set, the CLI:

- gets the host facts from the helper;
- gives preflight the helper-backed probe;
- warns, on every `plan` and `apply`, if Docker is reached through the raw socket instead
  of the proxy (spec §7.2(2): "The proxy can be disabled, with a warning").

The hidden `host-report` command is what the helper runs. `run()` is split into
`createProgram()` and `run()`, so Task 13 can read the commands without running them.

Decision: the no-proxy rule is "running from the image" (`MEDIAPLANE_IMAGE` set) and
`DOCKER_HOST` unset or one of Docker's default sockets. Running from source talks to the
socket by design, so it never warns.

**Files:**
- Modify: `packages/cli/src/run.ts`, `packages/engine/src/runtime/docker.ts`,
  `packages/engine/src/plan/plan.ts`
- Test: `packages/cli/src/run.test.ts`, `packages/cli/src/init.test.ts`,
  `packages/engine/src/runtime/docker.test.ts`, `packages/engine/src/plan/plan.test.ts`

**Interfaces:**
- **Consumes:** Task 3's `collectHostReport` and `parseHostRequest`; Task 5's
  `helperHostFacts` and `helperProbe`.
- **Produces:**
  - `CliDeps`:

    ```ts
    {
      host: (runtime: Runtime) => Promise<HostFacts>;
      runtime: (home: string, project: string) => Runtime;
      probe: (runtime: Runtime, home: string) => HostProbe;
    }
    ```

  - `defaultDeps(env: NodeJS.ProcessEnv): CliDeps`.
  - `createProgram(io: Io, deps: CliDeps, setExitCode: (code: number) => void): Command`.
  - The hidden command `mediaplane host-report <request>`, which prints one line of
    `mediaplane.host-report/v1` JSON.
  - `dockerAccessWarnings(env: NodeJS.ProcessEnv): Diagnostic[]` in the engine, giving the
    warning code `docker.no-proxy`. `plan` adds it right after the secret checks.

- [ ] **Step 1: Write the failing tests**

In `packages/engine/src/runtime/docker.test.ts`, add `dockerAccessWarnings` to the import
from `./docker`, and add:

```ts
describe('dockerAccessWarnings', () => {
  it('is quiet from source, and in the image when Docker is reached through the proxy', () => {
    expect(dockerAccessWarnings({})).toEqual([]);
    expect(dockerAccessWarnings({ DOCKER_HOST: '' })).toEqual([]);
    expect(
      dockerAccessWarnings({
        MEDIAPLANE_IMAGE: 'mediaplane:local',
        DOCKER_HOST: 'tcp://socket-proxy:2375',
      }),
    ).toEqual([]);
  });

  it.each([undefined, '', 'unix:///var/run/docker.sock', 'unix:///run/docker.sock'])(
    'warns in the image when DOCKER_HOST is %j',
    (dockerHost) => {
      expect(
        dockerAccessWarnings({ MEDIAPLANE_IMAGE: 'mediaplane:local', DOCKER_HOST: dockerHost }),
      ).toEqual([
        expect.objectContaining({ code: 'docker.no-proxy', severity: 'warning' }),
      ]);
    },
  );
});
```

In `packages/engine/src/plan/plan.test.ts`:

- give `planFor` an `env` option:

  ```ts
  function planFor(
    home: string,
    {
      runtime = fakeRuntime(),
      probe = fakeProbe(),
      env = {},
    }: { runtime?: Runtime; probe?: HostProbe; env?: NodeJS.ProcessEnv } = {},
  ) {
    return plan({ home, catalog: fixtureCatalog, host: FIXTURE_HOST, env, runtime, probe });
  }
  ```

- add:

```ts
  it('warns when it runs from its image without the socket proxy', async () => {
    const result = await planFor(await makeHome(), {
      env: { MEDIAPLANE_IMAGE: 'mediaplane:test' },
    });
    expect(result.diagnostics.map((d) => d.code)).toEqual(['docker.no-proxy']);
  });
```

In `packages/cli/src/run.test.ts`:

1. Add `collectHostReport`, `nodeProbe` and `type HostRequest` to the `@mediaplane/engine`
   import.
2. Replace `deps()` with:

```ts
function deps(runtime: Runtime = fakeRuntime()): Partial<CliDeps> {
  return {
    host: () => Promise.resolve(FIXTURE_HOST),
    runtime: () => runtime,
    probe: () => fakeProbe(),
  };
}
```

3. Update the two other places that still use the old `CliDeps` shape (`host` now returns
   a Promise, and `probe` is now a factory):
   - in "prints the plan warnings once, whether the apply goes ahead or not", change
     `probe: fakeProbe({ freeBytes: 5 * 1024 ** 3 }),` to
     `probe: () => fakeProbe({ freeBytes: 5 * 1024 ** 3 }),`;
   - in "refuses a Compose project it must not manage", change the third argument of
     `run()` to `{ host: () => Promise.resolve(FIXTURE_HOST), probe: () => fakeProbe() }`.
4. Add below `capture()`:

```ts
/**
 * A Docker whose host helper answers as the real one would on a healthy host: it sees this
 * machine's stack.yaml (so the home is "the same folder"), and a fake probe otherwise.
 */
function dockerWithHelper(seen: string[][] = []): Runtime {
  const host = fakeProbe();
  return fakeRuntime({
    hostHelper: async (request, mounts) => {
      seen.push(mounts.map((m) => m.source));
      const direct = (lookups: HostRequest['stat']) =>
        lookups.map(({ key }) => ({ key, at: key }));
      const report = await collectHostReport(
        { ...request, stat: direct(request.stat), free: direct(request.free) },
        {
          ...host,
          stat: (path) => (path.endsWith('/stack.yaml') ? nodeProbe.stat(path) : host.stat(path)),
        },
        () => FIXTURE_HOST,
      );
      return { ok: true, stdout: JSON.stringify(report) };
    },
  });
}
```

5. Add to `describe('mediaplane plan', …)`:

```ts
  it('looks at the host through the host helper when it runs from its image', async () => {
    const home = await makeHome();
    const seen: string[][] = [];
    const term = capture({
      MEDIAPLANE_IMAGE: 'mediaplane:test',
      DOCKER_HOST: 'tcp://socket-proxy:2375',
    });
    const runtime = dockerWithHelper(seen);
    expect(await run(['plan', '--home', home], term.io, { runtime: () => runtime })).toBe(2);
    // First the host facts, with nothing mounted; then preflight's look at the host.
    expect(seen[0]).toEqual([]);
    expect([...(seen[1] ?? [])].sort()).toEqual(
      ['/dev', '/srv/data', join(home, 'stack.yaml')].sort(),
    );
    expect(term.stderr()).not.toContain('without the socket proxy');
  });

  it('warns when it runs from its image without the socket proxy', async () => {
    const term = capture({ MEDIAPLANE_IMAGE: 'mediaplane:test' });
    const runtime = dockerWithHelper();
    await run(['plan', '--home', await makeHome()], term.io, { runtime: () => runtime });
    expect(term.stderr()).toContain(
      'warning: Mediaplane is using the Docker socket directly, without the socket proxy',
    );
  });
```

6. Add at the end of the file:

```ts
describe('mediaplane host-report', () => {
  it('prints what it sees for a request, and is not listed in --help', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-report-'));
    const term = capture();
    const request = JSON.stringify({
      facts: false,
      stat: [{ key: '/srv/data', at: dir }],
      free: [],
      ports: [],
    });
    expect(await run(['host-report', request], term.io)).toBe(0);
    expect(JSON.parse(term.stdout())).toMatchObject({
      schema: 'mediaplane.host-report/v1',
      stat: { '/srv/data': { isDirectory: true } },
    });
    const help = capture();
    expect(await run(['--help'], help.io)).toBe(0);
    expect(help.stdout()).toContain('plan');
    expect(help.stdout()).not.toContain('host-report');
  });

  it('refuses a request it cannot read', async () => {
    const term = capture();
    expect(await run(['host-report', '{}'], term.io)).toBe(1);
    expect(term.stderr()).toContain('the host helper was given a request it cannot read');
  });
});
```

In `packages/cli/src/init.test.ts`, replace `deps` with:

```ts
const deps = (cloud?: string): Partial<CliDeps> => ({
  host: () => Promise.resolve(cloud === undefined ? FIXTURE_HOST : { ...FIXTURE_HOST, cloud }),
  runtime: () => fakeRuntime(),
  probe: () => fakeProbe(),
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/cli packages/engine/src/runtime packages/engine/src/plan`

Expected: FAIL.
- **Engine:** `dockerAccessWarnings` does not exist.
- **CLI:** `pnpm typecheck` reports the new `CliDeps` shape. The helper tests see no helper
  calls, and `host-report` is an unknown command.

- [ ] **Step 3: Add the no-proxy warning to the engine**

In `packages/engine/src/runtime/docker.ts`, add
`import { warning, type Diagnostic } from '../diagnostics';` and, below `isManagedProject`:

```ts
/** Where Docker's own socket is: talking to it means there is no socket proxy. */
const RAW_SOCKETS = new Set(['', 'unix:///var/run/docker.sock', 'unix:///run/docker.sock']);

/**
 * A warning when Mediaplane runs from its image (MEDIAPLANE_IMAGE is set) but reaches the
 * Docker socket directly, not through the socket proxy. Spec §7.2(2): the proxy is on by
 * default and can be disabled, with a warning.
 */
export function dockerAccessWarnings(env: NodeJS.ProcessEnv): Diagnostic[] {
  if ((env.MEDIAPLANE_IMAGE ?? '') === '') return [];
  if (!RAW_SOCKETS.has(env.DOCKER_HOST ?? '')) return [];
  return [
    warning(
      'docker.no-proxy',
      'Mediaplane is using the Docker socket directly, without the socket proxy',
      {
        hint: 'the proxy limits the Docker calls Mediaplane can make; deploy/README.md shows how to turn it back on',
      },
    ),
  ];
}
```

In `packages/engine/src/plan/plan.ts`, add
`import { dockerAccessWarnings } from '../runtime/docker';` and, right after
`const diagnostics = await checkSecretRefs(loaded.config, home, options.env);`:

```ts
  diagnostics.push(...dockerAccessWarnings(options.env));
```

- [ ] **Step 4: Rewrite `packages/cli/src/run.ts`**

Replace the whole file with:

```ts
import { resolve } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  collectHostReport,
  createDockerRuntime,
  detectHostFacts,
  helperHostFacts,
  helperProbe,
  listRecords,
  nodeProbe,
  parseHostRequest,
  plan,
  PROJECT_NAME,
  readRecord,
  status,
  type HostFacts,
  type HostProbe,
  type Runtime,
} from '@mediaplane/engine';
import { Command, CommanderError } from 'commander';
import { init, type InitOptions } from './init';
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
  /** Facts about the host; from inside the Mediaplane container, through `runtime`. */
  host: (runtime: Runtime) => Promise<HostFacts>;
  runtime: (home: string, project: string) => Runtime;
  /** What preflight asks about the host, for the Mediaplane home `home`. */
  probe: (runtime: Runtime, home: string) => HostProbe;
}

export const DEFAULT_HOME = '/opt/mediaplane';

/** An environment variable's value, treating "" as unset. */
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * The real host. In Mediaplane's image (mediaplane.compose.yaml sets MEDIAPLANE_IMAGE),
 * the host's network, ports and folders outside the home can't be seen from the
 * container, so a host helper container of that image looks at them (spec §4.2). Run from
 * source, the CLI looks at the host itself.
 */
export function defaultDeps(env: NodeJS.ProcessEnv): CliDeps {
  const runtime = (home: string, project: string) => createDockerRuntime({ home, project });
  const image = setting(env, 'MEDIAPLANE_IMAGE');
  if (image === undefined) {
    return { host: () => Promise.resolve(detectHostFacts()), runtime, probe: () => nodeProbe };
  }
  const user = { uid: process.getuid?.() ?? 1000, gid: process.getgid?.() ?? 1000 };
  return {
    host: (docker) => helperHostFacts({ runtime: docker, image, user }),
    runtime,
    probe: (docker, home) => helperProbe({ runtime: docker, image, user, home }),
  };
}

/** The CLI's commands. Each action reports its exit code through `setExitCode`. */
export function createProgram(
  io: Io,
  deps: CliDeps,
  setExitCode: (code: number) => void,
): Command {
  const project = setting(io.env, 'MEDIAPLANE_COMPOSE_PROJECT') ?? PROJECT_NAME;
  const defaultHome = setting(io.env, 'MEDIAPLANE_HOME') ?? DEFAULT_HOME;
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
      const runtime = deps.runtime(home, project);
      const result = await plan({
        home,
        catalog,
        host: await deps.host(runtime),
        env: io.env,
        runtime,
        probe: deps.probe(runtime, home),
      });
      printPlan(result, { json: options.json === true }, io);
      setExitCode(result.ok ? (result.changed ? 2 : 0) : 1);
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
        setExitCode(1);
        return;
      }
      const home = resolve(options.home);
      const runtime = deps.runtime(home, project);
      const result = await apply({
        home,
        catalog,
        host: await deps.host(runtime),
        env: io.env,
        runtime,
        probe: deps.probe(runtime, home),
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
      setExitCode(result.outcome === 'success' || result.outcome === 'no-changes' ? 0 : 1);
    });

  program
    .command('status')
    .description("Show each app's container, and the last apply")
    .argument('[app]', 'show only this app')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--json', 'print machine-readable JSON')
    .action(
      async (app: string | undefined, options: { home: string; json?: boolean }) => {
        const asJson = options.json === true;
        const home = resolve(options.home);
        const result = await status(home, deps.runtime(home, project));
        const containers =
          app === undefined
            ? result.containers
            : result.containers.filter((c) => c.service === app);
        if (app !== undefined && containers.length === 0) {
          printError(`no container for "${app}" in this stack`, { json: asJson }, io);
          setExitCode(1);
          return;
        }
        printStatus({ ...result, containers }, { json: asJson }, io);
      },
    );

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
        setExitCode(1);
        return;
      }
      printRecord(record, { json: asJson }, io);
    });

  program
    .command('init')
    .description('Write a starter stack.yaml and a secrets/ folder (never overwrites)')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--media-server <name>', 'jellyfin or plex')
    .option('--data <path>', 'the data folder for downloads and media (absolute)')
    .option(
      '--vpn-provider <name>',
      'Gluetun VPN provider, e.g. mullvad; leave out for no VPN',
    )
    .option('--no-login-on-lan', "don't ask for a login from your own network")
    .option(
      '--timezone <zone>',
      'timezone, e.g. Europe/London',
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
    .option('--json', 'print machine-readable JSON')
    .action(async (options: InitOptions) => {
      const runtime = deps.runtime(resolve(options.home), project);
      setExitCode(await init(options, io, await deps.host(runtime)));
    });

  // What the host helper container runs (spec §4.2); not for people, so not in --help.
  program
    .command('host-report', { hidden: true })
    .description("Print what this host's network, folders and ports look like")
    .argument('<request>', 'what to look at, as JSON')
    .action(async (request: string) => {
      const report = await collectHostReport(parseHostRequest(request));
      io.stdout(`${JSON.stringify(report)}\n`);
    });

  return program;
}

/** Run the CLI with user arguments (no node/script prefix) and return the exit code. */
export async function run(
  argv: readonly string[],
  io: Io,
  overrides: Partial<CliDeps> = {},
): Promise<number> {
  const deps: CliDeps = { ...defaultDeps(io.env), ...overrides };
  const json = argv.includes('--json');
  let exitCode = 0;
  const program = createProgram(io, deps, (code) => {
    exitCode = code;
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

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run packages/cli packages/engine/src/runtime packages/engine/src/plan`

Expected: PASS, including the spawned tests in `main.test.ts`, which run from source with
`MEDIAPLANE_IMAGE` unset.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add packages/cli/src packages/engine/src
git commit -m "feat(cli): see the host through the helper inside the image, and warn without the proxy"
```

---
### Task 7: The CLI bundle

The packages export TypeScript sources with extension-less imports, which Node cannot run
directly. Decision: bundle the CLI with esbuild into one ES module, `dist/mediaplane.mjs`,
so the image needs no `node_modules` and no package manager.

esbuild is already in the lockfile, because `tsx` depends on `esbuild ~0.28.0`. This task
makes 0.28.2 a direct dev dependency. The alternatives were `tsc` output plus
`pnpm deploy --prod`, or a Node single-executable binary.

Two facts were checked on 2026-10-09 with esbuild 0.28.2 on this repository:

- **The bundle needs a `require`.** Without one it crashes at start-up with
  `Dynamic require of "process" is not supported` from `yaml`'s CommonJS build. So the
  banner defines `require` with `createRequire`.
- **The bundle is about 1.3 MB, and contains exactly `commander`, `diff`, `yaml` and
  `zod`.** Their MIT, BSD and ISC licences require their notices to travel with the
  bundle, so the script writes `dist/THIRD-PARTY-LICENSES.txt` from each package's own
  licence file.

**Files:**
- Create: `scripts/root.ts`, `scripts/bundle.ts`, `scripts/bundle.test.ts`
- Modify: `package.json` (`bundle` script, `esbuild` dev dependency), `pnpm-lock.yaml`,
  `tsconfig.json`, `vitest.config.ts`

**Interfaces:**
- **Consumes:** `packages/cli/src/main.ts` and `VERSION`.
- **Produces:**
  - `ROOT` (`scripts/root.ts`): the repository root, with a trailing slash.
  - `bundle(outDir?: string): Promise<{ file: string; packages: string[] }>`, writing
    `<outDir>/mediaplane.mjs` (mode 0755, with a `#!/usr/bin/env node` line) and
    `<outDir>/THIRD-PARTY-LICENSES.txt`. `outDir` defaults to `<ROOT>dist`.
  - `packagesOf(inputs: readonly string[]): Map<string, string>`: package name to folder.
  - `pnpm bundle`.

- [ ] **Step 1: Add the dependency and wire the scripts folder in**

```bash
pnpm add -D -w esbuild@~0.28.2
```

In `package.json`, add `"bundle": "tsx scripts/bundle.ts",` to `scripts`, after
`"mediaplane"`.

In `tsconfig.json`, add `"scripts/**/*.ts",` to `include`, after `"test/**/*.ts",`.

In `vitest.config.ts`, change `include` to
`['packages/*/src/**/*.test.ts', 'catalog/**/*.test.ts', 'scripts/**/*.test.ts']`.

`scripts/root.ts`:

```ts
import { fileURLToPath } from 'node:url';

/** The repository root, with a trailing slash. */
export const ROOT = fileURLToPath(new URL('..', import.meta.url));
```

- [ ] **Step 2: Write the failing test**

`scripts/bundle.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../packages/cli/src/version';
import { bundle, packagesOf } from './bundle';

describe('bundle', () => {
  it('builds one executable file that runs the CLI, with the licences it needs', async () => {
    const out = await mkdtemp(join(tmpdir(), 'mediaplane-bundle-'));
    const { file, packages } = await bundle(out);
    expect(packages).toEqual(['commander', 'diff', 'yaml', 'zod']);
    expect((await stat(file)).mode & 0o111).not.toBe(0);
    expect((await readFile(file, 'utf8')).startsWith('#!/usr/bin/env node\n')).toBe(true);

    const version = spawnSync(process.execPath, [file, '--version'], { encoding: 'utf8' });
    expect(version.stderr).toBe('');
    expect(version.stdout.trim()).toBe(VERSION);
    const missing = spawnSync(process.execPath, [file, 'plan', '--home', join(out, 'none')], {
      encoding: 'utf8',
      env: { ...process.env, MEDIAPLANE_IMAGE: '' },
    });
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('no stack.yaml');

    const licences = await readFile(join(out, 'THIRD-PARTY-LICENSES.txt'), 'utf8');
    for (const name of packages) expect(licences).toContain(`== ${name} ==`);
    expect(licences).toContain('Permission is hereby granted');
  }, 60_000);
});

describe('packagesOf', () => {
  it("names each bundled file's package, scoped or not, through pnpm's store", () => {
    expect(
      packagesOf([
        'packages/engine/src/index.ts',
        'node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/core.js',
        'node_modules/.pnpm/zod@4.6.5/node_modules/zod/index.js',
        'node_modules/.pnpm/@scope+thing@1.0.0/node_modules/@scope/thing/lib/a.js',
      ]),
    ).toEqual(
      new Map([
        ['@scope/thing', 'node_modules/.pnpm/@scope+thing@1.0.0/node_modules/@scope/thing'],
        ['zod', 'node_modules/.pnpm/zod@4.6.5/node_modules/zod'],
      ]),
    );
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run scripts`

Expected: FAIL. `./bundle` does not exist.

- [ ] **Step 4: Implement**

`scripts/bundle.ts`:

```ts
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { ROOT } from './root';

/**
 * Node's require, for the CommonJS packages in the bundle (yaml requires "process"). An
 * ES-module bundle has no require of its own.
 */
const BANNER = [
  '#!/usr/bin/env node',
  "import { createRequire as mediaplaneCreateRequire } from 'node:module';",
  'const require = mediaplaneCreateRequire(import.meta.url);',
].join('\n');

const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'license'];

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The npm package each bundled file came from: name → its folder. With pnpm a file sits
 * under node_modules/.pnpm/<id>/node_modules/<name>/, so the last node_modules counts.
 */
export function packagesOf(inputs: readonly string[]): Map<string, string> {
  const packages = new Map<string, string>();
  for (const input of inputs) {
    const match = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(input);
    if (match?.[1] !== undefined && match[2] !== undefined) packages.set(match[2], match[1]);
  }
  return new Map([...packages].sort(([a], [b]) => byName(a, b)));
}

/** Bundle the CLI into one file Node runs directly, plus the licences of what it includes. */
export async function bundle(
  outDir = join(ROOT, 'dist'),
): Promise<{ file: string; packages: string[] }> {
  await rm(outDir, { recursive: true, force: true });
  const file = join(outDir, 'mediaplane.mjs');
  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: ['packages/cli/src/main.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outfile: file,
    banner: { js: BANNER },
    legalComments: 'none',
    metafile: true,
    logLevel: 'warning',
  });
  await chmod(file, 0o755);
  const packages = packagesOf(Object.keys(result.metafile.inputs));
  const notices = [
    'Mediaplane is licensed under the GPL-3.0 (see LICENSE).',
    'Its CLI bundle includes these packages, each under its own licence:',
  ];
  for (const [name, folder] of packages) {
    notices.push('', `== ${name} ==`, '', await licenceText(join(ROOT, folder)));
  }
  await writeFile(join(outDir, 'THIRD-PARTY-LICENSES.txt'), `${notices.join('\n')}\n`);
  return { file, packages: [...packages.keys()] };
}

async function licenceText(folder: string): Promise<string> {
  for (const name of LICENCE_FILES) {
    try {
      return (await readFile(join(folder, name), 'utf8')).trim();
    } catch {
      // Not this name; try the next.
    }
  }
  throw new Error(`no licence file in ${folder}: the bundle cannot ship without one`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { file, packages } = await bundle();
  console.log(`Wrote ${file}, bundling ${packages.join(', ')}.`);
}
```

- [ ] **Step 5: Run the test, then the script**

Run: `pnpm vitest run scripts`

Expected: PASS.

Run: `pnpm --silent bundle && node dist/mediaplane.mjs --version`

Expected: `Wrote …/dist/mediaplane.mjs, bundling commander, diff, yaml, zod.`, then `0.0.0`.
`dist/` is already in `.gitignore`, and Prettier skips what Git ignores.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add scripts package.json pnpm-lock.yaml tsconfig.json vitest.config.ts
git commit -m "build: bundle the CLI into one file with esbuild"
```

---

### Task 8: The Mediaplane image

Decisions:

- **Base: `node:24.21.0-alpine3.24`,** pinned by digest. It is small, has few
  vulnerabilities, ships Node 24 LTS on both architectures, and has a `node` user with uid
  1000. npm, npx, yarn and corepack are deleted from it, because the bundle needs only
  Node. The alternatives were Debian `-slim`, distroless `nodejs24` (no shell, so no
  `sleep`, and a shim needs a hard-coded node path) and Chainguard.
- **The Docker CLI and Compose are copied from `docker:29.8.1-cli`,** pinned by digest.
  Checked on 2026-10-09:
  - that image contains Docker CLI 29.8.1 and Compose v5.5.1, the version this machine
    runs, both statically linked, so they run on Alpine's musl;
  - the CLI works as a non-root user with a read-only root and an unwritable `HOME`, and
    prints no warnings.

  One pin covers both. The alternative was `docker/compose-bin:v5.5.1` for Compose, as a
  second pin.
- **Idle with `sleep infinity`.** Checked: Alpine 3.24's busybox `sleep` accepts
  `infinity`. Compose's `init: true` (Task 9) forwards `SIGTERM`, so the container stops
  at once. The alternative was a Node idle loop, about 40 MB of memory for nothing.
- **The bundle stage runs on the build machine's own architecture**
  (`--platform=$BUILDPLATFORM`), because the bundle is plain JavaScript. CI builds each
  architecture natively, so today this changes nothing. It means S8's cross-platform
  release build needs no emulation for the heavy stage.
- **No `# syntax=` line.** It would pull an unpinned Dockerfile frontend image.

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `test/e2e/image.e2e.test.ts`
- Modify: `test/e2e/helpers.ts` (`REPO`, `buildImage`)

**Interfaces:**
- **Consumes:** `pnpm bundle` (Task 7) and the hidden `host-report` command (Task 6).
- **Produces:**
  - The image, built with `docker build --tag <tag> .`:
    - `/usr/local/bin/mediaplane`, a link to `/opt/mediaplane-cli/mediaplane.mjs`;
    - `/usr/local/bin/docker`, and Compose at
      `/usr/local/libexec/docker/cli-plugins/docker-compose`;
    - `/usr/share/doc/mediaplane/{LICENSE,THIRD-PARTY-LICENSES.txt}`;
    - user `1000:1000`, no entrypoint, the command `sleep infinity`, and
      `MEDIAPLANE_HOME=/opt/mediaplane`.
  - In `test/e2e/helpers.ts`, `REPO: string` (the repository root) and
    `buildImage(tag: string): Promise<void>`.

- [ ] **Step 1: Write the image tests**

Add to `test/e2e/helpers.ts`:

1. Add `import { fileURLToPath } from 'node:url';` to the imports.
2. Add below `BUSYBOX`:

```ts
/** The repository root: the image's build context. */
export const REPO = fileURLToPath(new URL('../..', import.meta.url));

/** Build the Mediaplane image from this checkout as `tag`. The first build takes minutes. */
export async function buildImage(tag: string): Promise<void> {
  const result = await nodeExec('docker', ['build', '--tag', tag, REPO], {
    cwd: '/',
    timeoutMs: 900_000,
  });
  if (result.code !== 0) {
    throw new Error(`docker build failed:\n${result.stderr.slice(-3000)}`);
  }
}
```

`test/e2e/image.e2e.test.ts`:

```ts
import { arch } from 'node:os';
import { nodeExec, toArch, type ExecResult } from '@mediaplane/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERSION } from '../../packages/cli/src/version';
import { buildImage } from './helpers';

const TAG = `mediaplane-e2e:${String(process.pid)}`;

/** Run a command in a throwaway container of the image, locked down like the deployment. */
function inImage(...args: string[]): Promise<ExecResult> {
  return nodeExec(
    'docker',
    [
      'run',
      '--rm',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      TAG,
      ...args,
    ],
    { cwd: '/' },
  );
}

describe('the Mediaplane image', () => {
  beforeAll(() => buildImage(TAG), 900_000);
  afterAll(async () => {
    await nodeExec('docker', ['image', 'rm', TAG], { cwd: '/' });
  });

  it('runs the CLI as a non-root user, with the Docker CLI and Compose 5 inside', async () => {
    expect((await inImage('mediaplane', '--version')).stdout.trim()).toBe(VERSION);
    expect((await inImage('id', '-u')).stdout.trim()).toBe('1000');
    const compose = await inImage('docker', 'compose', 'version', '--short');
    expect(compose.stdout.trim()).toBe('5.5.1');
  });

  it('ships no package manager', async () => {
    const found = await inImage(
      'sh',
      '-c',
      'for c in npm npx yarn yarnpkg corepack pnpm; do command -v "$c" || true; done',
    );
    expect(found.code).toBe(0);
    expect(found.stdout.trim()).toBe('');
  });

  it('carries its licence and those of what it bundles', async () => {
    const licences = await inImage('cat', '/usr/share/doc/mediaplane/THIRD-PARTY-LICENSES.txt');
    expect(licences.stdout).toContain('== zod ==');
    expect((await inImage('test', '-s', '/usr/share/doc/mediaplane/LICENSE')).code).toBe(0);
  });

  it('idles until it is stopped, with no entrypoint of its own', async () => {
    const inspect = await nodeExec(
      'docker',
      ['image', 'inspect', TAG, '--format', '{{json .Config}}'],
      { cwd: '/' },
    );
    const config = JSON.parse(inspect.stdout) as {
      Entrypoint: string[] | null;
      Cmd: string[] | null;
    };
    // `ENTRYPOINT []` is stored as null or [] depending on the builder.
    expect(config.Entrypoint ?? []).toEqual([]);
    expect(config.Cmd).toEqual(['sleep', 'infinity']);
  });

  it("reports the host's facts as the host helper", async () => {
    const result = await nodeExec(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'host',
        TAG,
        'mediaplane',
        'host-report',
        JSON.stringify({ facts: true, stat: [], free: [], ports: [] }),
      ],
      { cwd: '/' },
    );
    expect(result.code, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema: 'mediaplane.host-report/v1',
      facts: { arch: toArch(arch()) },
    });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/image.e2e.test.ts`

Expected: FAIL in `beforeAll`: `docker build failed` (there is no Dockerfile).

- [ ] **Step 3: Write the image**

`.dockerignore`:

```
**/node_modules
**/*.log
.git
.github
.claude
.superpowers
.mediaplane-dev
coverage
dist
docs
test
/stack.yaml
/secrets
```

`Dockerfile`:

```dockerfile
# The Mediaplane image: the CLI, Node, and the Docker CLI with Compose (spec §2.1, §3.3).
# Build it with:  docker build --tag mediaplane:local .

# The CLI bundle is plain JavaScript, so it is built once, on the build machine's own
# architecture, for every image architecture.
FROM --platform=$BUILDPLATFORM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS bundle
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cli/package.json packages/cli/
COPY packages/engine/package.json packages/engine/
COPY catalog/package.json catalog/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json LICENSE ./
COPY scripts/root.ts scripts/bundle.ts scripts/
COPY packages/cli/src packages/cli/src
COPY packages/engine/src packages/engine/src
COPY catalog catalog
RUN pnpm bundle

# The Docker CLI and the Compose plugin (v5.5.1) Mediaplane drives. Both are static.
FROM docker:29.8.1-cli@sha256:018edbc908e08fcc9dbf029c812c34251e9b4719e6f71ca0e5eae2a987d014ca AS docker-cli

FROM node:24.21.0-alpine3.24@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
# Only Node is needed at run time: drop the package managers the base image ships.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=bundle /build/dist/mediaplane.mjs /opt/mediaplane-cli/mediaplane.mjs
COPY --from=bundle /build/dist/THIRD-PARTY-LICENSES.txt /usr/share/doc/mediaplane/THIRD-PARTY-LICENSES.txt
COPY --from=bundle /build/LICENSE /usr/share/doc/mediaplane/LICENSE
RUN ln -s /opt/mediaplane-cli/mediaplane.mjs /usr/local/bin/mediaplane
ENV MEDIAPLANE_HOME=/opt/mediaplane
LABEL org.opencontainers.image.title="Mediaplane" \
      org.opencontainers.image.description="Deploys and wires a self-hosted media stack from one stack.yaml" \
      org.opencontainers.image.source="https://github.com/cyclopsgd/Mediaplane" \
      org.opencontainers.image.licenses="GPL-3.0"
# The node user. mediaplane.compose.yaml runs it as the user that owns the home instead.
USER 1000:1000
ENTRYPOINT []
# M1 has no listener: the container idles, and commands arrive through `docker exec`.
CMD ["sleep", "infinity"]
```

- [ ] **Step 4: Run the image tests on this aarch64 machine**

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/image.e2e.test.ts`

Expected: PASS (5 tests). The first build takes a few minutes. Afterwards:

```bash
docker image ls mediaplane-e2e
```

Expected: nothing listed, because the test removed its image.

If `corepack enable` fails because it cannot download pnpm, the build machine has no
route to `registry.npmjs.org`. Fix the network rather than vendoring pnpm.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add Dockerfile .dockerignore test/e2e
git commit -m "feat: build the Mediaplane image: Node, the CLI bundle, Docker and Compose"
```

---
### Task 9: `deploy/mediaplane.compose.yaml`, the socket proxy and the host shim

**The allow-list, derived from the real calls.** On 2026-10-09 the engine ran these
through `wollomatic/socket-proxy` 1.13.1 in debug mode, with everything allowed and every
request logged:

- `plan`;
- `apply` creating four containers and running the chown helper (`compose run`);
- a second, unchanged `apply`, and `status`;
- `apply` recreating one container and removing another (`--remove-orphans`);
- `compose pull` of a missing image;
- a host-helper `docker run`.

These were every method and path seen (the version prefix is `/v1.56` on Docker 29.8;
Docker 28 in CI negotiates `/v1.51`):

| Method | Paths |
|---|---|
| HEAD | `/_ping` |
| GET | `/version`, `/containers/json`, `/containers/{id}/json`, `/images/{ref}/json`, `/networks`, `/networks/{name}`, `/volumes` |
| POST | `/containers/create`, `/containers/{id}/start`, `/stop`, `/rename`, `/attach`, `/wait`, `/images/create`, `/networks/create` |
| DELETE | `/containers/{id}` |

`compose config --hash` made no API calls at all.

Then a proxy restricted to the allow-list below ran the same `apply`, `plan`, a
`compose run` and a host-helper run successfully. It refused each of these with
`Error response from daemon: Forbidden`:

- `docker exec`, `info`, `system df`, `events`, `logs`;
- `kill`, `restart`, `pause`, `commit`;
- `volume rm`, `network rm`, `image rm`;
- `swarm init`, `plugin ls`, `secret ls`, `config ls`.

It refused `build` with `Method Not Allowed`.

Decisions:

- **`wollomatic/socket-proxy` 1.13.1.** Its allow-list is a regular expression per HTTP
  method, matched against the path, so it can allow exactly the calls above. It is a
  static Go binary on `scratch`, ships a health-check binary, and can accept connections
  from one host name only. The alternatives were Tecnativa's or LinuxServer's
  `docker-socket-proxy`, whose switches work per API section: with `CONTAINERS=1` and
  `POST=1`, every container endpoint is open.
- **The allow-list adds four calls** that the default stack doesn't make, but that Compose
  makes when a `compose.override.yaml` adds a network or a named volume:
  `POST /networks/{name}/connect` and `/disconnect`, `POST /volumes/create`, and
  `GET /volumes/{name}`. Taken from Compose 5.5.1's source (`pkg/compose`). Nothing may be
  deleted except containers, so Mediaplane can never remove a network, volume or image.
  Overrides that need anything else (`post_start` hooks use `exec`) are refused, and ADR
  0008 says so.
- **The proxy runs as `65534:${DOCKER_GID}`**, nobody in the socket's group. The image's
  default `65534:65534` cannot open the socket (checked: `permission denied`). The
  socket's group differs between hosts, so `DOCKER_GID` is required. The alternative was
  root with every capability dropped, which needs no `DOCKER_GID` but is still uid 0.
- **TCP on an internal network, with `-allowfrom=mediaplane`.** Only the `mediaplane`
  service's address may connect. The alternative, a Unix socket in a shared volume, turns
  off socket-proxy's client check (its source skips it for socket endpoints) and needs
  the socket's mode to match `MEDIAPLANE_UID`.
- **No `-allowbindmountfrom`.** It would have to list the data folder, which lives in
  `stack.yaml` and can change. It would also refuse any extra mount a user adds in
  `compose.override.yaml`. The threat model (Task 12) shows how to turn it on.
- **`MEDIAPLANE_IMAGE` is required.** No image is published until S8, so there is no
  honest default.
- **Mediaplane's network is internal.** In M1 the container needs only the proxy, because
  image pulls happen in the Docker daemon. S3 and S6 will need more (see Out of scope).

The shim is one line, as spec §4.4 asks. It adds `-t` only on a terminal, so `apply` can
still ask for confirmation and scripts still work, and it honours `MEDIAPLANE_CONTAINER`
so the end-to-end test can point it elsewhere.

**Files:**
- Create: `deploy/mediaplane.compose.yaml`, `deploy/mediaplane` (mode 0755),
  `deploy/deploy.test.ts`
- Modify: `package.json` (the `yaml` dev dependency), `pnpm-lock.yaml`,
  `tsconfig.json`, `vitest.config.ts`

**Interfaces:**
- **Consumes:** the image (Task 8): `/usr/local/bin/mediaplane`, `sleep infinity`, and
  `MEDIAPLANE_IMAGE` read by the CLI (Task 6).
- **Produces:**
  - The Compose project `mediaplane-system`, with:
    - service `socket-proxy`, listening on `tcp://socket-proxy:2375`;
    - service `mediaplane`: `container_name: mediaplane`, `hostname: mediaplane`, and
      the environment `MEDIAPLANE_HOME`, `MEDIAPLANE_IMAGE` and
      `DOCKER_HOST=tcp://socket-proxy:2375`.
  - The settings it reads: `MEDIAPLANE_IMAGE` (required), `DOCKER_GID` (required),
    `MEDIAPLANE_HOME` (default `/opt/mediaplane`), and `MEDIAPLANE_UID` and
    `MEDIAPLANE_GID` (default 1000).
  - `deploy/mediaplane`: runs `docker exec -i [-t] ${MEDIAPLANE_CONTAINER:-mediaplane}
    mediaplane "$@"`.

- [ ] **Step 1: Wire the deploy folder in**

```bash
pnpm add -D -w yaml@^2.9.1
```

That is the version the engine already uses, so the lockfile gains no new package.

In `tsconfig.json`, add `"deploy/**/*.ts",` to `include`, after `"scripts/**/*.ts",`.

In `vitest.config.ts`, add `'deploy/**/*.test.ts'` to `include`.

- [ ] **Step 2: Write the failing test**

`deploy/deploy.test.ts`:

```ts
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const FILE = fileURLToPath(new URL('./mediaplane.compose.yaml', import.meta.url));
const SHIM = fileURLToPath(new URL('./mediaplane', import.meta.url));

interface Service {
  image?: string;
  container_name?: string;
  hostname?: string;
  user?: string;
  init?: boolean;
  read_only?: boolean;
  cap_drop?: string[];
  security_opt?: string[];
  command?: string[];
  environment?: Record<string, string>;
  volumes?: unknown[];
  ports?: unknown;
  networks?: string[];
  depends_on?: Record<string, { condition?: string }>;
}

const deployment = parse(readFileSync(FILE, 'utf8')) as {
  name: string;
  services: Record<string, Service | undefined>;
  networks: Record<string, unknown>;
};
const mediaplane = deployment.services.mediaplane ?? {};
const proxy = deployment.services['socket-proxy'] ?? {};
const HOME = '${MEDIAPLANE_HOME:-/opt/mediaplane}';

/** socket-proxy's rules, method → patterns, anchored the way socket-proxy anchors them. */
function allowList(command: readonly string[]): Map<string, RegExp[]> {
  const rules = new Map<string, RegExp[]>();
  for (const arg of command) {
    const match = /^-allow(GET|HEAD|POST|PUT|PATCH|DELETE|CONNECT|TRACE|OPTIONS)=(.*)$/.exec(
      arg,
    );
    if (match?.[1] === undefined || match[2] === undefined) continue;
    rules.set(match[1], [...(rules.get(match[1]) ?? []), new RegExp(`^${match[2]}$`)]);
  }
  return rules;
}
const rules = allowList(proxy.command ?? []);
const allowed = (method: string, path: string): boolean =>
  (rules.get(method) ?? []).some((rule) => rule.test(path));

const ID = 'f'.repeat(64);
/** CI's Docker 28 speaks API 1.51; Docker 29.8 speaks 1.56. */
const V = '/v1.51';

/**
 * Every Docker API call the engine made through a logging proxy on 2026-10-09 (Compose
 * 5.5.1): plan; apply creating, recreating and removing containers and running the chown
 * helper; a pull; and the host helper. socket-proxy matches the path, not the query.
 */
const ENGINE_CALLS: [string, string][] = [
  ['HEAD', '/_ping'],
  ['GET', `${V}/version`],
  ['GET', `${V}/containers/json`],
  ['GET', `${V}/containers/${ID}/json`],
  ['GET', `${V}/images/lscr.io/linuxserver/sonarr:4.0.20.3014-ls326@sha256:${ID}/json`],
  ['GET', `${V}/networks`],
  ['GET', `${V}/networks/mediaplane_default`],
  ['GET', `${V}/volumes`],
  ['POST', `${V}/containers/create`],
  ['POST', `${V}/containers/${ID}/start`],
  ['POST', `${V}/containers/${ID}/stop`],
  ['POST', `${V}/containers/${ID}/rename`],
  ['POST', `${V}/containers/${ID}/attach`],
  ['POST', `${V}/containers/${ID}/wait`],
  ['POST', `${V}/images/create`],
  ['POST', `${V}/networks/create`],
  ['DELETE', `${V}/containers/${ID}`],
];

/** What Compose also calls when compose.override.yaml adds a network or a named volume. */
const OVERRIDE_CALLS: [string, string][] = [
  ['POST', `${V}/networks/proxy-net/connect`],
  ['POST', `${V}/networks/proxy-net/disconnect`],
  ['POST', `${V}/volumes/create`],
  ['GET', `${V}/volumes/media-cache`],
];

/** Calls the engine never makes. The proxy must refuse them (spec §7.2(2)). */
const REFUSED: [string, string][] = [
  ['POST', `${V}/containers/${ID}/exec`],
  ['POST', `${V}/exec/${ID}/start`],
  ['GET', `${V}/containers/${ID}/logs`],
  ['GET', `${V}/containers/${ID}/archive`],
  ['PUT', `${V}/containers/${ID}/archive`],
  ['GET', `${V}/containers/${ID}/export`],
  ['POST', `${V}/containers/${ID}/kill`],
  ['POST', `${V}/containers/${ID}/restart`],
  ['POST', `${V}/containers/${ID}/update`],
  ['POST', `${V}/commit`],
  ['POST', `${V}/build`],
  ['POST', `${V}/images/busybox/push`],
  ['POST', `${V}/images/busybox/tag`],
  ['GET', `${V}/images/busybox/history`],
  ['DELETE', `${V}/images/busybox`],
  ['DELETE', `${V}/networks/mediaplane_default`],
  ['DELETE', `${V}/volumes/media-cache`],
  ['GET', `${V}/info`],
  ['GET', `${V}/system/df`],
  ['GET', `${V}/events`],
  ['POST', `${V}/auth`],
  ['POST', `${V}/swarm/init`],
  ['GET', `${V}/services`],
  ['GET', `${V}/secrets`],
  ['GET', `${V}/configs`],
  ['GET', `${V}/plugins`],
  ['GET', `${V}/distribution/busybox/json`],
  ['POST', '/session'],
];

describe('mediaplane.compose.yaml', () => {
  it('is the mediaplane-system project, which apply never manages', () => {
    expect(deployment.name).toBe('mediaplane-system');
  });

  it('runs Mediaplane hardened, as the home owner, with only the home mounted', () => {
    expect(mediaplane).toMatchObject({
      container_name: 'mediaplane',
      hostname: 'mediaplane',
      user: '${MEDIAPLANE_UID:-1000}:${MEDIAPLANE_GID:-1000}',
      init: true,
      read_only: true,
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
    });
    expect(mediaplane.image).toMatch(/^\$\{MEDIAPLANE_IMAGE:\?/);
    expect(mediaplane.volumes).toEqual([
      { type: 'bind', source: HOME, target: HOME, bind: { create_host_path: false } },
    ]);
    expect(mediaplane.environment).toEqual({
      MEDIAPLANE_HOME: HOME,
      MEDIAPLANE_IMAGE: mediaplane.image,
      DOCKER_HOST: 'tcp://socket-proxy:2375',
    });
    expect(mediaplane.ports).toBeUndefined();
  });

  it('gives only the proxy the Docker socket, read-only, and publishes nothing', () => {
    expect(proxy.image).toMatch(/^wollomatic\/socket-proxy:1\.13\.1@sha256:[0-9a-f]{64}$/);
    expect(proxy.volumes).toEqual(['/var/run/docker.sock:/var/run/docker.sock:ro']);
    expect(proxy).toMatchObject({
      read_only: true,
      cap_drop: ['ALL'],
      security_opt: ['no-new-privileges:true'],
    });
    expect(proxy.user).toMatch(/^65534:\$\{DOCKER_GID:\?/);
    expect(proxy.command).toContain('-allowfrom=mediaplane');
    expect(proxy.ports).toBeUndefined();
    expect(mediaplane.depends_on).toEqual({ 'socket-proxy': { condition: 'service_healthy' } });
  });

  it('puts the two on an internal network of their own', () => {
    expect(deployment.networks).toEqual({ 'docker-api': { internal: true } });
    expect(mediaplane.networks).toEqual(['docker-api']);
    expect(proxy.networks).toEqual(['docker-api']);
  });
});

describe('the socket proxy allow-list', () => {
  it.each(ENGINE_CALLS)('allows %s %s, which the engine calls', (method, path) => {
    expect(allowed(method, path)).toBe(true);
  });

  it.each(OVERRIDE_CALLS)('allows %s %s, for what an override adds', (method, path) => {
    expect(allowed(method, path)).toBe(true);
  });

  it.each(REFUSED)('refuses %s %s', (method, path) => {
    expect(allowed(method, path)).toBe(false);
  });

  it('allows the API at any 1.x version, and without one', () => {
    expect(allowed('GET', '/v1.56/version')).toBe(true);
    expect(allowed('GET', '/version')).toBe(true);
    expect(allowed('GET', '/v2.0/version')).toBe(false);
  });
});

describe('the host shim', () => {
  it('is executable, and runs the command in the mediaplane container', () => {
    expect(statSync(SHIM).mode & 0o111).not.toBe(0);
    expect(readFileSync(SHIM, 'utf8')).toContain(
      'exec docker exec -i $([ -t 0 ] && [ -t 1 ] && echo -t) "${MEDIAPLANE_CONTAINER:-mediaplane}" mediaplane "$@"',
    );
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run deploy`

Expected: FAIL, with `ENOENT` for `deploy/mediaplane.compose.yaml`.

- [ ] **Step 4: Write the deployment and the shim**

`deploy/mediaplane.compose.yaml`. The regular expressions are plain YAML scalars on
purpose: in a double-quoted string the backslashes would need doubling, and Prettier keeps
plain scalars as they are.

```yaml
# Mediaplane's own deployment (spec §4.4): the Mediaplane container and the Docker socket
# proxy, as the Compose project "mediaplane-system". It is separate from the stack
# Mediaplane manages (the "mediaplane" project), so apply can never recreate or remove it.
#
# Settings, from a .env file next to this one or from the environment:
#   MEDIAPLANE_IMAGE  the Mediaplane image to run (required: none is published yet)
#   DOCKER_GID        the group that owns the Docker socket: stat -c %g /var/run/docker.sock
#   MEDIAPLANE_HOME   the Mediaplane home, mounted at the same path (default /opt/mediaplane)
#   MEDIAPLANE_UID    the user that owns the home (default 1000)
#   MEDIAPLANE_GID    its group (default 1000)
#
# Start it:      docker compose -f mediaplane.compose.yaml up -d
# Use it:        docker exec -it mediaplane mediaplane plan
# The full guide: deploy/README.md
name: mediaplane-system

# One image, named once: the container runs it, and so does the host helper.
x-mediaplane-image: &mediaplane-image "${MEDIAPLANE_IMAGE:?set MEDIAPLANE_IMAGE to the Mediaplane image (see deploy/README.md)}"

services:
  # The only container that can reach Docker. It accepts connections from the mediaplane
  # container only, and forwards only the Docker API calls Mediaplane makes (ADR 0008).
  socket-proxy:
    image: wollomatic/socket-proxy:1.13.1@sha256:3935b709275e4ec35d6ed5a5c4a1f0d01ed31eec5e7234efc3357ecd47689002
    restart: unless-stopped
    user: "65534:${DOCKER_GID:?set DOCKER_GID to the group of the Docker socket (stat -c %g /var/run/docker.sock)}"
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 64m
    command:
      - -listenip=0.0.0.0
      - -allowfrom=mediaplane
      - -allowhealthcheck
      - -watchdoginterval=3600
      - -stoponwatchdog
      - -shutdowngracetime=5
      # socket-proxy anchors each pattern (^…$) and matches it against the path.
      # deploy/deploy.test.ts pins this list against the calls the engine makes.
      - -allowHEAD=(/v1\.[0-9]+)?/_ping
      - -allowGET=(/v1\.[0-9]+)?/(_ping|version|containers/json|containers/[a-zA-Z0-9][a-zA-Z0-9_.-]*/json|images/[a-zA-Z0-9][a-zA-Z0-9_.:/@-]*/json|networks|networks/[a-zA-Z0-9][a-zA-Z0-9_.-]*|volumes|volumes/[a-zA-Z0-9][a-zA-Z0-9_.-]*)
      - -allowPOST=(/v1\.[0-9]+)?/(containers/create|containers/[a-zA-Z0-9][a-zA-Z0-9_.-]*/(start|stop|rename|attach|wait)|images/create|networks/create|networks/[a-zA-Z0-9][a-zA-Z0-9_.-]*/(connect|disconnect)|volumes/create)
      - -allowDELETE=(/v1\.[0-9]+)?/containers/[a-zA-Z0-9][a-zA-Z0-9_.-]*
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks: [docker-api]
    healthcheck:
      test: ["CMD", "./healthcheck"]
      interval: 10s
      timeout: 5s
      retries: 3

  mediaplane:
    image: *mediaplane-image
    container_name: mediaplane
    # Fixed, so a recreated container can still clear a stale lock its predecessor left:
    # the lock records the host it was taken on.
    hostname: mediaplane
    restart: unless-stopped
    init: true
    user: "${MEDIAPLANE_UID:-1000}:${MEDIAPLANE_GID:-1000}"
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    environment:
      MEDIAPLANE_HOME: "${MEDIAPLANE_HOME:-/opt/mediaplane}"
      MEDIAPLANE_IMAGE: *mediaplane-image
      DOCKER_HOST: tcp://socket-proxy:2375
    volumes:
      # The same path inside and out, because the host's Docker resolves every path in the
      # stack's compose.yaml (spec §4.1). Create the folder first: Compose won't.
      - type: bind
        source: "${MEDIAPLANE_HOME:-/opt/mediaplane}"
        target: "${MEDIAPLANE_HOME:-/opt/mediaplane}"
        bind:
          create_host_path: false
    networks: [docker-api]
    depends_on:
      socket-proxy:
        condition: service_healthy

networks:
  # These two containers only, and no route out: in M1, Mediaplane needs nothing but the
  # proxy, because image pulls happen in the Docker daemon.
  docker-api:
    internal: true
```

`deploy/mediaplane`:

```sh
#!/bin/sh
# Mediaplane's host shim (spec §4.4): run a mediaplane command in its container, so that
# `mediaplane plan` works on the host. Install it with:
#   sudo install -m 0755 deploy/mediaplane /usr/local/bin/mediaplane
# On a terminal it adds -t, so apply can ask before it changes anything.
exec docker exec -i $([ -t 0 ] && [ -t 1 ] && echo -t) "${MEDIAPLANE_CONTAINER:-mediaplane}" mediaplane "$@"
```

Then:

```bash
chmod 0755 deploy/mediaplane
```

- [ ] **Step 5: Run the test, and check Compose accepts the file**

Run: `pnpm vitest run deploy`

Expected: PASS.

Run:

```bash
docker compose -f deploy/mediaplane.compose.yaml config >/dev/null; echo "exit $?"
MEDIAPLANE_IMAGE=mediaplane:local DOCKER_GID=0 docker compose -f deploy/mediaplane.compose.yaml config -q && echo valid
```

Expected:
- **The first** fails with `required variable … is missing a value` for one of them, and
  prints `exit 1`.
- **The second** prints `valid`.

`config` only parses, so nothing is started.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add deploy package.json pnpm-lock.yaml tsconfig.json vitest.config.ts
git commit -m "feat: deploy Mediaplane behind a Docker socket proxy (mediaplane-system)"
```

Check that Git kept the shim executable: `git ls-files -s deploy/mediaplane` starts with
`100755`.

---
### Task 10: End-to-end: plan and apply inside the deployed image

This test deploys the real `deploy/mediaplane.compose.yaml` with the image built from this
checkout. It drives Mediaplane only through the host shim, the way a user would. It proves
each of the following:

- **Hardening.** The container is hardened, and has no Docker socket.
- **The host helper.**
  - It sees the host's own ports: a port held on the host's `127.0.0.1` is reported as in
    use.
  - It sees the data folder, which is outside the home on purpose.
  - It sees that the home is the same folder.
- **The fixed hostname.** A stale lock left by "a previous container" (same hostname, dead
  pid) is cleared.
- **`apply` through the proxy.** It runs end to end, including the chown helper
  (`compose run`), and a second `apply` has nothing to do.
- **Ejectable (success criterion 6).** The command in the generated header, run on the
  host, recreates nothing.
- **The proxy.** It refuses calls the engine never makes, with `Forbidden`.

The test runs only on Linux with a rootful Docker at `/var/run/docker.sock`, like the
other end-to-end tests. The override it adds changes only what must differ from a real
install: the container name, and the Compose project Mediaplane manages
(`MEDIAPLANE_COMPOSE_PROJECT`). That way a real `mediaplane` deployment on the same host is
never touched.

**Files:**
- Create: `test/e2e/deploy.e2e.test.ts`
- Modify: `test/e2e/helpers.ts`, `test/e2e/apply.e2e.test.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- **Consumes:**
  - Tasks 8 and 9: `buildImage`, `REPO`, `deploy/mediaplane.compose.yaml` and
    `deploy/mediaplane`;
  - from `@mediaplane/engine`: `COMPOSE_PATH`, `LOCK_PATH`, `createDockerRuntime` and
    `nodeExec`.
- **Produces:**
  - in `test/e2e/helpers.ts`, `ejectArguments(compose: string, project: string): string[]`
    (moved from `apply.e2e.test.ts`) and `removeAsRoot(dir: string): Promise<void>`;
  - a CI e2e job with a 60-minute timeout.

- [ ] **Step 1: Share the eject command, and a root clean-up**

In `test/e2e/helpers.ts`:

1. Add `import { expect } from 'vitest';` to the imports.
2. Move the whole `ejectArguments` function, with its comment, out of
   `test/e2e/apply.e2e.test.ts` and into `helpers.ts`, as `export function ejectArguments`.
3. Add:

```ts
/**
 * Delete a folder the apps may have written to as other users, from a throwaway
 * container running as root, and then the folder itself.
 */
export async function removeAsRoot(dir: string): Promise<void> {
  await nodeExec(
    'docker',
    ['run', '--rm', '-v', `${dir}:/to-remove`, BUSYBOX, 'find', '/to-remove', '-mindepth', '1', '-delete'],
    { cwd: '/' },
  );
  await rm(dir, { recursive: true, force: true });
}
```

In `test/e2e/apply.e2e.test.ts`, delete the local `ejectArguments`, and import it with the
others: `import { BUSYBOX, composeDown, ejectArguments, makeHome, removeHome } from './helpers';`.

Run: `pnpm typecheck`

Expected: no errors.

- [ ] **Step 2: Write the end-to-end test**

`test/e2e/deploy.e2e.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  COMPOSE_PATH,
  createDockerRuntime,
  LOCK_PATH,
  nodeExec,
  type ExecResult,
} from '@mediaplane/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildImage,
  composeDown,
  ejectArguments,
  removeAsRoot,
  removeHome,
  REPO,
} from './helpers';

const ID = `mediaplane-e2e-${String(process.pid)}`;
const TAG = `mediaplane-e2e:${String(process.pid)}-deploy`;
/** Mediaplane's own project, deployed from mediaplane.compose.yaml. */
const SYSTEM = `${ID}-system`;
/** The stack Mediaplane manages from inside its container. */
const STACK = `${ID}-stack`;
const CONTAINER = `${ID}-mediaplane`;
const DEPLOY = join(REPO, 'deploy', 'mediaplane.compose.yaml');
const SHIM = join(REPO, 'deploy', 'mediaplane');
const UID = String(process.getuid?.() ?? 1000);
const GID = String(process.getgid?.() ?? 1000);

/**
 * Enough of the stack to create, chown and wait through the proxy. Seerr needs its appdata
 * chowned, and Sonarr, qBittorrent and Jellyfin are what Seerr needs. The data folder sits
 * outside the home, so only the host helper can see it.
 */
function smallStack(data: string): string {
  return `version: 1
user: { uid: ${UID}, gid: ${GID} }
paths: { data: ${data} }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`;
}

let home = '';
let data = '';
let override = '';
let env: NodeJS.ProcessEnv = {};

/** docker compose on Mediaplane's own project, as a user would run it. */
function system(...args: string[]): Promise<ExecResult> {
  return nodeExec(
    'docker',
    ['compose', '-p', SYSTEM, '--env-file', '/dev/null', '-f', DEPLOY, '-f', override, ...args],
    { env, cwd: '/', timeoutMs: 300_000 },
  );
}

/** A mediaplane command, run in its container through the host shim. */
function mediaplane(...args: string[]): Promise<ExecResult> {
  return nodeExec('sh', [SHIM, ...args], {
    env: { ...process.env, MEDIAPLANE_CONTAINER: CONTAINER },
    cwd: '/',
    timeoutMs: 1_200_000,
  });
}

/** A docker command run inside the Mediaplane container, so it goes through the proxy. */
function dockerInside(...args: string[]): Promise<ExecResult> {
  return nodeExec('docker', ['exec', CONTAINER, 'docker', ...args], { cwd: '/' });
}

function codesIn(stdout: string): string[] {
  const parsed = JSON.parse(stdout) as { diagnostics: { code: string }[] };
  return parsed.diagnostics.map((d) => d.code);
}

function close(server: Server): Promise<void> {
  return new Promise((done) => {
    server.close(() => {
      done();
    });
  });
}

describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
  beforeAll(async () => {
    await buildImage(TAG);
    home = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
    data = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-data-'));
    await writeFile(join(home, 'stack.yaml'), smallStack(data));
    override = join(await mkdtemp(join(tmpdir(), 'mediaplane-e2e-system-')), 'override.yaml');
    await writeFile(
      override,
      [
        'services:',
        '  mediaplane:',
        `    container_name: ${CONTAINER}`,
        '    environment:',
        `      MEDIAPLANE_COMPOSE_PROJECT: ${STACK}`,
        '',
      ].join('\n'),
    );
    env = {
      ...process.env,
      MEDIAPLANE_IMAGE: TAG,
      MEDIAPLANE_HOME: home,
      MEDIAPLANE_UID: UID,
      MEDIAPLANE_GID: GID,
      DOCKER_GID: String((await stat('/var/run/docker.sock')).gid),
    };
    const up = await system('up', '--detach', '--wait');
    if (up.code !== 0) throw new Error(`mediaplane-system did not start:\n${up.stderr}`);
  }, 1_200_000);

  afterAll(async () => {
    const stackDown = await composeDown(STACK);
    const systemDown =
      override === '' ? undefined : await system('down', '--remove-orphans');
    if (override !== '') await rm(dirname(override), { recursive: true, force: true });
    if (home !== '') await removeHome(home);
    if (data !== '') await removeAsRoot(data);
    const image = await nodeExec('docker', ['image', 'rm', TAG], { cwd: '/' });
    expect(stackDown.code, stackDown.stderr).toBe(0);
    if (systemDown !== undefined) expect(systemDown.code, systemDown.stderr).toBe(0);
    expect(image.code, image.stderr).toBe(0);
  }, 300_000);

  it('runs hardened, as the home owner, without the Docker socket', async () => {
    const inspect = await nodeExec('docker', ['inspect', CONTAINER], { cwd: '/' });
    const [info] = JSON.parse(inspect.stdout) as {
      Config: { User: string; Hostname: string };
      HostConfig: { ReadonlyRootfs: boolean; CapDrop: string[]; SecurityOpt: string[] };
      Mounts: { Source: string; Destination: string; RW: boolean }[];
    }[];
    expect(info?.Config).toMatchObject({ User: `${UID}:${GID}`, Hostname: 'mediaplane' });
    expect(info?.HostConfig).toMatchObject({
      ReadonlyRootfs: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
    });
    expect(info?.Mounts.map((m) => [m.Source, m.Destination, m.RW])).toEqual([
      [home, home, true],
    ]);
    const socket = await nodeExec('docker', ['exec', CONTAINER, 'test', '-e', '/var/run/docker.sock'], {
      cwd: '/',
    });
    expect(socket.code).toBe(1);
  });

  it("sees the host's own ports through the host helper", async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(8989, '127.0.0.1', done));
    try {
      const result = await mediaplane('plan', '--json');
      expect(result.code, result.stderr).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'preflight.port-in-use', path: 'apps.sonarr.port' }),
        ]),
      });
    } finally {
      await close(server);
    }
  });

  it(
    'applies through the proxy, clearing a lock its previous container left, and can be ejected',
    async () => {
      // A lock from a container that no longer runs: the same fixed hostname, a dead pid.
      await mkdir(join(home, 'state'), { mode: 0o700 });
      await writeFile(
        join(home, LOCK_PATH),
        `${JSON.stringify({ pid: 999_999, host: 'mediaplane', startedAt: '2026-10-09T00:00:00.000Z' })}\n`,
        { mode: 0o600 },
      );
      const first = await mediaplane('apply', '--yes', '--json');
      expect(first.code, first.stdout + first.stderr).toBe(0);
      expect(JSON.parse(first.stdout)).toMatchObject({ outcome: 'success' });

      const runtime = createDockerRuntime({ home, project: STACK });
      const containers = await runtime.containers();
      expect(containers.map((c) => `${c.service} ${c.state} ${c.health}`).sort()).toEqual([
        'jellyfin running healthy',
        'qbittorrent running healthy',
        'seerr running healthy',
        'sonarr running healthy',
      ]);
      // The chown helper ran through the proxy.
      expect((await stat(join(home, 'appdata', 'seerr'))).uid).toBe(1000);

      const second = await mediaplane('apply', '--yes', '--json');
      expect(JSON.parse(second.stdout)).toMatchObject({ outcome: 'no-changes' });
      const again = await mediaplane('plan', '--json');
      expect(again.code, again.stderr).toBe(0);
      expect(codesIn(again.stdout)).not.toContain('project.other-home');
      expect(codesIn(again.stdout)).not.toContain('docker.no-proxy');
      expect(codesIn(again.stdout)).not.toContain('preflight.home-path');

      // Ejectable (success criterion 6): the header's command, run on the host, recreates
      // nothing. An empty override makes its second -f real.
      await writeFile(join(home, 'compose.override.yaml'), 'services: {}\n');
      const ids = containers.map((c) => c.id).sort();
      const header = await readFile(join(home, COMPOSE_PATH), 'utf8');
      const eject = await nodeExec('docker', ejectArguments(header, STACK), { cwd: '/' });
      expect(eject.code, eject.stderr).toBe(0);
      expect((await runtime.containers()).map((c) => c.id).sort()).toEqual(ids);
    },
    1_200_000,
  );

  it('refuses the Docker calls the engine never makes', async () => {
    const containers = await createDockerRuntime({ home, project: STACK }).containers();
    const sonarr = containers.find((c) => c.service === 'sonarr');
    expect(sonarr).toBeDefined();
    const refused = [
      ['exec', sonarr?.id ?? 'missing', 'true'],
      ['info'],
      ['system', 'df'],
      ['volume', 'rm', `${ID}-none`],
      ['network', 'rm', `${ID}-none`],
    ];
    for (const args of refused) {
      const result = await dockerInside(...args);
      expect(result.code, args.join(' ')).not.toBe(0);
      expect(result.stdout + result.stderr, args.join(' ')).toContain('Forbidden');
    }
    // What the engine does call still works from the same place.
    const ps = await dockerInside('compose', '-p', STACK, 'ps', '--format', 'json');
    expect(ps.code, ps.stderr).toBe(0);
  });
});
```

- [ ] **Step 3: Run it on this aarch64 machine**

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/deploy.e2e.test.ts`

Expected: PASS (4 tests). With the app images already cached by the apply test, this takes
a few minutes.

Then run the leftover check:

```bash
docker ps -a --format '{{.Names}} {{.Label "com.docker.compose.project"}}' | grep mediaplane-e2e || echo clean
docker ps -a --filter label=io.mediaplane.helper --format '{{.Names}}' | grep . || echo "no helpers"
docker image ls mediaplane-e2e --format '{{.Tag}}' | grep . || echo "no images"
```

Expected: `clean`, `no helpers`, `no images`.

If a step fails, start with `docker logs ${ID}-mediaplane` and with the socket proxy's own
log, `docker compose -p <system project> logs socket-proxy`. The proxy logs each blocked
request as `blocked request … reason="path not allowed"`. A blocked call the engine
genuinely needs means the capture in Task 9 missed it. In that case:

1. add the call to `ENGINE_CALLS` in `deploy/deploy.test.ts`, with how it was seen;
2. widen the pattern in `deploy/mediaplane.compose.yaml`;
3. note it in ADR 0008.

Never allow a whole section.

- [ ] **Step 4: Give the CI job the time it needs**

In `.github/workflows/ci.yml`, in the `e2e` job, change `timeout-minutes: 45` to
`timeout-minutes: 60`. The job now also builds the image twice: once per file, and the
second build comes from the layer cache. Task 11 turns this job into a matrix over amd64
and arm64 runners.

- [ ] **Step 5: Run every end-to-end file, then commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e
git add test/e2e .github/workflows/ci.yml
git commit -m "test(e2e): plan and apply from inside the deployed image, through the proxy"
```

---
### Task 11: CI: native amd64 and arm64 image builds, Trivy, and end-to-end tests on both

Spec §8.2 asks for a multi-arch image build and end-to-end tests on amd64 *and* arm64 on
every PR. The repo is public, so GitHub's `ubuntu-24.04-arm` runners are free for it. By
the owner's ruling of 2026-10-09, arm64 CI therefore moves from S8 to S2c:

- **Each architecture is built and tested natively, on its own runner,** with no QEMU and
  no buildx-on-emulation.
- **There is no multi-arch manifest yet.** That comes with publishing, in S8.

The owner also brought Trivy forward for Mediaplane's own image: fail on critical
vulnerabilities that have a fix (spec §7.2(7)). Scanning the catalog images, the SBOM and
provenance stay in S8.

Facts checked on 2026-10-09:

- **The runner.** GitHub's runner reference lists `ubuntu-24.04-arm` for public
  repositories: 4 CPUs, 16 GB of memory, a 14 GB SSD, free.
- **Its image.** `actions/partner-runner-images` documents its Ubuntu 24.04 image as
  shipping Docker 28.0.4 and Compose 2.38.2. The image leaves out the Android SDK, CodeQL
  and Haskell, so three of the four folders the free-disk step deletes don't exist there.
  `.NET` is installed.

Decisions:

- **Native matrices.** The `image` job and the `e2e` job each run on
  `[ubuntu-24.04, ubuntu-24.04-arm]`, with `fail-fast: false`, so one architecture's
  failure never hides the other's result. Both keep the `needs.changes.outputs.code ==
  'true'` gate.
- **Trivy runs as its pinned image, on a `docker save` tarball,** on each runner, against
  that runner's image. The flags are unchanged: `--scanners vuln --severity CRITICAL
  --ignore-unfixed --exit-code 1`. The Trivy image digest is a multi-arch index, so each
  runner pulls its own architecture.
- **The free-disk step deletes only what exists,** and says what it skipped. `rm -rf`
  would already ignore a missing path, but the log then shows which runner had what.

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- **Consumes:** the `Dockerfile` (Task 8) and `pnpm test:e2e` (Tasks 8 and 10).
- **Produces:**
  - a CI job `image`, named `Image (<arch>, Trivy)`;
  - the `e2e` job, now named `End-to-end (real Docker, <arch>)`.

  Each runs once per architecture, when the `changes` job sees code changes.

- [ ] **Step 1: Scan the image locally first**

On this aarch64 machine:

```bash
docker build --tag mediaplane:scan .
docker save mediaplane:scan --output /tmp/mediaplane-scan.tar
docker run --rm --volume /tmp:/scan \
  aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969 \
  image --input /scan/mediaplane-scan.tar --scanners vuln --severity CRITICAL \
  --ignore-unfixed --exit-code 1 --no-progress
echo "trivy exit $?"
rm /tmp/mediaplane-scan.tar && docker image rm mediaplane:scan
```

Expected: `trivy exit 0`, and a table with no CRITICAL rows.

If Trivy reports a fixable critical vulnerability, fix it in this task, before CI does:

- **In an Alpine package:** bump the `node` pin to a newer patch release that is at least
  two weeks old.
- **In the Docker CLI or Compose:** bump the `docker:<version>-cli` pin the same way.

Record each bump in the commit message.

- [ ] **Step 2: Make the e2e job a matrix**

In `.github/workflows/ci.yml`, replace the whole `e2e` job with:

```yaml
  e2e:
    name: End-to-end (real Docker, ${{ matrix.arch }})
    needs: changes
    if: needs.changes.outputs.code == 'true'
    strategy:
      fail-fast: false
      matrix:
        include:
          - arch: amd64
            runner: ubuntu-24.04
          - arch: arm64
            runner: ubuntu-24.04-arm
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 60
    steps:
      # The apply test pulls about 7 GB of app images; make room for them. The arm64 image
      # has no Android SDK, GHC or CodeQL, so only what exists is deleted.
      - name: Free disk space
        run: |
          for path in /usr/local/lib/android /usr/share/dotnet /opt/ghc /opt/hostedtoolcache/CodeQL; do
            if [ -e "$path" ]; then
              sudo rm -rf "$path"
            else
              echo "not on this runner: $path"
            fi
          done
          df -h /
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: docker version && docker compose version
      - run: pnpm test:e2e
```

The steps are the existing job's, in the same order, with the same pinned actions. Only
the matrix, the name and the free-disk loop are new.

- [ ] **Step 3: Add the image job**

Add this job after `e2e`:

```yaml
  image:
    name: Image (${{ matrix.arch }}, Trivy)
    needs: changes
    if: needs.changes.outputs.code == 'true'
    strategy:
      fail-fast: false
      matrix:
        include:
          - arch: amd64
            runner: ubuntu-24.04
          - arch: arm64
            runner: ubuntu-24.04-arm
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      # Native on each runner: no emulation. A multi-arch manifest comes with publishing (S8).
      - name: Build the image
        run: docker build --tag mediaplane:ci .
      - name: Scan it with Trivy (fails on critical vulnerabilities that have a fix)
        run: |
          docker save mediaplane:ci --output "$RUNNER_TEMP/mediaplane.tar"
          docker run --rm --volume "$RUNNER_TEMP:/scan" \
            aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969 \
            image --input /scan/mediaplane.tar --scanners vuln --severity CRITICAL \
            --ignore-unfixed --exit-code 1 --no-progress
```

- [ ] **Step 4: Check the workflow and commit**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`

Expected: PASS. Prettier also checks the workflow's YAML.

```bash
git add .github/workflows/ci.yml
git commit -m "ci: build, scan and test the image natively on amd64 and arm64 runners"
```

The first real runs happen on the owner's next push. Report three things:

1. **Both matrices are pending,** on both architectures.
2. **The check names changed.** Each check now reports once per architecture, so any
   branch-protection rule that requires "End-to-end (real Docker)" must name the two new
   checks.
3. **What to do if the arm64 e2e job runs out of disk.** Its runner's SSD is listed at
   14 GB, and this slice could not check how much is free after the step. If it runs
   out, read the `df -h /` line, run `sudo du -xh --max-depth=2 /usr /opt | sort -h | tail`
   in a debugging step, and add the largest folders the tests don't need to the loop.

---
### Task 12: Packaging docs: install guide, ADR 0008, the threat model

**Files:**
- Create:
  - `deploy/README.md`;
  - `docs/adr/0008-docker-socket-proxy-on-by-default.md`;
  - `docs/security/threat-model.md`.
- Modify:
  - `SECURITY.md`, `README.md`, `CONTRIBUTING.md`, `.gitignore`;
  - `docs/design/m1-engine-cli.md` (§11).

**Interfaces:**
- **Consumes:** what Tasks 1 to 11 built, and only that.
- **Produces:** the install guide that the README, the threat model and Task 15's
  `docs/architecture.md` link to, at `deploy/README.md`.

Every statement in these files must be true of the code as it now is. Where something is
planned, say so and name the slice.

- [ ] **Step 1: Write the install guide**

`deploy/README.md`:

````markdown
# Running Mediaplane in its container

Mediaplane runs as two containers in their own Compose project, `mediaplane-system`:

- **`mediaplane`**: the CLI. It idles until you run a command, and has no web interface
  yet (the panel arrives in M2).
- **`socket-proxy`**: the only container that talks to Docker. It passes on only the
  Docker API calls Mediaplane makes
  ([ADR 0008](../docs/adr/0008-docker-socket-proxy-on-by-default.md)).

The stack Mediaplane deploys is a separate Compose project, `mediaplane`, so `apply` can
never touch Mediaplane itself.

> Mediaplane is pre-alpha. The apps are not wired together yet, and some of their
> first-run pages are open to anyone who can reach them. Keep `network.bind: localhost`
> while you try it.

## What you need

- **Linux** on amd64 or arm64.
- **Docker Engine 24 or newer**, rootful, with its socket at `/var/run/docker.sock`, and
  the Compose plugin 2.24 or newer. Rootless Docker is not supported yet.
- **A folder for the Mediaplane home,** on a local filesystem that supports hard links,
  such as ext4, XFS or Btrfs. Mediaplane creates its lock and `stack.yaml` with a hard
  link, so FAT, exFAT and many network shares won't work.
- **A data folder** for downloads and media.

## Install

No image is published yet; releases come later in M1. Build one from a checkout:

```bash
git clone https://github.com/cyclopsgd/Mediaplane.git
cd Mediaplane
docker build --tag mediaplane:local .
```

Create the home, owned by the user Mediaplane will run as. Here that is you:

```bash
sudo mkdir -p /opt/mediaplane
sudo chown "$(id -u):$(id -g)" /opt/mediaplane
```

Tell the deployment which image, user and Docker group to use, in `deploy/.env`, then
start it:

```bash
cat > deploy/.env <<EOF
MEDIAPLANE_IMAGE=mediaplane:local
MEDIAPLANE_UID=$(id -u)
MEDIAPLANE_GID=$(id -g)
DOCKER_GID=$(stat -c %g /var/run/docker.sock)
EOF
docker compose -f deploy/mediaplane.compose.yaml up -d
```

For a home somewhere else, add `MEDIAPLANE_HOME=/srv/mediaplane` to `deploy/.env`. The
home is mounted at the same path inside the container, because the host's Docker resolves
every path in the stack's `compose.yaml`. `mediaplane plan` checks this for you.

### The `mediaplane` command

Commands run inside the container:

```bash
docker exec -it mediaplane mediaplane plan
```

The one-line shim shortens that to `mediaplane plan`:

```bash
sudo install -m 0755 deploy/mediaplane /usr/local/bin/mediaplane
```

It adds `-t` only on a terminal, so it works in scripts too.

## First run

```bash
mediaplane init     # asks a few questions, then writes /opt/mediaplane/stack.yaml
mediaplane plan     # checks the host and shows what apply would do
mediaplane apply    # asks before it changes anything; --yes skips the question
mediaplane status
```

- **`init`** writes the user it runs as into `stack.yaml`. Inside the container that is
  `MEDIAPLANE_UID`. The apps run as that user, so it must be able to write to the data
  folder.
- **File secrets.** A secret written as `{ file: secrets/… }` lives in the home.
- **Environment secrets.** A secret written as `{ env: NAME }` must be in the container's
  environment. Pass it with `docker exec -e NAME mediaplane mediaplane apply`, which the
  shim doesn't do, or add it to the `mediaplane` service.

## What runs where

```text
host
├─ mediaplane-system
│  ├─ mediaplane    the CLI, idle
│  └─ socket-proxy  Docker API, filtered
├─ mediaplane       your stack's apps
└─ host helper      seconds, while
                    planning
```

- **The host helper.** From inside its container, Mediaplane can't see the host's
  network, ports, or folders outside its home. So during `plan` and `apply` it starts a
  throwaway container of its own image on the host network, and reads them there. That
  container:
  - gets read-only mounts of the data folder, `/dev` and `stack.yaml`;
  - runs as Mediaplane's user, with no capabilities;
  - is removed when it exits, a second or two later.
- **Mediaplane's network** is internal: the container reaches the proxy and nothing else.

## Updating

Rebuild the image, then recreate the project:

```bash
git pull
docker build --tag mediaplane:local .
docker compose -f deploy/mediaplane.compose.yaml up -d
```

Once images are published, `docker compose -f deploy/mediaplane.compose.yaml pull`
replaces the build. Updating Mediaplane never restarts your stack.

## Running without the socket proxy

The proxy is on by default. It is defence in depth, not a boundary: anything that can
create containers can take over the host (see the
[threat model](../docs/security/threat-model.md)). To turn it off, for example to debug a
call it refuses, give Mediaplane the socket with a Compose file of your own,
`deploy/no-proxy.yaml`:

```yaml
services:
  mediaplane:
    environment:
      DOCKER_HOST: unix:///var/run/docker.sock
    group_add: ["${DOCKER_GID}"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

Then start the project with both files:

```bash
docker compose -f deploy/mediaplane.compose.yaml -f deploy/no-proxy.yaml up -d
```

Every `plan` and `apply` then warns:
`Mediaplane is using the Docker socket directly, without the socket proxy`. To turn the
proxy back on, run `up -d` again with `mediaplane.compose.yaml` alone.

## Troubleshooting

| You see | What to do |
|---|---|
| `required variable MEDIAPLANE_IMAGE is missing a value` | Create `deploy/.env` (Install) |
| `bind source path does not exist: /opt/mediaplane` | Create the home first (Install) |
| `the Mediaplane home … is not the same folder on the Docker host` | Set `MEDIAPLANE_HOME` instead of editing the volume, so the paths match |
| `cannot create …/state/lock (EPERM): … hard links` | Move the home to a local ext4, XFS or Btrfs filesystem |
| `EACCES` on a file in the home | Give `state/` and `generated/` to `MEDIAPLANE_UID`, for example `sudo chown -R "$(id -u):$(id -g)" /opt/mediaplane/state /opt/mediaplane/generated`. Leave `appdata/` alone: some apps need their own owner |
| `the host helper failed: … No such image` | `MEDIAPLANE_IMAGE` must name an image on this host: check `docker image ls` |
| `Error response from daemon: Forbidden` | The proxy refused a call. Its log names it: `docker compose -f deploy/mediaplane.compose.yaml logs socket-proxy` |

## Removing Mediaplane

`docker compose -f deploy/mediaplane.compose.yaml down` removes Mediaplane and the proxy.
Your stack keeps running. The command in the header of
`/opt/mediaplane/generated/compose.yaml` manages it without Mediaplane.
````

In `.gitignore`, add `/deploy/.env` and `/deploy/no-proxy.yaml` to the local-homes block:
they hold this machine's settings.

- [ ] **Step 2: Write ADR 0008**

`docs/adr/0008-docker-socket-proxy-on-by-default.md`:

```markdown
# 0008. Docker socket proxy on by default

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

Mediaplane drives Docker: it creates, recreates and removes the stack's containers, pulls
images, and runs short-lived helper containers. Whoever can do that controls the host,
because a container can be privileged or mount the host's root filesystem.

Mounting `/var/run/docker.sock` into the Mediaplane container would also give it every
other part of the Docker API:

- `exec` into any container on the host;
- reading any container's logs and files;
- building and pushing images;
- swarm, secrets, configs, plugins and system-wide settings.

M1 has no network listener. So the realistic way to misuse Mediaplane's Docker access is a
bug in Mediaplane itself, or in something it runs, such as Compose.

## Decision

- **Mediaplane never mounts the Docker socket.** It reaches Docker through a proxy
  container, `wollomatic/socket-proxy` pinned by digest, in Mediaplane's own Compose
  project, `mediaplane-system` (spec §4.4).
- **The proxy forwards only what the engine calls.** Its allow-list is a regular
  expression per HTTP method, written from the calls the engine was seen to make:
  - pings and the Docker version;
  - containers: list, inspect, create, start, stop, rename, attach, wait and delete;
  - images: inspect and pull;
  - networks: list, inspect and create;
  - volumes: list.

  It also allows network connect and disconnect, and volume create and inspect, which
  Compose needs when a `compose.override.yaml` adds a network or a named volume.

  Everything else is refused with `403 Forbidden`, including:
  - `exec`, logs, file copy, export, commit and build;
  - kill, restart, pause and update;
  - deleting images, networks or volumes;
  - `/info`, `/system`, `/events` and `/auth`;
  - swarm, services, secrets, configs, plugins and distribution.

  `deploy/deploy.test.ts` pins the list against the captured calls.
- **Only Mediaplane can use it.** The proxy listens on an internal network that it shares
  with the Mediaplane container alone. It accepts connections only from the `mediaplane`
  host name, and publishes no port.
- **The proxy is locked down too.** It runs:
  - from a `scratch` image, as `nobody` in the socket's group;
  - with a read-only root, no capabilities and `no-new-privileges`;
  - with the socket mounted read-only, and a health check.
- **It can be turned off**, by giving Mediaplane the socket with an extra Compose file.
  Every `plan` and `apply` then warns (`docker.no-proxy`).
- **The code keeps its own limit.** The runtime refuses any Compose project except
  `mediaplane` and `mediaplane-<name>`, and never manages `mediaplane-system` (spec
  §7.2(2)). The one container created outside the managed project is the unnamed, `--rm`
  host helper, labelled `io.mediaplane.helper`.

## Consequences

- **This is defence in depth, not a boundary.** Creating containers stays allowed, and
  that alone can take over the host: a compromised Mediaplane could still start a
  privileged container or mount `/`. The proxy narrows what a bug can reach by accident,
  and what an attacker can do quietly. The threat model says so plainly.
- **Overrides that need more of the API fail loudly.** Some overrides ask for more: a
  `post_start` hook (which uses `exec`), or a change that makes Compose delete a network
  or volume. The proxy refuses them with `Forbidden`, and logs each one. Widening the
  list means capturing the new call, adding it to the test, and recording it here.
- **Bind-mount filtering is available, but off.** socket-proxy can refuse bind mounts
  outside listed folders (`-allowbindmountfrom`). It is off by default, because the data
  folder is chosen in `stack.yaml` and an override may add mounts. The threat model shows
  how to turn it on.
- **There is one more pinned image to keep current, and one more setting:** `DOCKER_GID`,
  the group that owns the socket.
- **Rootful Docker only, for now.** The deploy file expects the socket at
  `/var/run/docker.sock`.
```

- [ ] **Step 3: Write the threat model**

`docs/security/threat-model.md`:

````markdown
# Threat model

This is the threat model for Mediaplane as built today: M1, up to and including Slice 2c.
It makes spec §7 concrete. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).

## The one thing to know

Mediaplane controls Docker, and controlling Docker is root-equivalent on the host. The
security of Mediaplane is therefore the security of the host. Every control below narrows
that power. None of them removes it.

## What it protects

| Asset | Where | Why it matters |
|---|---|---|
| The host | Everything | Docker access is root on the host |
| Generated API keys | `state/secrets.json` and `generated/.env`, both 0600 | They open the apps' APIs |
| Your secrets: VPN key, Plex token, passwords | `secrets/` (0700), or environment variables | They are your accounts |
| App data | `appdata/<app>/` | The apps' databases and settings, some holding credentials |
| Your media | The data folder | Your library |

## What runs, and who can reach it

```text
LAN or internet
  │ web UIs only, as
  │ network.bind says
  ▼
mediaplane project: the apps
  (qBittorrent inside Gluetun)

mediaplane-system project
  mediaplane
    │ internal network
    ▼
  socket-proxy ──► Docker

host helper: seconds, on the
host network, read-only mounts
```

- **The Mediaplane container.**
  - It runs as a non-root user (`MEDIAPLANE_UID`), with a read-only root filesystem, no
    capabilities and `no-new-privileges`.
  - Its only mount is the home. Its only network is internal, and reaches the proxy and
    nothing else. It listens on nothing.
  - You reach it with `docker exec`, which already needs Docker access on the host.
- **The socket proxy.** It is the only container with the Docker socket. It forwards only
  the API calls Mediaplane makes, and only from the Mediaplane container
  ([ADR 0008](../adr/0008-docker-socket-proxy-on-by-default.md)).
- **The host helper.** During `plan` and `apply`, Mediaplane starts a container of its own
  image on the host network for a second or two. It reads what the Mediaplane container
  cannot see: network addresses, free ports, the data folder, `/dev`, and the home's
  `stack.yaml`, all mounted read-only. It runs as Mediaplane's user, with no
  capabilities, a read-only root and `no-new-privileges`, and is removed when it exits.
- **The apps.**
  - They are unmodified upstream images, pinned by digest, and never get the Docker
    socket.
  - Only their web UIs are published, bound as `network.bind` says. Everything else stays
    on the stack's own Docker network.
  - qBittorrent has no network of its own. It uses Gluetun's, so it has no route out when
    the VPN is down. The automated test for that arrives in Slice 3.

## Threats and controls

| # | Threat | Controls today | What remains |
|---|---|---|---|
| T1 | A bug in Mediaplane, a library or Compose is used to drive Docker | No listener in M1, and the input is your own `stack.yaml`. The proxy refuses `exec`, logs, file copy, builds, every delete except of containers, and the system, swarm, secret, config and plugin APIs. The runtime refuses any project but `mediaplane` or `mediaplane-<name>` | Creating containers is allowed, and a container can be privileged or mount `/`. The proxy cannot tell a malicious create from a normal one |
| T2 | Someone on the LAN reaches an app | Only web UIs are published, on the LAN addresses (`lan`) or on localhost. A login is asked for from the LAN by default (`security.login_on_lan`) | Until the wiring lands (Slices 3 to 7), first-run setup pages are open to whoever reaches them first: Jellyfin's wizard, Seerr's setup, and the arrs' first login. Keep `bind: localhost` |
| T3 | A cloud VM's private address is reachable from the internet | On a detected cloud VM, `bind: lan` is refused unless `network.lan_subnet` is set. `bind: all` warns on every plan | Detection relies on firmware strings. Use `bind: localhost`, with Tailscale or an SSH tunnel |
| T4 | An app is compromised | It has no Docker access, and no other app's appdata. qBittorrent sits in Gluetun's network namespace | Every app shares the data folder, which hardlinks need, so a compromised app can change media |
| T5 | Secrets leak | Generated with `crypto.randomBytes`. Kept in 0600 files inside a 0700 `state/`. Never in `stack.yaml` or `compose.yaml`. Replaced with `***` in errors. Change records hold names, never values. Given to Compose in its environment or in the 0600 `generated/.env`, never on its command line | Not encrypted at rest, so use full-disk encryption. `appdata/` holds credentials too: treat it as sensitive |
| T6 | Another user on the host uses Mediaplane's Docker access | The proxy publishes no port, and accepts only the Mediaplane container's address. Using Mediaplane needs `docker exec`, which means Docker access already | Anyone in the `docker` group is already root on the host |
| T7 | A tampered image or dependency | Every image is pinned by digest: the apps, the proxy, and Node and the Docker CLI in Mediaplane's image. GitHub Actions are pinned by commit. Trivy fails CI on fixable critical vulnerabilities in Mediaplane's image, and gitleaks scans every push | The catalog images are not scanned yet, and there is no SBOM or provenance yet. Both arrive in Slice 8 |
| T8 | The home is mounted at another path, so Docker mounts the wrong folders | `plan` checks that `stack.yaml` inside the container is the very file the host has at that path (`preflight.home-path`) | None known |
| T9 | The proxy is turned off | Every `plan` and `apply` warns (`docker.no-proxy`) | Without it, a bug reaches the whole Docker API |

## Hardening further

- **Restrict bind mounts at the proxy.** socket-proxy can refuse any bind mount outside
  the folders you list. Add a line to the `socket-proxy` command in
  `deploy/mediaplane.compose.yaml`, listing:
  - your home;
  - your data folder;
  - `/dev`, which the host helper mounts.

  ```yaml
      - -allowbindmountfrom=/opt/mediaplane,/srv/data,/dev
  ```

  Every extra mount in your `compose.override.yaml` must then be listed too, and
  `volumes_from` is refused. It still cannot stop a privileged container.
- **Keep `network.bind: localhost`,** and reach the web UIs through Tailscale, WireGuard or
  an SSH tunnel.
- **Encrypt the disk** that holds the home.

## Out of scope

- **Vulnerabilities in the upstream apps.** Report them to those projects.
- **A host that is already compromised,** or a member of the `docker` group acting
  against the host. That is root access already.
- **Shared hosts where untrusted users have Docker access.**
````

- [ ] **Step 4: Update `SECURITY.md`, `README.md` and `CONTRIBUTING.md`**

In `SECURITY.md`:

1. Add at the end of the "Scope" list:

   ```markdown
   - anything that gets a Docker call past the socket proxy's allow-list, or makes the
     host helper write to the host.
   ```

2. Add after the list:

   ```markdown
   [`docs/security/threat-model.md`](docs/security/threat-model.md) describes what
   Mediaplane protects, how, and what it does not protect against.
   ```

In `README.md`:

1. **The status quote.** Add a sentence at the end of its "Works today" bullet: `It runs
   in its own hardened container, behind a Docker socket proxy.`
2. **The "What works so far" table.** Add after the `init` row:

   ```markdown
   | Run in a hardened container, behind a Docker socket proxy                        | Done            |
   ```

3. **A new section.** Add this before "## Try it (from source)":

   ````markdown
   ## Run it in a container

   Mediaplane runs as its own container next to a Docker socket proxy, in a Compose
   project of its own. No image is published yet, so build one from a checkout:

   ```bash
   docker build --tag mediaplane:local .
   ```

   Then follow [`deploy/README.md`](deploy/README.md) to start it and run
   `mediaplane plan` inside it.
   ````

4. **The "Is it safe to run?" answer.** Replace its last paragraph with:

   ```markdown
   On a cloud VM it refuses to publish the web UIs on the private address unless you say
   so. In its container, Mediaplane never touches the Docker socket. It goes through a
   proxy that allows only the Docker calls it makes, which is defence in depth rather
   than a boundary. The [threat model](docs/security/threat-model.md) explains what that
   does and doesn't protect, and [SECURITY.md](SECURITY.md) covers what is in scope.
   ```

In `CONTRIBUTING.md`, after the paragraph that starts "Before committing", add:

````markdown
### The image

`pnpm bundle` writes the CLI as one file, `dist/mediaplane.mjs`, which is what the image
runs. To build and check the image itself:

```bash
docker build --tag mediaplane:local .
pnpm vitest run --config vitest.e2e.config.ts test/e2e/image.e2e.test.ts test/e2e/deploy.e2e.test.ts
```

The deploy test starts `deploy/mediaplane.compose.yaml` under its own names and applies a
small stack from inside the container. CI builds the image and runs every end-to-end
test natively on both amd64 and arm64 runners. It fails if Trivy finds a critical
vulnerability that has a fix. The Docker API calls the
engine may make are listed in `deploy/deploy.test.ts`. A change that needs a new one must
add it there, to the proxy's allow-list, and to ADR 0008.
````

- [ ] **Step 5: Record the slice's refinements in the spec**

In `docs/design/m1-engine-cli.md`, add at the end of §11:

```markdown
### Slice 2c: packaging (2026-10-09)

- **Where the deployment lives.** It is `deploy/mediaplane.compose.yaml`, started with
  `docker compose -f deploy/mediaplane.compose.yaml up -d`. Until images are published
  (S8), it needs `MEDIAPLANE_IMAGE`, the image to run. It also needs `DOCKER_GID`, the
  group that owns the Docker socket.
- **The host helper does more than addresses.** Inside the container, Mediaplane can see
  neither the host's ports, nor its folders outside the home, nor its devices. So the
  helper container (§4.2) also reports them to preflight: free ports, the data folder,
  `/dev/net/tun` and free space. It runs Mediaplane's own image, with read-only mounts.
  The one container created outside the managed project is the unnamed, `--rm` host
  helper, labelled `io.mediaplane.helper`.
- **The home is checked.** Preflight fails (`preflight.home-path`) when the home inside
  the container is not the same folder as the host's at that path (§4.1).
- **The proxy.** It is `wollomatic/socket-proxy`, with a per-method allow-list of the
  Docker API calls the engine makes. Nothing may be deleted except containers (ADR 0008).
- **Trivy for Mediaplane's own image runs from S2c** (§7.2(7)). Scanning the catalog
  images, the SBOM and provenance stay in S8.
- **CI runs on arm64 from S2c** (§8.2), on GitHub's `ubuntu-24.04-arm` runners, which are
  free because the repo is public. The image is built, scanned and tested end to end
  natively on each architecture. A multi-arch manifest comes with publishing, in S8.
```

- [ ] **Step 6: Check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add deploy/README.md docs SECURITY.md README.md CONTRIBUTING.md .gitignore
git commit -m "docs: install guide, ADR 0008 and the threat model"
```

---
### Task 13: Generated references: `stack.yaml`, JSON Schema, CLI

These come forward from S8, by the owner's decision (spec §9, success criterion 7):

- `pnpm docs:generate` writes three files from code:
  - `docs/reference/stack-yaml.md`, from the Zod schema and the catalog;
  - `docs/reference/stack.schema.json`, from Zod 4's JSON Schema export;
  - `docs/reference/cli.md`, from the Commander program.
- `pnpm docs:check` fails when any of them is stale, and runs in CI's check job.
- The `--json` output shapes stay in S8.

Checked on 2026-10-09:

- `z.toJSONSchema(stackConfigSchema, { io: 'input' })` succeeds on the schema as it is,
  with defaults.
- `.describe()` text appears as `description`.
- `apps` comes out as a plain map, because the schema is loose there.

So the published schema spells out `apps` per catalog app, with each app's own options.
An editor can then complete app names and catch typos.

Decisions:

- **The JSON Schema path is `docs/reference/stack.schema.json`,** as the owner asked and
  spec §9 implies. Spec §4.2's example still points at `schema/stack.schema.v1.json`, so
  this task updates the spec. `init`'s starter now begins with the matching
  `yaml-language-server` line.
- **Exit codes live next to the commands** (`EXIT_CODES` in `run.ts`). `--help` shows
  them, and so does the reference.
- **`--timezone` shows "this machine's timezone" as its default,** instead of the
  machine's actual zone, so the generated reference is the same on every machine.
- **Generated Markdown is passed through Prettier** before it is written or compared, so
  `pnpm lint` and `pnpm docs:check` always agree.

**Files:**
- Create:
  - `packages/engine/src/config/json-schema.ts` and its test;
  - `packages/engine/src/testing/schema.ts` (the `undocumented` test helper);
  - `scripts/docs.ts`;
  - `scripts/docs/stack-reference.ts` and its test;
  - `scripts/docs/cli-reference.ts` and its test;
  - the generated files `docs/reference/stack-yaml.md`,
    `docs/reference/stack.schema.json` and `docs/reference/cli.md`.
- Modify:
  - `packages/engine/src/config/schema.ts`, `packages/engine/src/config/starter.ts`,
    `packages/engine/src/index.ts`, `packages/engine/src/testing/index.ts`;
  - `catalog/qbittorrent/app.ts`, `catalog/seerr/app.ts`, `catalog/catalog.test.ts`;
  - `packages/cli/src/run.ts`;
  - `package.json`, `.github/workflows/ci.yml`, `CONTRIBUTING.md`;
  - `docs/design/m1-engine-cli.md` (§4.2 and §11).
- Test: `packages/engine/src/config/starter.test.ts`, `packages/cli/src/run.test.ts`

**Interfaces:**
- **Consumes:** `stackConfigSchema`, `appSettingsSchema`, the catalog, `createProgram`
  (Task 6), `defaultDeps`, and `ROOT` (Task 7).
- **Produces:**
  - In the engine:
    - `STACK_SCHEMA_URL =
      'https://raw.githubusercontent.com/cyclopsgd/Mediaplane/main/docs/reference/stack.schema.json'`;
    - `appEntrySchema(def: AppDefinition): z.ZodType`;
    - `stackJsonSchema(catalog: Catalog): Record<string, unknown>`.
  - In `packages/cli/src/run.ts`:
    - `EXIT_CODES: Readonly<Record<string, readonly string[]>>`;
    - `ENVIRONMENT: readonly { name: string; description: string }[]`.
  - In the scripts:
    - `renderStackReference(schema: Schema, catalog: Catalog): string`, `typeOf(schema:
      Schema): string`, `cell(text: string): string` and `type Schema`, in
      `scripts/docs/stack-reference.ts`;
    - `renderCliReference(program?): string`, in `scripts/docs/cli-reference.ts`;
    - `prettify(path: string, content: string): Promise<string>` and
      `generatedFiles(): Promise<{ path: string; content: string }[]>`, in
      `scripts/docs.ts`. Task 14 adds the catalog READMEs to `generatedFiles`.
  - `pnpm docs:generate` and `pnpm docs:check`.

- [ ] **Step 1: Write the failing tests for the schema export**

A test helper first, shared by the engine's test and the catalog's. Create
`packages/engine/src/testing/schema.ts`:

```ts
/** The parts of a JSON Schema that undocumented() walks. */
export interface DescribedSchema {
  description?: string;
  properties?: Record<string, DescribedSchema>;
  anyOf?: DescribedSchema[];
  [key: string]: unknown;
}

/**
 * Every property in a JSON Schema that has no description, by dotted path. A property
 * whose anyOf options carry the description (a secret reference) counts as described.
 */
export function undocumented(schema: DescribedSchema, path = ''): string[] {
  const missing: string[] = [];
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const at = path === '' ? name : `${path}.${name}`;
    const described =
      child.description !== undefined ||
      (child.anyOf ?? []).some((option) => option.description !== undefined);
    if (!described) missing.push(at);
    missing.push(...undocumented(child, at));
    for (const option of child.anyOf ?? []) missing.push(...undocumented(option, at));
  }
  return missing;
}
```

and add `export * from './schema';` to `packages/engine/src/testing/index.ts`.

`packages/engine/src/config/json-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fixtureApp, fixtureCatalog } from '../testing/fixtures';
import { undocumented, type DescribedSchema as Schema } from '../testing/schema';
import { appEntrySchema, STACK_SCHEMA_URL, stackJsonSchema } from './json-schema';
import { stackConfigSchema } from './schema';

describe('stackJsonSchema', () => {
  const schema = stackJsonSchema(fixtureCatalog) as Schema & {
    properties: Record<string, Schema & { properties?: Record<string, Schema> }>;
  };

  it('names itself, and keeps the required fields', () => {
    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: STACK_SCHEMA_URL,
      required: ['version', 'paths', 'media_server'],
    });
  });

  it('spells out every catalog app under apps, and allows no other', () => {
    const apps = schema.properties.apps;
    expect(Object.keys(apps?.properties ?? {})).toEqual(
      fixtureCatalog.map((def) => def.id).sort(),
    );
    expect(apps?.additionalProperties).toBe(false);
  });

  it("gives each app the shared settings and its own options, and allows it empty", () => {
    const qbittorrent = schema.properties.apps?.properties?.qbittorrent;
    expect(qbittorrent?.anyOf?.[0]).toEqual({ type: 'null' });
    expect(qbittorrent?.anyOf?.[1]?.properties).toMatchObject({
      enabled: { type: 'boolean', default: true },
      port: { type: 'integer', minimum: 1, maximum: 65535 },
      vpn: { type: 'boolean', default: true },
    });
    expect(qbittorrent?.anyOf?.[1]?.additionalProperties).toBe(false);
  });
});

describe('the stack.yaml schema', () => {
  it('describes every field', () => {
    expect(undocumented(z.toJSONSchema(stackConfigSchema, { io: 'input' }) as Schema)).toEqual(
      [],
    );
  });

  it('describes every setting every app takes', () => {
    const entry = z.toJSONSchema(appEntrySchema(fixtureApp({ id: 'x' })), { io: 'input' });
    expect(undocumented(entry as Schema)).toEqual([]);
  });
});
```

In `catalog/catalog.test.ts`:

1. Add the imports:

   ```ts
   import { stackJsonSchema } from '@mediaplane/engine';
   import { undocumented, type DescribedSchema } from '@mediaplane/engine/testing';
   ```

2. Add inside `describe('catalog', …)`:

```ts
  it("describes every app's own options, for the reference and the JSON Schema", () => {
    expect(undocumented(stackJsonSchema(catalog) as DescribedSchema)).toEqual([]);
  });
```

In `packages/engine/src/config/starter.test.ts`, add `STACK_SCHEMA_URL` to the imports
(from `./json-schema`) and add:

```ts
  it('points editors at the published JSON Schema on its first line', () => {
    expect(starterStack(ANSWERS).split('\n')[0]).toBe(
      `# yaml-language-server: $schema=${STACK_SCHEMA_URL}`,
    );
  });
```

Run: `pnpm vitest run packages/engine/src/config catalog`

Expected: FAIL. `./json-schema` does not exist, and once it does, `undocumented` lists
every field.

- [ ] **Step 2: Describe every field**

In `packages/engine/src/config/schema.ts`:

1. **`secretRefSchema`.** Give each of its two objects a described field, and describe
   the union itself:

```ts
export const secretRefSchema = z
  .union(
    [
      z.strictObject({
        file: z
          .string()
          .min(1)
          .describe(
            'A file that holds the secret, relative to the Mediaplane home, such as secrets/wg.key.',
          ),
      }),
      z.strictObject({
        env: z
          .string()
          .regex(ENV_NAME)
          .describe('An environment variable that holds the secret.'),
      }),
    ],
    {
      error: (issue) =>
        typeof issue.input === 'string'
          ? INLINE_SECRET
          : 'expected { file: … } or { env: … }',
    },
  )
  .describe('A secret reference: { file: … } or { env: … }, never the secret itself.');
```

2. **`appSettingsSchema`.** Add these `.describe()` calls, each as the last call in its
   chain, after `.optional()` or `.default()`:

| Field | Description |
|---|---|
| `enabled` | `Turn the app off but keep its settings with false. Listing an app turns it on.` |
| `port` | `The host port the app's web UI is published on. The port inside the container stays the same, except for qBittorrent, where both move together.` |
| `version` | `Run this image tag instead of the tested one. plan warns that it is an untested combination.` |
| `env` | `Extra environment variables for the app: strings, or secret references, which never appear in compose.yaml.` |

3. **`stackShape`.** Add `.describe()` the same way, as the last call:

| Field | Description |
|---|---|
| `version` | `The version of this file's format. Always 1.` |
| `timezone` | `The timezone the apps run in, as a tz database name such as Europe/London.` |
| `user` | `The user and group the apps run as. They must be able to write to paths.data.` |
| `user.uid` | `The user id.` |
| `user.gid` | `The group id.` |
| `paths` | `Where your media lives.` |
| `paths.data` | `The data folder for downloads and media, mounted in the apps as /data. Keep both on one filesystem inside it, so moves are instant hardlinks. An absolute path, without ":".` |
| `network` | `Where the web UIs are published.` |
| `network.bind` | `lan: on this host's private (RFC 1918) addresses. localhost: on 127.0.0.1 only. all: on every interface, and plan warns every time. On a cloud VM, lan needs lan_subnet.` |
| `network.lan_subnet` | `Your LAN as an IPv4 CIDR, such as 192.168.1.0/24. Detected from this host's private addresses when left out; on a cloud VM, bind: lan needs it set.` |
| `security` | `Login settings.` |
| `security.login_on_lan` | `Ask for a login from your own network too. false lets Sonarr, Radarr and Prowlarr skip it for addresses in the LAN subnet.` |
| `admin` | `The shared admin login for the apps that have one. Not used yet: the apps' logins are set up from Slice 3.` |
| `admin.username` | `The admin user name. Not used yet (Slice 3).` |
| `admin.password` | `The admin password, as a secret reference. Checked to exist, but not used yet: from Slice 3, a password is generated when this is left out.` |
| `media_server` | `The media server, jellyfin or plex. It runs whether or not it is listed under apps.` |
| `plex` | `Plex settings, needed when media_server is plex.` |
| `plex.token` | `Your Plex token, as a secret reference. Checked to exist, but not used yet: claiming the server arrives in Slice 6.` |
| `vpn` | `The VPN that qBittorrent's traffic goes through, by way of Gluetun. Needed while apps.qbittorrent.vpn is true.` |
| `vpn.provider` | `The VPN provider, by its Gluetun name, such as mullvad.` |
| `vpn.private_key` | `Your WireGuard private key, as a secret reference.` |
| `vpn.addresses` | `The WireGuard address, for providers that need one, such as Mullvad. Other Gluetun settings go in apps.gluetun.env.` |
| `apps` | `The apps to run, by id. Listing an app runs it, even with no settings.` |
| `overrides` | `Keep mine values, by <app>.<resource>.<field>. Not used yet: drift detection arrives in Slice 4.` |
| `managed_by` | `external: Mediaplane never writes this file, for when automation such as Ansible owns it. Today only init writes it, and init never overwrites. Matters from Slice 4.` |

For example, `timezone` becomes:

```ts
  timezone: z
    .string()
    .min(1)
    .default('Etc/UTC')
    .describe('The timezone the apps run in, as a tz database name such as Europe/London.'),
```

and `user` becomes:

```ts
  user: z
    .strictObject({
      uid: z.int().min(0).describe('The user id.'),
      gid: z.int().min(0).describe('The group id.'),
    })
    .default({ uid: 1000, gid: 1000 })
    .describe('The user and group the apps run as. They must be able to write to paths.data.'),
```

For `admin.password`, `plex.token` and `vpn.private_key`, which reuse `secretRefSchema`,
describe the property: `password: secretRefSchema.optional().describe('…')`.

In `catalog/qbittorrent/app.ts`, change its options to:

```ts
  options: z.strictObject({
    vpn: z
      .boolean()
      .default(true)
      .describe(
        "Route qBittorrent through Gluetun's VPN, so it has no network when the VPN is down. true needs a vpn: block; false makes plan warn every time.",
      ),
  }),
```

In `catalog/seerr/app.ts`, change its options to:

```ts
  options: z.strictObject({
    sonarr_profile: z
      .string()
      .min(1)
      .optional()
      .describe('The Sonarr quality profile Seerr requests with. Not used yet (Slice 7).'),
    radarr_profile: z
      .string()
      .min(1)
      .optional()
      .describe('The Radarr quality profile Seerr requests with. Not used yet (Slice 7).'),
  }),
```

- [ ] **Step 3: Write the schema export, and point the starter at it**

`packages/engine/src/config/json-schema.ts`:

```ts
import { z } from 'zod';
import type { AppDefinition, Catalog } from '../catalog/types';
import { compare } from '../util/sort';
import { appSettingsSchema, stackConfigSchema } from './schema';

/** Where the published JSON Schema for stack.yaml lives (spec §9). */
export const STACK_SCHEMA_URL =
  'https://raw.githubusercontent.com/cyclopsgd/Mediaplane/main/docs/reference/stack.schema.json';

type JsonSchema = Record<string, unknown>;

/** What stack.yaml takes under apps.<id>: the settings every app takes, and its own. */
export function appEntrySchema(def: AppDefinition): z.ZodType {
  const own = def.options instanceof z.ZodObject ? def.options.shape : {};
  return z
    .strictObject({ ...appSettingsSchema.shape, ...own })
    .describe(`${def.name}. Listing it runs it.`);
}

/**
 * The published JSON Schema for stack.yaml, for editors (spec §9). It is the Zod schema's
 * input form, with apps: spelled out per catalog app, so an editor can complete app names
 * and their options. Validation itself stays with the Zod schema and the resolver.
 */
export function stackJsonSchema(catalog: Catalog): JsonSchema {
  const { $schema, ...base } = z.toJSONSchema(stackConfigSchema, {
    io: 'input',
  }) as JsonSchema & { properties: Record<string, JsonSchema | undefined> };
  const apps = [...catalog]
    .sort((a, b) => compare(a.id, b.id))
    .map((def): [string, JsonSchema] => {
      const { $schema: _, ...entry } = z.toJSONSchema(appEntrySchema(def), { io: 'input' });
      // `sonarr:` with nothing after it is YAML null, which stack.yaml reads as {}.
      return [def.id, { anyOf: [{ type: 'null' }, entry] }];
    });
  return {
    $schema,
    $id: STACK_SCHEMA_URL,
    title: 'Mediaplane stack.yaml, version 1',
    ...base,
    properties: {
      ...base.properties,
      apps: {
        description: base.properties.apps?.description,
        default: {},
        type: 'object',
        properties: Object.fromEntries(apps),
        additionalProperties: false,
      },
    },
  };
}
```

In `packages/engine/src/index.ts`, add `export * from './config/json-schema';` after
`export * from './config/schema';`.

In `packages/engine/src/config/starter.ts`:

1. Add `import { STACK_SCHEMA_URL } from './json-schema';`.
2. Make this the first element of the array `starterStack` joins:
   `` `# yaml-language-server: $schema=${STACK_SCHEMA_URL}`, ``.

Run: `pnpm vitest run packages/engine/src/config catalog`

Expected: PASS.

- [ ] **Step 4: Put the exit codes and environment in the CLI**

In `packages/cli/src/run.ts`:

1. Change the commander import to `import { Command, CommanderError, Option } from 'commander';`.
2. Add below `DEFAULT_HOME`:

```ts
/** What each command's exit code means (spec §5.2): in --help, and in the CLI reference. */
export const EXIT_CODES: Readonly<Record<string, readonly string[]>> = {
  plan: [
    '0: nothing would change',
    '2: apply would change something, including apps still waiting for their health check',
    '1: an error; nothing was changed',
  ],
  apply: [
    '0: applied, or nothing needed changing',
    '1: a step failed, the apply was cancelled, or stack.yaml or the host has errors',
  ],
  status: ['0: the containers were listed', '1: an error, or no container for that app'],
  history: ['0: the records were listed or shown', '1: an error, or no such record'],
  init: [
    '0: stack.yaml and secrets/ were written',
    '1: an error; an existing stack.yaml is never overwritten',
  ],
};

/** The environment variables the CLI reads. */
export const ENVIRONMENT: readonly { name: string; description: string }[] = [
  {
    name: 'MEDIAPLANE_HOME',
    description: 'The Mediaplane home when --home is not given. Default /opt/mediaplane.',
  },
  {
    name: 'MEDIAPLANE_IMAGE',
    description:
      'Set by mediaplane.compose.yaml in the Mediaplane container: the image the host helper runs. Leave it unset when running from source.',
  },
  {
    name: 'MEDIAPLANE_COMPOSE_PROJECT',
    description:
      'For tests and development only: manage the Compose project mediaplane-<name> instead of mediaplane.',
  },
  {
    name: 'DOCKER_HOST',
    description:
      "Docker's own setting, passed to every docker command. In the Mediaplane container it points at the socket proxy.",
  },
];

function exitCodesHelp(command: string): string {
  const lines = (EXIT_CODES[command] ?? []).map((line) => `  ${line}`);
  return `\nExit codes:\n${lines.join('\n')}\n`;
}
```

3. In `createProgram`, add `.addHelpText('after', exitCodesHelp('<name>'))` to each of the
   five commands, just before its `.action(`. For example:
   `.option('--json', 'print machine-readable JSON').addHelpText('after', exitCodesHelp('plan')).action(…)`.
4. In the `init` command, replace the `.option('--timezone <zone>', …)` call with:

```ts
    .addOption(
      new Option('--timezone <zone>', 'timezone, e.g. Europe/London').default(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        "this machine's timezone",
      ),
    )
```

In `packages/cli/src/run.test.ts`, add:

```ts
describe('--help', () => {
  it("lists each command's exit codes", async () => {
    const term = capture();
    expect(await run(['plan', '--help'], term.io)).toBe(0);
    expect(term.stdout()).toContain('Exit codes:\n  0: nothing would change\n');
  });

  it("names the machine's timezone as init's default, not the zone itself", async () => {
    const term = capture();
    await run(['init', '--help'], term.io);
    expect(term.stdout()).toContain("(default: this machine's timezone)");
  });
});
```

Run: `pnpm vitest run packages/cli`

Expected: PASS.

- [ ] **Step 5: Write the failing tests for the renderers**

`scripts/docs/stack-reference.test.ts`:

```ts
import { catalog } from '@mediaplane/catalog';
import { stackJsonSchema } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { renderStackReference, typeOf, type Schema } from './stack-reference';

const text = renderStackReference(stackJsonSchema(catalog) as Schema, catalog);

describe('renderStackReference', () => {
  it('lists each field with its type, default and description', () => {
    expect(text).toContain('| `paths.data` | string | required | The data folder');
    expect(text).toContain('| `network.bind` | one of `lan`, `localhost`, `all` | `"lan"` |');
    expect(text).toContain('| `admin.password` | secret reference |  | The admin password');
    // Required once user: is given; user: itself has a default.
    expect(text).toContain('| `user.uid` | integer, at least 0 | required | The user id. |');
  });

  it("lists the settings every app takes once, and each app's own", () => {
    expect(text).toContain('| `apps.<app>.port` | integer, 1 to 65535 |  |');
    expect(text).toContain(
      '| `apps.<app>.env` | map of name → string or secret reference | `{}` |',
    );
    expect(text).toContain('| `apps.qbittorrent.vpn` | boolean | `true` |');
    expect(text).not.toContain('`apps.sonarr.port`');
  });

  it('names every app and says it is generated', () => {
    for (const def of catalog) expect(text).toContain(`\`${def.id}\``);
    expect(text).toContain('Generated by "pnpm docs:generate"');
  });
});

describe('typeOf', () => {
  it.each([
    [{ type: 'boolean' }, 'boolean'],
    [{ const: 1 }, '`1`'],
    [{ type: ['string', 'number', 'boolean'] }, 'string, number or boolean'],
    [{ type: 'integer', minimum: 1, maximum: 65535 }, 'integer, 1 to 65535'],
    [{ anyOf: [{ type: 'null' }, { type: 'object' }] }, 'object'],
  ] satisfies [Schema, string][])('%j is %s', (schema, expected) => {
    expect(typeOf(schema)).toBe(expected);
  });
});
```

`scripts/docs/cli-reference.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderCliReference } from './cli-reference';

describe('renderCliReference', () => {
  const text = renderCliReference();

  it('documents every command with its options and exit codes', () => {
    for (const name of ['plan', 'apply', 'status', 'history', 'init']) {
      expect(text).toContain(`## \`mediaplane ${name}\``);
    }
    expect(text).toContain(
      '| `--home <dir>` | Mediaplane home directory (default: "/opt/mediaplane") |',
    );
    expect(text).toContain('- 2: apply would change something');
    expect(text).toContain('| `MEDIAPLANE_IMAGE` |');
  });

  it("leaves out the host helper's command, and nothing in it depends on this machine", () => {
    expect(text).not.toContain('host-report');
    expect(text).toContain("(default: this machine's timezone)");
  });
});
```

Run: `pnpm vitest run scripts/docs`

Expected: FAIL. The renderers do not exist.

- [ ] **Step 6: Write the renderers**

`scripts/docs/stack-reference.ts`:

```ts
import type { Catalog } from '@mediaplane/engine';

/** The parts of a JSON Schema the reference reads. */
export interface Schema {
  $id?: string;
  type?: string | string[];
  description?: string;
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: Schema | boolean;
  anyOf?: Schema[];
}

interface Row {
  field: string;
  type: string;
  default: string;
  description: string;
}

const GENERATED =
  '<!-- Generated by "pnpm docs:generate" from packages/engine/src/config/schema.ts and the catalog. Do not edit. -->';

/** { file } or { env }: shown as one type. */
function isSecretRef(schema: Schema): boolean {
  const keys = (schema.anyOf ?? []).map((option) => Object.keys(option.properties ?? {}).join());
  return keys.length === 2 && keys.includes('file') && keys.includes('env');
}

/** A field's type, in words. */
export function typeOf(schema: Schema): string {
  if (schema.const !== undefined) return `\`${JSON.stringify(schema.const)}\``;
  if (schema.enum !== undefined) {
    return `one of ${schema.enum.map((value) => `\`${String(value)}\``).join(', ')}`;
  }
  if (isSecretRef(schema)) return 'secret reference';
  const options = (schema.anyOf ?? []).filter((option) => option.type !== 'null');
  if (options.length > 0) return options.map(typeOf).join(' or ');
  const types = Array.isArray(schema.type) ? schema.type : [schema.type ?? 'any'];
  if (types.length > 1) return `${types.slice(0, -1).join(', ')} or ${types.at(-1) ?? ''}`;
  const type = types[0] ?? 'any';
  if (type === 'integer') return integerRange(schema);
  if (type === 'object' && typeof schema.additionalProperties === 'object') {
    return `map of name → ${typeOf(schema.additionalProperties)}`;
  }
  return type;
}

function integerRange({ minimum, maximum }: Schema): string {
  if (minimum !== undefined && maximum !== undefined && maximum < Number.MAX_SAFE_INTEGER) {
    return `integer, ${String(minimum)} to ${String(maximum)}`;
  }
  return minimum === undefined ? 'integer' : `integer, at least ${String(minimum)}`;
}

/** One row per field, and its fields after it. Maps and secret references are one row. */
function rows(schema: Schema, prefix: string): Row[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).flatMap(([name, child]) => {
    const field = prefix === '' ? name : `${prefix}.${name}`;
    const row: Row = {
      field,
      type: typeOf(child),
      default: required.has(name)
        ? 'required'
        : child.default === undefined
          ? ''
          : `\`${JSON.stringify(child.default)}\``,
      description: child.description ?? '',
    };
    return [row, ...rows(child, field)];
  });
}

/** A Markdown table cell: pipes escaped, line breaks flattened. */
export const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');

function table(list: readonly Row[]): string[] {
  return [
    '| Field | Type | Default | Description |',
    '| --- | --- | --- | --- |',
    ...list.map(
      (row) =>
        `| \`${row.field}\` | ${cell(row.type)} | ${cell(row.default)} | ${cell(row.description)} |`,
    ),
  ];
}

/** An app's entry under apps:, without its "or nothing" alternative. */
function entryOf(schema: Schema | undefined): Schema {
  return (schema?.anyOf ?? []).find((option) => option.type === 'object') ?? {};
}

/** docs/reference/stack-yaml.md (spec §9), from the published JSON Schema and the catalog. */
export function renderStackReference(schema: Schema, catalog: Catalog): string {
  const top = Object.fromEntries(
    Object.entries(schema.properties ?? {}).map(([name, child]): [string, Schema] => [
      name,
      // apps gets sections of its own below.
      name === 'apps' ? { ...child, properties: undefined } : child,
    ]),
  );
  const entries = schema.properties?.apps?.properties ?? {};
  const keysOf = (id: string) => Object.keys(entryOf(entries[id]).properties ?? {});
  const shared = catalog
    .map((def) => keysOf(def.id))
    .reduce((common, keys) => common.filter((key) => keys.includes(key)));
  const sharedSchema = entryOf(entries[catalog[0]?.id ?? '']);
  const sharedRows = rows(
    {
      properties: Object.fromEntries(
        shared.map((key): [string, Schema] => [key, sharedSchema.properties?.[key] ?? {}]),
      ),
    },
    'apps.<app>',
  );
  const ownRows = catalog.flatMap((def) => {
    const entry = entryOf(entries[def.id]);
    const own = Object.entries(entry.properties ?? {}).filter(([key]) => !shared.includes(key));
    return rows({ properties: Object.fromEntries(own) }, `apps.${def.id}`);
  });
  return [
    '# `stack.yaml` reference',
    '',
    GENERATED,
    '',
    '`stack.yaml` describes the stack you want, and `mediaplane plan` and `apply` make the host match it. This page lists every field.',
    '',
    `Editors can check the file as you type against its [JSON Schema](stack.schema.json). \`mediaplane init\` writes this first line for you:`,
    '',
    '```yaml',
    `# yaml-language-server: $schema=${schema.$id ?? ''}`,
    '```',
    '',
    'A **secret reference** is `{ file: secrets/<name> }`, a file relative to the Mediaplane home, or `{ env: NAME }`, an environment variable. A secret itself never goes in `stack.yaml` ([ADR 0009](../adr/0009-no-secrets-in-stack-yaml.md)).',
    '',
    '## Fields',
    '',
    ...table(rows({ ...schema, properties: top }, '')),
    '',
    '## Settings every app takes',
    '',
    'Under `apps.<app>`, where `<app>` is one of the apps listed at the end of this page.',
    '',
    ...table(sharedRows),
    '',
    "## One app's own settings",
    '',
    ...table(ownRows),
    '',
    '## Apps',
    '',
    '| App | Id |',
    '| --- | --- |',
    ...catalog.map((def) => `| ${def.name} | \`${def.id}\` |`),
    '',
  ].join('\n');
}
```

`scripts/docs/cli-reference.ts`:

```ts
import {
  createProgram,
  defaultDeps,
  ENVIRONMENT,
  EXIT_CODES,
} from '../../packages/cli/src/run';
import { cell } from './stack-reference';

type Program = ReturnType<typeof createProgram>;

const GENERATED =
  '<!-- Generated by "pnpm docs:generate" from packages/cli/src/run.ts. Do not edit. -->';

/** The CLI as a user sees it, with no environment: so the same on every machine. */
function program(): Program {
  const quiet = { stdout: () => undefined, stderr: () => undefined, env: {} };
  return createProgram(quiet, defaultDeps({}), () => undefined);
}

/** docs/reference/cli.md (spec §9), from the Commander program itself. */
export function renderCliReference(cli: Program = program()): string {
  const help = cli.createHelp();
  const lines = [
    '# CLI reference',
    '',
    GENERATED,
    '',
    'Every command takes `--json` for machine-readable output, and `--help` for this help. `mediaplane --version` prints the version.',
    '',
  ];
  for (const command of help.visibleCommands(cli)) {
    if (command.name() === 'help') continue;
    lines.push(
      `## \`mediaplane ${command.name()}\``,
      '',
      `${command.description()}.`,
      '',
      '```text',
      help.commandUsage(command),
      '```',
      '',
    );
    const args = help.visibleArguments(command);
    if (args.length > 0) {
      lines.push(
        '| Argument | Description |',
        '| --- | --- |',
        ...args.map(
          (arg) => `| \`${help.argumentTerm(arg)}\` | ${cell(help.argumentDescription(arg))} |`,
        ),
        '',
      );
    }
    const options = help.visibleOptions(command).filter((option) => option.long !== '--help');
    lines.push(
      '| Option | Description |',
      '| --- | --- |',
      ...options.map(
        (option) =>
          `| \`${help.optionTerm(option)}\` | ${cell(help.optionDescription(option))} |`,
      ),
      '',
      'Exit codes:',
      '',
      ...(EXIT_CODES[command.name()] ?? []).map((code) => `- ${code}`),
      '',
    );
  }
  lines.push(
    '## Environment variables',
    '',
    '| Variable | Meaning |',
    '| --- | --- |',
    ...ENVIRONMENT.map((variable) => `| \`${variable.name}\` | ${cell(variable.description)} |`),
    '',
  );
  return lines.join('\n');
}
```

Run: `pnpm vitest run scripts/docs`

Expected: PASS.

- [ ] **Step 7: Write the generator, and generate**

`scripts/docs.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalog } from '@mediaplane/catalog';
import { stackJsonSchema } from '@mediaplane/engine';
import { format, resolveConfig } from 'prettier';
import { renderCliReference } from './docs/cli-reference';
import { renderStackReference, type Schema } from './docs/stack-reference';
import { ROOT } from './root';

/** Formatted as Prettier would, so `pnpm lint` and `pnpm docs:check` agree. */
export async function prettify(path: string, content: string): Promise<string> {
  const filepath = join(ROOT, path);
  return format(content, { ...(await resolveConfig(filepath)), filepath });
}

/** Every generated file, by path from the repository root, with its current content. */
export async function generatedFiles(): Promise<{ path: string; content: string }[]> {
  const schema = stackJsonSchema(catalog);
  const published = {
    $comment:
      'Generated by "pnpm docs:generate" from packages/engine/src/config/schema.ts and the catalog. Do not edit.',
    ...schema,
  };
  const files = [
    {
      path: 'docs/reference/stack.schema.json',
      content: `${JSON.stringify(published, null, 2)}\n`,
    },
    {
      path: 'docs/reference/stack-yaml.md',
      content: renderStackReference(schema as Schema, catalog),
    },
    { path: 'docs/reference/cli.md', content: renderCliReference() },
  ];
  return Promise.all(
    files.map(async (file) => ({ path: file.path, content: await prettify(file.path, file.content) })),
  );
}

async function main(check: boolean): Promise<number> {
  const stale: string[] = [];
  for (const { path, content } of await generatedFiles()) {
    const target = join(ROOT, path);
    const current = await readFile(target, 'utf8').catch((cause: unknown) => {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')
        return undefined;
      throw cause;
    });
    if (current === content) continue;
    if (check) {
      stale.push(path);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    console.log(`wrote ${path}`);
  }
  if (stale.length === 0) return 0;
  console.error(
    `These generated files are out of date:\n${stale.map((p) => `  ${p}\n`).join('')}Run "pnpm docs:generate" and commit the result.`,
  );
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.includes('--check'));
}
```

In `package.json`, add to `scripts`, after `"bundle"`:

```json
    "docs:generate": "tsx scripts/docs.ts",
    "docs:check": "tsx scripts/docs.ts --check",
```

Run:

```bash
pnpm --silent docs:generate
pnpm --silent docs:check && echo current
```

Expected:
- **`docs:generate`** prints `wrote docs/reference/stack.schema.json`, then the two
  Markdown files.
- **`docs:check`** prints `current`.

Read the three files. In particular:

- `stack-yaml.md` lists `apps.qbittorrent.vpn`, `apps.seerr.radarr_profile` and
  `apps.seerr.sonarr_profile` under "One app's own settings".
- `cli.md` has no `host-report`.

Then prove the check bites. Change `network`'s description in `schema.ts` to anything
else, and run:

```bash
pnpm --silent docs:check; echo "exit $?"
```

Expected: it names `docs/reference/stack-yaml.md` and `docs/reference/stack.schema.json`,
then prints `exit 1`. Undo the change.

- [ ] **Step 8: Run the check in CI, and record the change**

In `.github/workflows/ci.yml`, in the `check` job, add `- run: pnpm docs:check` after
`- run: pnpm typecheck`.

In `CONTRIBUTING.md`, add a row to the "Everyday commands" table:

```markdown
| `pnpm docs:generate` | Rewrite the generated docs in `docs/reference/` (CI runs `pnpm docs:check`) |
```

and, below the table:

```markdown
After changing `packages/engine/src/config/schema.ts`, a command or option in
`packages/cli/src/run.ts`, or an app in `catalog/`, run `pnpm docs:generate` and commit
what it writes. CI fails while the generated docs are stale.
```

Also change the line that starts "Before committing, run" to:

```markdown
Before committing, run `pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.
```

In `docs/design/m1-engine-cli.md`:

- In §4.2's example, change the first line's URL to
  `https://raw.githubusercontent.com/cyclopsgd/Mediaplane/main/docs/reference/stack.schema.json`.
- Add to the "Slice 2c" list in §11:

  ```markdown
  - **Generated references from S2c.** The `stack.yaml` reference, its JSON Schema at
    `docs/reference/stack.schema.json` (§4.2, §9) and the CLI reference are generated
    from code, and CI fails when they are stale. They move here from S8, by the owner's
    decision. The `--json` shapes stay in S8.
  ```

- [ ] **Step 9: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages catalog scripts docs package.json .github/workflows/ci.yml CONTRIBUTING.md
git commit -m "docs: generate the stack.yaml, JSON Schema and CLI references, and check them in CI"
```

---
### Task 14: A README for every app

Spec §4.3 and §9 ask for a `catalog/<app>/README.md` per app: what Mediaplane manages
there, how to override it, and known issues. Each README has two parts:

- **A generated block.** It is written from `app.ts` by `pnpm docs:generate` and checked
  by `pnpm docs:check`. It holds the image pin, ports, volumes, user, health check,
  secrets, and what the app needs or turns on. These facts change with every pin bump,
  so they are never typed by hand.
- **The hand-written rest**, which says plainly what is not wired yet and which slice
  brings it.

Decision: a generated facts block. The alternative was hand-written facts that point at
`app.ts` for the pin. The cost of this choice is that S8's Renovate pin bumps must also
run `pnpm docs:generate`, and Task 17 records that as an S8 input.

**Files:**
- Create: `scripts/docs/catalog-facts.ts`, `scripts/docs/catalog-facts.test.ts`,
  `catalog/{byparr,flaresolverr,gluetun,jellyfin,plex,prowlarr,qbittorrent,radarr,seerr,sonarr}/README.md`
- Modify:
  - `packages/engine/src/render/compose.ts` (`HEALTHCHECK_DEFAULTS`);
  - `scripts/docs.ts`, `scripts/docs/stack-reference.ts`;
  - `catalog/catalog.test.ts`.

**Interfaces:**
- **Consumes:** Task 13's `generatedFiles` and `prettify`, the catalog, and `AppDefinition`.
- **Produces:**
  - in the engine, `HEALTHCHECK_DEFAULTS = { interval: '30s', timeout: '10s', retries: 5,
    startPeriod: '60s' } as const`;
  - in `scripts/docs/catalog-facts.ts`:
    - `FACTS_START = '<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->'`;
    - `FACTS_END = '<!-- END GENERATED -->'`;
    - `renderFacts(def: AppDefinition): string`;
    - `withFacts(readme: string, def: AppDefinition, path: string): string`.

- [ ] **Step 1: Name the health-check timing once**

In `packages/engine/src/render/compose.ts`, replace `healthcheck()` with:

```ts
/** The timing Mediaplane gives every catalog health check (the app READMEs show it). */
export const HEALTHCHECK_DEFAULTS = {
  interval: '30s',
  timeout: '10s',
  retries: 5,
  startPeriod: '60s',
} as const;

function healthcheck(
  test: string[],
  startPeriod: string = HEALTHCHECK_DEFAULTS.startPeriod,
): ComposeHealthcheck {
  return {
    test,
    interval: HEALTHCHECK_DEFAULTS.interval,
    timeout: HEALTHCHECK_DEFAULTS.timeout,
    retries: HEALTHCHECK_DEFAULTS.retries,
    start_period: startPeriod,
  };
}
```

Run: `pnpm vitest run packages/engine/src/render catalog`

Expected: PASS. The golden files are unchanged.

- [ ] **Step 2: Write the failing tests**

`scripts/docs/catalog-facts.test.ts`:

```ts
import { catalog } from '@mediaplane/catalog';
import type { AppDefinition } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { FACTS_END, FACTS_START, renderFacts, withFacts } from './catalog-facts';

function app(id: string): AppDefinition {
  const def = catalog.find((d) => d.id === id);
  if (def === undefined) throw new Error(`no app ${id}`);
  return def;
}

describe('renderFacts', () => {
  it('shows the pin, ports, volumes, user, health check and secrets', () => {
    const sonarr = app('sonarr');
    const text = renderFacts(sonarr);
    expect(text).toContain(`\`${sonarr.image.repo}:${sonarr.image.tag}\``);
    expect(text).toContain(sonarr.image.digest);
    expect(text).toContain('8989/tcp (web)');
    expect(text).toContain('`<home>/appdata/sonarr` → `/config`');
    expect(text).toContain("the stack's `user:`, through `PUID` and `PGID`");
    expect(text).toContain('`curl -fsS http://localhost:8989/ping`, every 30s');
    expect(text).toContain('`apiKey`: 32 random hex characters');
  });

  it('says when the image fixes its user, and escapes a pipe in a health check', () => {
    const text = renderFacts(app('seerr'));
    expect(text).toContain('uid 1000');
    expect(text).toContain('\\|\\| exit 1');
  });

  it('shows Compose escapes as the shell sees them', () => {
    expect(renderFacts(app('qbittorrent'))).toContain('${WEBUI_PORT}');
    expect(renderFacts(app('qbittorrent'))).not.toContain('$${WEBUI_PORT}');
  });

  it('shows what an app turns on with its default settings', () => {
    expect(renderFacts(app('prowlarr'))).toContain('`byparr`');
    expect(renderFacts(app('qbittorrent'))).toContain('`gluetun`');
  });

  it('describes images with their own health check, or none', () => {
    expect(renderFacts(app('gluetun'))).toContain("| Health check | the image's own |");
    expect(renderFacts(app('flaresolverr'))).toContain('| Health check | none: ');
  });
});

describe('withFacts', () => {
  const readme = `# Sonarr\n\nIntro.\n\n${FACTS_START}\nold\n${FACTS_END}\n\n## Known issues\n`;

  it('replaces only the generated block', () => {
    const out = withFacts(readme, app('sonarr'), 'catalog/sonarr/README.md');
    expect(out.startsWith('# Sonarr\n\nIntro.\n\n')).toBe(true);
    expect(out).not.toContain('\nold\n');
    expect(out.endsWith(`${FACTS_END}\n\n## Known issues\n`)).toBe(true);
  });

  it('refuses a README without the markers', () => {
    expect(() => withFacts('# Sonarr\n', app('sonarr'), 'catalog/sonarr/README.md')).toThrow(
      'catalog/sonarr/README.md needs the lines',
    );
  });
});
```

Add inside the per-app `describe.each` in `catalog/catalog.test.ts`, importing `readFile`
from `node:fs/promises`:

```ts
    it('has a README with a block for the generated facts', async () => {
      const readme = await readFile(new URL(`./${app.id}/README.md`, import.meta.url), 'utf8');
      expect(readme).toContain('<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts.');
      expect(readme).toContain('<!-- END GENERATED -->');
    });
```

Run: `pnpm vitest run scripts/docs catalog`

Expected: FAIL. `./catalog-facts` does not exist, and no app has a README.

- [ ] **Step 3: Write the renderer**

`scripts/docs/catalog-facts.ts`:

```ts
import { HEALTHCHECK_DEFAULTS, type AppDefinition, type SecretSource } from '@mediaplane/engine';

export const FACTS_START =
  '<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->';
export const FACTS_END = '<!-- END GENERATED -->';

const cell = (text: string) => text.replaceAll('|', '\\|');
const code = (text: string) => `\`${text}\``;

function ports(def: AppDefinition): string {
  if (def.ports.length === 0) return 'none';
  return def.ports
    .map((port) => {
      const where =
        port.publish === false
          ? 'inside the stack only'
          : port.hostEqualsContainer === undefined
            ? `published as \`network.bind\` says; \`apps.${def.id}.port\` moves the host port`
            : `published as \`network.bind\` says; \`apps.${def.id}.port\` moves the host and container port together (\`${port.hostEqualsContainer.env}\`)`;
      return `${String(port.container)}/${port.protocol ?? 'tcp'} (${port.name}), ${where}`;
    })
    .join('; ');
}

function volumes(def: AppDefinition): string {
  const { appdata, data } = def.volumes;
  const list = [
    ...(appdata === undefined ? [] : [`${code(`<home>/appdata/${def.id}`)} → ${code(appdata)}`]),
    ...(data === undefined ? [] : [`the data folder (\`paths.data\`) → ${code(data)}`]),
  ];
  return list.length === 0 ? 'none' : list.join('; ');
}

function runsAs(def: AppDefinition): string {
  switch (def.runAs) {
    case 'puid-env':
      return "the stack's `user:`, through `PUID` and `PGID`";
    case 'user-directive':
      return "the stack's `user:`, through Compose's `user:`";
    case 'image-default':
      return "the image's own user";
    default: {
      const uid = def.runAs.slice('fixed:'.length);
      return `uid ${uid}, fixed by the image. Mediaplane gives \`appdata/${def.id}\` to ${uid}:${uid} before the app starts`;
    }
  }
}

function health(def: AppDefinition): string {
  if (def.health === 'none') return 'none: `up --wait` waits only for it to be running';
  if (def.health === 'image') return "the image's own";
  const { interval, timeout, retries } = HEALTHCHECK_DEFAULTS;
  const start = def.health.startPeriod ?? HEALTHCHECK_DEFAULTS.startPeriod;
  // Compose reads $$ as a literal $; show the command as the shell runs it.
  const test = def.health.test.slice(1).join(' ').replaceAll('$$', '$');
  return `${code(test)}, every ${interval} (timeout ${timeout}, ${String(retries)} retries, ${start} to start)`;
}

function secret(source: SecretSource): string {
  if ('generate' in source) {
    return source.generate === 'hex32'
      ? '32 random hex characters, generated once and kept in `state/secrets.json`'
      : '`qbt_` and 28 random letters and digits, generated once and kept in `state/secrets.json`';
  }
  if ('createdBy' in source) return 'created by the app during its first-run setup';
  return `yours, from \`${source.userProvided}\` in \`stack.yaml\``;
}

function secrets(def: AppDefinition): string {
  const list = Object.entries(def.secrets)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, source]) => `${code(name)}: ${secret(source)}`);
  return list.length === 0 ? 'none' : list.join('; ');
}

function turnsOn(def: AppDefinition): string {
  const parsed = def.options?.safeParse({});
  const implied = def.implies?.(parsed?.success === true ? parsed.data : {}) ?? [];
  return implied.length === 0
    ? 'nothing'
    : `${implied.map(code).join(', ')}, with the default settings`;
}

const list = (values: readonly string[]) =>
  values.length === 0 ? 'nothing' : values.map(code).join(', ');

/** The facts table for one app, from its app.ts. */
export function renderFacts(def: AppDefinition): string {
  const rows: [string, string][] = [
    ['Image', code(`${def.image.repo}:${def.image.tag}`)],
    ['Digest', code(def.image.digest)],
    ['Architectures', def.arch.join(', ')],
    ['Ports', ports(def)],
    ['Volumes', volumes(def)],
    ['Runs as', runsAs(def)],
    ['Health check', health(def)],
    ['Secrets', secrets(def)],
    ['Needs', list(def.requires.map((r) => r.capability))],
    ['Provides', list(def.provides)],
    ['Also turns on', turnsOn(def)],
  ];
  return [
    FACTS_START,
    '',
    '## What Mediaplane sets',
    '',
    '| Setting | Value |',
    '| --- | --- |',
    ...rows.map(([name, value]) => `| ${name} | ${cell(value)} |`),
    '',
    FACTS_END,
  ].join('\n');
}

/** `readme`, with its generated block replaced by the facts for `def`. */
export function withFacts(readme: string, def: AppDefinition, path: string): string {
  const start = readme.indexOf(FACTS_START);
  const end = readme.indexOf(FACTS_END);
  if (start < 0 || end < start) {
    throw new Error(
      `${path} needs the lines ${FACTS_START} and ${FACTS_END}, where the generated facts go`,
    );
  }
  return `${readme.slice(0, start)}${renderFacts(def)}${readme.slice(end + FACTS_END.length)}`;
}
```

In `scripts/docs.ts`:

1. Add `import { withFacts } from './docs/catalog-facts';`.
2. In `generatedFiles`, type the list as
   `const files: { path: string; content: string }[] = [ … ];`.
3. Add, before the `return`:

```ts
  for (const def of catalog) {
    const path = `catalog/${def.id}/README.md`;
    files.push({ path, content: withFacts(await readFile(join(ROOT, path), 'utf8'), def, path) });
  }
```

In `scripts/docs/stack-reference.ts`, make the "Apps" table link each app's README.
Replace ``...catalog.map((def) => `| ${def.name} | \`${def.id}\` |`),`` with:

```ts
    ...catalog.map(
      (def) => `| [${def.name}](../../catalog/${def.id}/README.md) | \`${def.id}\` |`,
    ),
```

- [ ] **Step 4: Write the READMEs**

Each file starts with the two marker lines, empty between them. `pnpm docs:generate` fills
them in at Step 5.

`catalog/sonarr/README.md`:

````markdown
# Sonarr

Sonarr follows TV series. It finds new episodes through Prowlarr's indexers, sends them
to the download client, and files them in your library. Mediaplane runs the upstream
LinuxServer.io image, unmodified.

<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->
<!-- END GENERATED -->

## What Mediaplane does today

- **Its API key.** Generated once, and passed in `SONARR__AUTH__APIKEY`.
- **Its login.** `SONARR__AUTH__METHOD` is `Forms`. `SONARR__AUTH__REQUIRED` is
  `Enabled`, or `DisabledForLocalAddresses` when `security.login_on_lan` is `false`. In
  that case `SONARR__SERVER__TRUSTEDNETWORKS` also lists your LAN subnet, when it is
  known.
- **Its web UI,** published as `network.bind` says.

## Not built yet

The wiring arrives in Slices 3 to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):

- **Slice 3:**
  - the key written into `config.xml` before first start;
  - the shared admin login;
  - qBittorrent as its download client;
  - the `/data/media/tv` root folder.
- **Slice 5:** Prowlarr's link to it.
- **Slice 6:** the media server connection that refreshes your library on import.
- **Slice 7:** Seerr's link to it.

## Changing it

- **In `stack.yaml`,** under `apps.sonarr`, you can set `port`, `version`, `env` and
  `enabled: false`. A different `version` is an untested combination, and `plan` warns
  about it. See the [`stack.yaml` reference](../../docs/reference/stack-yaml.md).
- **Anything else** goes in `compose.override.yaml` in the Mediaplane home. Compose merges
  it over the generated file, and `plan` shows what it changes. For example, a second
  folder for an archive:

  ```yaml
  services:
    sonarr:
      volumes:
        - /srv/archive/tv:/archive/tv
  ```

  Don't override the variables listed above: Mediaplane relies on them.

## Known issues

- **The first visitor sets the login.** Until Slice 3 sets up the admin login, whoever
  opens Sonarr first is asked to choose a user name and password. Keep
  `network.bind: localhost` until then.
````

`catalog/radarr/README.md`:

````markdown
# Radarr

Radarr follows films. It finds releases through Prowlarr's indexers, sends them to the
download client, and files them in your library. Mediaplane runs the upstream
LinuxServer.io image, unmodified.

<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->
<!-- END GENERATED -->

## What Mediaplane does today

- **Its API key.** Generated once, and passed in `RADARR__AUTH__APIKEY`.
- **Its login.** `RADARR__AUTH__METHOD` is `Forms`. `RADARR__AUTH__REQUIRED` is
  `Enabled`, or `DisabledForLocalAddresses` when `security.login_on_lan` is `false`. In
  that case `RADARR__SERVER__TRUSTEDNETWORKS` also lists your LAN subnet, when it is
  known.
- **Its web UI,** published as `network.bind` says.

## Not built yet

The wiring arrives in Slices 3 to 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):

- **Slice 3:**
  - the key written into `config.xml` before first start;
  - the shared admin login;
  - qBittorrent as its download client;
  - the `/data/media/movies` root folder.
- **Slice 5:** Prowlarr's link to it.
- **Slice 6:** the media server connection that refreshes your library on import.
- **Slice 7:** Seerr's link to it.

## Changing it

- **In `stack.yaml`,** under `apps.radarr`, you can set `port`, `version`, `env` and
  `enabled: false`. A different `version` is an untested combination, and `plan` warns
  about it. See the [`stack.yaml` reference](../../docs/reference/stack-yaml.md).
- **Anything else** goes in `compose.override.yaml` in the Mediaplane home. Compose merges
  it over the generated file, and `plan` shows what it changes. For example, more logging:

  ```yaml
  services:
    radarr:
      environment:
        RADARR__LOG__LEVEL: debug
  ```

  Don't override the variables listed above: Mediaplane relies on them.

## Known issues

- **The first visitor sets the login.** Until Slice 3 sets up the admin login, whoever
  opens Radarr first is asked to choose a user name and password. Keep
  `network.bind: localhost` until then.
````

`catalog/prowlarr/README.md`:

````markdown
# Prowlarr

Prowlarr manages your indexers in one place and syncs them to Sonarr and Radarr.
Mediaplane runs the upstream LinuxServer.io image, unmodified. Prowlarr has no data
folder: it only searches.

<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->
<!-- END GENERATED -->

## What Mediaplane does today

- **Its API key.** Generated once, and passed in `PROWLARR__AUTH__APIKEY`.
- **Its login.** `PROWLARR__AUTH__METHOD` is `Forms`. `PROWLARR__AUTH__REQUIRED` is
  `Enabled`, or `DisabledForLocalAddresses` when `security.login_on_lan` is `false`.
- **Byparr.** Listing Prowlarr also turns on Byparr, the Cloudflare challenge solver,
  unless you list FlareSolverr instead or set `byparr: { enabled: false }`.
- **Its web UI,** published as `network.bind` says.

## What stays yours

Mediaplane never adds indexers. You add them once in Prowlarr, and from Slice 5 they sync
to Sonarr and Radarr.

## Not built yet

- **Slice 3:**
  - the key written into `config.xml` before first start;
  - the shared admin login.
- **Slice 5:**
  - the links to Sonarr and Radarr, with full sync;
  - Byparr registered as Prowlarr's indexer proxy, with the tag `cloudflare`. Tag your
    Cloudflare-protected indexers `cloudflare` to route them through it.

See the [roadmap](../../docs/plans/m1-roadmap.md).

## Changing it

- **In `stack.yaml`,** under `apps.prowlarr`, you can set `port`, `version`, `env` and
  `enabled: false`. See the [`stack.yaml` reference](../../docs/reference/stack-yaml.md).
- **Anything else** goes in `compose.override.yaml` in the Mediaplane home:

  ```yaml
  services:
    prowlarr:
      environment:
        PROWLARR__LOG__LEVEL: debug
  ```

## Known issues

- **The first visitor sets the login.** Until Slice 3 sets up the admin login, whoever
  opens Prowlarr first is asked to choose a user name and password. Keep
  `network.bind: localhost` until then.
````

`catalog/qbittorrent/README.md`:

````markdown
# qBittorrent

qBittorrent is the download client. Mediaplane runs the upstream LinuxServer.io image,
unmodified, and by default puts it behind Gluetun's VPN.

<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->
<!-- END GENERATED -->

## What Mediaplane does today

- **Behind the VPN** (`apps.qbittorrent.vpn: true`, the default):
  - qBittorrent uses Gluetun's network (`network_mode: service:gluetun`), so it has no
    route out when the VPN is down;
  - it starts only once Gluetun is healthy, and restarts when Gluetun is recreated;
  - its web UI is published on Gluetun's service;
  - `stack.yaml` needs a `vpn:` block.
- **Without the VPN** (`vpn: false`), it has its own network, and `plan` warns every time.
- **One port, inside and out.** qBittorrent checks the `Host` header, so the published
  port and its own port must match. `apps.qbittorrent.port` changes both, through
  `WEBUI_PORT`.
- **Its API key.** It is generated once and kept in `state/secrets.json`. It is not
  applied yet (see below).

## Not built yet

- **Slice 3:**
  - `qBittorrent.conf` written before first start, with the API key, the shared admin
    login and your LAN settings;
  - the `tv` and `movies` categories, and save paths under `/data/torrents/`;
  - the automated kill-switch test, and `mediaplane vpn-check`.

See the [roadmap](../../docs/plans/m1-roadmap.md).

## Changing it

- **In `stack.yaml`,** under `apps.qbittorrent`, you can set `vpn`, `port`, `version`,
  `env` and `enabled: false`. See the
  [`stack.yaml` reference](../../docs/reference/stack-yaml.md).
- **Anything else** goes in `compose.override.yaml`. Behind the VPN, network settings
  belong on `gluetun`, not here.

## Known issues

- **The first login.** Until Slice 3 writes the shared admin login, the image prints a
  temporary password for the `admin` user in qBittorrent's log on first start. Read it
  with `docker compose -p mediaplane logs qbittorrent`.
````

`catalog/gluetun/README.md`:

````markdown
# Gluetun

Gluetun is the VPN client that qBittorrent's traffic goes through. Mediaplane runs the
upstream image, unmodified. It is turned on whenever `apps.qbittorrent.vpn` is `true`,
which is the default.

<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->
<!-- END GENERATED -->

## What Mediaplane does today

- **The VPN, from `stack.yaml`'s `vpn:` block:**
  - `VPN_SERVICE_PROVIDER` is `vpn.provider`, and `VPN_TYPE` is `wireguard`;
  - `WIREGUARD_PRIVATE_KEY` comes from `vpn.private_key`, through `generated/.env`, so it
    never appears in `compose.yaml`;
  - `WIREGUARD_ADDRESSES` is `vpn.addresses`, when you set it.
- **Your LAN.** `FIREWALL_OUTBOUND_SUBNETS` lists your LAN subnet, so your own network can
  reach qBittorrent's web UI.
- **What it needs from the host.** It gets `NET_ADMIN` and `/dev/net/tun`, and `plan`
  fails early when `/dev/net/tun` is missing.
- **Its control server** (port 8000) is never published. Apps in its network must not
  use port 8000.

## Not built yet

- **Slice 3:** the automated kill-switch test, against a local WireGuard server, and
  `mediaplane vpn-check`, which compares qBittorrent's public address with the host's.

See the [roadmap](../../docs/plans/m1-roadmap.md).

## Changing it

Any other Gluetun setting goes in `apps.gluetun.env`, and secrets go in as references:

```yaml
apps:
  gluetun:
    env:
      SERVER_COUNTRIES: Netherlands
      WIREGUARD_PRESHARED_KEY: { file: secrets/wg-psk }
```

## Known issues

- **A wrong key never connects.** Gluetun's health check needs a working tunnel. With a
  wrong or fake key it never becomes healthy, and `apply` waits up to ten minutes, then
  fails.
- **The LAN subnet is set even with `bind: localhost`.** Slice 3 limits it to stacks that
  publish on the LAN.
````

`catalog/jellyfin/README.md`:

````markdown
# Jellyfin

Jellyfin is one of the two media servers; Plex is the other. Mediaplane runs the
upstream LinuxServer.io image, unmodified, when `media_server` is `jellyfin`.

<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->
<!-- END GENERATED -->

## What Mediaplane does today

- **It runs Jellyfin** with your data folder at `/data`, and publishes its web UI as
  `network.bind` says.
- **It waits up to two minutes** for Jellyfin's first start before the health check
  counts.

## Not built yet

- **Slice 6:**
  - first-run setup through Jellyfin's own API, with no port published until it is done;
  - its API key, stored in `state/secrets.json`;
  - the Movies and Shows libraries;
  - the connections from Sonarr and Radarr.

See the [roadmap](../../docs/plans/m1-roadmap.md).

## Changing it

- **In `stack.yaml`,** under `apps.jellyfin`, you can set `port`, `version` and `env`.
- **Anything else** goes in `compose.override.yaml`. For example, hardware transcoding
  needs the GPU device:

  ```yaml
  services:
    jellyfin:
      devices:
        - /dev/dri:/dev/dri
  ```

## Known issues

- **The setup wizard is open.** Until Slice 6, Jellyfin's first-run wizard is open to
  whoever reaches its port first. Keep `network.bind: localhost`, and finish the wizard
  yourself.
````

`catalog/plex/README.md`:

````markdown
# Plex

Plex is one of the two media servers; Jellyfin is the other. Mediaplane runs the upstream
LinuxServer.io image, unmodified, when `media_server` is `plex`.

<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->
<!-- END GENERATED -->

## What Mediaplane does today

- **It runs Plex** with your data folder at `/data`, and publishes its web UI as
  `network.bind` says.
- **`VERSION=docker`** keeps the Plex version the image ships, so Plex changes only when
  the pinned image does.
- **Your token.** `plan` checks that `plex.token` points at a secret that exists, but the
  token is not used yet.

## Not built yet

- **Slice 6:**
  - `mediaplane plex-login`, which signs in through plex.tv and saves your token;
  - claiming the server with it on first start;
  - the Movies and TV Shows libraries;
  - the connections from Sonarr and Radarr.

See the [roadmap](../../docs/plans/m1-roadmap.md).

## Changing it

- **In `stack.yaml`,** under `apps.plex`, you can set `port`, `version` and `env`.
- **Anything else** goes in `compose.override.yaml`.

## Known issues

- **Plex starts unclaimed.** Until Slice 6 claims it for you, you can claim it yourself.
  Get a claim token at `https://plex.tv/claim`. It is valid for four minutes, so save it
  to `secrets/plex-claim` in the home and run `mediaplane apply` straight away, with:

  ```yaml
  apps:
    plex:
      env:
        PLEX_CLAIM: { file: secrets/plex-claim }
  ```

  Remove the line afterwards. `plan` shows Plex being recreated when you do.
````

`catalog/seerr/README.md`:

````markdown
# Seerr

Seerr is where people ask for films and series. It passes their requests to Sonarr and
Radarr. Mediaplane runs the upstream image, unmodified (see
[ADR 0006](../../docs/adr/0006-seerr-as-the-requests-app.md)).

<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->
<!-- END GENERATED -->

## What Mediaplane does today

- **Its API key.** Generated once, and passed in `API_KEY`. It does nothing until Seerr
  has its first user.
- **Its user.** Seerr's image always runs as uid 1000. So before it starts, Mediaplane
  gives `appdata/seerr` to 1000:1000, with a throwaway container of Seerr's own image.
- **`init: true`,** so Seerr shuts down cleanly when it is stopped.
- **Its web UI,** published as `network.bind` says.

## Not built yet

- **Slice 7:**
  - Seerr's first sign-in, as the Jellyfin admin or with your Plex token;
  - its links to the media server, Sonarr and Radarr;
  - `apps.seerr.sonarr_profile` and `radarr_profile`, which choose the quality profiles
    it requests with.

See the [roadmap](../../docs/plans/m1-roadmap.md).

## Changing it

- **In `stack.yaml`,** under `apps.seerr`, you can set `port`, `version`, `env` and
  `enabled: false`.
- **Anything else** goes in `compose.override.yaml`.

## Known issues

- **Setup is open.** Until Slice 7, Seerr's setup page is open to whoever reaches it
  first. Keep `network.bind: localhost`.
- **Removing it needs `sudo`.** `appdata/seerr` belongs to uid 1000, so deleting it needs
  `sudo`, or that user.
- **One kind of media server.** Seerr works with one kind of media server at a time.
  Switching `media_server` later means setting Seerr up again.
````

`catalog/byparr/README.md`:

````markdown
# Byparr

Byparr solves Cloudflare challenges for Prowlarr's indexers. Mediaplane runs the upstream
image, unmodified. Listing Prowlarr turns it on.

<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->
<!-- END GENERATED -->

## What Mediaplane does today

- **It runs Byparr** inside the stack only. Its port is never published.
- **Its own health check.** Mediaplane checks it every 30 seconds. The image's built-in
  check runs only every 15 minutes, and its first run comes before the server listens, so
  `apply` would otherwise wait a quarter of an hour.

## Not built yet

- **Slice 5:** registering Byparr as Prowlarr's indexer proxy, with the tag `cloudflare`.

See the [roadmap](../../docs/plans/m1-roadmap.md).

## Changing it

- **To use FlareSolverr instead,** list `flaresolverr: {}`. Prowlarr then doesn't turn
  Byparr on.
- **To run without a solver,** set `byparr: { enabled: false }`.
- **Anything else** goes in `compose.override.yaml`.

## Known issues

- **arm64 is lightly tested upstream.** Mediaplane's own end-to-end tests run it on arm64.
  FlareSolverr is a drop-in alternative.
````

`catalog/flaresolverr/README.md`:

````markdown
# FlareSolverr

FlareSolverr is the alternative to Byparr for solving Cloudflare challenges for
Prowlarr's indexers. Mediaplane runs the upstream image, unmodified, when you list
`flaresolverr: {}`. Prowlarr then doesn't turn Byparr on.

<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->
<!-- END GENERATED -->

## What Mediaplane does today

- **It runs FlareSolverr** inside the stack only. Its port is never published.
- **`LOG_LEVEL=info`.**
- **No health check.** `apply` waits only for it to be running.

## Not built yet

- **Slice 5:** registering FlareSolverr as Prowlarr's indexer proxy, with the tag
  `cloudflare`.

See the [roadmap](../../docs/plans/m1-roadmap.md).

## Changing it

- **In `stack.yaml`,** under `apps.flaresolverr`, you can set `version`, `env` and
  `enabled: false`.
- **Anything else** goes in `compose.override.yaml`.
````

- [ ] **Step 5: Generate the facts, and check them**

```bash
pnpm --silent docs:generate
pnpm vitest run scripts/docs catalog
pnpm --silent docs:check && echo current
```

Expected:
- **`docs:generate`** writes the ten READMEs and `docs/reference/stack-yaml.md`, which now
  links them.
- **The tests** pass.
- **`docs:check`** prints `current`.

Open `catalog/seerr/README.md` and check that the facts table shows `uid 1000` and its
health check renders as one table cell.

Check every hand-written claim against `app.ts` and the code. Each README must say only
what the code does today. Anything not built must name its slice.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add catalog scripts packages/engine/src/render docs/reference
git commit -m "docs(catalog): a README for every app, with facts generated from app.ts"
```

---
### Task 15: `docs/architecture.md`

Spec §9 asks for a condensed version of §3 to §6, with diagrams. This page covers only
what is built, up to and including this slice, and points at the design for the rest.

**Files:**
- Create: `docs/architecture.md`

**Interfaces:**
- **Consumes:** the code as it is now.
- **Produces:** the page Task 17's README section links to.

- [ ] **Step 1: Write the page**

`docs/architecture.md`:

````markdown
# Architecture

This page is a condensed version of the [M1 design](design/m1-engine-cli.md), §3 to §6,
covering what is built so far (Slices 1 to 2c). The design describes the whole of M1;
this page describes what exists.

## The idea

You describe the stack you want in one file, `stack.yaml`. Mediaplane then works like
`terraform plan` and `apply`:

- `plan` works out what would change, and touches nothing;
- `apply` makes those changes, then plans again to check that nothing is left.

What it writes is an ordinary Docker Compose project, which runs without Mediaplane.

## What runs where

```text
host (Docker)
│
├─ mediaplane-system
│  ├─ mediaplane
│  │    the CLI, idle until
│  │    you run a command
│  └─ socket-proxy
│       the only container
│       with Docker's socket
│
├─ mediaplane
│    your stack: Sonarr,
│    Radarr, Jellyfin, …
│
└─ host helper
     a second or two per
     plan, on the host
     network
```

- **`mediaplane-system`** is Mediaplane's own Compose project. Apply never manages it,
  and the runtime refuses to. [`deploy/README.md`](../deploy/README.md) shows how to start
  it.
- **The Mediaplane container** has a read-only root and no capabilities, and runs as the
  user who owns the home. Its only mount is the home, at the same path as on the host,
  because the host's Docker resolves every path in `compose.yaml`.
- **The socket proxy** forwards only the Docker API calls the engine makes
  ([ADR 0008](adr/0008-docker-socket-proxy-on-by-default.md)).
- **The host helper.** From inside a container, the host's network, free ports and
  folders outside the home are out of sight. So during `plan` and `apply`, Mediaplane
  runs a throwaway container of its own image on the host network, with read-only
  mounts. It reads them there, and reports back as JSON.
- **Running from source** (`pnpm mediaplane`, for development), there is no container. The
  CLI runs under Node on the host, and looks at the host itself.

## The engine

| Part | What it does | Code |
|---|---|---|
| config | Loads `stack.yaml` and validates it with Zod. Secrets are references to files or environment variables, never values (ADR 0009) | `packages/engine/src/config` |
| catalog | One typed definition per app, pinned by tag and digest | `catalog/<app>/app.ts` |
| resolver | Turns the config and catalog into the apps to run: dependencies, architecture, ports, bind addresses | `packages/engine/src/resolver` |
| renderer | Writes `compose.yaml` and `.env`, the same bytes for the same input | `packages/engine/src/render` |
| secrets | Generates each key once, and keeps it in `state/secrets.json` | `packages/engine/src/secrets` |
| runtime | The only code that runs `docker` | `packages/engine/src/runtime` |
| preflight | Checks the host before anything changes, through the host helper when inside the container | `packages/engine/src/preflight`, `host` |
| planner | Diffs the files, the containers and the keys | `packages/engine/src/plan` |
| apply | Runs the steps below, converging forward (ADR 0004) | `packages/engine/src/apply` |
| history | Writes one change record per apply | `packages/engine/src/history` |
| CLI | Commands, human and `--json` output, exit codes ([reference](reference/cli.md)) | `packages/cli` |

Not built yet:

- the integrations, which wire the apps together through their APIs (Slices 3 to 7);
- drift detection, with Keep mine (Slice 4).

## `plan`

```text
stack.yaml + secrets/
  │ load, validate
  ▼
resolve
  │ catalog, host facts,
  │ ports, addresses
  ▼
ask Docker
  │ versions, what runs
  ▼
preflight
  │ disk, data folder,
  │ devices, ports, home
  ▼
render
  │ compose.yaml, .env
  ▼
diff
  files, containers,
  keys to generate
```

`plan` writes nothing. Its exit code is 0 when nothing would change, 2 when something
would, and 1 on an error.

**Which containers change** comes from Compose itself
([ADR 0010](adr/0010-predict-container-changes-with-compose-hashes.md)):

- `plan` pipes the unwritten `compose.yaml` into `docker compose config --hash`;
- it compares each service's hash with the label on the running container.

## `apply`

```text
lock
 → plan, then ask
 → generate keys
 → write files
 → pull images
 → set appdata owners
 → up --wait
 → plan again
 → write change record
 → unlock
```

- **Converge forward** ([ADR 0004](adr/0004-converge-forward-apply.md)). When a step
  fails, the later ones are skipped and nothing is rolled back. Running `apply` again
  plans afresh, and does only what is left.
- **Pulls come first.** Images are pulled before anything stops, so a network failure
  leaves the running stack alone.
- **Keys are saved before any container starts.**
- **The lock** records the process and the host name. That is why the Mediaplane
  container's host name is fixed: a recreated container can still clear a lock its
  predecessor left.

## The home

```text
/opt/mediaplane/
├─ stack.yaml        yours
├─ compose.override.yaml
│                    yours
├─ secrets/          yours
├─ generated/        rewritten
│  ├─ compose.yaml
│  ├─ compose.prev.yaml
│  └─ .env           0600
├─ state/            0700
│  ├─ secrets.json   0600
│  ├─ history/
│  └─ lock
└─ appdata/<app>/    the apps'
```

- **`stack.yaml`** is the only file you normally edit
  ([reference](reference/stack-yaml.md)).
- **`compose.override.yaml`** is yours. Mediaplane never writes it. Compose merges it
  over the generated file, and `plan` includes it.
- **`generated/`** is rewritten on every apply. The header of `compose.yaml` gives the
  exact `docker compose` command that runs the stack without Mediaplane.
- **The home's filesystem must support hard links,** because the lock and `init`'s
  `stack.yaml` are created with one.

The data folder (`paths.data`) is yours, and every app mounts it as `/data`. Keep
downloads and media inside it, on one filesystem, so moving a finished download into the
library is an instant hardlink. `plan` checks that `torrents/`, `usenet/` and `media/`,
where they exist, are on the same filesystem as the folder itself.

## Security

Controlling Docker is root on the host, so Mediaplane's security is the host's. The
[threat model](security/threat-model.md) lists what is protected, how, and what isn't.

## What comes next

The [roadmap](plans/m1-roadmap.md) has the order:

- the wiring, app by app (Slices 3 to 7);
- drift detection (Slice 4);
- releases (Slice 8);
- the web panel (M2).
````

- [ ] **Step 2: Check the diagrams' width**

```bash
node -e 'for (const f of process.argv.slice(1)) { let on = false; require("fs").readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (l.startsWith("```")) { on = l === "```text"; return; } if (on && [...l].length > 40) console.log(`${f}:${i + 1}: ${[...l].length}`); }); }' docs/architecture.md deploy/README.md docs/security/threat-model.md
```

Expected: no output. Every line in a `text` block is 40 characters or fewer.

- [ ] **Step 3: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add docs/architecture.md
git commit -m "docs: add the architecture overview"
```

---

### Task 16: The "app won't start" runbook and ADR 0006

The runbook uses the spec's format (§9): symptoms, checks, fix, prevention. It is built
from apply's real diagnostics and `status`. The roadmap planned this runbook for S6; it
comes now because `apply` and `status` exist. ADR 0006 records a decision the spec has
already made, with the spec's reasons.

**Files:**
- Create: `docs/runbooks/app-wont-start.md`, `docs/adr/0006-seerr-as-the-requests-app.md`

**Interfaces:**
- **Consumes:**
  - the diagnostic codes `apply.start-failed`, `apply.pull-failed`,
    `apply.ownership-failed`, `preflight.port-in-use` and `compose.invalid`;
  - apply's summary line;
  - `status`'s columns;
  - `DEFAULT_WAIT_SECONDS` (600).
- **Produces:** the runbook and ADR that Task 17 links.

- [ ] **Step 1: Write the runbook**

`docs/runbooks/app-wont-start.md`:

````markdown
# Runbook: an app won't start

## Symptoms

- **`mediaplane apply` stops at the containers step:**

  ```console
    failed  containers
  error: these apps did not start healthy: sonarr (unhealthy). Compose said: …
    hint: run "mediaplane status" to see each app, fix the cause, then run apply again

  Apply failed: 4 done, 1 failed, 1 skipped. Run apply again to retry.
  ```

  The skipped step is `verify`.
- **`mediaplane status`** shows the app as `exited` or `restarting`, or its HEALTH as
  `unhealthy` or `starting`.
- **`mediaplane plan`** exits 2 and lists it under `Not healthy yet:`.
- **`apply` fails earlier,** at `images` (`apply.pull-failed`) or at `appdata ownership`
  (`apply.ownership-failed`).

## Checks

1. **Which app, and in what state:** `mediaplane status`, or `mediaplane status --json`.
2. **Its log:** `docker compose -p mediaplane logs --tail 100 <app>`.
3. **Its health check's last answers:**
   `docker inspect --format '{{json .State.Health}}' mediaplane-<app>-1`.
4. **Whether `plan` sees a problem:** run `mediaplane plan` and read every error and
   warning.
5. **Whether it sits behind Gluetun.** qBittorrent starts only once Gluetun is healthy, so
   look at Gluetun first.

## Fix

| Cause | Fix |
|---|---|
| Gluetun never becomes healthy | Its health check needs a working tunnel. Check `secrets/wg.key`, `vpn.provider` and `vpn.addresses`, and read Gluetun's log for the VPN's own error. A fake key never connects |
| The port is taken | `plan` reports `preflight.port-in-use`. Stop whatever holds it, or set `apps.<app>.port` |
| The app can't write its folders | The data folder must be writable by `stack.yaml`'s `user:`. LinuxServer.io images fix their own `appdata` folder; Seerr gets 1000:1000 from apply's ownership step |
| A slow first start | Jellyfin and Plex get 120 seconds before a failed check counts, and `apply` waits up to 10 minutes in all. Run `apply` again: it waits again |
| The image could not be pulled | `apply.pull-failed`. Nothing was stopped, so the old stack still runs. Check the network and the registry, then run `apply` again |
| `compose.override.yaml` broke it | `plan` reports `compose.invalid` when Compose rejects the file. Otherwise, take the change out and run `apply` again |
| A `version:` you chose | It is an untested combination, and `plan` warns about it. Remove it to go back to the tested image |

Then run `mediaplane apply`. It plans again and does only what is left
([ADR 0004](../adr/0004-converge-forward-apply.md)).

## Prevention

- **Run `mediaplane plan` first,** and fix every error it reports.
- **Keep the tested versions:** leave out `version:`.
- **Leave room on the disk.** `plan` warns below 10 GiB free, and stops below 2 GiB.
- **Never edit `generated/compose.yaml`;** put changes in `compose.override.yaml`.
````

- [ ] **Step 2: Write ADR 0006**

`docs/adr/0006-seerr-as-the-requests-app.md`:

```markdown
# 0006. Seerr as the requests app

- **Status:** Accepted
- **Date:** 2026-10-09. Decided in the M1 design (2026-10-08), and recorded here.

## Context

A media stack needs somewhere for people to ask for films and series, and those requests
must reach Sonarr and Radarr. Two principles shape the choice:

- **Jellyfin and Plex are equal choices** (spec §1.3).
- **Every app is set up headlessly, through its own API,** with no forks (spec §1.4).

So the requests app must work with either media server, and be configurable end to end
through its API.

## Decision

Seerr, version 3.5 or later, is M1's requests app (spec §2.1, §6.1, §6.5):

- **It works with both media servers.** Mediaplane signs in to it as the Jellyfin admin it
  created (`POST /api/v1/auth/jellyfin`), or with the user's Plex token
  (`POST /api/v1/auth/plex`).
- **Its settings API covers the wiring:**
  - the media server, and its libraries;
  - Sonarr and Radarr, each with a default profile and root folder;
  - `POST /api/v1/settings/initialize`, which finishes setup.
- **Its API key can be chosen in advance,** through `API_KEY`.
- **One Seerr instance, bound to `media_server`.**

## Consequences

- **One kind of media server per instance.** Switching `media_server` later means setting
  Seerr up again (spec §10).
- **Pinned, with a version floor.** Seerr's settings and library API changed by 3.5, so it
  stays pinned at 3.5 or later, and every bump runs the end-to-end suite.
- **The key does nothing until a first user exists.** So the wiring (Slice 7) starts with
  that first sign-in.
- **A fixed uid.** Seerr's image runs as uid 1000, so Mediaplane gives its appdata folder
  to 1000:1000 before it starts (Slice 2b).
- **One API quirk to respect.** Once the media server is configured, its `hostname` is
  never sent again, because Seerr answers 500.
```

- [ ] **Step 3: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add docs/runbooks docs/adr/0006-seerr-as-the-requests-app.md
git commit -m "docs: add the \"app won't start\" runbook and ADR 0006"
```

---

### Task 17: README and roadmap: link the docs

**Files:**
- Modify: `README.md`, `docs/plans/m1-roadmap.md`

**Interfaces:**
- **Consumes:** every document from Tasks 12 to 16.
- **Produces:** a single index of the docs, and a roadmap that records this slice's
  decisions and its inputs for later slices.

- [ ] **Step 1: A Documentation section in the README**

In `README.md`, replace the whole `## Design` section with:

```markdown
## Documentation

| Document | What it covers |
| --- | --- |
| [Running in a container](deploy/README.md) | Install, update, and run without the socket proxy |
| [Architecture](docs/architecture.md) | How the pieces fit, as built so far |
| [`stack.yaml` reference](docs/reference/stack-yaml.md) | Every field, generated from the schema, with its [JSON Schema](docs/reference/stack.schema.json) |
| [CLI reference](docs/reference/cli.md) | Every command, option and exit code, generated from the CLI |
| The apps | One README each: what Mediaplane sets, how to change it, known issues. See [Sonarr](catalog/sonarr/README.md), [Radarr](catalog/radarr/README.md), [Prowlarr](catalog/prowlarr/README.md), [qBittorrent](catalog/qbittorrent/README.md), [Gluetun](catalog/gluetun/README.md), [Jellyfin](catalog/jellyfin/README.md), [Plex](catalog/plex/README.md), [Seerr](catalog/seerr/README.md), [Byparr](catalog/byparr/README.md) and [FlareSolverr](catalog/flaresolverr/README.md) |
| [Runbook: an app won't start](docs/runbooks/app-wont-start.md) | Symptoms, checks, fix and prevention |
| [Threat model](docs/security/threat-model.md) | What is protected, how, and what isn't |
| [Architecture decision records](docs/adr/) | Why things are the way they are |
| [M1 design](docs/design/m1-engine-cli.md) and [roadmap](docs/plans/m1-roadmap.md) | The plan for all of M1, and where it stands |
```

In the "What works so far" table, add after the "Run in a hardened container" row
(Task 12):

```markdown
| Documentation generated from code: the `stack.yaml` and CLI references, app facts | Done            |
```

Run `pnpm format` so that Prettier realigns both tables.

- [ ] **Step 2: Update the roadmap**

In `docs/plans/m1-roadmap.md`:

1. **"Detailed plans so far".** Change the S2b line to end in `(done).`, and add:
   `- Slice 2c: [\`m1-s2c-packaging.md\`](m1-s2c-packaging.md).`
2. **The S2 split table's S2c row.** Replace its "Delivers" cell with:

   ```markdown
   **Packaging.** The Mediaplane image, `deploy/mediaplane.compose.yaml` with the socket proxy (`mediaplane-system`), host detection from inside the container (the host helper), the threat model and ADR 0008. Also, by the owner's decisions of 2026-10-09: Trivy for the Mediaplane image (from S8); and the docs so far, which are the generated `stack.yaml`, JSON Schema and CLI references with a CI freshness check (from S8), `docs/architecture.md`, a README per app, the "app won't start" runbook and ADR 0006
   ```

3. **The slices table's S8 row.** In its "Delivers" cell:
   - replace `Trivy, SBOM and provenance` with
     `Trivy for the catalog images (Mediaplane's own image is scanned from S2c), SBOM and provenance`;
   - replace `generated reference docs and a freshness check` with
     `the \`--json\` output shapes in the generated docs (the \`stack.yaml\`, JSON Schema and CLI references, with their freshness check, arrive in S2c)`;
   - replace `a multi-arch release workflow` with
     `a multi-arch release workflow and manifest (arm64 CI itself runs from S2c)`.
4. **"Every slice writes its own docs as it goes".** Make four changes:
   - change the ADR bullets to `0010 in S2a, 0004 in S2b, and 0006 and 0008 in S2c;`, and
     delete the `0006 in S7.` bullet;
   - in the bullet "Each app's `catalog/<app>/README.md`", change "written when that
     app's integration lands" to "written in S2c, and updated when that app's integration
     lands";
   - in the runbooks list, change `"app won't start" in S6.` to `"app won't start" in S2c.`;
   - add this bullet at the end of the list:

     ```markdown
     - **A docs task in every slice plan,** from S2c on (owner, 2026-10-09). It covers the
       spec §9 artefacts the slice touches: it runs `pnpm docs:generate` for the generated
       references, and updates each touched app's README, the runbooks and ADRs, and
       `docs/architecture.md`.
     ```

5. **"CI architecture coverage".** Replace the whole section, under its heading, with:

   ```markdown
   The dev box is aarch64. GitHub's hosted arm64 runners are free for public
   repositories, and the repo is public, so from S2c (owner, 2026-10-09):

   - the `image` and `e2e` jobs run as matrices on `ubuntu-24.04` (amd64) and
     `ubuntu-24.04-arm` (arm64), natively, with no emulation;
   - each runner builds its own architecture's image, scans it with Trivy, and runs every
     end-to-end test against it;
   - a multi-arch image manifest waits for publishing, in S8.

   Each slice that adds end-to-end tests still runs them locally on the aarch64 dev box
   before merging.
   ```
6. **"Inputs for later slices".**
   - Change the heading `**S2c:**` to `**S2c:** all of these are in the S2c plan.`
   - Add to the **S3** list:

     ```markdown
     - **The Mediaplane container can reach only the socket proxy.** Its network is
       internal (S2c). Wiring needs the apps' APIs, so attach the container to the
       stack's network, or find another route. Then update ADR 0008 and the threat model.
     ```

   - Add an **S6** list after S4:

     ```markdown
     **S6:**

     - **The Plex claim and `plex-login` need plex.tv.** The Mediaplane container has no
       route out today (S2c), so give it one, and record that in the threat model.
     ```

   - Add to the **S8** list:

     ```markdown
     - **Pins outside the catalog.** Renovate must also bump the images pinned in:
       - `Dockerfile` (`node`, `docker:*-cli`);
       - `deploy/mediaplane.compose.yaml` (`wollomatic/socket-proxy`);
       - `ci.yml` (Trivy).

       Every catalog pin bump must also run `pnpm docs:generate`, because each app
       README's facts block shows the pin.
     - **Publish the image,** and give `MEDIAPLANE_IMAGE` in
       `deploy/mediaplane.compose.yaml` a pinned default. Then the install guide can pull
       instead of build.
     ```

- [ ] **Step 3: Check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add README.md docs/plans/m1-roadmap.md
git commit -m "docs: link every document from the README, and record S2c in the roadmap"
```

---

## Slice 2c completion checklist

- [ ] On this aarch64 machine, this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  That includes `image.e2e.test.ts` and `deploy.e2e.test.ts`.
- [ ] The Trivy scan from Task 11, Step 1, exits 0 on this machine.
- [ ] Follow `deploy/README.md` by hand against a scratch home:
  - `mediaplane plan` works through the shim;
  - `mediaplane apply --yes` on a stack with `bind: localhost` brings every app up
    healthy;
  - a second `apply` prints `No changes.`

  Then remove the stack, `mediaplane-system` and the scratch home.
- [ ] No `mediaplane-e2e-*` containers or images, and no `io.mediaplane.helper`
  containers, are left (Task 10's leftover check).
- [ ] No committed file contains a real path, user name, host name or address from this
  machine: `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing
  outside the GitHub URLs.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the owner:
  - the first runs of the `image` and `e2e` matrices, on both runners, are pending;
  - the e2e check now reports one result per runner. Any branch-protection rule that
    requires the old "End-to-end (real Docker)" check must name the new ones.
