# Mediaplane — M1 Engine + CLI: Design Spec

- **Date:** 2026-10-08
- **Status:** Approved (2026-10-08)
- **Milestone:** M1 of 4 (Engine + CLI)
- **Licence:** GPL-3.0

---

## 1. Product context

This section records the product-level decisions that every milestone builds on.
Later milestone specs refer back to it instead of repeating it.

### 1.1 Problem

A self-hosted media stack (Sonarr, Radarr, Prowlarr, a download client, a media
server, a requests app) is easy to *install*, because many projects generate the
containers. It is tedious and error-prone to *wire up*. Each app makes its own
API key, and the user copies keys between web UIs, adds download clients, root
folders and indexer links by hand, and then has no way to tell when something
drifts or breaks.

### 1.2 What Mediaplane is

Mediaplane is an open-source control plane for a self-hosted media stack. It
ships as a single multi-arch container that runs on an existing Linux host. The
user describes the stack they want in one declarative file, `stack.yaml`, written
by a web wizard, by hand or by automation such as Ansible. Mediaplane then:

1. deploys it as a plain Docker Compose project,
2. pre-generates every API key and credential so the user never copies one,
3. wires the apps together through their REST APIs,
4. keeps running, detecting drift and warning without overwriting.

### 1.3 Positioning (prior-art research, 2026-10-08)

| Existing tool | Why it does not meet the need |
|---|---|
| YAMS, Saltbox, DockSTARTer, Runtipi, CasaOS | Install the apps but leave all wiring manual |
| LavX/arrstack (MIT) | Wires everything, but runs only as a terminal wizard. No persistent panel, no drift detection, no Plex |
| SparkBox | Has a wizard, wiring and a panel, but is **closed source**, host-installed, Jellyfin-only and x86-first |
| Umbrel | Partial wiring, but it is a whole OS, uses a non-commercial licence and leaves Seerr unwired |
| Buildarr, Flemmarr | Config-as-code, but stale or dead |

The gap Mediaplane fills is all four of the following together:

- OSI open source, shipped as a single container.
- **Plex and Jellyfin** as equal choices.
- **arm64 fully supported**.
- **Drift detect-and-warn**, which no existing tool offers.

### 1.4 Principles

1. **Never fork upstream apps.** Mediaplane orchestrates unmodified upstream
   images. All behaviour comes from env vars, config files and REST APIs.
2. **One engine, one code path.** The wizard, panel, CLI and future Ansible all
   write `stack.yaml` and call the same `plan`/`apply`.
3. **No lock-in.** The output is a plain Compose project that the user can read,
   manage from Portainer, or keep running without Mediaplane.
4. **The user stays in control.** There are documented override points at the
   container level (`compose.override.yaml`) and the app level (Mediaplane only
   manages what it created). Manual changes are detected and reported, never
   silently reverted.
5. **Quality first.** Every feature must justify itself by user value. Every app
   version Mediaplane ships has passed end-to-end tests.
6. **Neutral framing.** Documentation describes a self-hosted media platform for
   the user's own library and contains no piracy-flavoured language or examples.

### 1.5 Audience and platforms

- **Audience:** the public. Users range from semi-technical people using the web
  wizard to automation-minded users who drive the CLI.
- **v1 hosts:** Linux x86_64 and arm64.
- **Later:** Windows/macOS through Docker Desktop or WSL2, if that proves
  reasonable.
- **Out of scope for v1:** NAS OSes (Unraid, TrueNAS, Synology) and multi-host
  stacks.

### 1.6 Milestones

| Milestone | Delivers |
|---|---|
| **M1: Engine + CLI** (this spec) | `stack.yaml` schema, catalog format, compose rendering, key pre-seeding, wiring for the core video stack, drift detection with Keep mine, `plan`/`apply`, change history, CI with real-container end-to-end tests |
| **M2: Panel UI** | Web wizard (including a "Sign in with Plex" step), dashboard, enabling and disabling apps, drift view with Re-apply and Keep mine, change-history view, panel authentication |
| **M3: Operations** | Safe updates with snapshot-based rollback, scheduled backups and restore, alerts (ntfy, email, webhook) |
| **M4: Catalog expansion** | SABnzbd, Audiobookshelf, Bookshelf (experimental, books and audiobooks), Bazarr, Recyclarr, Portainer, Homepage |

Documentation is written alongside each milestone (see §9).

**After v1:** music (Lidarr and a music server), more alert targets, offsite
backup targets, Windows/macOS, NAS OSes, multi-host.

**Ansible readiness.** Mediaplane will **not** ship Ansible content. The project
owner will write the Ansible deployment separately, later. M1 must make that
easy:

- a declarative, versioned, documented `stack.yaml` with a published JSON Schema;
- headless `plan` and `apply` with `--json` output and meaningful exit codes;
- secrets supplied as files or env vars;
- an "externally managed" mode in which Mediaplane never writes `stack.yaml`.

---

## 2. M1 scope

### 2.1 In scope

- **The Mediaplane image:** multi-arch (amd64 and arm64), containing the engine
  and the CLI.
- **Engine modules:** config, catalog, resolver, renderer, runtime, keys,
  integrations, planner, drift, history (see §3).
- **CLI:** `init`, `plan`, `apply`, `status`, `drift`, `keep`, `history`,
  `credentials`, `plex-login`, `vpn-check` and `migrate`. Every command supports
  `--json`.
- **M1 catalog (core video stack):** Jellyfin *or* Plex, Sonarr, Radarr,
  Prowlarr, qBittorrent behind Gluetun, Seerr, and Byparr (with FlareSolverr as
  an alternative).
- **Mediaplane's own deployment:** the Mediaplane container plus the Docker
  socket proxy, in a separate Compose project (§4.4).
- **Wiring between those apps** (see §6).
- **Drift detection with Re-apply and Keep mine.**
- **Change history** (one record per apply).
- **CI/CD:** lint, type-check, unit tests, end-to-end tests on amd64 and arm64,
  a real VPN kill-switch test, security scans, release automation and Renovate.
- **Documentation for everything above** (see §9).

### 2.2 Out of scope for M1

- Any web UI or HTTP listener (M2).
- Updates with rollback, backups and alerts (M3).
- Any app outside the core video stack (M4).
- Ansible content (a separate project).

### 2.3 Success criteria

M1 is done when all of the following hold:

1. **Zero manual steps (Jellyfin).** On a clean Ubuntu 24.04 host, amd64 *and*
   arm64, a minimal `stack.yaml` (about 10 lines) followed by
   `mediaplane apply --yes` produces a fully wired, healthy stack. Specifically:
   - Prowlarr syncs to Sonarr and Radarr, with Byparr as its proxy;
   - qBittorrent is registered in both arrs, with per-app categories;
   - root folders exist;
   - Seerr is connected to Jellyfin, Sonarr and Radarr.
2. **Plex has exactly one manual input.** The Plex path is identical except that
   the user supplies a Plex token.
