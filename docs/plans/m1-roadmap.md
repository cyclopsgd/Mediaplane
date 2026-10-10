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
- Slice 2c: [`m1-s2c-packaging.md`](m1-s2c-packaging.md) (done).
- Slice 3a: [`m1-s3a-admin-and-seed-files.md`](m1-s3a-admin-and-seed-files.md) (done).
- Slice 3d: [`m1-s3d-vpn-check.md`](m1-s3d-vpn-check.md) (done).
- Slice 3b: [`m1-s3b-wiring.md`](m1-s3b-wiring.md) (done).

Where M1 stands (the README shows the same):

- **Merged:** S1, S2a, S2b, S2c, S3a, S3d and S3b.
- **Next:** S3c.
- **After that:** S4 to S8.

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

Every slice writes its own docs as it goes:

- **ADRs**, when a slice implements the decision:
  - 0001, 0002, 0005 and 0009 in S1;
  - 0010 in S2a, 0004 in S2b, and 0006 and 0008 in S2c;
  - 0003 in S4.
  - 0007 (books) belongs to M4.
- **Each app's `catalog/<app>/README.md`**, written in S2c, and updated when that
  app's integration lands.
- **Runbooks**, written with the feature they cover:
  - "VPN down" in S3d, and "wiring failed" in S3b;
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
| Gluetun's built-in health check with `depends_on: service_healthy`. **Verified on 2026-10-10** by `test/e2e/vpn.e2e.test.ts`, against a local WireGuard server: `apply` waits for Gluetun to be healthy, then starts qBittorrent, and both end healthy. It runs in CI from Slice 3d | S3d (done) |
| `FIREWALL_OUTBOUND_SUBNETS` accepting a comma-separated list. **Verified on 2026-10-10** by `test/e2e/vpn.e2e.test.ts`: two subnets, given through `apps.gluetun.env`, are both routed in Gluetun's namespace. It runs in CI from Slice 3d | S3d (done) |
| qBittorrent `WEBUI_PORT` behaviour inside Gluetun's namespace. **Verified on 2026-10-10** by `test/e2e/vpn.e2e.test.ts`: with `apps.qbittorrent.port: 8090` and `bind: localhost`, the web UI answers on `127.0.0.1:8090`. It runs in CI from Slice 3d | S3d (done) |
| The value format of Servarr `SERVER__TRUSTEDNETWORKS` (comma-separated CIDRs). Verified in S3b: see below | S3b (done) |
| Seerr running as uid 1000 with `init: true`. **Verified on 2026-10-09** by `test/e2e/apply.e2e.test.ts` and `test/e2e/deploy.e2e.test.ts`: Seerr, rendered with `init: true`, runs healthy after apply's ownership step gives its appdata to uid 1000 | S2b (done) |

Verified in S3b (2026-10-10):

- **`SERVER__TRUSTEDNETWORKS`**: `test/e2e/apply.e2e.test.ts` gives two subnets through
  `apps.sonarr.env`, and Sonarr's own settings show them back as the same
  comma-separated list. That shows Sonarr reads the list as given; the tests don't show
  it splitting the list to match a client. It runs in CI from Slice 3b.

## Inputs for later slices from the reviews

The Slice 1 final review (2026-10-08) approved the merge. It also raised the
design gaps below, which only matter once Mediaplane writes files or deploys.
The Slice 2a final review (2026-10-09) added the S2b list and two S3 items.
The Slice 2b final review (2026-10-09) added the S2c list, two S4 items and an
M2 item. Slice 2c (2026-10-09) added the last S3 item, the S6 list and the last
four S8 items. Slice 3a (2026-10-10) added three S3 items, the S3d list, three
S4 items, two S6 items, an S8 item and an M2 item. Slice 3d (2026-10-10) added the last
S3 item, the unscheduled list and extended two S8 items. Slice 3b (2026-10-10) added the
S3c list, two S4 items and one unscheduled item. Each slice plan must address the items
for that slice.

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

**S3:** S3a handles the first five, except Mediaplane's network in TRUSTEDNETWORKS,
which moved to M2. S3b handles the rest, except qBittorrent's settings and admin
password, which are S3c's (and listed again below).

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
  **Decided by the owner on 2026-10-10, on how Mediaplane reaches the apps: a private
  wiring network.** A Docker network with `internal: true`, which
  Mediaplane's container, every wired app and Gluetun (for qBittorrent) join.
  - Mediaplane's container stays offline: that network has no route out.
  - The apps keep their normal network for their own internet traffic.
  - Gluetun's firewall must accept wiring traffic to qBittorrent's port, and S3b's
    end-to-end test proves it.
  - The plex.tv calls go through a short-lived helper in S6.
  - This is defence in depth, not a wall, because the proxy still lets Mediaplane
    create containers.
  - S3b writes ADR 0011 on it.
  - **Done in S3b:** as decided, with the end-to-end tests proving the login from source
    and from the image behind the real proxy, Gluetun letting the wiring network reach
    qBittorrent's port, and Mediaplane's container having no default route.
