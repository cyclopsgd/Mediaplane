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
└── appdata/                MEDIAPLANE (0700): only this folder; apply keeps it private
    └── <app>/              APPS: each app's config dir (sensitive; backed up in M3),
                            with the modes its image gives it
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
  that need one, such as Mullvad. It is one or more IPv4 or IPv6 addresses with a
  prefix length (CIDRs), separated by commas without spaces, and never an IPv6 zone
  such as `fe80::1%eth0/64`. Any other Gluetun setting is passed through
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
   - `/dev/net/tun` is present when a VPN is configured, and `/dev/dri` (a folder of the
     GPU's devices) when a media server sets `hardware_transcoding`;
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
| `init` | Write a starter `stack.yaml` and a `secrets/` layout. On a TTY it asks interactive prompts (media server, data path, VPN provider and its WireGuard address, LAN or localhost, the LAN subnet and whether the LAN must sign in (both only with LAN), the admin user name, and whether to generate its password); otherwise it takes flags. It checks every flag it can before the first prompt, including the format of `--vpn-addresses` (on a terminal, only the refusal of `--vpn-addresses` without `--vpn-provider`, and whether `--lan-subnet` fits this host, wait for the provider and bind answers), and asks again after a bad answer. It never overwrites an existing file. It also checks the home first, creates the data folder, adds a note before each question, and takes the WireGuard key on a hidden prompt (§11, Slice 3b) |
| `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (a key or password check can leave a mark in an app: §11, Slices 3c, 4, 5, 6 and 7; it never calls plex.tv); in the image it joins the wiring network, its only lasting change to Docker (§11, Slice 3b) |
| `apply` | Converge on `stack.yaml` (§5) |
| `status [app]` | Container health, VPN state, and the last apply's outcome |
| `drift` | Report drift only (§6.3) |
| `keep <path>` | Keep mine: record a drifted value or a deletion as an override |
| `history [id]` | List change records, or show one in full |
| `credentials [app]` | Show the shared admin login and per-app URLs (never printed in `--json` unless `--reveal` is given) |
| `plex-login` | Run the plex.tv PIN flow and save the token where `plex.token` names a file (`secrets/plex-token`), through a short-lived helper in the image (§11, Slice 7) |
| `vpn-check` | Check that qBittorrent reaches the internet only through the VPN: its network, Gluetun's state and the route into the tunnel, then its egress IP against the host's (`--no-egress` skips that) |
| `migrate` | Rewrite `stack.yaml` to the current schema version, preserving comments |

- **`plan`.** Exit 0 means no changes, 2 means changes are pending, 1 means an
  error (`--detailed-exitcode` semantics by default).
- **`apply`.** Interactive by default: it shows the plan and asks for
  confirmation. `--yes` skips the prompt. Ctrl-D or Ctrl-C at the prompt answers
  no. Exit 0 means success; the `--json` output includes `"changed": true|false`.
  Exit 1 means failed or partial.
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
  left without a network. Verify asserts both. Starting a stopped Gluetun again does not
  restart qBittorrent, so apply does (§11, Slice 3b).
- **Settings that need a restart.** Port, URL base, bind address, trusted
  networks and allowed hosts are set through env vars. Changing one makes
  Compose recreate the container; Mediaplane never changes these through the
  API.
- **Pre-start files.** `config.xml` (Sonarr, Radarr and Prowlarr),
  `qBittorrent.conf` and Gluetun's `auth/config.toml` are written only when they
  do not exist yet. After first start the API is the only write path, because
  the apps rewrite their own files. Gluetun doesn't rewrite its file, and reads
  it only when it starts.

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
     Compose project (its own `mediaplane-system` project is read-only to it, but for
     its own container's membership of the stack's wiring network: §11, Slice 3b).
     That is enforced in code.
   - The proxy can be disabled, with a warning.
3. **Mediaplane container hardening.** It runs as a non-root user with a
   read-only root filesystem, `no-new-privileges` and `cap_drop: [ALL]`. Its
   only writable mount is `MEDIAPLANE_HOME`.
4. **Secrets.**
   - Generated with a cryptographic RNG.
   - `state/secrets.json` and `generated/.env` are `0600`, and `state/` is
     `0700`.
   - `appdata/` itself is `0700` too. The apps rewrite their own files readable by
     all, and those files hold their keys, so only Mediaplane's user may enter the
     folder. Docker resolves bind mounts as root, so no app needs to pass through
     it. Each app's folder inside it keeps the modes its image gives it. Apply
     makes an existing `appdata/` private again on every run that goes ahead,
     including one with nothing else to change.
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
   - `mediaplane vpn-check` checks this topology, and compares qBittorrent's egress
     IP with the host's (§11, Slice 3d).
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
  images are published (S9), it needs `MEDIAPLANE_IMAGE`, the image to run. It
  also needs `DOCKER_GID`, the group that owns the Docker socket.
- **The host helper does more than addresses.** Inside the container,
  Mediaplane can see neither the host's ports, nor its folders outside the home,
  nor its devices. So the helper container (§4.2) also reports them to
  preflight: free ports, the data folder, `/dev/net/tun` or `/dev/dri` and free space, and
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
  images, the SBOM and provenance stay in S9.
- **CI runs on arm64 from S2c** (§8.2), on GitHub's `ubuntu-24.04-arm` runners,
  which are free because the repo is public. The image is built, scanned and
  tested end to end natively on each architecture. A multi-arch manifest comes
  with publishing, in S9.
- **Generated references from S2c.** The `stack.yaml` reference, its JSON Schema at
  `docs/reference/stack.schema.json` (§4.2, §9) and the CLI reference are generated
  from code, and CI fails when they are stale. They move here from S9, by the owner's
  decision. The `--json` shapes stay in S9.

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
- **`appdata/` is private, and `plan` says what apply will do to it (§4.1, §7.2(4)).**
  Only `appdata/` itself is `0700`; each app's folder keeps the modes its image gives
  it. Apply creates `appdata/` as `0700` and, on every run that goes ahead, makes an
  existing one `0700` again, even when nothing else would change (no change record is
  written for that).
  - **Another user owns it:** `chmod` fails, and apply stops with
    `apply.appdata-not-private` (`apply.files-failed` in the files step), naming the
    owner's uid and the uid Mediaplane runs as. The hint is to give `appdata/` itself,
    not what is in it, to Mediaplane's user (`MEDIAPLANE_UID` in its container).
  - **`plan` looks first, with `stat()` only.** It warns `appdata.not-owned` for that
    case, with the same hint. For any other mode than `0700` it notes
    `appdata.not-private` (a warning). Neither makes the plan "changed", because apply
    already does this without a change record; a missing `appdata/` gets no note,
    because apply creates it.
- **Installs from before Slice 3a are reported, never overwritten.** A `config.xml`
  without `ApiKey`, a `qBittorrent.conf` without `WebUI\APIKey`, or Gluetun's
  `auth/config.toml` without Mediaplane's role (`name = "mediaplane"`) fails `plan`
  with `<app>.not-seeded`, and its hint gives the steps. A file Mediaplane can't read
  counts as seeded, because there is no way to tell. Slice 8 automates the fix, with
  the rest of "restore the key at the source" (§6.3).
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
    again after a bad answer. Ctrl-D or Ctrl-C at a question stops it, writing nothing.
  - The LAN subnet must hold one of the host's private addresses. On a cloud VM, it is
    never offered, an empty answer is asked again, and `--bind lan` without
    `--lan-subnet` is refused.
  - "Ask for a login from your own network too?" is asked only with `lan`.
  - `--admin-password-file` must name a file inside the home, and
    `--vpn-addresses` needs `--vpn-provider`.
  - `--vpn-addresses` is one or more IPv4 or IPv6 CIDRs, comma-separated without spaces
    and with no IPv6 zone (Slice 3d, §4.2). `init` checks its format before the first
    question; on a terminal, only the "needs `--vpn-provider`" refusal waits for the
    provider answer.
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

### Slice 3d: the VPN's kill-switch test and vpn-check (2026-10-10)

- **The kill-switch test (§2.3 criterion 5, §8.1(4))** runs Gluetun's `custom` provider
  against a WireGuard server of its own (`lscr.io/linuxserver/wireguard`, pinned by
  digest) and an echo server that answers with the caller's address. CI loads the
  `wireguard` kernel module on both runners first. The test fails, and never skips,
  without it.
- **`vpn-check` (§5.2, §7.2(6))** always checks the structure: qBittorrent's network
  mode, that it joined the Gluetun now running, Gluetun's health, the VPN's status from
  Gluetun's control server (with `controlApiKey`, header `X-API-Key`), and that the route
  out goes into the tunnel. By default it also compares where qBittorrent's traffic and
  the host's leave from, through `https://1.1.1.1/cdn-cgi/trace`;
  `MEDIAPLANE_VPN_CHECK_URL` names another service, and `--no-egress` skips it. It exits
  0 on a pass, and 1 on a leak or a VPN that is down. Its `--json` is
  `mediaplane.vpn-check/v1`, where `ok` says the check ran and `verdict` what it found.
  Its last line claims no more than the checks found: it says nothing leaks only when
  Gluetun is stopped, or nothing answered while the route went into the tunnel or
  nowhere (`failClosed`). The default of asking Cloudflare was decided while planning
  this slice; the owner can still change it.
  - **The addresses were compared, and differed,** when the check with the id `egress`
    has the status `ok`. Equal addresses give `leak`. `egress.vpn` and `egress.host` can
    hold addresses without a comparison: an IPv4 and an IPv6 address are both known, but
    prove nothing.
  - **`failClosed` is true** only when qBittorrent was shown to be in Gluetun's network,
    and either Gluetun is stopped (exited, dead or created, or without a container), or
    nothing answered while the route went into the tunnel or nowhere. It is an
    inference, not a measurement. A route into the tunnel can't get out around the VPN,
    so there a service that stalls the TLS handshake only makes a working tunnel read as
    down. With the route outside the tunnel, no answer is still `down`, but never
    fail-closed: only Gluetun's firewall stands in the way, and the silence may come from
    a service this network can't reach, or from a TLS stall.
  - **It measures IPv4 only.** The route target is `1.1.1.1`, and the default URL is
    reached by an IPv4 address. An IPv6 check waits for Docker's IPv6 to be turned on; the
    roadmap lists it.
  - **The egress URL is not a secret.** It is shown in the output and in `egress.url`,
    and in the image it goes on the host helper's command line. It must carry no token.
    The host's request refuses a redirect and a URL with a user name or password, and
    only an address-shaped answer comes back. Run from source behind a Node env proxy
    (`NODE_USE_ENV_PROXY`, `--use-env-proxy`), or with a `DOCKER_HOST` that isn't a
    `unix://` socket, the host side isn't measured, so it is a warning (threat model,
    T13).