3. **Idempotent.** A second `apply` reports `No changes`, exits 0 and modifies
   nothing.
4. **Drift is detected, never reverted.** A manual edit to any managed field is
   reported by `mediaplane drift` with the expected and actual values. Re-apply
   restores it, and Keep mine records it as an override so drift is clear.
5. **The VPN fails closed.** With the VPN tunnel down, qBittorrent has no route
   out. This is proven by an automated test.
6. **Ejectable.** The generated Compose project runs without Mediaplane, using the
   exact command printed in the generated file's header. An automated test runs that
   command.

   ```bash
   docker compose -p mediaplane --project-directory <home> \
     -f <home>/generated/compose.yaml -f <home>/compose.override.yaml \
     --env-file <home>/generated/.env up -d
   ```

   Leave out the `-f <home>/compose.override.yaml` pair if there is no override file.
7. **Honest docs.** The `stack.yaml` and CLI references are generated from code,
   and CI fails if they are out of date.

---

## 3. Architecture

### 3.1 Overview

There is one image and one engine library. The CLI is a thin layer over the
engine; the M2 web panel will be another. The model is Terraform-style: `plan`
computes the difference between desired and observed state, and `apply`
converges on desired state.

```
 stack.yaml ─┐       (wizard / CLI / Ansible all write this)
 secrets/   ─┤
             ▼
 ┌─────────── mediaplane engine ───────────────────────────────┐
 │ config ──► resolver ──► renderer ──► compose.yaml + .env     │
 │  (Zod)    (deps, arch,   (pure,         + user's             │
 │           ports, toggles) deterministic)  compose.override   │
 │              │                              │                │
 │          catalog                        runtime ── docker compose
 │       (app definitions,                 (thin driver)        │
 │        pinned versions)                     │                │
 │              │                              ▼                │
 │         integrations ◄──── observe ──── running apps         │
 │        (per-app wiring:  ──── apply ───► (REST APIs)         │
 │         desired/observe/apply)                               │
 │              │                                               │
 │   planner (diff: files + containers + wiring) ──► plan/apply │
 │   drift  = planner in observe-only mode                      │
 │   keys   = generate once, persist, never regenerate          │
 │   history = append-only change records                       │
 └──────────────────────────────────────────────────────────────┘
```

### 3.2 Units and interfaces

| Unit | Responsibility | Depends on | Side effects |
|---|---|---|---|
| `config` | Load `stack.yaml`, validate it with Zod, apply in-memory schema migrations, resolve `{file:}`/`{env:}` secret references | — | Reads files |
| `catalog` | Typed app definitions bundled in the image | — | None |
| `resolver` | Turn config and catalog into a `ResolvedStack`: the enabled apps, the dependency and capability check, the arch check, port allocation and derived values | config, catalog | None (pure) |
| `keys` | Generate missing credentials using a cryptographic RNG and persist them before anything starts. Never regenerate them | resolver | Writes `state/secrets.json` |
| `renderer` | Turn a `ResolvedStack` and its keys into `compose.yaml` and `.env`. Output is deterministic, with stable ordering | resolver, keys | None (pure) |
| `runtime` | The **only** module that runs `docker compose` (`config`, `pull`, `up --wait`, `ps`, `down`). Parses JSON output | — | Docker |
| `integrations` | One adapter per app: `desired()`, `observe()`, `apply()` | the resolved stack, keys, the effective compose config | HTTP calls to the apps |
| `planner` | Diff the files, the containers and the wiring into an ordered `Plan` | all of the above | None (pure, given its inputs) |
| `drift` | The planner in observe-only mode, using a three-way comparison (see §6) | planner | None |
| `history` | Append-only change records | — | Writes `state/history/` |
| `cli` | Argument parsing, human and `--json` output, exit codes | engine | stdout, stderr |

The integration adapter contract is sketched below. Exact types are settled in
the implementation plan.

```ts
interface Integration {
  app: AppId;
  /** Other apps whose integrations must be applied first (e.g. Prowlarr needs Sonarr up). */
  after: AppId[];
  /** Managed resources that should exist, given the resolved stack. Pure. */
  desired(ctx: ResolvedContext): ManagedResource[];
  /** Read back the managed resources (only those Mediaplane owns) from the app's API. */
  observe(ctx: LiveContext): Promise<ObservedResource[]>;
  /** Create, update or delete one resource. Must be idempotent. */
  apply(change: ResourceChange, ctx: LiveContext): Promise<ApplyResult>;
}
```

`runtime` sits behind an interface, so unit tests use a fake. Adapter HTTP
clients are typed per app API.

### 3.3 Technology

- **Language and runtime:** TypeScript on Node 24 LTS, managed with pnpm. This
  matches the owner's other projects, and one language covers both the engine
  and the M2 UI.
- **Validation and schema:** Zod for validation, which also generates the
  published JSON Schema.
- **YAML:** the `yaml` package's Document API, so that writes to `stack.yaml`
  (Keep mine, `migrate`) **preserve the user's comments and formatting**.
- **Tests:** Vitest.
- **Container tooling:** the Docker Compose CLI is bundled in the image (v5 at
  the time of writing). Preflight requires at least 2.24, for `up --wait` and
  `depends_on.restart`.
- **Rejected alternatives.** Go was rejected for language familiarity. Calling
  the Docker Engine API directly would have meant reimplementing Compose
  semantics and losing ejectability. Forking LavX/arrstack would have meant
  inheriting a terminal-script design with no desired-state model. Its MIT code
  may be consulted as a wiring reference, with attribution if any is reused.

---

## 4. Data model

### 4.1 On-disk layout and ownership

`MEDIAPLANE_HOME` (default `/opt/mediaplane`) is bind-mounted at the **same
absolute path** inside the Mediaplane container as on the host. This is
necessary because the host's Docker daemon interprets bind-mount paths in the
generated compose file.

```
/opt/mediaplane/
├── stack.yaml              USER:   desired state (the only file normally edited)
├── compose.override.yaml   USER:   optional container-level overrides; never written by Mediaplane
├── secrets/                USER:   one file per secret (VPN key, Plex token, …)
├── generated/              MEDIAPLANE: rewritten every apply; "DO NOT EDIT" header
│   ├── compose.yaml
│   ├── compose.prev.yaml   (previous version, used for change-record diffs)
│   └── .env                (0600)
├── state/                  MEDIAPLANE (0700)
│   ├── secrets.json        generated keys/passwords (0600); created once, never silently rotated
│   ├── resources.json      per managed resource: app-assigned ID + last-applied snapshot of managed fields
│   ├── history/            one JSON change record per apply
│   └── lock                single-writer lock
└── appdata/<app>/          APPS: each app's config dir (sensitive; backed up in M3)
```

The data root, for example `/srv/data`, is chosen by the user. It uses a single
top-level folder so that moves are hardlinks, not copies. Every app mounts it as
`/data`.