- **qBittorrent's settings after its first start.** `admin.username`,
  `admin.password`, `login_on_lan` and the LAN subnet reach qBittorrent only through
  its pre-start file (S3a). S3c manages them through its API.
- **The shared admin password, through each app's API.** Apply it through every app's
  API, qBittorrent included, so that a change to `admin.password` reaches every app
  (S3b for Sonarr, Radarr and Prowlarr, S3c for qBittorrent). Today `credentials` shows
  the new password while qBittorrent keeps the one from its first start. **Done in S3b
  for Sonarr, Radarr and Prowlarr:** the `<app>.admin` resource.
- **Keys an app creates must fit the secrets store (S3b).** `state/secrets.json` takes
  only letters, digits and `_` in an app's key (`^[A-Za-z0-9_]+$`), because the keys go
  into the apps' files unescaped. A secret with `createdBy: 'app'` is kept in the same
  store, so its value must fit too, or the check must apply only to the keys Mediaplane
  generates. Otherwise the next `plan` can't read the store. **Done in S3b:** the rule
  stays for every key, and the store refuses to save one it couldn't read back, naming
  the key. Jellyfin's (S6) is 32 hex characters, which fits.
- **qBittorrent stranded by a Gluetun started again on its own (S3b).** When Gluetun
  restarts alone, by hand or after a crash, qBittorrent keeps the old, empty network
  namespace. Compose restarts qBittorrent only when it recreates Gluetun, not when it
  starts a stopped one (Compose 5.5.1), so `apply` leaves it stranded and its health
  check still passes on loopback. `vpn-check` reports it (S3d). Make the verify stage's
  VPN topology check (spec §6.4) catch it too, by reusing `vpnCheck` without the egress
  check, and have `apply` restart qBittorrent then. **Done in S3b:** `plan` lists such a
  qBittorrent as `restart`, also when apply starts a stopped Gluetun (the owner's trial),
  and verify runs vpn-check's checks without egress.

**S3c:**

- **qBittorrent through its API.** S3b reaches qBittorrent's API already, through Gluetun
  on the wiring network, and checks its key. Add its integration: the categories, the
  preferences, and `qbittorrent.admin`, whose password goes through `setPreferences`.
- **Download clients need their category.** Sonarr's and Radarr's `download_client`
  should `require` the qBittorrent category, so that a failed category skips it (S3b's
  contract has `requires`).
- **`after` for the arrs.** Sonarr and Radarr come after qBittorrent once they link to it.

**S3d:** all of these are in the S3d plan.

- **Gluetun's control server refuses requests without the key.** S3a writes
  `auth/config.toml`, and this was checked only by hand on the pinned image. Check
  in the end-to-end test that `GET /v1/vpn/status` answers 401 without `X-API-Key`,
  and 200 with it.
- **qBittorrent's web UI on localhost, behind Gluetun.** Since S3a,
  `FIREWALL_OUTBOUND_SUBNETS` is set only while the web UIs are on the LAN. Check in
  the end-to-end test that with `bind: localhost` the web UI still answers on
  `127.0.0.1`, as a hand check found in S3a. If it doesn't, the cloud-VM default has
  regressed.
- **Validate `vpn.addresses`.** The schema takes any non-empty string today. Check it
  as comma-separated IPv4 or IPv6 CIDRs.
- **`vpn-check` and a Gluetun that wasn't restarted.** A Gluetun that started before
  Slice 3a, and hasn't been restarted since, has not read the key file Mediaplane
  wrote: it reads the file only when it starts (its README says to restart it once).
  Until then its control server still answers anyone, without the key, so `vpn-check`
  works but the server is open. Have `vpn-check` notice that (a request without the
  key that succeeds) and say so, with the fix: restart Gluetun, then qBittorrent.

**S4:**

- Override field names are case-sensitive, so the managed-field comparison must
  match them exactly.
- **Appdata ownership is checked only on change.** Apply checks it only when
  something else changes, and never re-checks it for apps that are running.
- **An override can move an appdata mount.** When `compose.override.yaml`
  remaps an app's appdata mount, the ownership helper's chown runs on the
  override's host path, not on `appdata/<app>`. Pre-start files (S3a) are still
  written to `appdata/<app>`, so the app starts without them, and nothing reports
  it.
- **Installs from before Slice 3a.** `plan` reports a `config.xml` without `ApiKey`,
  a `qBittorrent.conf` without `WebUI\APIKey`, or Gluetun's `auth/config.toml` without
  Mediaplane's role, as `<app>.not-seeded`, and the app READMEs give the manual fix.
  Automate it: stop the app, add the stored key to its file, and start it ("restore
  the key at the source", spec §6.3).
- **FlareSolverr's anonymous volume.** Its image declares `VOLUME /config`, and the
  catalog mounts nothing there, so every container it creates leaves an anonymous
  volume behind. Mount a folder there, or document it. (The end-to-end helpers
  remove them with `down -v` since S3a.)
- **Rotating the admin password.** There is no way to replace the generated password
  yet. Add one, which reaches every app through its API.
- **A wiring network whose settings change.** Compose must make it anew then, and
  through the socket proxy it can't delete a network (S3b). The wiring failed runbook
  gives the steps by hand. Decide whether Mediaplane should do them.
- **The `partial` outcome.** Spec §5 step 12 names `success`, `partial` and `failed`.
  Apply records `failed` when part of the wiring failed (S3b). Decide whether drift's
  re-apply needs `partial`.

**S6:**

- **The Plex claim and `plex-login` need plex.tv.** The Mediaplane container has no
  route out today (S2c), and stays offline under S3b's decision above (a private wiring
  network). So make the plex.tv calls from a short-lived helper, and record that in the
  threat model.
- **Jellyfin's health check can pass early.** In its first seconds, Jellyfin's
  `/health` answers 200 with `Degraded` while the server still answers 503 to
  everything else (S2c). Look at a check that waits for the server itself.
- **A login of your own for Plex, and for Seerr on Plex.** Plex's login is always
  your plex.tv account, never the shared admin (spec §6.1). With Plex, Seerr's
  first sign-in uses that account too. The catalog's `login` (S3a) is `'shared'`
  or the slice that brings it, so `credentials` says their login arrives in
  Slice 6 (Plex) or Slice 7 (Seerr). Give `login` a value for your own account,
  and use it for both.
- **Plex's web UI is at `/web`.** `credentials` prints `http://<address>:<port>`
  for every app, so give the catalog a per-app web path.

**S8 (before going public):**

- **Repo setup (owner):** enable GitHub private vulnerability reporting, which
  `SECURITY.md` relies on. Choose GPL-3.0-only or GPL-3.0-or-later and add the
  SPDX `license` field.
- **Docs:** make the `--json` contract explicit (pin its fields and document
  `mediaplane.plan/v1`). Drop the internal "Slice 1" wording from the README.
- **`credentials --json` has no `ok` field.** `init`, `plan`, `apply` and the error
  envelope all carry one, and the success output of `mediaplane.credentials/v1` doesn't.
  Align it in the `--json` pass: adding `ok: true` is additive within v1.
- **Tests:** tighten the catalog tag test, and add Renovate. Let
  `test/e2e/deploy.e2e.test.ts` deploy with `deployMediaplane()` from
  `test/e2e/helpers.ts` (S3d), as the VPN test does.
- **Pins outside the catalog.** Renovate must also bump the images pinned in:
  - `Dockerfile` (`node`, `docker:*-cli`);
  - `deploy/mediaplane.compose.yaml` (`wollomatic/socket-proxy`);
  - `.github/workflows/ci.yml` (Trivy and gitleaks), `.githooks/pre-commit`
    (gitleaks), `test/e2e/helpers.ts` (busybox) and `test/e2e/wireguard.ts` (the
    `lscr.io/linuxserver/wireguard` test server, rebuilt weekly upstream).

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

**M2 (the panel):**

- `trigger: 'cli'` is a literal in `mediaplane.change/v1`. Fields may be added
  within v1 when they are optional (spec §11, Slice 3a); decide whether a new
  trigger is one, or needs a v2, before the panel writes change records.
- **Servarr `TRUSTEDNETWORKS` and Mediaplane's network (ruling R12).** Once the panel
  proxies requests to the apps, add its network, so Sonarr believes the
  `X-Forwarded-For` header it sends (spec §11, Slice 3a).

**Not scheduled yet:**

- **Restrict what the proxy lets Mediaplane create.** The wiring network keeps
  Mediaplane's container offline, but the proxy still lets it create containers with any
  network, so that is defence in depth, not a wall (ADR 0011).

- **Windows and macOS through Docker Desktop or WSL2** (spec §1.5, later): a manual trial
  (2026-10-10) worked, but the port check can't see Docker Desktop's Windows-side ports.

- **An IPv6 egress check.** `vpn-check` measures IPv4 only (S3d): its route target is
  `1.1.1.1`, and its default URL is reached by an IPv4 address. When Docker's IPv6 is
  turned on for the stack, add an IPv6 egress check, so a leak over IPv6 shows.
- **A `leak` verdict on real Docker.** Unit tests cover every `leak` path of
  `vpn-check`, but no end-to-end test reaches one (S3d). Add one, for example a
  `network_mode` override for qBittorrent in the kill-switch test, so the leak path runs
  once against real Docker.

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