- **vpn-check needs no route of its own.** Its probe is a `compose run` of the
  `qbittorrent` service, so it starts in Gluetun's network namespace, in qBittorrent's
  own image, as nobody. It reaches Gluetun's control server on `127.0.0.1:8000` there,
  and gets the key on its standard input, never on a command line. It uses only Docker
  API calls that `apply` already makes. So it doesn't depend on how the Mediaplane
  container will reach the apps (Slice 3b, below), and the socket proxy allows nothing new.
  In the image, the host helper asks for the host's own address.
- **The runtime runs one-off commands and inspects containers (§3.2).** `run` is the
  `compose run` that the ownership helper's `chown` now uses too. `inspect` reads a
  container's network mode, start time and Compose project (`GET containers/{id}/json`),
  and refuses a container of any other project (§7.2(2)).
- **Gluetun started again on its own strands qBittorrent.** qBittorrent keeps the network
  namespace Gluetun had when qBittorrent started. Compose restarts qBittorrent when it
  recreates Gluetun (§6.4), but not when it only starts it again (verified with Compose
  5.5.1), so `apply` did not fix it in Slice 3d. `vpn-check` reports it from the two start
  times, and the "VPN down" runbook gives the fix by hand. Slice 3b has `apply` restart
  qBittorrent (below).
- **`vpn.addresses` (§4.2)** is one or more IPv4 or IPv6 addresses with a prefix length,
  separated by commas without spaces, as Gluetun's `WIREGUARD_ADDRESSES` takes them.

### Slice 3b: the wiring framework (2026-10-10)

- **Mediaplane reaches the apps over a private wiring network** (§3.2, §7.2; the owner's
  decision of 2026-10-10, [ADR 0011](../adr/0011-a-private-wiring-network.md)).
  - `compose.yaml` declares a network `wiring` with `internal: true`. Every app whose API
    Mediaplane calls joins it, beside its default network. An app in another app's
    network namespace is reached through that app, which joins for it: Gluetun, for
    qBittorrent, whose firewall counts the network as local.
  - Mediaplane's container joins it during `plan` and `apply`, and stays, so it is on two
    internal networks and has no route out. Apply steps off it before `up`, and back on
    in the wire step. The runtime joins only its own container, and only to its
    project's wiring network. To join, it reads the network first, strictly (it must be
    internal, a bridge, and carry the project's Compose labels for `wiring`), and joins
    by the ID it read. To leave, it reads the network and takes Mediaplane off by that
    ID, with no refusal of its own. That is the one change Mediaplane makes to
    `mediaplane-system` (§7.2(2)). The socket proxy allows nothing new.
  - Mediaplane's container sets `net.ipv4.ip_forward: 0`, so it cannot route between the
    proxy's network and the wiring network. Only the IPv4 key is set: the networks have
    no IPv6, and the IPv6 key fails on hosts without IPv6.
  - Run from source, nothing joins: the host reaches the apps' addresses on the network.
  - The apps are reached at their container's address there, with
    `Host: <service>:<port>`, as the other apps reach them.
- **An app's API is in the catalog** (§4.3): its port, a path that answers without the
  key once the app is ready, its key and how a request carries it (`X-Api-Key`, or a
  Bearer token for qBittorrent), and a path that answers only with the key. `plan` and
  `apply` check that path for every app with an API, before its resources.
- **The integration contract** (§3.2) is `catalog/<app>/integration.ts`: the apps it
  comes `after`, and its resources. Each resource has a one-segment name, so its address
  is `<app>.<resource>` and a field's is `<app>.<resource>.<field>`, as override keys are
  (§4.2). It lists its managed fields and its secrets, and says how to read it from the
  app, check its secrets, create it and update it. A resource may `require` others: one
  that failed skips it (§5.1).
- **The shared admin in Sonarr, Radarr and Prowlarr is a resource,** `<app>.admin`, not a
  `bootstrap-api` step (§4.3, §6.1): its user name is a managed field, and its password a
  secret, checked by signing in at `/login`. Apply sets it with the app's host settings
  (`PUT /api/v3/config/host/<id>`, `/api/v1` for Prowlarr), sending the rest back as it
  came; no restart is needed.