```
/srv/data/
├── torrents/{tv,movies}
├── usenet/{tv,movies}          (used from M4)
└── media/{tv,movies}
```

M4 adds `books` and `audiobooks` subfolders.

### 4.2 `stack.yaml` (schema v1)

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/cyclopsgd/Mediaplane/main/docs/reference/stack.schema.json
version: 1
timezone: Europe/London
user: { uid: 1000, gid: 1000 }
paths: { data: /srv/data }
network: { bind: lan, lan_subnet: 192.168.1.0/24 }   # lan | localhost | all
security: { login_on_lan: true }                       # false = skip login from the LAN where apps support it (§6.1)
admin: { username: admin }                             # password generated unless { file: … } given
media_server: jellyfin                                 # jellyfin | plex
plex: { token: { file: secrets/plex-token } }          # only when media_server: plex
vpn:
  provider: mullvad                                    # any Gluetun provider
  private_key: { file: secrets/wg.key }
  addresses: 10.64.0.2/32                              # WireGuard address, if the provider needs one
apps:
  sonarr: {}
  radarr: { port: 7879 }        # escape hatches: port, version, env
  prowlarr: {}
  qbittorrent: { vpn: true }
  seerr: {}
  byparr: {}
overrides:                      # written by "Keep mine"
  sonarr.download_client.category: television
