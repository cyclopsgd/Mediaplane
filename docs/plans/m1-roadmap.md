# M1 roadmap: Engine + CLI in slices

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md)

M1 is too large for one implementation plan, so it is delivered in eight
vertical slices. Each slice:

- ends with working, tested software and a green CI;
- gets its **own detailed plan**, written when the previous slice has landed, so
  the plan builds on the real code rather than guesses.

Detailed plans so far:

- Slice 1: [`m1-s1-pure-core.md`](m1-s1-pure-core.md) (done).
- Slice 2a: [`m1-s2a-plan-against-docker.md`](m1-s2a-plan-against-docker.md) (done).
- Slice 2b: [`m1-s2b-apply.md`](m1-s2b-apply.md) (done).
- Slice 2c: [`m1-s2c-packaging.md`](m1-s2c-packaging.md).

## Slices

| # | Slice | Delivers | Spec sections | Proves |
|---|---|---|---|---|
| S1 | **Pure core** | Repo scaffold, CI, secret scanning, OSS basics, the `stack.yaml` schema and loader, secret references, the catalog format with all M1 app definitions (pinned), the resolver, the Compose renderer, a file-level `plan`, and the CLI `plan` command | §2.1, §3, §4.1–4.3, §5.2 (plan) | `mediaplane plan` shows exactly the Compose project it would write, and rejects bad input with actionable errors. No Docker is needed |
| S2 | **Runtime and apply (containers)** | Key generation and persistence, `.env` rendering, the Compose driver, the lock, preflight checks (including the host helper and the same-filesystem check), the container diff, the apply stages (write, pull, start, record), change history, the `apply`, `status`, `history` and `init` commands, the Mediaplane image with `deploy/mediaplane.compose.yaml` and the socket proxy (`mediaplane-system`), and an end-to-end harness | §4.4, §5, §5.1, §7.2 (2–4) | Success criteria 3 (containers) and 6. Containers come up healthy on amd64 and arm64. A second apply reports no changes |
| S3 | **Wiring framework and the download path** | The integration contract, a typed HTTP client with retries, `resources.json`, pre-start config files (`config.xml`, `qBittorrent.conf` with PBKDF2), the shared admin credential and `credentials`, the Servarr admin bootstrap, Sonarr/Radarr wired to qBittorrent (download clients, root folders, categories), the verify stage, and `vpn-check`. Also a real VPN kill-switch test against a local WireGuard server | §6.1, §6.2 (download rows), §6.4, §8.1 (4) | Success criterion 5. Partly criterion 1 |
| S4 | **Drift** | The three-way drift model, `drift`, `keep`, a comment-preserving override writer, `unmanaged`, externally managed mode, name-based re-adoption, key recovery from appdata, and shared-key propagation | §6.3, §6.1 (key recovery) | Success criterion 4 |
| S5 | **Indexers** | Prowlarr application links (fullSync), the Byparr/FlareSolverr indexer proxy and the `cloudflare` tag | §6.2 (Prowlarr rows) | Indexers added in Prowlarr reach both arrs, and proxied requests work |
| S6 | **Media servers** | Jellyfin bootstrap-before-publish, its API key and libraries, the arr → media-server connections, Plex `plex-login` (PIN flow), the Plex claim and libraries, and a nightly Plex CI job | §6.1 (Jellyfin, Plex), §6.4, §8.1 (Plex) | Both media servers are wired headlessly, except for the single Plex sign-in |
| S7 | **Requests** | The Seerr first sign-in (through the Jellyfin admin or the Plex token), libraries, the Sonarr/Radarr servers, initialize, and the full-stack end-to-end test | §6.1 (Seerr), §6.2 (Seerr row) | Success criteria 1 and 2 |
| S8 | **Release and public readiness** | Trivy for the catalog images (Mediaplane's own image is scanned from S2c), SBOM and provenance, release-please, Renovate (a custom manager for catalog pins plus SHA-pinned Actions), a multi-arch release workflow and manifest (arm64 CI itself runs from S2c), the `--json` output shapes in the generated docs (the `stack.yaml`, JSON Schema and CLI references, with their freshness check, arrive in S2c), `migrate`, the full README, the add-an-app guide, the code of conduct, templates and CODEOWNERS | §8.2, §9 | Success criterion 7. Everything is green on both architectures |

### S2 is delivered in three parts (decided 2026-10-09)

S2 is too large for one plan, so it ships as three sub-slices. Each one ends green,
just like a full slice.

| # | Delivers | Proves |
|---|---|---|
| S2a | **Plan against a real host.** The S2 items from the Slice 1 reviews, plus: cloud detection, the Docker runtime (versions, `config --hash`, `ps`), the secrets store (read-only), secret values, preflight checks, the container diff from Compose's own config hash (ADR 0010), the CLI showing containers and secrets, and the end-to-end harness with a CI job | `mediaplane plan` reports exactly what `apply` would do to files, containers and secrets, and still writes nothing |
| S2b | **Apply.** Key generation and persistence, `.env` rendering, atomic writes and the lock, the appdata ownership helper (Seerr runs as uid 1000), the apply stages (write, pull, `up --wait`, verify, record), change history, the `apply`, `status`, `history` and `init` commands, verified health checks, and ADR 0004 | Containers come up healthy on amd64 and arm64. A second apply reports no changes |
| S2c | **Packaging.** The Mediaplane image, `deploy/mediaplane.compose.yaml` with the socket proxy (`mediaplane-system`), host detection from inside the container (the host helper), the threat model and ADR 0008. Also, by the owner's decisions of 2026-10-09: Trivy for the Mediaplane image (moved here from S8); native arm64 CI (moved here from S8); and the docs so far, which are the generated `stack.yaml`, JSON Schema and CLI references with a CI freshness check (moved here from S8), `docs/architecture.md`, a README per app, the "app won't start" runbook and ADR 0006. And `pnpm audit` of the CLI's production dependencies in CI, which the image scan can't see because they are bundled (spec §7.2(7)) | Success criterion 6 |

Every slice writes its own docs as it goes:

- **ADRs**, when a slice implements the decision:
  - 0001, 0002, 0005 and 0009 in S1;
  - 0010 in S2a, 0004 in S2b, and 0006 and 0008 in S2c;
  - 0003 in S4.
  - 0007 (books) belongs to M4.
- **Each app's `catalog/<app>/README.md`**, written in S2c, and updated when that
  app's integration lands.
- **Runbooks**, written with the feature they cover:
  - "VPN down" and "wiring failed" in S3;
  - "drift reported" in S4;
  - "app won't start" in S2c.
- **A docs task in every slice plan,** from S2c on (owner, 2026-10-09). It covers the
  spec §9 artefacts the slice touches: it runs `pnpm docs:generate` for the generated
  references, and updates each touched app's README, the runbooks and ADRs, and
  `docs/architecture.md`.

## CI architecture coverage

The dev box is aarch64. GitHub's hosted arm64 runners are free for public
repositories, and the repo is public, so from S2c (owner, 2026-10-09):

- the `image` and `e2e` jobs run as matrices on `ubuntu-24.04` (amd64) and
  `ubuntu-24.04-arm` (arm64), natively, with no emulation;
- on each runner, the `image` job builds that architecture's image and scans it with
  Trivy, and the `e2e` job runs every end-to-end test, including the ones that build
  the image and deploy it behind the socket proxy;
- a push that changes only docs skips both jobs. The last job, `All checks passed`,
  reports either way, so it is the one check branch protection should require;
- a multi-arch image manifest waits for publishing, in S8.

Each slice that adds end-to-end tests still runs them locally on the aarch64 dev box
before merging.

## Things S1 encodes that later slices must verify against real containers

S1 renders these values but cannot run them. The slice named here confirms
each one, or corrects it in the catalog:

| Value | Verified in |
|---|---|
| Health-check commands for each image (`curl` in linuxserver images, `wget` in Seerr). The tools were confirmed present in every pinned image on 2026-10-09. **Verified on arm64 and amd64 on 2026-10-09** by S2b's end-to-end test, which applies the video stack and sees every app healthy: on the arm64 dev box, and on amd64 in CI at `ebd18fe` | S2b (done) |
| Gluetun's built-in health check with `depends_on: service_healthy`. It needs a working tunnel, so it is verified with S3's local WireGuard server | S3 |
| `FIREWALL_OUTBOUND_SUBNETS` accepting a comma-separated list | S3 |
| qBittorrent `WEBUI_PORT` behaviour inside Gluetun's namespace | S3 |
| The value format of Servarr `SERVER__TRUSTEDNETWORKS` (comma-separated CIDRs) | S3 |
| Seerr running as uid 1000 with `init: true`. **Verified on 2026-10-09** by `test/e2e/apply.e2e.test.ts` and `test/e2e/deploy.e2e.test.ts`: Seerr, rendered with `init: true`, runs healthy after apply's ownership step gives its appdata to uid 1000 | S2b (done) |

## Inputs for later slices from the reviews

The Slice 1 final review (2026-10-08) approved the merge. It also raised the
design gaps below, which only matter once Mediaplane writes files or deploys.
The Slice 2a final review (2026-10-09) added the S2b list and two S3 items.
The Slice 2b final review (2026-10-09) added the S2c list, two S4 items and an
M2 item. Slice 2c (2026-10-09) added the last S3 item, the S6 list and the last
four S8 items. Each slice plan must address the items for that slice.

**S2 (must land with `apply`):** all of these are in the S2a plan.

- **Cloud hosts and `bind: lan`.** On AWS, GCP, Azure and OCI the main
  network card has a private 10.x address that is NATed to a public IP, so it
  counts as "the LAN". The dev box is OCI, for example. Preflight must detect
  cloud platforms (DMI vendor or asset tag, metadata endpoint) and refuse or
  warn on `lan` unless `network.lan_subnet` is set explicitly. Bind addresses
  must also be restricted to an explicit `lan_subnet`.
- **Secrets in `apps.<id>.env`.** These values are plaintext today and end up
  in `compose.yaml`. Accept `{ file }` and `{ env }` references for env
  values, rendered as `${MP_<APP>_ENV_<NAME>}`, so values such as
  `WIREGUARD_PRESHARED_KEY` or `OPENVPN_PASSWORD` never land in the file.
- **Ejecting with the override file.** Compose only auto-merges a
  `compose.override.yaml` that sits next to the compose file. The runtime must
  pass both files with `-f`, and the generated file's header and the docs must
  give the exact `docker compose -f … -f …` command for ejecting.
- **Interface and namespace checks:**
  - Extend the virtual-interface deny-list (vmnet, vboxnet, zt, tap, ppp,
    nordlynx, cali, kube-, weave, cilium, utun), or check for a physical device
    under `/sys/class/net/<if>/device`.
  - Declare Gluetun's control port 8000 (unpublished), and check for container
    port clashes inside shared network namespaces.
- **Validation:**
  - Check that `version:` is a valid Docker tag, and pass the image reference
    through `literal()`.
  - Reject paths containing `:`.
  - `IPV4_CIDR` must reject octets above 255.
  - An empty `MEDIAPLANE_HOME` must fall back to the default.
- **Errors:**
  - Unexpected I/O errors must name the file and a next step. EACCES is
    likely, because the container runs as non-root.
  - `--json` must print a JSON error envelope when an exception is thrown.
  - An alias-bomb YAML file must produce a diagnostic, not an exception.
  - YAML syntax errors must not echo the offending source line once logs or
    history exist.
- **Tests:** a test that `plan()` writes nothing, alongside the new write code.

**S2b (blockers for `apply`):** all of these are in the S2b plan.

- **Own ports are matched by exact address.** Preflight treats a port as the
  stack's own only when a container publishes it on the same address. Changing
  `network.bind` while the containers run then gives a false
  `preflight.port-in-use`. Key own ports on protocol and port instead.
- **Runtime errors from `configHashes`.** A `RuntimeError` thrown by
  `configHashes` escapes `plan()` without the `docker.unavailable` handling
  that `versions()` and `containers()` get.
- **No timeout in `nodeExec`.** A hung `docker` call hangs `plan` and `apply`.
- **Malformed `ps` output.** A line that isn't JSON throws a `SyntaxError`. Make
  it a `RuntimeError`, and skip lines that aren't JSON objects.
- **Duplicate containers for one service.** When a service has more than one
  container, the last one wins. Handle it explicitly.
- **Validate `MEDIAPLANE_COMPOSE_PROJECT`** (`mediaplane` or `mediaplane-*`)
  before `apply` can act on it (spec §7.2(2)).
- **The test environment.** `main.test` needs ports 8989, 8080 and 8096 free,
  and `run.test` assumes `/opt/mediaplane` doesn't exist. So `pnpm test` fails
  on a host that runs a real stack.
- **Secret name collisions.** A catalog secret named `env<X>` would map to the
  same `MP_<APP>_ENV_<X>` variable as `apps.<id>.env.<X>`. Add a guard test with
  the next catalog secret.
- **The eject command in the docs.** ADR 0002 and spec §2.3 still say plain
  `docker compose up -d`. Update them to the exact command once `.env` exists.
  **Done in S2b:** both give the exact command from the generated header, and
  the end-to-end test runs that command.

**S2c:** all of these are in the S2c plan.

- **A stable hostname.** The lock records the host it was taken on, and only
  clears a stale lock from the same host. Give the Mediaplane container a fixed
  `hostname:`, so a recreated container can still clear its own stale lock.
- **Hard links in the home.** The lock (and `init`'s `stack.yaml`) is created
  with a hard link, so the Mediaplane home needs a filesystem that supports
  them. Document it.
- **`init` and uid 1000.** `init` tells the user to make the data folder
  writable by uid 1000. Consider the invoking user instead.
- **A different home.** Warn when the project's containers carry a
  `com.docker.compose.project.working_dir` from a different home, which means
  another home already manages a project with this name.

**S3:**

- Gluetun's `FIREWALL_OUTBOUND_SUBNETS` and Servarr's `TRUSTEDNETWORKS` should
  only be filled when ports are actually published on the LAN. Today they are
  also filled with `bind: localhost`.
- Warn when `lanSubnets` is empty but a feature needs it.
- Servarr `TRUSTEDNETWORKS` should add Mediaplane's Docker network once
  requests are proxied (ruling R12; spec §6.1).
- **`lanSubnets` on cloud hosts.** On a cloud VM without an explicit
  `lan_subnet`, leave `lanSubnets` empty.
- **Keep `lan_subnet` private.** Require `lan_subnet` to be inside RFC 1918, so
  a public or `0.0.0.0/0` subnet can't widen `TRUSTEDNETWORKS` or the
  authentication bypass.
- **The Mediaplane container can reach only the socket proxy.** Its network is
  internal (S2c). Wiring needs the apps' APIs, so attach the container to the
  stack's network, or find another route. Then update ADR 0008 and the threat model.

**S4:**

- Override field names are case-sensitive, so the managed-field comparison must
  match them exactly.
- **Appdata ownership is checked only on change.** Apply checks it only when
  something else changes, and never re-checks it for apps that are running.
- **An override can move an appdata mount.** When `compose.override.yaml`
  remaps an app's appdata mount, the ownership helper's chown runs on the
  override's host path, not on `appdata/<app>`.

**S6:**

- **The Plex claim and `plex-login` need plex.tv.** The Mediaplane container has no
  route out today (S2c), so give it one, and record that in the threat model.
- **Jellyfin's health check can pass early.** In its first seconds, Jellyfin's
  `/health` answers 200 with `Degraded` while the server still answers 503 to
  everything else (S2c). Look at a check that waits for the server itself.

**S8 (before going public):**

- **Repo setup (owner):** enable GitHub private vulnerability reporting, which
  `SECURITY.md` relies on. Choose GPL-3.0-only or GPL-3.0-or-later and add the
  SPDX `license` field.
- **Docs:** make the `--json` contract explicit (pin its fields and document
  `mediaplane.plan/v1`). Drop the internal "Slice 1" wording from the README.
- **Tests:** tighten the catalog tag test, and add Renovate.
- **Pins outside the catalog.** Renovate must also bump the images pinned in:
  - `Dockerfile` (`node`, `docker:*-cli`);
  - `deploy/mediaplane.compose.yaml` (`wollomatic/socket-proxy`);
  - `.github/workflows/ci.yml` (Trivy and gitleaks), `.githooks/pre-commit`
    (gitleaks) and `test/e2e/helpers.ts` (busybox).

  Every catalog pin bump must also run `pnpm docs:generate`, because each app
  README's facts block shows the pin.
- **Node's own vulnerabilities.** Node comes with the image's `node` base as a
  binary, not an Alpine package, so neither Trivy nor `pnpm audit` sees it (S2c).
  It stays current only when Renovate bumps the `node` pin in the `Dockerfile`.
  Decide whether CI should also check Node's version against Node's security
  releases.
- **The Docker version CI tests.** The runners' Docker moves with GitHub's images,
  so the supported floor, Docker Engine 24, is not tested in CI (S2c). Decide
  whether to test it.
- **Publish the image,** and give `MEDIAPLANE_IMAGE` in
  `deploy/mediaplane.compose.yaml` a pinned default. Then the install guide can pull
  instead of build.

**M2 (the panel):** `trigger: 'cli'` is a literal in `mediaplane.change/v1`.
Decide an additive rule, or a v2 of the schema, before the panel writes change
records.

## Spec refinements made while planning (2026-10-08)

These were applied to the spec and keep its intent:

- **Compose version.** The bundled Compose CLI is v5.x. Preflight requires at
  least 2.24.
- **LAN binding.** `network.bind: lan` uses private IPv4 (RFC 1918) addresses in
  M1. IPv6 ULA comes later.
- **Secrets and seeding steps.** Catalog `secrets` are declared separately from
  `credentials` steps. "User-provided" is a secret source, not a step.
- **VPN address.** `vpn.addresses` is optional, for providers such as Mullvad.
  Other Gluetun settings go through `apps.gluetun.env`.