- **Without a login for local addresses, the Servarr apps take only listed Host names**
  (§6.1, §6.4). With `security.login_on_lan: false`, Mediaplane sets
  `<APP>__SERVER__ALLOWEDHOSTS` to the app's service name and the addresses its web UI is
  published on. The apps refuse to save their settings without it in that mode; it also
  stops DNS rebinding. `localhost` and `127.0.0.1` always pass. A name of your own goes in
  `apps.<app>.env`.
- **`state/resources.json`** (§4.1, §6.3) is `mediaplane.resources/v1`: for each resource,
  its id in the app (null for a singleton), its name, its managed fields as applied, the
  names of its secrets, and when it was applied. It never holds a secret's value or hash:
  secrets are checked by using them. It is written, 0600, after each resource that
  changes.
- **`plan` plans the wiring** (§5 step 5). For each app that is running, healthy and left
  as it is, in order, it checks readiness and the key, then each resource: `create`,
  `update` (naming what differs), `adopt` (the app holds it as wanted, but
  `resources.json` doesn't say so: re-adoption by name, §6.3), or `unchanged`. A resource
  of any other app is checked `after-start`. One Mediaplane couldn't ask is `unknown`,
  with a warning, and makes the plan changed. `plan` waits up to 15 seconds for an app;
  it changes nothing in the apps. In the image, when an app is running and left as it is,
  it joins the wiring network to ask it: the one lasting change `plan` makes, to Docker
  and not to the stack (the §5.2 row). It also runs the short-lived host helper, which
  leaves nothing behind.
- **The wire step** (§5 step 10) runs after `start`. It waits up to two minutes for each
  app, checks its key, and makes each resource what the stack wants, in the order of
  `after`. A resource that fails doesn't stop the others; one that requires it is
  skipped, and the step fails (outcome `failed`: `partial` is not used yet).
- **The typed HTTP client** (§3.2, §5.1) uses Node's `http` with an agent of its own, so
  a proxy from the environment never sees a key. It tries again a refused connection, a
  timeout, a cut connection, or a 502, 503 or 504, with exponential backoff and jitter,
  until the deadline; a POST only when nothing reached the app. Any other failing status,
  a 4xx or a 500 for example, fails at once, with the app's own message: Servarr's
  validation list, ASP.NET's problem details, or plain text, cut to 200 characters, and
  never an `attemptedValue`. It reads at most 5 MiB of an answer,
  and checks its shape with Zod, naming only the paths that don't fit. Every message has
  each key and password replaced with `***`, before an answer is collapsed or cut, and
  again after.
- **The runtime** (§3.2) gains, as `compose run` and `inspect` were added before:
  `docker network inspect`, `connect` and `disconnect` for Mediaplane's own container
  and the wiring network, each container's address on that network (from
  `docker container inspect`), and `compose stop`.
- **An integration's ports** (§5) come from the resolver's container ports, after
  `apps.<id>.port`, not from Compose's effective config: an override that changes a
  wired app's port is not followed yet.
- **Verify** (§5 step 11, §6.4, §7.2(6)) also runs vpn-check's checks, without the
  address comparison, when qBittorrent is behind Gluetun.
- **A stranded qBittorrent is restarted** (§6.4). `plan` lists it as `restart` when it
  started before Gluetun last did, or when Gluetun is stopped and apply will start it:
  Compose restarts it only when it recreates Gluetun. Apply stops it before `up`, which
  starts it in Gluetun's new network.
- **Change records** (§5 step 12) gain, within `mediaplane.change/v1`: the step `wire`,
  each action's `resource`, the plan's `wiring`, and the container action `restart`.
- **Housekeeping.**
  - The secrets store refuses to save a key it couldn't read back, such as one an app
    made with other characters, naming the key and never its value.
  - Apply writes `generated/.env` only when it changed, as `plan` says.
  - A hint that points to a runbook gives its address on GitHub, with the first thing to
    do before it where that is plain: from the image there is no copy of the repo.
  - `init` (§5.2) checks that it can create the home, or write into it, before its first
    question. It creates the data folder when it can, as the user it runs as, and never
    changes an owner or a mode; when it can't, its next steps give the `sudo` commands,
    and in the image a folder outside the home is left to you. On a terminal, a line or
    two before each question says what it is for, and with a VPN provider it takes the
    WireGuard private key on a hidden prompt, checks its shape, and writes it to
    `secrets/wg.key` (0600), never over an existing one.

### Slice 3c: the download path (2026-10-11)