# managed_by: external          # Mediaplane never writes this file (Ansible/GitOps mode)
```

Rules:

- **No inline secrets.** Every secret is a `{ file: … }` or `{ env: … }`
  reference, so `stack.yaml` is safe to commit to git. An inline secret is a
  validation error. The wizard (M2) writes `secrets/` files for the user.
- **An app is enabled if it is listed.** `enabled: false` disables it but keeps
  its settings.
- **Removing an app never deletes its `appdata/`.** The plan shows the container
  and its links being removed. Deleting data is a documented manual step.
- **Everything has a sensible default**, so a minimal file is about 8 to 10
  lines.
- **Validation errors are actionable**, for example
  `unknown app 'sonar' — did you mean 'sonarr'?`.
- **Externally managed mode.** With `managed_by: external`, Mediaplane never
  writes `stack.yaml`. `migrate` and Keep mine print the snippet to add instead.
- **`vpn.addresses`** is optional and sets the WireGuard address for providers
  that need one, such as Mullvad. Any other Gluetun setting is passed through
  `apps.gluetun.env`.
- **Override keys** follow the form `<app>.<resource>.<field>`. The set of
  overridable fields is declared per integration and documented in each app's
  README.
- **VPN for qBittorrent.** `apps.qbittorrent.vpn` defaults to `true`, and in
  that case a `vpn:` block is required (validation error otherwise).
  `vpn: false` is allowed, but `plan` shows a prominent warning every time.
- **`network.bind`:**
  - `lan` (the default) publishes ports only on the host's private addresses
    (RFC 1918 IPv4; IPv6 ULA is a later addition). Preflight detects these with a short-lived helper
    container on the host network, and `lan_subnet` defaults from the same
    detection. If the host has no private address, as on a typical VPS,
    preflight fails and suggests `localhost` plus Tailscale.
  - `localhost` publishes on `127.0.0.1` only.
  - `all` publishes on `0.0.0.0`, and `plan` warns every time.

### 4.3 Catalog entries

Each app is one folder: `catalog/<app>/{app.ts, integration.ts, README.md}`.
`README.md` is that app's user guide, covering what Mediaplane manages and how
to override it.

```ts
export default defineApp({
  id: 'sonarr', name: 'Sonarr', category: 'video',
  image: { repo: 'lscr.io/linuxserver/sonarr', tag: '<pinned>', digest: 'sha256:<pinned>' },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 8989 }],
  volumes: { appdata: '/config', data: '/data' },
  runAs: 'puid-env',            // linuxserver PUID/PGID; others use 'user-directive' or 'fixed:1000'
  provides: [],
  requires: [{ capability: 'download-client', min: 1 }],
  secrets: { apiKey: { generate: 'hex32' } },  // where each secret comes from
  credentials: [                // ordered seeding steps (see table below)
    { step: 'env', var: 'SONARR__AUTH__APIKEY', secret: 'apiKey' },
    { step: 'bootstrap-api', action: 'create-admin' },
  ],
  configFiles: (ctx) => [       // pre-start files (see below)
    {
      path: 'config.xml',       // inside appdata/sonarr
      content: `<Config><ApiKey>${ctx.secret('apiKey')}</ApiKey>…</Config>`,
      seeded: /<ApiKey>[^<]+<\/ApiKey>/,
    },
  ],
  login: { comingIn: 'Slice 3b' },  // 'shared' once the shared admin works there
  health: { http: '/ping' },
  experimental: false,
});
```

`runAs` tells the renderer how each image handles users. For an image with a
fixed uid, such as Seerr (uid 1000), Mediaplane sets the ownership of that app's
`appdata/` directory to match.

**Credential seeding steps.** Each app declares an ordered list of steps,
because some apps need more than one. Sonarr, for example, takes its key from an
env var and from `config.xml` (a pre-start file, below), and its admin user from
the API.

| Step | Mechanism | Used by (M1) |
|---|---|---|
| `env` | An environment variable set from first start | Sonarr, Radarr, Prowlarr, Seerr |
| `bootstrap-api` | First-run setup through the app's API after it starts | Sonarr, Radarr, Prowlarr (admin user), Jellyfin (startup wizard, API key), Seerr (first sign-in). Audiobookshelf in M4 |

**Pre-start files.** Files an app reads when it starts come from its
`configFiles(ctx)` hook, not from a step. The hook is pure: from the resolved
stack, the shared admin login and the app's secrets, it returns each file's path
inside the app's appdata folder, its content, and a `seeded` pattern. Apply
writes each file before the app's first start, and only if it is absent (§6.4).
An existing file that doesn't match `seeded` is from an install made before
Mediaplane seeded the app, and `plan` reports it (§11, Slice 3a). In M1 these
are Sonarr's, Radarr's and Prowlarr's `config.xml`, qBittorrent's
`qBittorrent.conf` and Gluetun's `auth/config.toml`.

Secrets are declared separately from the steps that use them. A secret is
either generated (`hex32`, `qbt`), created by the app itself (Jellyfin's API
key), or provided by the user (`vpn.private_key`, `plex.token`). For example,
the VPN key is a user-provided secret that Gluetun's `env` step injects.

§6.1 gives the exact per-app details.

**Capabilities.** An app declares what it `provides` (for example
`download-client:torrent`) and what it `requires`. A missing requirement is a
validation error, or a warning where it is marked soft. For example, enabling
Sonarr with no download client fails with an explanation.

**The tested set.** Each Mediaplane release pins every app by tag and digest.
Those exact versions have passed the end-to-end suite. A per-app `version:`
override is allowed, but `plan` flags it as an *untested combination*.

### 4.4 Mediaplane's own deployment

Mediaplane runs as its **own Compose project**, `mediaplane-system`. It is
separate from the stack it manages, the `mediaplane` project, so `apply` can
never recreate or remove Mediaplane itself.

- **What the project contains:** the Mediaplane container and the Docker socket
  proxy.
- **What it ships as:** a documented `mediaplane.compose.yaml`. The user starts
  it once with `docker compose up -d`, and the later Ansible project templates
  the same file.
- **How Mediaplane runs:**
  - In M1 the container is long-running and idle. Commands run with
    `docker exec mediaplane mediaplane <command>`.
  - An optional one-line host shim, `/usr/local/bin/mediaplane`, wraps that
    command, and the docs show how to install it.
  - In M2 the same container also serves the panel.
- **How it is updated:** by the user, with `docker compose pull && up -d` on
  `mediaplane-system`. Self-update is out of scope for M1, and M3 revisits it.

---

## 5. The apply flow

```
lock → load+validate → preflight → keys → plan → write files → pull → start → bootstrap → wire → verify → record → unlock
```

1. **Lock.** Exclusive creation of `state/lock`, recording the pid, host and
   start time. A concurrent run reports who holds the lock and since when. A
   stale lock, whose process is dead, is detected and cleared.
2. **Load and validate.** Parse `stack.yaml` and check that every referenced
   secret exists. An old schema version is migrated in memory with a warning.
   Only `mediaplane migrate` rewrites the file.
3. **Preflight.** These checks fail before anything is touched:
   - Docker and Compose versions, and the host architecture against each app's
     image architectures;
   - free disk space;
   - the data root exists and is writable by `uid`/`gid`;
   - **downloads and media are on the same filesystem**, which hardlinks require
     (compared by `st_dev`);
   - `/dev/net/tun` is present when a VPN is configured;
   - the ports to be published are free;
   - the host's private addresses are present when `network.bind: lan` is set
     (§4.2);
   - `compose.override.yaml` is valid, checked with `docker compose config`.
4. **Keys.** Generate or recover every credential that can be chosen in
   advance, and persist it *before* any container starts. Credentials that an
   app creates itself, such as Jellyfin's API key, are persisted the moment they
   are created during bootstrap.
5. **Plan.** Diff the files (rendered against current), the containers (by
   Compose config hash), and the wiring (desired against observed, for running
   apps). Wiring for apps that are not running yet is marked *after start*.
6. **Write files.** Write atomically (temp file, then rename) and keep the
   previous `compose.yaml` as `compose.prev.yaml`.
7. **Pull.** Run `docker compose pull` *before* stopping anything, so a network
   failure leaves the old stack running untouched.
8. **Start.** Run `docker compose up -d --wait --remove-orphans` with per-app
   health checks. `depends_on: condition: service_healthy` handles ordering, so
   for example qBittorrent starts only after Gluetun is healthy. On their first
   start, apps that have anonymous first-run endpoints start **without
   published ports** (§6.4).
9. **Bootstrap.** Perform `bootstrap-api` first-run setup for newly started
   apps. Afterwards, re-render with ports and recreate any app that was started
   unpublished.
10. **Wire.** Apply integration changes in topological order of `after`.
11. **Verify.** Re-plan. The result must be empty, and any remaining difference
    is reported as a failure.
12. **Record.** Write the change record:
    - the trigger (cli, panel or wizard) and the hash of `stack.yaml`;
    - the plan, and every action with its result;
    - the duration and the outcome (`success`, `partial` or `failed`).

    Secrets are always stored as `<redacted>`.

Integrations read addresses and ports from the **effective** Compose config,
meaning the generated file merged with the user's override. A port change made
in `compose.override.yaml` is therefore wired automatically.

### 5.1 Failure handling

- **Converge forward, not transactional.** Every action is idempotent. When an
  action fails, the independent actions still run and the dependent ones are
  marked `skipped`. The summary reads, for example:
  `12 done, 1 failed, 2 skipped — re-run apply to retry`. Because a re-run
  re-plans, it does only what is left.
- **No automatic rollback of applies.** Unwinding a partially wired stack is
  riskier than converging it. Snapshot-based rollback is reserved for version
  updates in M3, the one case where going forward can be worse because of
  database migrations.
- **Retries.** Transient errors (connection refused, 502/503/504, timeouts while
  an app starts) are retried with exponential backoff up to a per-app timeout.
  Non-transient errors (4xx) fail immediately and include the app's own error
  message.
- **Actionable errors.** Every error names the app, the action and the response,
  and gives a next step, for example:
  `Prowlarr couldn't reach Sonarr at http://sonarr:8989 — check Sonarr's health: mediaplane status sonarr`.

### 5.2 CLI contract

| Command | Purpose |
|---|---|
| `init` | Write a starter `stack.yaml` and a `secrets/` layout. On a TTY it asks interactive prompts (media server, data path, VPN provider and its WireGuard address, LAN or localhost, the LAN subnet and whether the LAN must sign in (both only with LAN), the admin user name, and whether to generate its password); otherwise it takes flags. It checks the flags before the first prompt, and asks again after a bad answer. It never overwrites an existing file |
| `plan` | Show what `apply` would change, including drift. Makes no changes |
| `apply` | Converge on `stack.yaml` (§5) |
| `status [app]` | Container health, VPN state, and the last apply's outcome |
| `drift` | Report drift only (§6.3) |
| `keep <path>` | Keep mine: record a drifted value or a deletion as an override |
| `history [id]` | List change records, or show one in full |
| `credentials [app]` | Show the shared admin login and per-app URLs (never printed in `--json` unless `--reveal` is given) |
| `plex-login` | Run the plex.tv PIN flow and save the token to `secrets/plex-token` |
| `vpn-check` | Compare qBittorrent's egress IP with the host's |
| `migrate` | Rewrite `stack.yaml` to the current schema version, preserving comments |

- **`plan`.** Exit 0 means no changes, 2 means changes are pending, 1 means an
  error (`--detailed-exitcode` semantics by default).
- **`apply`.** Interactive by default: it shows the plan and asks for
  confirmation. `--yes` skips the prompt. Exit 0 means success; the `--json`
  output includes `"changed": true|false`. Exit 1 means failed or partial.
- **`--json`.** Every command supports it. The JSON shapes are versioned and
  documented, because external automation depends on them.

---

## 6. Wiring and drift

Findings in this section come from per-app research done on 2026-10-08
against current upstream source and docs.

### 6.1 Credentials and first run

| App | API key | Admin / first run | Notes |
|---|---|---|---|
| Sonarr, Radarr, Prowlarr | Generated 32-hex key, set through `<APP>__AUTH__APIKEY` **and** written to `config.xml` before first start | Shared admin created with `PUT /api/v3/config/host` (Prowlarr uses `/api/v1`), `authenticationMethod: forms` | Writing the key to `config.xml` matters because an env-only key is never persisted; if the env var were ever lost, the app would silently generate a new key. Auth enum values are case-sensitive. `AUTH__ENABLED` is never set (it is a legacy flag), and auth `None` is never used |
| qBittorrent (≥ 5.2) | Generated `qbt_` + 28 chars, written to `qBittorrent.conf` before first start | Same file: shared admin, `WebUI\Password_PBKDF2` (PBKDF2-HMAC-SHA512, 100 000 iterations, 16-byte salt, 64-byte key) | The arrs authenticate with the API key, so no auth-bypass subnet is needed for app-to-app traffic. The published and container WebUI ports must be identical, because of qBittorrent's Host-header check. A `port:` override therefore changes both, and also `WEBUI_PORT`. Ports are published on the `gluetun` service |
| Jellyfin (≥ 12) | Cannot be chosen. Created with `POST /Auth/Keys?app=Mediaplane` after setup, read back with `GET /Auth/Keys`, then stored in `state/secrets.json` | Startup API (`POST /Startup/User`, `POST /Startup/Complete`), then `AuthenticateByName`. Uses **bootstrap-before-publish** (§6.4) | Uses `Authorization: MediaBrowser Token="…"`; the legacy token headers are disabled by default in v12 |
| Plex | User-provided token from **`mediaplane plex-login`**, which runs the plex.tv PIN flow (prints a link, then polls until the user has signed in). Uses the long-lived legacy token, not the 7-day JWT | A claim token is fetched from plex.tv at apply time using the user's token, then passed as `PLEX_CLAIM` on first start, so the 4-minute claim expiry is never a problem | The one unavoidable interactive step. The M2 wizard reuses the same flow |
| Seerr (≥ 3.5) | Generated, set through `API_KEY` | The key does nothing until a first user exists. Mediaplane signs in with `POST /api/v1/auth/jellyfin` as the Jellyfin admin it created, or with `POST /api/v1/auth/plex` and the user's token. It then configures Seerr through `/api/v1/settings/*` and finishes with `POST /api/v1/settings/initialize` | One media-server type per instance. `hostname` is never re-sent once the media server is configured, because doing so returns 500 |
| Byparr / FlareSolverr | None | None | Internal only; never published |
| Gluetun | User-provided VPN key (a secret file). A generated `controlApiKey` for its control server, written to `auth/config.toml` before first start (§11, Slice 3a) | None | `FIREWALL_OUTBOUND_SUBNETS` is set to the LAN subnet while the web UIs are published on the LAN, so the LAN can reach qBittorrent's UI |

**Login on the LAN.** `security.login_on_lan` defaults to `true`, and the M2
wizard asks the user to choose.

| Setting | Sonarr / Radarr / Prowlarr | qBittorrent |
|---|---|---|
| `true` | `AUTH__REQUIRED=Enabled` | Subnet whitelist disabled |
| `false` | `AUTH__REQUIRED=DisabledForLocalAddresses`, with `SERVER__TRUSTEDNETWORKS` set to the LAN subnet, plus Mediaplane's Docker network from M2 (§11, Slice 3a). Without that, the local bypass misbehaves behind proxies | `AuthSubnetWhitelist` set to the LAN subnet |

The LAN is trusted only while the web UIs are published on it (`network.bind`
`lan` or `all`). Only then are Servarr's `SERVER__TRUSTEDNETWORKS`,
qBittorrent's `AuthSubnetWhitelist` and Gluetun's `FIREWALL_OUTBOUND_SUBNETS`
set. With `localhost`, they are left out (§11, Slice 3a).

Jellyfin, Plex and Seerr always require login, because they have real user
accounts.

**Shared admin credential.** There is one username (default `admin`) and one
generated high-entropy password, applied to every app that has an admin login.
`mediaplane credentials` shows them. The user may supply their own password with
`admin.password: { file: … }`.

**Key recovery.** Sometimes `state/secrets.json` is missing while `appdata/`
still exists, for example after a reinstall or lost state. In that case
Mediaplane recovers the existing keys from the apps' own config before
generating anything:

- `ApiKey` from `config.xml`;
- `WebUI\APIKey` from `qBittorrent.conf`;
- `main.apiKey` from Seerr's `settings.json`.

New credentials are generated only for apps with no recoverable key. If a
credential cannot be recovered, for example the Jellyfin admin password, `plan`
reports it with a pointer to the recovery runbook.

### 6.2 Wiring map (M1)

Every resource Mediaplane creates is named `… (Mediaplane)`.

| Link | Resource created | Managed fields | Secret check |
|---|---|---|---|
| Sonarr / Radarr → qBittorrent | Download client (`QBittorrent`) with host `gluetun` and category `tv` / `movies` | host, port, useSsl, category, apiKey, enable | `POST /downloadclient/test` |
| Sonarr / Radarr | Root folder `/data/media/tv` / `/data/media/movies` | path | — |
| Sonarr / Radarr → Jellyfin or Plex | Connection (`MediaBrowser` / `PlexServer`) that updates the library on import | host, port, apiKey / authToken, updateLibrary | `POST /notification/test` |
| Prowlarr → Sonarr / Radarr | Application with `syncLevel: fullSync` | prowlarrUrl, baseUrl, apiKey, syncLevel, syncCategories | `POST /applications/test` |
| Prowlarr → Byparr / FlareSolverr | Indexer proxy of type `FlareSolverr`, plus the tag `cloudflare` | host, requestTimeout, tags | `POST /indexerproxy/test` |
| qBittorrent | Categories `tv` and `movies` with save paths under `/data/torrents/`, plus the default save path | category save paths, save_path | — |
| Jellyfin | Libraries Movies (`movies`) and Shows (`tvshows`) | name, collectionType, paths | — |
| Plex | Libraries Movies and TV Shows | name, type, location | — |
| Seerr → media server, Sonarr, Radarr | Media-server link with libraries enabled; Sonarr and Radarr servers with a default profile, root folder and `isDefault` | hostname, port, apiKey, activeProfile, activeDirectory, enabled libraries | `POST /api/v1/settings/sonarr/test`, `POST /api/v1/settings/radarr/test` |

**Ordering.** The `after` relationships give this order: qBittorrent and
Jellyfin/Plex, then Sonarr and Radarr, then Prowlarr, then Seerr. Before wiring
an app, Mediaplane polls its unauthenticated readiness endpoint (`/ping` for
the arrs). Prowlarr's application POST tests the connection, so Sonarr and
Radarr must already be up.

**Seerr's default profile** is the first match from a preference list
(`HD-1080p`, then `Any`), or else the first profile.
`apps.seerr.sonarr_profile` and `apps.seerr.radarr_profile` override it.

**Never touched (user-owned):**

- **Indexers.** Mediaplane never adds indexers. The user adds them once in
  Prowlarr and they sync everywhere.
- **Library and media settings:** quality profiles, custom formats, naming, and
  media-management settings other than root folders.
- **People:** users, sharing and permissions.
- **Unmanaged fields.** Any field of a managed resource that is not listed above.

Prowlarr only routes indexers through the proxy when they share a tag. The user
therefore tags Cloudflare-protected indexers with `cloudflare`, and
`catalog/prowlarr/README.md` explains how.

### 6.3 Drift model

Mediaplane makes a three-way comparison for every managed resource:

- **D (desired):** derived from `stack.yaml` plus `overrides`.
- **L (last applied):** the snapshot in `state/resources.json`.
- **O (observed):** read back from the app's API.

| Condition | Meaning | Shown by | Resolution |
|---|---|---|---|
| D ≠ L | The user edited `stack.yaml` | `plan`, as a pending change | `apply` |
| O ≠ L on a managed field | Changed outside Mediaplane | `drift` and `plan` | Re-apply (`apply`), or Keep mine (`mediaplane keep <app>.<resource>.<field>`) |
| Managed resource missing | Deleted outside Mediaplane | `drift` and `plan` | Re-apply recreates it. Keep mine records `<app>.<resource>: unmanaged`, and Mediaplane stops managing it |
| Test endpoint fails for a resource holding a secret | A secret changed, or connectivity broke | `drift` | Re-apply rewrites the secret. Investigate using the runbook |
| A shared key changed at its source (e.g. qBittorrent's API key regenerated) | The source of a key that other apps consume has moved | `drift`, on the source and on each consumer | Keep mine reads the new key and propagates it to every consumer. Re-apply restores the old key at the source (for qBittorrent: stop, rewrite `qBittorrent.conf`, start) |

Rules:

- **Only managed fields are compared.** Each integration declares its managed
  fields, and the app's README lists them. Those are also the only fields `keep`
  accepts; anything else is rejected with an explanation.
- **Secrets are verified, never compared.** The arrs mask secrets as `********`
  on read, so Mediaplane runs the app's own test endpoint instead. PUTting
  `********` back preserves the stored value, so re-applying non-secret fields
  never disturbs secrets.
- **Identity is the app-assigned ID** recorded in `resources.json`. If the ID is
  unknown, for example after lost state, a resource with the exact
  Mediaplane-assigned name is adopted rather than duplicated.
- **Keep mine writes to `overrides:`** using the comment-preserving YAML writer.
  In `managed_by: external` mode it prints the snippet instead.
- **Drift never writes to an app.** Only `apply` does.
- **When drift is checked:**
  - during every `plan` and `apply`, in the observe stage;
  - on demand with `mediaplane drift`;
  - periodically from M2 (default every 15 minutes);
  - and M3 alerts on newly detected drift.

### 6.4 Lifecycle details

- **Bootstrap before publish.** Some apps expose anonymous first-run endpoints:
  Jellyfin in M1, and Audiobookshelf in M4. These start first with **no
  published ports**. Mediaplane completes setup over the internal Docker network,
  then re-renders with ports and recreates the container. There is never a
  window in which a LAN client could claim the admin account.
- **Gluetun dependants.** qBittorrent uses `network_mode: service:gluetun`
  together with
  `depends_on: { gluetun: { condition: service_healthy, restart: true } }`.
  Recreating Gluetun therefore restarts qBittorrent, which would otherwise be
  left without a network. Verify asserts both.
- **Settings that need a restart.** Port, URL base, bind address, trusted
  networks and allowed hosts are set through env vars. Changing one makes
  Compose recreate the container; Mediaplane never changes these through the
  API.
- **Pre-start files.** `config.xml` and `qBittorrent.conf` are written only
  when they do not exist yet. After first start the API is the only write path,
  because the apps rewrite their own files.

### 6.5 Upstream version floor

The adapters target the API behaviour of these versions, and the tested set
always satisfies them.

| App | Minimum | Reason |
|---|---|---|
| Sonarr | 4.0.19 | AllowedHosts / TrustedNetworks semantics |
| Radarr | 6.4.3 | Same |
| Prowlarr | 2.6.3 | Same |
| qBittorrent | 5.2.0 | WebUI API keys |
| Jellyfin | 12.0 | Auth header format |
| Seerr | 3.5.0 | Shape of the settings and library API |

Sonarr v5 is in development and adds a v5 API. The adapter stays on `/api/v3`
until v5 is stable (see §10).

---

## 7. Security

### 7.1 Threat model summary

Mediaplane controls Docker, and **controlling Docker is root-equivalent on the
host**. The security of Mediaplane is therefore the security of the host. The
full threat model goes in `docs/security/threat-model.md`.

### 7.2 Controls

1. **Exposure, the primary control.**
   - M1 has **no network listener**; the CLI runs through `docker exec`.
   - From M2 the panel binds to the LAN by default and never to the internet.
   - The docs direct remote access through Tailscale/WireGuard or an
     authenticating reverse proxy. There is no built-in public exposure.
2. **Docker socket proxy, on by default.**
   - Mediaplane never mounts the raw socket. A minimal proxy container allows
     only the endpoints Compose needs (containers, images, networks, volumes,
     and the reads used by `--wait`) and blocks `exec`, swarm, plugins, secrets,
     configs and system.
   - This is documented honestly as **defence in depth, not a boundary**, since
     container creation alone permits host escape.
   - Mediaplane refuses to act on resources outside the managed `mediaplane`
     Compose project (its own `mediaplane-system` project is read-only to it).
     That is enforced in code.
   - The proxy can be disabled, with a warning.
3. **Mediaplane container hardening.** It runs as a non-root user with a
   read-only root filesystem, `no-new-privileges` and `cap_drop: [ALL]`. Its
   only writable mount is `MEDIAPLANE_HOME`.
4. **Secrets.**
   - Generated with a cryptographic RNG.
   - `state/secrets.json` and `generated/.env` are `0600`, and `state/` is
     `0700`.
   - Secrets are redacted in logs and change records.
   - They are not encrypted at rest, because a key on the same disk adds nothing.
     The docs recommend full-disk encryption and flag `appdata/` as sensitive.
5. **The apps.**
   - Every app with a login has one. Mediaplane generates one admin credential
     set and applies it across the apps; `mediaplane credentials` shows it.
   - Login is required from the LAN too, unless the user sets
     `security.login_on_lan: false` (a setup-time choice). In that case trusted
     networks are configured so the bypass applies to the LAN only (§6.1).
   - The arrs reach qBittorrent with its API key, not through an auth-bypass
     subnet.
   - Only the web UIs are published, bound according to `network.bind`.
     Everything else stays on an internal Docker network.
6. **VPN.**
   - qBittorrent uses `network_mode: service:gluetun`, so it has no network of
     its own and fails closed by construction.
   - Verify asserts this topology and that Gluetun reports connected.
   - `mediaplane vpn-check` compares qBittorrent's egress IP with the host's.
7. **Supply chain.**
   - Images are pinned by tag and digest, and Renovate bumps both.
   - CI runs Trivy (failing on critical vulnerabilities that have a fix),
     gitleaks and `pnpm audit`.
   - The Mediaplane image is published with an SBOM and build provenance.
   - GitHub Actions are pinned by SHA.
   - `SECURITY.md` explains private vulnerability reporting through GitHub.

---

## 8. Testing and CI

### 8.1 Test layers

1. **Unit tests** (Vitest).
   - **Covered:** resolver, renderer, planner, config validation and error
     messages, keys, Keep mine and overrides, migrations.
   - **Golden-file tests:** fixture `stack.yaml` files with their exact expected
     `compose.yaml`.
   - **Coverage target:** at least 90% on resolver, renderer and planner.
2. **Adapter tests against a fake HTTP server.** These exercise retry on 5xx,
   4xx error surfacing, timeouts and malformed responses.
3. **End-to-end tests against real containers,** using the exact pinned
   versions. The suite:
   1. runs `apply` on a fixture stack and asserts the wiring through each app's
      API;
   2. runs `apply` again and asserts `No changes` (idempotency);
   3. mutates a managed field through the app's API, then asserts that `drift`
      reports it, Keep mine clears it, and Re-apply restores it;
   4. removes an app, then asserts that its container and links are gone and its
      `appdata/` remains;
   5. runs `docker compose up` without Mediaplane (ejectability).
4. **A real VPN kill-switch test.** A local WireGuard server container acts as
   Gluetun's custom provider. The test asserts that qBittorrent's egress goes
   through the tunnel, then stops the WireGuard server and asserts that
   qBittorrent has no route out.

**Plex.** Plex cannot be signed in from CI. Jellyfin paths are tested end to end
on every PR. Plex paths run in a nightly job that uses a token stored as a
GitHub secret, which is never exposed to fork PRs, plus a short manual
pre-release checklist.

### 8.2 CI/CD (GitHub Actions)

- **Every PR:**
  - lint and format checks, type-check, unit tests with coverage;
  - a multi-arch image build;
  - end-to-end tests on amd64 *and* arm64 runners;
  - the VPN kill-switch test;
  - Trivy and gitleaks;
  - a check that generated docs and the JSON Schema are up to date.
- **Renovate:**
  - **What it bumps:** catalog image pins (through a custom manager), npm
    dependencies, and Actions SHAs.
  - **What every app-pin bump runs:** the full end-to-end suite. This is what
    makes the tested-set guarantee true.
  - **Merging:** app-pin bumps are never auto-merged.
- **Releases:**
  - release-please builds versions and the changelog from Conventional Commits.
  - Multi-arch images go to `ghcr.io/cyclopsgd/mediaplane` with an SBOM and
    provenance. The repo is `cyclopsgd/Mediaplane`, but GHCR requires
    lowercase image names, so workflows lowercase the name.
  - Release notes include a generated "tested app versions" table.

---

## 9. Documentation

Documentation lives in the repo and is updated with the code.

- **`README.md`**
  - the pitch and quick start;
  - features;
  - an honest comparison with alternatives (§1.3);
  - an architecture diagram;
  - the wizard GIF, added in M2.
- **`docs/architecture.md`:** a condensed version of §3–§6, with diagrams.
- **`docs/reference/`, generated from code:**
  - the `stack.yaml` reference, from the Zod schema;
  - the published JSON Schema;
  - the CLI reference;
  - the `--json` output shapes.
- **`catalog/<app>/README.md`:** what Mediaplane manages in that app, its
  overridable fields, how to override them, and known issues.
- **`docs/adr/`:** the initial ADRs.
  - 0001 Don't fork upstream apps
  - 0002 Compose-native control plane
  - 0003 Drift: detect and warn, with Keep mine
  - 0004 Converge-forward apply (no automatic rollback)
  - 0005 TypeScript on Node
  - 0006 Seerr as the requests app
  - 0007 Bookshelf for books (experimental, behind an adapter; M4)
  - 0008 Docker socket proxy on by default
  - 0009 No secrets in `stack.yaml`
- **`docs/runbooks/`:** a consistent format of symptoms, checks, fix and
  prevention. M1 covers: VPN down, app won't start, wiring failed, and drift
  reported.
- **Other files:**
  - `docs/security/threat-model.md`
  - `SECURITY.md`
  - `CONTRIBUTING.md`, including a step-by-step "add an app" guide
  - `CHANGELOG.md`
  - `LICENSE` (GPL-3.0)

---

## 10. Risks and open questions

| Risk | Mitigation |
|---|---|
| Plex requires a plex.tv sign-in that cannot be automated | `user-provided` token. M2 adds a "Sign in with Plex" wizard step. Nightly CI uses a stored token |
| Seerr supports one media-server type per instance | One Seerr instance, bound to `media_server`. Switching servers is a documented re-setup |
| Byparr is lightly tested on arm64 upstream | The arm64 end-to-end tests cover it. FlareSolverr is a drop-in alternative (same Prowlarr proxy type) |
| The book-arr ecosystem is unsettled after Readarr's retirement | Out of M1. In M4, books sit behind an adapter, are marked experimental, and start with Bookshelf |
| Changes in `docker compose` CLI output or behaviour | `runtime` is the only consumer. The Compose version is pinned in the image. End-to-end tests catch regressions |
| Upstream API changes in a new app version | Tested-set pinning. Every Renovate bump runs end-to-end tests before merge |
| Recent upstream security changes (Servarr AllowedHosts/TrustedNetworks; Jellyfin 12 legacy auth off) are fresh and may shift again | Version floor (§6.5). Adapters set these explicitly rather than relying on defaults. End-to-end tests run on every bump |
| Plex steers new integrations toward 7-day JWTs. The legacy long-lived token may be deprecated | `plex-login` stores the legacy token. A token-refresh path is designed in if the legacy flow is withdrawn. Nightly Plex CI detects breakage |
| Seerr's settings and library API changed recently (by 3.5) | Pin Seerr. The adapter targets ≥ 3.5. End-to-end tests run on every bump |
| Sonarr v5 (new API) arrives | Stay on `/api/v3` until v5 is stable, then add a v5 adapter path selected by version |
| Byparr's FlareSolverr compatibility is confirmed in code but not advertised upstream | End-to-end tests run a proxied request through it. FlareSolverr is the fallback |
| Lost `state/` | Key recovery from appdata, plus name-based re-adoption (§6.1, §6.3) |

---

## 11. Refinements made while planning

These keep the spec's intent. They are grouped by the slice whose plan made them.

### Slice 2b: apply (2026-10-09)

- **Apply plans before it generates keys.** §5 lists keys before plan. Apply
  plans first (the plan names the keys it would generate), asks for
  confirmation, and only then generates and saves them. A cancelled apply
  therefore writes nothing.
- **The runtime also uses `compose run`.** Besides the commands in §3.2, it
  runs `docker compose run --rm --no-deps` for the appdata ownership helper: a
  throwaway container of the app's own image that runs `chown` as root.
- **Apply has an appdata ownership stage, between pull and start.** Apps that
  run as a fixed uid (Seerr runs as 1000) or as the stack's `user:` get
  `appdata/<app>` owned by that user before they start (§4.3).
- **Apps that are not healthy yet are part of the plan.** A running app whose
  health check is `starting` or `unhealthy` makes the plan changed, so after a
  failed start, running apply again waits for it again, and verify (§5 step 11)
  fails while it is still not healthy (ADR 0004).

### Slice 2c: packaging (2026-10-09)

- **Where the deployment lives.** It is `deploy/mediaplane.compose.yaml`,
  started with `docker compose -f deploy/mediaplane.compose.yaml up -d`. Until
  images are published (S8), it needs `MEDIAPLANE_IMAGE`, the image to run. It
  also needs `DOCKER_GID`, the group that owns the Docker socket.
- **The host helper does more than addresses.** Inside the container,
  Mediaplane can see neither the host's ports, nor its folders outside the home,
  nor its devices. So the helper container (§4.2) also reports them to
  preflight: free ports, the data folder, `/dev/net/tun` and free space, and
  whether the home's `stack.yaml` is the host's own. It runs Mediaplane's own
  image, with read-only mounts, during `init`, `plan` and `apply`. The one
  container created outside the managed project is the unnamed, `--rm` host
  helper, labelled `io.mediaplane.helper`.
- **The home is checked.** Preflight fails (`preflight.home-path`) when the home
  inside the container is not the same folder as the host's at that path (§4.1).
- **The proxy.** It is `wollomatic/socket-proxy`, with a per-method allow-list
  of the paths of the Docker API calls the engine makes. Of deletes, only
  containers' are allowed, and with them their anonymous volumes. The list
  allows `kill`, which `docker run` sends when a timed-out host helper is
  stopped (ADR 0008).
- **Trivy for Mediaplane's own image runs from S2c** (§7.2(7)), and so does
  `pnpm audit` of the CLI's production dependencies, which the image scan can't
  see because they are bundled. Neither sees Node itself. Scanning the catalog
  images, the SBOM and provenance stay in S8.
- **CI runs on arm64 from S2c** (§8.2), on GitHub's `ubuntu-24.04-arm` runners,
  which are free because the repo is public. The image is built, scanned and
  tested end to end natively on each architecture. A multi-arch manifest comes
  with publishing, in S8.
- **Generated references from S2c.** The `stack.yaml` reference, its JSON Schema at
  `docs/reference/stack.schema.json` (§4.2, §9) and the CLI reference are generated
  from code, and CI fails when they are stale. They move here from S8, by the owner's
  decision. The `--json` shapes stay in S8.

### Slice 3a: shared admin and pre-start files (2026-10-10)

- **S3 ships in four parts:** S3a (the shared admin and pre-start files), S3d (the
  VPN's kill-switch test and `vpn-check`), S3b (the wiring framework) and S3c (the
  download path), in that order. The roadmap gives each part's scope.
- **Pre-start files come from each app's `configFiles(ctx)`** (§4.3, §6.4), a pure
  renderer that replaces the `config-file` seeding step. Apply writes them in its files
  step, before any pull or start, only when they are absent: mode 0600, never
  half-written, with their folders created, and never through a link that leads out of
  the app's appdata folder. `plan` lists them as created "before first start", and
  never shows their content. It renders them from the secrets apply would generate, in
  memory only, to learn their paths.
- **Installs from before Slice 3a are reported, never overwritten.** A `config.xml`
  without `ApiKey`, a `qBittorrent.conf` without `WebUI\APIKey`, or Gluetun's
  `auth/config.toml` without an `apikey` line fails `plan` with `<app>.not-seeded`, and
  its hint gives the steps. A file Mediaplane can't read counts as seeded, because
  there is no way to tell. Slice 4 automates the fix, with the rest of "restore the key
  at the source" (§6.3).
- **The shared admin (§6.1).** `admin.username` is 3 to 32 letters, digits, `.`, `_`
  or `-`. A password of your own must be at least 12 characters
  (`admin.password-too-short`). Otherwise Mediaplane generates 24 base62 characters,
  keeps them in `state/secrets.json` as `shared.adminPassword`, and `plan` lists
  `admin.password` among the secrets to generate. It is generated for every stack that
  doesn't set `admin.password`, even before an app uses it. In Slice 3a only
  qBittorrent gets the login, through its pre-start file. Sonarr, Radarr and Prowlarr
  get it through their API in Slice 3b, though their `config.xml` already sets
  `AuthenticationMethod` and `AuthenticationRequired`.
- **`credentials` (§5.2)** prints the login, and the web address of each app that has a
  login. Its human output shows a generated password, as §6.1 says. `--json`
  (`mediaplane.credentials/v1`) leaves the password `null` unless `--reveal` is given.
  A password of your own is shown only with `--reveal`. Apps whose login is still to
  come say which slice brings it, from the catalog's `login`.
  - The addresses come from each app's port named `web`, on the stack's bind
    addresses. With `bind: all`, they are `127.0.0.1` and the host's private
    addresses.
  - It writes nothing, and needs no running container: only the host's facts, and a
    password that apply has generated.
- **`init` asks five more questions (§5.2),** each with a flag: the admin user name,
  whether to generate the password or read it from a file, `lan` or `localhost`
  (`localhost` on a cloud VM), the LAN subnet with `lan`, and the WireGuard address
  with a VPN provider.
  - It checks every flag it can before the first question, and on a terminal it asks
    again after a bad answer.
  - The LAN subnet must hold one of the host's private addresses. On a cloud VM, it is
    never offered, and `--bind lan` without `--lan-subnet` is refused.
  - "Ask for a login from your own network too?" is asked only with `lan`.
  - `--admin-password-file` must name a file inside the home, and
    `--vpn-addresses` needs `--vpn-provider`.
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
  Mediaplane trusts no subnet. `plan` warns (`network.no-lan-subnet`) when that keeps
  the LAN out of qBittorrent's web UI behind Gluetun, or, without the VPN, makes
  qBittorrent ask the LAN for a login although `login_on_lan` is `false`.
- **Mediaplane's own network joins `TRUSTEDNETWORKS` in M2, not M1** (§6.1). That
  setting names the proxies whose `X-Forwarded-For` header Sonarr believes.
  Mediaplane's own calls use API keys and send no such header, so the setting waits for
  the M2 panel, which proxies requests.
- **Apply retries a pull** (§5 step 7, §5.1) after a temporary registry error: a TLS
  handshake, I/O or client timeout, a reset connection, an unexpected EOF, an HTTP
  500, 502, 503 or 504, or a rate limit. It tries three more times, after 5, 15 and 45
  seconds. A missing image, a refused login or a name that doesn't resolve fails at
  once.
- **Change records grow by additive, optional fields within `mediaplane.change/v1`**
  (§5 step 12). Older records still parse. A field that changes meaning needs a v2.
  Slice 3a adds none; S3b's wiring actions will.