- **qBittorrent through its API, after its first start** (§6.1, §6.2, §6.4). Four
  resources, all set with its key:
  - `qbittorrent.admin`: its user name, and its password, checked by signing in (204
    means it works, 401 that it doesn't) and set through its preferences, which need
    neither the old password nor a restart. A change of `admin.username` or
    `admin.password` now reaches qBittorrent. qBittorrent stops an address from signing
    in for an hour after five failed sign-ins in a row; that answer (403) is reported as
    it is, never read as a wrong password. A changed password costs one failed sign-in
    per `plan` and per `apply`, so four `plan`s, or declined `apply`s, before the `apply`
    are enough for a ban. That sign-in is sent once: it isn't sent again after it may
    have reached qBittorrent, such as after a timeout or a 5xx, so it never costs a
    second failure. Servarr's sign-ins keep their retries.
  - `qbittorrent.preferences`: the default save path `/data/torrents`, Automatic Torrent
    Management on (§11, Slice 3a), and who may skip the login: the LAN subnets, only with
    `security.login_on_lan: false` while the web UIs are on the LAN, as its pre-start file
    sets them. A change of those settings now reaches qBittorrent. This adds
    Automatic Torrent Management and the whitelist to §6.2's managed fields. §6.4 keeps
    trusted networks out of the API, but qBittorrent's whitelist is set through it: unlike
    Servarr's `TRUSTEDNETWORKS`, it has no environment variable and needs no restart. A
    `network.lan_subnet` typed with host bits, such as `192.168.1.10/24`, is read as its
    network, `192.168.1.0/24`, the form qBittorrent keeps, so the whitelist settles.
  - `qbittorrent.category_tv` and `qbittorrent.category_movies`, saving to
    `/data/torrents/tv` and `/data/torrents/movies`, each while Sonarr or Radarr is in the
    stack. A category is known by its name.
- **Sonarr's and Radarr's download client** (§6.2): `<arr>.download_client`, named
  `qBittorrent (Mediaplane)`, with the fields §6.2 lists and qBittorrent's key as its
  secret. Its host is how the arr reaches qBittorrent: `gluetun` behind the VPN, whose
  network qBittorrent shares, or `qbittorrent`; its port is qBittorrent's own. It is made
  from the arr's own template. The arr tests a new client as it saves it, with
  `forceSave` too, which skips only its warnings, so a create fails while the arr can't
  reach qBittorrent. It is updated by sending the client back as the arr gave it, so its
  other settings stay the user's, with `forceSave`, which skips the arr's test: an update
  is saved even while qBittorrent is down. Its key is checked with the arr's own test of
  the client it holds (the key masked): a refused key is planned as an update; any other
  failure, such as qBittorrent out of the arr's reach, is the arr's own message
  (`unknown` in `plan`, a failure in apply and verify). It `requires` qBittorrent's
  category, because the arr's test makes a missing one with no save path, and Sonarr and
  Radarr come `after` qBittorrent. While the category is to be made, `plan` checks the
  client's fields only, never its key, so that the arr's test can't make the category
  (`plan` changes nothing: §5.2, §6.3); the wire step checks it once the category is
  there. The arr's test also makes a missing post-import category (Sonarr's
  `tvImportedCategory`, Radarr's `movieImportedCategory`), which Mediaplane doesn't
  manage, so a `plan` makes one again in qBittorrent when you set it in the arr and later
  delete it in qBittorrent. A test that fails also records a failure in the arr's status
  of that client (`DownloadClientStatus`), as a test from the arr's web UI does, and a
  later pass resets it (probed in Slice 4).
- **Sonarr's and Radarr's root folder** (§6.2): `<arr>.root_folder`, `/data/media/tv` or
  `/data/media/movies`, known by its path (the arrs can't change one). The arr needs the
  folder to exist, so the wire step makes it first, with `mkdir -p` in a throwaway
  container of the arr's own service (`compose run`), as the stack's `user:`. A changed
  path would add a root folder, and leave the old one.
- **The integration contract** (§3.2) grows: a resource's `desired` sees the stack's
  keys, its `verify` what the app holds, and it may name `folders` to make first. While a
  managed field differs, the secrets aren't checked, because the update sets them anyway.
  `plan` also leaves them unchecked until a resource they `require` is in place
  (`unchanged` or `adopt`) and checked. Apply's wire step doesn't check again a secret
  its own plan found refused: it sets it. In `plan`, a resource the app refuses leaves
  the app's others to be checked. An app that stops answering, or keeps failing with a
  502, 503 or 504, leaves the rest of it `unknown`, so `plan`'s 15 seconds are the
  app's, not each resource's. `plan` reports a managed field that holds a secret
  (`wire.secret-field`), which apply refuses.
- **The typed HTTP client** (§3.2, §5.1) also sends a form with the key (qBittorrent's
  API), runs an app's own test (a 2xx passes; a 400 gives the errors of Servarr's
  validation list, never a warning or an `attemptedValue`), and takes a sign-in's 401 as
  its answer. A refusal of a call made without the key no longer blames the key. Its
  messages keep a secret out in each form an app may echo it in, nested ones too, such as
  a password JSON-escaped inside a form field, or a JSON body quoted in an HTML page.
- **No new Docker API call.** The folder helper is a `compose run`, as the ownership
  helper and vpn-check's probe are; the socket proxy allows nothing new (§7.2(2)).

### Slice 4: indexers (2026-10-15)

- **Prowlarr's links to Sonarr and Radarr** (§6.2): `prowlarr.application_sonarr` and
  `prowlarr.application_radarr`, Prowlarr's applications `Sonarr (Mediaplane)` and
  `Radarr (Mediaplane)`, each while that arr is in the stack.
  - The managed fields are §6.2's: `prowlarrUrl` (`http://prowlarr:9696`, how the arr
    reaches Prowlarr back), `baseUrl` (`http://sonarr:8989` or `http://radarr:7878`, how
    Prowlarr reaches the arr), `syncLevel` (`fullSync`) and `syncCategories`, Prowlarr
    2.6's own default categories for that app, kept as one sorted list. `apiKey` is the
    link's secret, not a compared field, as qBittorrent's key is the download client's
    (Slice 3c): Prowlarr shows it masked.
  - The key is checked with Prowlarr's own test of the link it holds, sent masked with
    its id, which calls the arr with the key and has the arr call Prowlarr back: a
    failure that names `ApiKey` is an update; any other is Prowlarr's own message. A link
    is made from Prowlarr's template with `forceSave`, which still tests a new one, and
    updated with `forceSave`, which doesn't. A test that fails records a failure in
    Prowlarr's status of that link (`ApplicationStatus`), as a test from its web UI does,
    and a later pass resets it, so a `plan` that finds a key refused leaves that record
    (probed).
  - Each `requires` its arr's `admin`, the first thing Mediaplane checks in the arr. While
    the arr isn't up, refuses its key, or has its admin yet to be set, `plan` leaves the
    link's key unchecked, rather than report Prowlarr's test failing on the arr, and the
    wire step skips the link when the arr's admin fails (§5.1).
- **The indexer proxy** (§6.2): `prowlarr.indexer_proxy`, named `Cloudflare (Mediaplane)`
  whichever solver runs, so a change of solver is an update, and lost state finds it by
  name. Its type is FlareSolverr, which Byparr answers too. Its `host` is
  `http://byparr:8191/`, or `http://flaresolverr:8191/`, its `requestTimeout` 60 seconds
  (Prowlarr's default), and its `tags` `cloudflare`, compared as labels. Apply asks
  Prowlarr for the tag as it makes or updates the proxy: Prowlarr gives back the one it
  has, or makes it.
  - It holds no secret, so Mediaplane never tests it (§6.3). §6.2's secret-check column
    names Prowlarr's test of it; Prowlarr runs that test itself when it creates the
    proxy: it has the solver fetch `https://prowlarr.servarr.com/v1/ping`. So the
    `apply` that makes the proxy needs that page within the solver's reach, and `plan`
    never sends the test. `plan` still reads the proxy and compares its host, timeout
    and tags.
  - FlareSolverr gets a health check (`/health`), so that `up --wait` waits for it before
    the wire step makes the proxy. Byparr has one already.
- **Indexers stay yours** (§6.2). The end-to-end test adds made-up Torznab indexers,
  served by a container of its own outside the stack, and never a real one: Prowlarr
  syncs them to Sonarr and Radarr, and fetches those tagged `cloudflare`, behind a
  stand-in Cloudflare challenge, through Byparr's browser, then FlareSolverr's (§10,
  Byparr's risks). Byparr's health check and Prowlarr's test of the proxy need the
  internet.
- **A link stays when its arr leaves the stack**, and Prowlarr's indexer proxy, when the
  stack drops its Cloudflare solver, as a download client stays when qBittorrent leaves:
  Mediaplane doesn't remove what it made yet. Slice 8 decides, with §8.1(3) step 4.
- **One way to wire a Servarr provider.** The arrs' download client and Prowlarr's links
  and proxy share how they are found (by id, else by name, among the app's providers of
  that kind), made from the app's template, and updated; the download client and the
  links are also tested.
- **No new Docker API call.** The new calls are the apps' APIs over the wiring network
  (§7.2(2)).
- **The slices after S4 are renumbered** (the owner's decision, 2026-10-15): S5 Jellyfin,
  S6 requests, S7 Plex, S8 drift and S9 release. The roadmap keeps the history.

### Slice 5: Jellyfin (2026-10-15)

- **Bootstrap before publish** (§5 steps 8 and 9, §6.4). An app whose first-run setup
  anyone who reaches it could finish declares it in the catalog (`bootstrap`), with the
  file in its appdata that says it is done.
  - **Which apps, and when.** `plan` lists an app to set up when its key isn't stored, or
    its appdata doesn't say its setup is done (Jellyfin's `system.xml`,
    `IsStartupWizardCompleted`), under `First-run setup:` (`bootstrap` in `--json`). It
    starts without its ports unless its appdata says the setup is done: then nobody can
    claim it, and apply only signs in to make its key. A file Mediaplane can't read says
    nothing, so the stored key decides. `plan` never runs a setup; it shows the app's
    container recreated when it runs published, and checks its wiring after the start.
  - **No published port.** The start step gives Compose one more file, on its standard
    input, after `compose.override.yaml`, that sets the app's `ports` to `!reset []`
    (Compose 2.24 and later, the floor preflight checks), so the override's ports go too.
    `compose.yaml` itself always holds the ports, so the stack runs as written without
    Mediaplane.
    - §6.4's guarantee holds while `apply` runs the stack. `!reset` covers `ports`
      only, so an override that changes Jellyfin's network (`network_mode: host`, or a
      network shared with a service that publishes), or the stack run outside
      Mediaplane, voids it (threat model T16).
  - **The bootstrap step** is a new step, after `start`, run only when `plan` lists a
    setup. It reaches the app over the wiring network without a key, finishes its setup
    as the shared admin, and keeps the key it makes in `state/secrets.json` at once (§5
    step 4). Then it steps off the wiring network, as the start step does (Slice 3b, ADR
    0011), and runs `up` again without that file, and Compose recreates the app with its
    ports. §5 step 9's and §6.4's "re-render with ports" is this second `up` of
    `compose.yaml` as written: nothing is rendered twice. An app whose setup failed while
    it is still open stays unpublished; one whose setup is done is published even when
    making its key failed. An app the plan started unpublished whose shared admin is
    then refused (`Bootstrap.run` throws an `auth` failure) stays unpublished, whatever
    it says of its setup: someone else finished it while Mediaplane set it up, or, when
    its `done` file can't be read, it may have been set up by hand. The step reads the
    file again, and its error says which, so that it never advises starting afresh an
    app the user set up. One the plan started published, done by hand before, is left
    published.
  - **The re-check, and two plan diagnostics.** Before publishing an app, the engine asks
    the app once more whether its setup is still open (`Bootstrap.open`), and publishes
    it only if it is not; if it still looks open, or can't be asked, the step fails and
    that app stays unpublished, though it keeps the key it made. For an app the plan
    started published, the error says that it is published, and to stop it. `plan` warns
    `bootstrap.unreadable` when it can't read the file that says the setup is done while
    a key is stored, since it can't tell whether the setup is open; and fails with
    `bootstrap.network-via` for an app with a setup that runs inside another app's
    network, which publishes its ports (no catalog app does).
  - **No new Docker API call:** `up`, and a recreate, are what `apply` already does, and
    the file goes on Compose's standard input (§7.2(2)).
- **Jellyfin's setup** (§6.1), as Jellyfin 12.2 takes it: `GET /Startup/User` first,
  which makes its first user (`POST /Startup/User` before it is refused, and a
  `POST /Startup/Complete` without a user leaves a Jellyfin nobody can sign in to); then
  `POST /Startup/User` with the shared admin (a 403 says a password is set already, from
  a setup that stopped before it was done); then `AuthenticateByName`, which Jellyfin
  takes before the wizard is completed, then `POST /Startup/Complete`. A first user the
  shared admin can't sign in as isn't Mediaplane's: the wizard is left open, and the step
  fails. The key is the newest named `Mediaplane` in `GET /Auth/Keys`, which lists keys
  in full, else one made with `POST /Auth/Keys?app=Mediaplane`, which answers nothing,
  read back from the list; then the session is signed out of. Every call carries
  Jellyfin's client fields in `Authorization: MediaBrowser …`, with `Token="…"` once
  there is a key: a sign-in without all four fields is refused (400).
- **Jellyfin's health check** passes only once `/health` answers `Healthy`. At every
  start, it answers 200 `Degraded` for a few seconds while the rest answers 503, then
  Jellyfin restarts its server (probed).
- **Jellyfin's resources** (§6.2):
  - `jellyfin.admin`, the shared admin: known by the id `state/resources.json` records,
    else by the admin's user name, so an integration's `observe` now sees what the stack
    wants. Its password is checked by signing in and out again, which Jellyfin's
    activity log records, as it does any sign-in: a third small mark `plan` can leave in
    an app (§5.2). Jellyfin doesn't lock its admin out after failed sign-ins (none after
    seven, probed). It is renamed, or given its password, with the key; Mediaplane makes
    no other user.
  - `jellyfin.library_movies` and `jellyfin.library_shows`: `Movies` (`movies`,
    `/data/media/movies`) and `Shows` (`tvshows`, `/data/media/tv`), with §6.2's fields,
    `paths` kept as one sorted list. They are named as §6.2 names them, without
    "(Mediaplane)": they are what you browse. Each is known by its name: Jellyfin's id
    for a library follows its folder, which a rename changes. Its folder is made first,
    in a throwaway Jellyfin container. Jellyfin names a second library of one name
    `<name>2`, so one is made only when none has the name, and it can't change what a
    library holds, which an update refuses with what to do. A new library gets the
    options Jellyfin's web UI gives one: its default metadata and image downloaders,
    from `/Libraries/AvailableOptions`, internet metadata and real-time monitoring. A
    library made without them still gets its metadata, but doesn't watch its folders.
- **Sonarr's and Radarr's connection to Jellyfin** (§6.2): `<arr>.connection_jellyfin`,
  an Emby / Jellyfin connection (`MediaBrowser`) named `Jellyfin (Mediaplane)`, with
  host `jellyfin`, Jellyfin's container port and `updateLibrary`. `apiKey` is its secret,
  checked with the arr's own `POST /notification/test`: a failure that names `ApiKey` is
  an update. It is made with the triggers on that change a file: an import, an upgrade, a
  rename, and the deletes; they stay the user's after that. The arr tests a new
  connection with a trigger on as it saves it, `forceSave` or not; an update with
  `forceSave` isn't tested. A test that fails records a failure in the arr's status of
  the connection (`NotificationStatus`), and a later pass resets it, as for the download
  client and Prowlarr's links (probed). Each requires `jellyfin.admin`, and the arrs come
  `after` Jellyfin: while Jellyfin is to be set up, or refuses its key, `plan` leaves the
  connection's key unchecked.
- **The typed HTTP client** (§3.2) gains Jellyfin's ways: the `mediabrowser` key scheme,
  a sign-in with a JSON body that takes 401 as its answer, a POST or DELETE whose answer
  isn't read, and the same app with another key (a session's).
- **One helper for an app's address** (`serviceAddress`): its service, or the service
  whose network it runs in, and its container port. The download client, Prowlarr's
  links and proxy, and the connection all use it.
- **Jellyfin's key, deleted by hand,** shuts Mediaplane out of Jellyfin, and `plan` says
  so. Removing it from `state/secrets.json` has the next `apply` sign in, make a new one,
  and give it to the arrs' connections; Slice 8 automates that, with key recovery.

### Slice 6: requests (2026-10-16)

- **Seerr's first sign-in is a first-run setup, before it is published** (§5 step 9,
  §6.1, §6.4). Until its first sign-in, Seerr 3.5 lets anyone who reaches its port sign
  in through a Jellyfin of their own choosing (`POST /api/v1/auth/jellyfin` with a
  `hostname`) and be its admin, and its key does nothing (403) until that admin exists
  (probed). So Seerr has a `bootstrap`, as Jellyfin does, and starts unpublished.
  - §6.4's guarantee holds for Seerr as it does for Jellyfin: while `apply` runs the
    stack. An override that changes Seerr's network, or the stack run outside
    Mediaplane, voids it (threat model T16).
  - **Done** is its `settings.json` naming a media server (`mediaServerType` 1 to 3; 4
    is none), and Mediaplane's record that the setup is its own. Its key is Mediaplane's
    (`API_KEY`), so a setup may make no key, and then no key tells whose setup it is.
    The record is `setUp` in `state/secrets.json`: a sorted list of app names, written
    only when it is not empty. A keyless setup counts as done only when its file says so
    and `setUp` names the app. The record is made, at once, by a setup that succeeds or
    that shows the app is Mediaplane's, and not by a claimed or waiting one. It is
    dropped, and the store written at once, when a pending keyless setup runs, and made
    again only by a success. A Seerr set up before this slice has no record, so it is
    checked once, unpublished, then recorded. A file Mediaplane can't read has the app
    start unpublished, and set up again, on every `apply` (`bootstrap.unreadable`), and
    each such `apply` fails at verify (exit 1), until the file is readable.
  - **The setup** signs in through Jellyfin, at Jellyfin's service and container port,
    as the shared admin, which makes it Seerr's admin and Jellyfin Seerr's media server,
    then signs out (`POST /api/v1/auth/logout`, with the session's cookie, which the
    typed client keeps out of every message). A Seerr found set up when its setup runs
    (with no record, or its file not saying so when `apply` started it) is Mediaplane's
    only when its admin (its first user) is the shared admin and its Jellyfin the stack's
    (`jellyfin:8096`, with no URL base and no TLS: Seerr adds `urlBase` after the port,
    so `@<host>` there is another host), asked with its key: the password is never sent to
    it, since Seerr would pass it to its own Jellyfin. So is one found set up when the
    sign-in fails: someone inside the stack may have signed in between the look and the
    sign-in, and Seerr then refuses a second Jellyfin (500). Any other is refused as
    claimed (`auth`), and stays unpublished. Those two questions fail closed: one that
    can't be answered (a timeout, a 5xx) is refused as `auth` too, with "couldn't tell
    whether it is its own"; an answer that doesn't show the setup is Mediaplane's
    (another shape, a 4xx) is refused as claimed, with "its answers don't show that it
    is Mediaplane's". A setup with no key that fails in any other way never
    publishes its app either, whatever the app then looks like. A setup that waits keeps
    its app unpublished and is asked once more: if someone else finished it meanwhile, it
    fails with the claimed message and stays unpublished.
  - **Order, and waiting** (the roadmap's S6 item). The setups run in the order of the
    apps' integrations, so Seerr's comes after Jellyfin's. A setup may wait
    (`SetupWaiting`): Seerr's, while Jellyfin refuses the shared admin's password, and
    any setup after an app whose own setup failed or waits. A setup that waits leaves its
    app as it was, unpublished; the step warns (`bootstrap.waiting`) and doesn't fail, the
    wire step skips that app's resources (and what requires them), and verify fails with
    the setup still listed. So a Jellyfin whose admin password changed gets it set by the
    wire step, and the next `apply` signs Seerr in. The roadmap's sign-in that `requires`
    `jellyfin.admin` is this wait: a setup runs before the wire step, so it can't require
    a resource; Seerr's link to Jellyfin requires it.
  - **With Plex, Seerr wasn't wired by this slice:** the resolver left out its API,
    integration and setup on a Plex stack, so nothing called it there, and its `login`
    said Slice 7, until Slice 7 wired it and removed that (below). Its login is
    `'shared'` with Jellyfin, through Jellyfin.
- **Seerr's resources** (§6.2), after Jellyfin, Sonarr and Radarr, and Prowlarr when the
  stack has it (so §6.2's order doesn't rest on an id tie-break):
  - `seerr.media_server`: Jellyfin at its service and port (`hostname` and `port`, as
    Seerr's settings `ip` and `port`), with the Movies and Shows libraries enabled
    (`libraries`, those of Mediaplane's that are enabled; one you enable is yours). Its
    `apiKey` is the key Seerr holds for Jellyfin, which Seerr made itself in its first
    sign-in and shows in clear: once read, it is redacted for the rest of the run, as
    the stack's own secrets are. It is checked by using it, never compared, through
    Seerr's list of Jellyfin's users, which fails (500) while Jellyfin refuses it
    (probed). Mediaplane gives Seerr its own Jellyfin key only when Seerr's is refused, or
    Jellyfin's address changes. Seerr's `useSsl` and `urlBase` are part of that address:
    with either set, `hostname` is observed as the URL Seerr calls, so it differs, and the
    update sends `useSsl: false` and `urlBase: ''`. `hostname` is never sent: it is the
    sign-in's field, which Seerr refuses once set (500), and a stray setting in
    `/api/v1/settings/jellyfin`. Libraries are synced from Jellyfin, then enabled one at a
    time; they are synced again when Jellyfin's address changes, since another Jellyfin
    has other library ids. It requires `jellyfin.admin` and both libraries.
  - `seerr.server_sonarr` and `seerr.server_radarr`, named `<Arr> (Mediaplane)`, each
    while the stack runs the arr: `hostname`, `port`, `activeProfile` (the profile's
    name), `activeDirectory` (the arr's root folder) and `isDefault`; `apiKey` is a
    secret. Seerr shows the key in clear, but it is still checked, never compared, as
    §6.3 says, with Seerr's own test (`POST /api/v1/settings/<arr>/test`) of the server
    it holds, at the stack's address for the arr with no URL base, since the key it holds
    may be the stack's. With TLS or a `baseUrl` held, `hostname` is observed as the URL
    Seerr calls, so the server reads as changed and is put back. Seerr's test fails with
    one 500 whatever the cause (probed), so a failure is tested again with the stack's
    key, at the stack's address for the arr: a pass then means the key was refused (an
    update); a second failure is Seerr not reaching the arr. A server is saved whole, its
    id read-only (probed), and made with what Seerr's web UI gives a new one, but with
    season folders on for Sonarr, Sonarr's own default; Radarr's are off, as films have no
    seasons. Each key Seerr shows for a server is redacted once read. Each requires its
    arr's root folder.
  - `seerr.setup`: `initialized`, set by `POST /api/v1/settings/initialize` while it is
    false, once Seerr's links are in place, which it requires. Seerr takes it again
    (probed), but it is sent once.
- **Seerr's default profile** (§6.2) needs the arr's profiles, which only the arr has.
  A resource may now `resolve` what only the app can say, before its fields are compared:
  the servers ask the arr through Seerr's test. `apps.seerr.sonarr_profile` and
  `radarr_profile` name a profile; one the arr lacks fails, listing those it has. `plan`
  leaves it unresolved, and those fields uncompared, while a resource it requires is
  still to be put in place, as it leaves secrets unchecked. Every other field, and every
  field of a resource without `resolve`, is compared as before.
- **`plan`'s marks** (§5.2): Seerr's checks leave nothing in its settings, but each that
  fails logs a line in Seerr's log, and a test with a key the arr refuses logs one in the
  arr's (probed). A passing check logs nothing.
- **Keys go only to the stack's own addresses.** An arr's key, Jellyfin's key and Seerr's
  own key are sent only to the stack's address for that app (`serviceAddress`), with no
  URL base, never to a host, port or URL base read from Seerr, which anyone with Seerr's
  admin can change (Seerr adds a server's `baseUrl` after the port, so `@<host>` there is
  another host). That holds for the servers' second test too: it carries the stack's
  key, the stack's address and `baseUrl: ''`, as the create and the update do.
- **Seerr's key** is generated, set through `API_KEY`, which Seerr takes at every start,
  and written by Seerr into `settings.json` (`main.apiKey`) at its first start (probed).
  A key Seerr's web UI makes anew lasts until Seerr restarts.
- **A request reaches the arr through outside services:** Seerr looks the title up on
  TMDB, and the arr looks it up again on its own metadata service. So the end-to-end
  test of the whole stack (success criterion 1) stops at the links: Seerr signed in
  through Jellyfin, linked to Jellyfin with both libraries and to both arrs, each passing
  Seerr's own test, a second `apply` with no changes, and hand changes put back.
- **The typed HTTP client** gains a sign-in whose session lives in a cookie, kept out of
  every message, and a sign-in's fields of any JSON type.
- **Secrets read in an answer** (§6.3): a key Mediaplane reads in clear, which it didn't
  know when the run started, joins the run's redaction from then on
  (`AppApi.addSecret`): the clients', `plan`'s diagnostics, and the bootstrap and wire
  steps' failures, which go into the change record. Those are the keys Jellyfin lists,
  the key Seerr made itself in Jellyfin, and the keys Seerr shows for its servers.
- **No new Docker API call:** Seerr's setup is the same unpublished `up` and recreate as
  Jellyfin's (§7.2(2)).

### Slice 7: Plex (2026-10-16)

- **plex.tv, from the image, through a short-lived helper** (§3, §7.2, ADR 0012).
  Mediaplane's container has no route out (ADR 0011), and the proxy's allow-list stays
  as it is. Each plex.tv call is one `docker run --rm --interactive` of Mediaplane's own
  image, `mediaplane plex-tv`, on Docker's default `bridge` network: it has a route
  out, and reaches neither the wiring network nor the stack's own (probed), where the
  host network reaches both (probed). It has no mount, no socket, no capability, a
  read-only root, `no-new-privileges`, Mediaplane's user, `--pull never`, and the label
  `io.mediaplane.helper=plex-tv`. Its request, with any token in it, is one line of JSON
  on its standard input (`mediaplane.plex-tv/v1`), never on a command line or in its
  environment, and its answer one line on its standard output. It takes four strict
  requests (a PIN, the wait for its sign-in, a claim token, and the account a token is
  of), and fixes the address: plex.tv's own. Each run may take as long as the client's
  three tries and the waits between them, with a minute more for the container (170 s);
  a helper that runs out of time is plex.tv unanswered (`unreachable`, so unsure), as the
  client would have said. `docker run -i` uses `create`, `attach`, `start` and `wait`,
  which the allow-list has for the host helper. The default bridge reaches the host's
  published ports, the LAN and other containers on it too, which is harmless while the
  helper's code and plex.tv's address are fixed. Run from source, the CLI calls plex.tv
  itself: ADR 0011 keeps only the container offline. The client has an HTTPS agent of
  its own, reads at most 1 MiB, tries a GET twice more after 5 and 15 seconds when
  plex.tv didn't answer, failed (5xx), asked it to wait (429) or refused the request
  but not the token (403), never a POST, and its messages name the method and path
  only, never a query or a value.
- **What plex.tv's answers mean.** Only a 401 is "refused" (`refused`). A 403, a 429, a
  5xx or no answer is "couldn't tell" (`unsure`), and so is a helper that fails or runs
  out of time (`unreachable`), or Docker failing on the way to plex.tv (`failedCall`,
  which names only the error's kind). A 404 for a sign-in's PIN is `expired`; another
  answer, or a helper answer Mediaplane doesn't understand, is `protocol`, which Plex's
  and Seerr's setups refuse (`rejected`). Each keeps Plex and Seerr unpublished.
- **`mediaplane plex-login`** (§5.2, §6.1). It asks plex.tv for a strong PIN (25
  characters, 30 minutes, probed), prints a link to `app.plex.tv/auth` with it, and asks
  every two seconds until someone signs in, the PIN runs out, or `--timeout` seconds
  (1 to 1800) pass. The PIN belongs to a client id made for that sign-in
  (`mediaplane-<uuid>`), which only can read it (probed: another id gets 404), and to the
  product `Mediaplane`; the account's other calls use the fixed id `mediaplane`, which
  adds no device (probed). The token is the account's long-lived one, which the PIN
  gives (§10). It is saved, 0600, never half-written, where `plex.token` names a file;
  `secrets/` is made 0700. A saved token plex.tv takes is kept unless `--force`; one it
  refuses (401) is replaced; one plex.tv can't say about ("couldn't tell", above) is
  kept, and the message says so, with `--force` as the way past. "Couldn't reach
  plex.tv" means no answer at all. A token file or `secrets/` folder that can't be read
  stops it before any PIN, even with `--force`. A `plex.token` read from the environment
  is refused: there is nowhere to save it. It prints the link, never the token, and
  with `--json`, `mediaplane.plex-login/v1`, with the link on stderr.
- **Plex is claimed before it is published** (§5 step 9, §6.1, §6.4). An unclaimed Plex
  answers anyone who reaches it at an address, and `POST /myplex/claim` claims it for
  the caller's account with no sign-in (probed: 200). So Plex has a `bootstrap`, keyless
  as Seerr's (its key is your token), and starts unpublished.
  - **The claim token** is fetched by the start step, just before `up`, with your token
    (`GET /api/claim/token.json`), and only for an app the plan starts unpublished whose
    appdata says its setup isn't done (`Bootstrap.firstStart`): a `Preferences.xml`
    Mediaplane can't read gets none, as the setup can't succeed until it can. It lasts four minutes and works once. It
    reaches Plex as `PLEX_CLAIM`, in the extra Compose file on standard input, as
    `"${MP_START_PLEX_PLEX_CLAIM}"`, which Compose takes from its environment (Compose
    2.38.2 and 5.5.1, probed); the publishing `up` doesn't pass it. It is redacted in
    `up`'s errors. It is fetched before the start step changes anything (before
    Mediaplane leaves the wiring network, and before the VPN's guests are stopped). With
    no token, or no claim token, the step fails, and stops every running app the plan
    starts unpublished, Plex, and Seerr, naming each: an app whose setup isn't done isn't
    shown to be yours, and must not stay published, as a Plex an `apply` before this
    slice published unclaimed, or a Seerr set up by hand then, would. An error that isn't
    the setup's own is said by its kind only, whether or not anything ran. Plex's
    setup never holds your token: only the one read of its settings, once ownership is
    proven, carries it.
  - **The setup** waits, as long as `apply` waits for an app (`AppApi.until`), until
    `/identity`, asked without your token (`until`'s `anonymous`, as `open` and the
    re-check before publishing ask it), says `claimed`: the image starts Plex once for its
    config, unclaimed, and the container can be healthy then (probed). Then plex.tv is
    asked whose account (`GET /api/v2/user`) the token in Plex's `Preferences.xml`
    (`PlexOnlineToken`) is, which plex.tv answers with the server's owner (probed), and
    whose your token is. Not the same is claimed (`auth`). Plex's admin can set its
    machine identifier (`PUT /:/prefs?MachineIdentifier=…`, probed), so that can't decide,
    nor can anything else Plex says; Plex can hold a token of your account only through a
    claim token of yours. Plex's token refused (401, as once the server is removed from
    its account, probed) is claimed too; plex.tv unsure (a timeout, a 5xx, a 429, a 403,
    no connection, a helper that fails or runs out of time, or Docker failing on the
    way) is `unsure`, as is a claimed Plex whose file holds no token; your token
    refused, an answer not understood (plex.tv's or the helper's), or the file
    unreadable, is `rejected`. All
    keep Plex unpublished, as any failure of a keyless setup does. Only then does Plex get
    your token: the setup reads its preferences (`GET /:/prefs`), and refuses (`rejected`)
    a Plex that could let a client in without a sign-in: `allowedNetworks` not empty,
    `enableLocalSecurity` other than `-1` (Plex's default; a claimed Plex at `-1` refused
    a client with no token, probed) or `1`, or `DlnaEnabled` not off, or any of them
    missing or of another type (`OPEN_SETTINGS`). Anyone could set them over
    `PUT /:/prefs` while Plex was unclaimed, and they survive the claim (probed). The
    message names each, and the remedy: stop Plex, delete the attribute in
    `Preferences.xml` or set its default as the file writes it (`allowedNetworks=""`,
    `enableLocalSecurity="-1"`, `DlnaEnabled="0"`), then `apply`. They are checked in the
    setup only, before the first publish, so a value set later, on purpose, stays. One
    that never says `claimed` stays unpublished, and the next `apply` fetches a new claim
    token.
  - **Done** is `Preferences.xml` holding `PlexOnlineToken`, and `setUp` naming Plex.
  - **Claimed by another account:** the remedies are, in order,
    `mediaplane plex-login --force` as that account if it is yours (without `--force`,
    `plex-login` keeps a saved token that plex.tv still takes); removing Plex's
    `PlexOnline*` attributes, which the next `apply` claims again with your account,
    keeping Plex's libraries and machine identifier (probed); and, last, starting it
    afresh (`Bootstrap.claimedHint`). Seerr's on a Plex stack starts with the same
    `plex-login --force`.
- **Plex's resources** (§6.2):
  - `plex.server`: `name`, Plex's `FriendlyName` (`PUT /:/prefs`, probed), `Mediaplane`
    or `apps.plex.server_name` (a new option, 1 to 64 characters), so it isn't taken for
    another Plex of yours: a new Plex shows its container's random hostname (probed).
  - `plex.library_movies` and `plex.library_tv`: `Movies` on `/data/media/movies` and
    `TV Shows` on `/data/media/tv` (`name`, `type`, `location`), with the agent and
    scanner Plex's web UI gives (`tv.plex.agents.movie` and `Plex Movie`,
    `tv.plex.agents.series` and `Plex TV Series`) and `en-US`, which Plex needs (400
    without, probed). Known by name; one of the other kind is refused, as Plex can't
    change it (400, probed). An update sends the agent it holds, which Plex needs, and
    replaces the locations.
  - Plex takes no change until it has started (`/identity` without `startState`): it
    answers 400 "the server is still starting up" before (found by the nightly test).
    So an app's API may say when it has started (`ApiSpec.started`), and the wire step
    waits for that.
  - **Never set:** remote access (`PublishServerOnPlexOnlineKey`, off by default) and
    the networks allowed without auth (`allowedNetworks`, none by default): Plex's
    defaults stay (probed), the second checked empty by the setup. Its relay
    (`RelayEnabled`, on) is left to you.
- **Sonarr's and Radarr's connections to Plex** (§6.2): `<arr>.connection_plex`,
  `Plex (Mediaplane)`, a `PlexServer` connection at `plex:32400`, without TLS or a URL base,
  with `updateLibrary` and the Jellyfin connection's events, and `authToken`: your Plex
  token, a secret the arr shows masked, checked with the arr's own test, never compared.
  The test takes your token or Plex's own (probed), and needs a Plex library of the
  arr's kind ("At least one TV library is required", found by the nightly test), so
  each requires that library. Both connections now share `servarrMediaServer`
  (`catalog/_shared/servarr-connection.ts`). The address held is observed with TLS and
  the URL base, so a connection held with either reads as moved, and the update sends
  `useSsl: false` and `urlBase: ''`: the key goes only to the stack's address. That is
  new for the Jellyfin connection too.
- **Seerr on a Plex stack** (§6.1, §6.2). S6's stand-in, which left Seerr unwired on a
  Plex stack, is gone.
  - **Its setup** signs in with your token (`POST /api/v1/auth/plex`, probed on Seerr
    3.5), once Plex's setup is done (Seerr comes after Plex), which makes your plex.tv
    account its admin, then signs out. Seerr checks the token at plex.tv, and answers
    500 when it can't, which fails the setup. A Seerr found set up is Mediaplane's only
    when its admin's `plexId` (`GET /api/v1/auth/me`) is your account's id, which
    plex.tv gives for your token (`GET /api/v2/user`), and its Plex is unset or the
    stack's without TLS (`GET /api/v1/settings/plex`), asked with its key: it is never
    signed in to, which would hand your token to whoever set it up. Only that account's
    token makes it Seerr's admin, so Seerr's admin can't shape the answer. Questions
    fail closed, as on a Jellyfin stack.
  - **Its first sign-in must be its admin's,** on either stack (tightening S6's
    Jellyfin path): the session Mediaplane gets is asked whose it is
    (`GET /api/v1/auth/me`), and anything but Seerr's first user (`id` 1) is someone
    who signed in first. Mediaplane signs out, and the setup fails as claimed (`auth`,
    or `unsure` when Seerr didn't answer), with the safe remedies first
    (`Bootstrap.claimedHint`, which now holds Seerr's own, the engine keeping a plain
    fallback).
  - `seerr.media_server_plex` (a resource of its own, since a resource's name can't
    change with the stack): Plex at `plex:32400`, without TLS (Seerr's Plex has no URL
    base, probed), with Movies and TV Shows enabled. Seerr reaches Plex with its admin's
    token, so the link holds no secret of Mediaplane's. With TLS, `hostname` is the URL
    Seerr calls, so it differs and is put back. It requires `plex.server` and both
    libraries.
  - A media-server link with an empty `machineId` (Plex) or `serverId` (Jellyfin) reads
    as not linked: Seerr keeps an address it couldn't save a link for (probed for Plex),
    and sets the id only once it has. `apply` links it again.
- **Logins** (§6.1): an app's `login` is `'shared'`, `{ own: 'Plex' }` (your plex.tv
  account), or `{ comingIn: … }`, or a function of the stack: Plex's is your own, and
  Seerr's is Plex's on a Plex stack. `mediaplane credentials` says "sign in with your
  own Plex account". An app may have a web path (`webPath`): Plex's is `/web`.
- **`plan`'s marks** (§5.2): an arr's first test of its connection to Plex lists the arr
  among Plex's devices (probed), as a test from its web UI does. `plan` never calls
  plex.tv, never claims Plex and never signs Seerr in: a claim token works once.
- **Secrets** (§6.3, §7): your Plex token is a user secret, read once per run
  (`userSecrets`), redacted everywhere, and sent only in Plex's `X-Plex-Token` header (a
  new key scheme, `x-plex-token`), once Plex is shown to be yours, in request bodies to
  the arrs and Seerr, and to plex.tv. Claim tokens, plex.tv's answers and Seerr's cookie
  are redacted too. None is in `compose.yaml`, `.env`, a record, `resources.json` or the
  output. Every secret you give is redacted, but only those an app's API takes as its key
  (`api.key.secret`) reach setups and resources as keys (`stackKeys`): the VPN key never
  does.
- **Tests** (§8). The every-PR end-to-end test runs Plex against a fake plex.tv, whose
  claim token Plex's image sends to the real plex.tv, which refuses it (no account is
  involved), and checks that Plex, unclaimable, is never published. The deploy test
  runs `plex-login` through its helper from the image: one PIN from the real plex.tv,
  or, when plex.tv is down, its "couldn't reach plex.tv", so an outage fails no pull
  request. A real claim needs a real account's token, which fork PRs must never get.
  The nightly job (`.github/workflows/plex.yml`), on `main` (on a schedule, or by hand,
  by a maintainer; the job checks the branch), in the GitHub environment `plex`, with
  the `PLEX_TOKEN` secret, does nothing without it, masks each value it derives
  (`::add-mask::`), claims a Plex with the real plex.tv, and checks that the Plex it
  publishes holds no `PLEX_CLAIM`. It runs on amd64 and arm64, one at a time, since
  both share the test account, and each removes only the servers it noted, in a last
  step that runs whatever happened (`DELETE /devices/<id>.xml`, probed).
- **No new Docker API call:** the helper uses the host helper's, and Plex's setup is the
  same unpublished `up` and recreate as Jellyfin's (§7.2(2)).
