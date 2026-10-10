# M1 Slice 3d: the VPN's kill-switch test and `vpn-check` — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove success criterion 5 ("the VPN fails closed") with an automated test against
a real WireGuard server, on amd64 and arm64, and give users `mediaplane vpn-check`, which
checks the same on their own host: qBittorrent has no network but Gluetun's, the VPN is
up, and qBittorrent's traffic leaves from another address than the host's. A "VPN down"
runbook says what to do when it fails.

**Architecture:**

- **The kill-switch test** (`test/e2e/vpn.e2e.test.ts`) applies a stack with Gluetun's
  `custom` provider pointed at a WireGuard server the test runs itself
  (`test/e2e/wireguard.ts`), on a network of its own beside an echo server that answers
  `ip=<the caller's address>`, as Cloudflare's trace does. It checks the tunnel, then
  stops the server and then Gluetun, and checks that nothing gets out. CI loads the
  `wireguard` kernel module first, on both runners.
- **`vpn-check` needs no route of its own** (the owner's decision D1 is still open). Its
  probe is a `compose run` of the `qbittorrent` service (`runtime.run`), so it starts in
  Gluetun's network namespace, as qBittorrent does, in qBittorrent's own image, as nobody.
  A short shell script there asks Gluetun's control server on `127.0.0.1:8000` (the key
  comes in on stdin), looks up the route out, and asks the IP-echo service which address
  it comes from (`vpn/probe.ts`). The host's own address comes from the CLI's own `fetch`
  when run from source, and from the host helper (`--network host`) in the image
  (`vpn/egress.ts`, `host/report.ts`). Docker is asked for each container's network mode
  and start time (`runtime.inspect`). `vpnCheck()` (`vpn/check.ts`) turns it all into
  checks and a verdict: `pass`, `down` or `leak`.
- **No new socket-proxy permission.** The probe uses the same Docker API calls as the
  appdata ownership helper (`compose run`), `inspect` is `GET containers/{id}/json`, and
  the host side is the host helper. Task 8's end-to-end test runs `vpn-check` from the
  deployed image, behind the real proxy, to prove it.

**Tech Stack:** as Slice 3a (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency. One new image,
in the end-to-end tests only: `lscr.io/linuxserver/wireguard`, pinned by tag and digest.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §2.3 success criterion 5, §5.2 (`vpn-check`), §6.1 (Gluetun's row), §6.4 (Gluetun
  dependants);
- §7.2(2) (the socket proxy), §7.2(4) (secrets), §7.2(6) (VPN);
- §8.1(4) (the kill-switch test), §8.2 (CI), §9 (the documentation set, runbooks);
- §11, Slice 3a (Gluetun's control-server key).

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md), especially the S3 split
("S3 is delivered in four parts"), the S3d list in "Inputs for later slices from the
reviews", and "Things S1 encodes that later slices must verify against real containers".

Decisions made for S3 after the roadmap (the controller's rulings, 2026-10-09; the owner
can still reverse the ones marked "logged"):

- **`vpn-check` (D9, logged for the owner).** It always checks the structure. By default
  it also checks egress, through `https://1.1.1.1/cdn-cgi/trace`, from inside the VPN and
  from the host, and compares the two. `--no-egress` skips that, and
  `MEDIAPLANE_VPN_CHECK_URL` overrides the URL. JSON is `mediaplane.vpn-check/v1`. It
  exits 0 on a pass, and 1 on a leak or when the VPN is down. It uses Gluetun's control
  key (`gluetun.controlApiKey`, header `X-API-Key`) for `GET /v1/vpn/status` and
  `GET /v1/publicip/ip`.
- **The kill-switch test (D10).** The WireGuard server is
  `lscr.io/linuxserver/wireguard:1.0.20260223-r0-ls123@sha256:33c5e4260f5ddf9376fcb6f1ff90c0ccc3c63d2ab469595e33d178ecf8a4c4c6`.
  CI loads the module with a `modprobe wireguard` step on both runners (`ubuntu-24.04`
  and `ubuntu-24.04-arm`). The first CI run proves R1 (that the hosted runners can load
  it); the fallback is a userspace WireGuard server (Task 2, "If CI can't load the
  module").
- **D1 is the owner's, and unresolved:** how the Mediaplane container reaches the apps'
  APIs. S3d must not depend on it.
- **D14 (S3a):** Gluetun's pre-start `auth/config.toml` gives `controlApiKey` the routes
  `GET /v1/vpn/status` and `GET /v1/publicip/ip` only.
- **D17:** each part updates the threat model for what it ships.

## Global Constraints

Everything in the Slice 1, 2a, 2b, 2c and 3a Global Constraints still holds
(`docs/plans/m1-s1-pure-core.md`, `m1-s2a-plan-against-docker.md`, `m1-s2b-apply.md`,
`m1-s2c-packaging.md`, `m1-s3a-admin-and-seed-files.md`):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses or hostnames in committed files. Test secrets look like
  `'0'.repeat(32)` or `fake-key-0123`. Addresses in tests and docs come from the
  documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), private
  ranges, or `fd00::/8`. The end-to-end test generates its WireGuard keys when it runs;
  none is committed;
- neutral framing;
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes nothing, and neither does `vpn-check`;
- Docker is reached only through the `Runtime` (the end-to-end tests may call `docker`
  themselves);
- unit tests never need Docker, except the spawned tests in
  `packages/cli/src/main.test.ts`. Task 5's script test runs `sh` with stand-ins for `ip`
  and `curl`, and needs no Docker;
- the runtime refuses any Compose project that is not `mediaplane` or
  `mediaplane-<name>`, and never accepts `mediaplane-system`;
- every image is pinned by digest, and every GitHub Action by commit SHA;
- end-to-end test files run one at a time;
- never push.

These are added or restated for this slice:

- **Secrets never appear** in diagnostics, errors, change records, logs, or human or JSON
  output. Gluetun's control key reaches the probe only on its standard input: never on a
  command line (every user on the host can list the processes of every container), in a
  container's environment, or in `docker inspect`. The runtime replaces it with `***` in
  what the probe prints. End-to-end assertions that see the key, or a WireGuard key, say
  only whether they passed, so a failure prints none of them into the public CI log.
- **No new socket-proxy permission.** `deploy/mediaplane.compose.yaml` and its allow-list
  test stay as they are. Anything that would need a new Docker API call is a
  security-sensitive decision for the controller, not for an implementer.
- **Docker and Compose flags.** Compose spells some long flags differently in v2 and v5.
  CI runs Docker 28 with Compose v2.38.2; the dev box runs Docker 29.8 with Compose 5.5.1;
  preflight requires Compose 2.24. Prefer short flags. The probe's `compose run` uses
  exactly the flags the ownership helper already uses (`--rm`, `--no-deps`, `-T`,
  `--user`, `--entrypoint`); stdin through `compose run -T` was checked on 5.5.1 and
  2.38.2. The tests add only `docker` (not Compose) commands, with short flags where there
  are any, and `compose up -d --wait` and `down --remove-orphans`, which the deploy test
  already uses.
- **Never prune images** (`docker image prune`, `docker system prune`): the dev box keeps
  the pinned images cached for the end-to-end tests.
- **Names in end-to-end tests** start with `mediaplane-e2e-`: the project
  `mediaplane-e2e-<pid>-vpn`, with `-wan`, `-wgserver`, `-echo`, `-system` and
  `-mediaplane` after it for what the test adds, the image `mediaplane-e2e:<pid>-vpn`, and
  temporary folders `mediaplane-e2e-…`.
- **The WireGuard module.** The kill-switch test needs the host's `wireguard` kernel
  module: `sudo modprobe wireguard` once after each boot. It fails, and never skips,
  without it.
- **Temporary folders in unit tests** come from `tempDir()` or `tempDirSync()` in
  `@mediaplane/engine/testing`.
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

The spec and the rulings leave these open. Each is marked `Decision:` where it is applied.
The ones the controller should look at first are marked **(check)**.

1. **(check) How `vpn-check` reaches the VPN's side without D1.** Its probe is
   `docker compose run --rm --no-deps -T --user 65534:65534 --entrypoint sh qbittorrent -c <script> vpn-check <port> <url>`.
   A one-off of a `network_mode: service:gluetun` service starts in Gluetun's network
   namespace, which is exactly what qBittorrent uses, so the probe reaches Gluetun's
   control server on `127.0.0.1:8000` and measures qBittorrent's real path out. It runs
   qBittorrent's own image (busybox `ip` and `base64`, and curl 8.22, checked on the
   pinned image), as nobody, and writes nothing. It makes the same Docker API calls as
   the ownership helper's `chown` (create, start, attach, wait, delete). **No proxy
   permission changes.** Task 8 runs it from the deployed image behind the real proxy.
   Rejected: `docker exec` (the proxy refuses `exec`, and adding it would be the widest
   possible permission); a helper container of Mediaplane's image joined to Gluetun's
   network (`--network container:`), which needs a `docker run` outside the managed
   project; reaching Gluetun's IP from the Mediaplane container, which is D1 (Tasks 3,
   5, 6).
2. **(check) The key goes in on stdin.** The probe reads Gluetun's key from its standard
   input and hands it to curl as a header file on stdin (`-H @-`). A command-line
   argument would show in `ps` to every user on the host; `compose run -e` would put it in
   the container's settings and `docker inspect`. Checked: `compose run -T` passes stdin
   on Compose 5.5.1 and 2.38.2, and through the socket proxy (Task 8) (Tasks 3, 5).
3. **(check) The host's own address, in the image, comes from the host helper.** Its
   request gets an optional `egress` URL, and the helper, already on the host network,
   fetches it and reports the address. Same container, same proxy calls; the helper now
   makes one outbound HTTPS request per `vpn-check` (threat model T13). From source, the
   CLI fetches it itself (Task 4).
4. **The runtime gains `run()` and `inspect()`.** `chown` becomes a `run` (its arguments
   don't change), which is the generalisation the research's D13 planned for S3c.
   `inspect(ids)` reads each container's network mode and start time with
   `docker container inspect --format` (`GET containers/{id}/json`) (Task 3).
5. **(check) A qBittorrent stranded by a Gluetun started again on its own is "down".**
   The probe joins Gluetun's *current* namespace, so it would pass while qBittorrent still
   holds the old, empty one. Verified on the dev box: Compose restarts qBittorrent when it
   recreates Gluetun, but not when `up` starts a stopped Gluetun, nor after
   `docker restart`. So `vpn-check` compares the two start times (qBittorrent must have
   started after Gluetun's current run) and says to restart qBittorrent. `apply` doesn't
   fix it; that is recorded as a Slice 3b input (Tasks 6, 9).
6. **The probe's output** is one line per check: its name, its exit status, and its
   output in base64, so a multi-line body or a curl error can't break the parse, and
   Compose's own progress lines are ignored (Task 5).
7. **Verdict rules.** Each check is `ok`, `warning`, `down` or `leak`; a leak beats down,
   and down beats a pass. Down: Gluetun not running or not healthy, its control server
   saying the VPN is not `running`, the route not going into the tunnel, no answer
   through the tunnel, or qBittorrent stranded. Leak: qBittorrent with a network of its
   own, `apps.qbittorrent.vpn: false`, or the same address on both sides. Warnings only:
   a control server that refuses the key or doesn't answer (the route and the egress are
   the evidence), one that answers without the key (Gluetun not restarted since S3a), an
   answer without an address, and a host that can't ask the service (D9: "passes on
   structure") (Task 6).
8. **`vpn: false` is a `leak` verdict, not an error:** qBittorrent's traffic leaves from
   the host's address by configuration. A stack with no qBittorrent is an error
   (`vpn-check.no-qbittorrent`) (Task 6).
9. **The host is not asked when the tunnel side got no answer:** the verdict is already
   `down`, and it saves a request to the outside service (Task 6).
10. **Gluetun's own public address** (`GET /v1/publicip/ip`) is shown, never compared: it
    is Gluetun's cached lookup through other services, and empty with
    `PUBLICIP_ENABLED=off` (research F32). It is `gluetunPublicIp` in the JSON (Task 6).
11. **The tunnel interface** is `tun0`, unless `apps.gluetun.env` sets `VPN_INTERFACE`
    (Task 6).
12. **`--json`'s `ok`** says the check ran, as in `mediaplane.plan/v1`, where `ok: true`
    can still exit 2; `verdict` says what it found, and the exit code is 1 for `leak` and
    `down`. Errors use the existing `mediaplane.error/v1` envelope (Task 7).
13. **`vpn.addresses`** is one or more IPv4 or IPv6 CIDRs, comma-separated without spaces,
    as Gluetun's `WIREGUARD_ADDRESSES` takes them. `init` checks `--vpn-addresses` before
    its first question and asks again after a bad answer (Task 1).
14. **(check) The test topology** differs from the research's (D10), which used two extra
    networks. One test network ("wan") holds the WireGuard server and the echo; both
    publish on its gateway, a host address, at ports Docker picks (no fixed port can
    clash). The host reaches the echo directly and is seen as the gateway; the tunnel
    reaches it through the server and is seen as the server's address. So one URL
    exercises the real comparison from both sides. The echo's port on the gateway is the
    "leak target" an ordinary container reaches. Verified on the dev box (Task 2).
15. **The kill-switch test also locks in three "Things S1 encodes" rows:** Gluetun's health
    check gating qBittorrent, `FIREWALL_OUTBOUND_SUBNETS` as a comma list (two RFC 5737
    subnets through `apps.gluetun.env`, both routed), and `WEBUI_PORT` in Gluetun's
    namespace (`apps.qbittorrent.port: 8090`, answering on `127.0.0.1:8090` with
    `bind: localhost`, which is also an S3d review input) (Task 2).
16. **(check) The WireGuard module on CI:** a step
    `sudo modprobe wireguard && test -d /sys/module/wireguard` before `pnpm test:e2e` on
    both runners, and the fixture fails, never skips, without `/sys/module/wireguard`.
    The kill-switch test comes second (Task 2), before any `vpn-check` code, so the
    controller can push the branch early and learn R1 from CI before the rest is built.
    If CI can't load the module, Task 2's contingency swaps the server for a userspace
    one (`wireguard-go`) without touching the test.
17. **`vpn-check` from the image is tested behind the real proxy** by a new
    `deployMediaplane()` e2e helper. `deploy.e2e.test.ts` keeps its own setup; moving it
    onto the helper is an S8 tidy-up (Task 8).
18. **The roadmap's last S3d input is covered by the e2e:** Gluetun started without its
    key file answers without the key, and `vpn-check` warns (Task 8).

## File structure (new and changed in this slice)

```
packages/engine/src/
├── config/schema.ts               (changed) vpn.addresses
├── runtime/types.ts               (changed) OneOffCommand,
│                                            ContainerDetails, run,
│                                            inspect
├── runtime/docker.ts (+test)      (changed) run, inspect,
│                                            parseDetails; chown on run
├── testing/fakes.ts               (changed) run, inspect, details,
│                                            probeOutput
├── vpn/egress.ts (+test)          (new) DEFAULT_VPN_CHECK_URL,
│                                        egressAddress, fetchEgress
├── vpn/probe.ts (+test)           (new) PROBE_SCRIPT, probeCommand,
│                                        parseProbe
├── vpn/check.ts (+test)           (new) vpnCheck
├── host/report.ts (+test)         (changed) the egress request
├── host/helper.ts (+test)         (changed) helperEgress
└── index.ts                       (changed) the vpn exports
packages/cli/src/
├── vpn-check.ts (+test)           (new) printVpnCheck
├── run.ts                         (changed) vpn-check, CliDeps.egress
└── init.ts (+init.test.ts)        (changed) checks the address
test/e2e/
├── wireguard.ts                   (new) the WireGuard server
├── vpn.e2e.test.ts                (new) the kill switch, vpn-check
└── helpers.ts                     (changed) deployMediaplane
.github/workflows/ci.yml           (changed) modprobe wireguard
deploy/deploy.test.ts              (changed) a comment only
docs/runbooks/vpn-down.md          (new)
docs/, catalog/*/README.md,        (changed) threat model,
README.md, deploy/README.md,       architecture, references,
CONTRIBUTING.md                    spec §5.2, §7.2, §11, roadmap
```

**Tasks:**

1. Housekeeping: `vpn.addresses` must be WireGuard addresses.
2. The kill-switch end-to-end test, and CI's WireGuard module.
3. The runtime: one-off commands and container details.
4. The host's own address: `fetchEgress`, and the host helper's `egress`.
5. The probe inside qBittorrent's network.
6. `vpnCheck()`: the checks and the verdict.
7. `mediaplane vpn-check`.
8. End-to-end: `vpn-check` against the kill switch, from source and from the image.
9. Docs: the "VPN down" runbook, threat model, READMEs, install guide, architecture,
   spec, roadmap.

**Out of scope here:**

- **How the Mediaplane container reaches the apps (D1), ADR 0011, and the wiring:** S3b and
  S3c. Nothing here attaches Mediaplane to the stack's network.
- **The verify stage's VPN topology check** (spec §6.4: "Verify asserts both"), and
  `apply` restarting a stranded qBittorrent: S3b, which can reuse `vpnCheck` without the
  egress check. Task 9 records it in the roadmap.
- **Alerts on a failed `vpn-check`:** M3.
- **Moving `deploy.e2e.test.ts` onto `deployMediaplane()`:** S8, with the other test
  tidy-ups.

---
### Task 1: Housekeeping: `vpn.addresses` must be WireGuard addresses

Roadmap, "Inputs for later slices", S3d: "**Validate `vpn.addresses`.** The schema takes
any non-empty string today. Check it as comma-separated IPv4 or IPv6 CIDRs." The
kill-switch test (Task 2) is the first to apply one for real.

Decision: one or more IPv4 or IPv6 addresses with a prefix length, separated by commas
**without spaces**, as a provider's WireGuard file and Gluetun's `WIREGUARD_ADDRESSES`
take them. IPv4 reuses the existing `IPV4_CIDR` check (no leading zeros); IPv6 uses
`node:net`'s `isIPv6` and a prefix of 0 to 128. `init` checks `--vpn-addresses` before
its first question (inside a `vpn:` block, which is the only place the starter writes
it), and on a terminal asks again after a bad answer, like its other questions.

**Files:**
- Modify: `packages/engine/src/config/schema.ts`
- Modify: `packages/cli/src/init.ts`
- Test: `packages/engine/src/config/load.test.ts`, `packages/cli/src/init.test.ts`
- Generated: `docs/reference/stack-yaml.md`, `docs/reference/stack.schema.json`

**Interfaces:**
- **Consumes:** the existing `IPV4_CIDR` regex and `isIpv4Cidr` in `config/schema.ts`;
  `schemaCheck`, `schemaDiagnostic`, `askUntil` and `Check<T>` in `cli/src/init.ts`.
- **Produces:** `isWireguardAddresses(value: string): boolean`, exported from
  `config/schema.ts` (and so from `@mediaplane/engine`). The schema's message for
  `vpn.addresses` starts `must be one or more addresses with their prefix length`.

- [ ] **Step 1: Write the failing tests**

Add to `describe('parseConfig', …)` in `packages/engine/src/config/load.test.ts`, before
`it('rejects data paths containing ":"', …)`:

```ts
  it('takes vpn.addresses as comma-separated IPv4 or IPv6 addresses with a prefix', () => {
    const vpn = (addresses: string) =>
      `${MINIMAL}vpn:\n  provider: mullvad\n  private_key: { file: secrets/wg.key }\n  addresses: "${addresses}"\n`;
    for (const good of ['10.64.0.2/32', 'fd00::2/128', '10.64.0.2/32,fd00::2/128']) {
      expect(parseConfig(vpn(good)).ok, good).toBe(true);
    }
    for (const bad of [
      '',
      '10.64.0.2',
      '10.64.0.256/32',
      '10.64.0.2/33',
      'fd00::2/129',
      '10.64.0.2/32, fd00::2/128',
      '10.64.0.2/32,',
      'mullvad',
    ]) {
      const diagnostics = diagnosticsOf(vpn(bad));
      expect(diagnostics, bad).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        code: 'config.invalid',
        path: 'vpn.addresses',
      });
      expect(diagnostics[0]?.message).toContain('separated by commas without spaces');
    }
  });
```

In `packages/cli/src/init.test.ts`:

- add, before `it('lets you type the LAN subnet when the one it sees is not it', …)`:

  ```ts
    it('asks again for a WireGuard address the schema rejects', async () => {
      const home = await newHome();
      const term = capture([
        'jellyfin',
        '/srv/data',
        'mullvad',
        '10.64.0.2',
        '10.64.0.2/32,fd00::2/128',
        'localhost',
        'admin',
        'y',
      ]);
      expect(await run(['init', '--home', home], term.io, deps())).toBe(0);
      expect(term.stderr()).toBe(
        'That must be one or more addresses with their prefix length, separated by commas without spaces, such as 10.64.0.2/32 or 10.64.0.2/32,fd00::2/128.\n',
      );
      expect((await stackIn(home)).vpn).toMatchObject({
        addresses: '10.64.0.2/32,fd00::2/128',
      });
    });
  ```

- add a last entry to the `REFUSALS` list, after the
  `[['--vpn-addresses', '10.64.0.2/32'], '--vpn-addresses needs --vpn-provider'],` entry:

  ```ts
      [
        ['--vpn-provider', 'mullvad', '--vpn-addresses', '10.64.0.2'],
        'vpn.addresses: must be one or more addresses with their prefix length',
      ],
  ```

  The two `it.each(REFUSALS…)` tests then check it with and without a terminal: it is
  refused before the first question either way.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/config/load.test.ts packages/cli/src/init.test.ts`

Expected: FAIL. `10.64.0.2` and the other bad values parse today, so the new
`parseConfig` test, the new init test (no question is asked again) and the two new
`REFUSALS` cases fail.

- [ ] **Step 3: Implement**

In `packages/engine/src/config/schema.ts`:

- add `import { isIPv6 } from 'node:net';` as the first import;
- add after `function isIpv4Cidr(…) { … }`:

  ```ts

  /** An IPv6 address with a prefix length of 0 to 128, such as fd00::1/128. */
  function isIpv6Cidr(value: string): boolean {
    const slash = value.lastIndexOf('/');
    const prefix = value.slice(slash + 1);
    return (
      slash > 0 &&
      /^(?:\d|[1-9]\d|1[01]\d|12[0-8])$/.test(prefix) &&
      isIPv6(value.slice(0, slash))
    );
  }

  /**
   * Gluetun's WIREGUARD_ADDRESSES: one or more IPv4 or IPv6 addresses with their prefix
   * length, separated by commas without spaces, as a provider's config file gives them.
   */
  export function isWireguardAddresses(value: string): boolean {
    return value.split(',').every((part) => isIpv4Cidr(part) || isIpv6Cidr(part));
  }

  ```

- replace the `addresses` field of the `vpn` object with:

  ```ts
        addresses: z
          .string()
          .refine(
            isWireguardAddresses,
            'must be one or more addresses with their prefix length, separated by commas without spaces, such as 10.64.0.2/32 or 10.64.0.2/32,fd00::2/128',
          )
          .optional()
          .describe(
            "The WireGuard address, for providers that need one, such as Mullvad: the Address line of your provider's WireGuard file, such as 10.64.0.2/32. Several go comma-separated, without spaces. Other Gluetun settings go in apps.gluetun.env.",
          ),
  ```

  The refinement replaces `.min(1)`: it rejects an empty string too.

In `packages/cli/src/init.ts`:

- in `gatherAnswers`, replace the block that starts
  `if (vpnProvider !== undefined && vpnAddresses === undefined) {` (it asks with `ask(…)`
  and takes any answer) with:

  ```ts
      if (vpnProvider !== undefined && vpnAddresses === undefined) {
        vpnAddresses = await askUntil<string | undefined>(
          ask,
          io,
          "Your provider's WireGuard address, if its config file has one, e.g. 10.64.0.2/32 (empty to skip): ",
          (answer) => (answer === '' ? { value: undefined } : addressesCheck(answer)),
        );
      }
  ```

- in `readFlags`, add a last entry to the object passed to `schemaDiagnostic`, after the
  `lanSubnet` line:

  ```ts
      ...(options.vpnAddresses === undefined
        ? {}
        : { vpnProvider: ANY_PROVIDER, vpnAddresses: options.vpnAddresses }),
  ```

- add before `/** The schema's verdict on one typed answer, as a sentence about that answer. */`:

  ```ts
  /** A provider for checking a WireGuard address: the starter writes it only in a vpn: block. */
  const ANY_PROVIDER = 'custom';

  /** The schema's verdict on a typed WireGuard address. */
  function addressesCheck(answer: string): Check<string> {
    return schemaCheck({ vpnProvider: ANY_PROVIDER, vpnAddresses: answer }, answer);
  }

  ```

- [ ] **Step 4: Run them to verify they pass, and regenerate the references**

```bash
pnpm vitest run packages/engine/src/config packages/cli/src/init.test.ts
pnpm docs:generate
git diff --stat docs/reference
```

Expected: PASS. `docs:generate` rewrites `docs/reference/stack-yaml.md` (the
`vpn.addresses` line) and `docs/reference/stack.schema.json` (its description; its
`minLength` goes, because the refinement replaced `.min(1)`), and nothing else.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/config packages/cli/src/init.ts packages/cli/src/init.test.ts docs/reference
git commit -m "fix(config): vpn.addresses must be WireGuard addresses, and init asks again for a bad one" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: The kill-switch end-to-end test, and CI's WireGuard module

Success criterion 5: "With the VPN tunnel down, qBittorrent has no route out. This is
proven by an automated test." Spec §8.1(4): a local WireGuard server acts as Gluetun's
custom provider; the test checks that qBittorrent's traffic goes through the tunnel, then
stops the server and checks that qBittorrent has no route out. The roadmap's S3d list adds
two checks: Gluetun's control server answers 401 without the key and 200 with it, and
qBittorrent's web UI answers on `127.0.0.1` with `bind: localhost`. Nothing in the engine
changes: the kill switch was built by Slices 1 and 2; this test proves it.

Decision: the topology (decision 14 above).

```text
host
├─ <id>-wan (test network)
│  ├─ <id>-wgserver  WireGuard,
│  │    UDP published on the
│  │    gateway (Gluetun's endpoint)
│  └─ <id>-echo      answers
│       ip=<caller>; also
│       published on the gateway
└─ <id>_default (the stack)
   ├─ gluetun  ─► tunnel ─► wgserver
   └─ qbittorrent, in gluetun's
      network namespace
```

- The host reaches the echo at its own address and is seen as the gateway; Gluetun's
  tunnel reaches it through the server, which masquerades, and is seen as the server's
  address. Without the tunnel, Gluetun's namespace reaches neither the echo nor the
  echo's port on the gateway, while an ordinary container on the stack's network does
  reach that port: that is the control.
- Gluetun's own health checks aim at the echo (`HEALTH_TARGET_ADDRESSES`,
  `HEALTH_ICMP_TARGET_IPS`), and its DNS, public-IP and version lookups are off, so the
  test needs no internet (research F24, F25).
- Keys come from Node's X25519 (`generateKeyPairSync('x25519')`, JWK base64url to
  base64), so no `wg` tool is needed (research F36).
- Probes are `docker run --rm --init busybox wget -T 5`: busybox as PID 1 never stops a
  hung `wget` (research pitfall).

Decision: three checks lock in "Things S1 encodes" rows (decision 15):
`apps.qbittorrent.port: 8090` checks `WEBUI_PORT` in Gluetun's namespace, and
`FIREWALL_OUTBOUND_SUBNETS` gets two RFC 5737 subnets through `apps.gluetun.env`.
Decision: CI loads the module before the end-to-end tests, and the fixture fails, never
skips, without it (decision 16).

**Files:**
- Create: `test/e2e/wireguard.ts`, `test/e2e/vpn.e2e.test.ts`
- Modify: `test/e2e/helpers.ts` (a comment), `.github/workflows/ci.yml`

**Interfaces:**
- **Consumes:** `apply`, `createDockerRuntime`, `detectHostFacts`, `nodeExec`,
  `nodeProbe`, `readSecretStore` from `@mediaplane/engine`; `BUSYBOX`, `composeDown`,
  `makeHome` and `removeAsRoot` from `test/e2e/helpers.ts`.
- **Produces** (Task 8 uses them):
  - `WIREGUARD: string`, `TUNNEL: { server: '10.66.0.1/24'; client: '10.66.0.2/32' }`,
    `wireguardKeys(): { privateKey: string; publicKey: string }`;
  - `startWireGuard(id: string): Promise<WireGuardServer>`, where
    `WireGuardServer` is `{ gateway: string; endpointPort: number; serverPublicKey: string; clientPrivateKey: string; echo: string; leakPort: number; exit: string; stop(): Promise<void>; remove(): Promise<void> }`;
  - in `vpn.e2e.test.ts`: `PROJECT`, `vpnStack(data, wg)`, `busybox(network, ...args)`,
    `fetchFrom(network, url)` and `statusOf(result)`.

- [ ] **Step 1: The WireGuard server fixture**

Create `test/e2e/wireguard.ts`:

```ts
import { generateKeyPairSync } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeExec } from '@mediaplane/engine';
import { BUSYBOX, removeAsRoot } from './helpers';

/**
 * The WireGuard server that stands in for a VPN provider in the kill-switch test (spec
 * §8.1(4)). It needs the host's wireguard kernel module: it has no userspace fallback.
 */
export const WIREGUARD =
  'lscr.io/linuxserver/wireguard:1.0.20260223-r0-ls123@sha256:33c5e4260f5ddf9376fcb6f1ff90c0ccc3c63d2ab469595e33d178ecf8a4c4c6';

/** The tunnel: the server's address on it, and Gluetun's (`vpn.addresses`). */
export const TUNNEL = { server: '10.66.0.1/24', client: '10.66.0.2/32' } as const;

/**
 * A stand-in for the internet: a network of its own, outside the stack, holding the
 * WireGuard server and an echo server that answers `ip=<the caller's address>`, as
 * Cloudflare's /cdn-cgi/trace does. The host reaches the echo directly, and the stack
 * reaches it only through the tunnel, so the echo sees a different address for each.
 */
export interface WireGuardServer {
  /** The network's gateway: an address of the host, where the two ports are published. */
  gateway: string;
  /** The server's UDP port on the gateway: Gluetun's endpoint. */
  endpointPort: number;
  serverPublicKey: string;
  /** Gluetun's private key, for `vpn.private_key`. */
  clientPrivateKey: string;
  /** The echo server's own address, reachable from the host and through the tunnel. */
  echo: string;
  /** The echo, published on the gateway: a target any container on the host reaches. */
  leakPort: number;
  /** The server's address on the network: what the echo sees for traffic from the tunnel. */
  exit: string;
  /** Stop the server, as a VPN provider going away would. */
  stop(): Promise<void>;
  /** Remove both containers, the network and the files. Safe to call more than once. */
  remove(): Promise<void>;
}

/** An X25519 key pair in WireGuard's base64, from Node alone: no `wg` tool needed. */
export function wireguardKeys(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const base64 = (field: string | undefined) =>
    Buffer.from(field ?? '', 'base64url').toString('base64');
  return {
    privateKey: base64(privateKey.export({ format: 'jwk' }).d),
    publicKey: base64(publicKey.export({ format: 'jwk' }).x),
  };
}

async function docker(...args: string[]): Promise<string> {
  const result = await nodeExec('docker', args, { cwd: '/', timeoutMs: 120_000 });
  if (result.code !== 0) {
    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

/** The host port Docker chose for a container's `port` (such as "51820/udp"). */
async function publishedPort(container: string, port: string): Promise<number> {
  const [first] = (await docker('port', container, port)).split('\n');
  return Number(first?.split(':').at(-1));
}

async function addressOn(container: string, network: string): Promise<string> {
  return docker(
    'inspect',
    '--format',
    `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
    container,
  );
}

/** Fail, never skip, when the host can't run the server: CI loads the module first. */
async function requireWireGuardModule(): Promise<void> {
  try {
    await access('/sys/module/wireguard');
  } catch {
    throw new Error(
      'the wireguard kernel module is not loaded, and the test WireGuard server needs it: run "sudo modprobe wireguard" (CI does this in its e2e job)',
    );
  }
}

/** Start the server and the echo, as `<id>-wgserver` and `<id>-echo` on `<id>-wan`. */
export async function startWireGuard(id: string): Promise<WireGuardServer> {
  await requireWireGuardModule();
  const network = `${id}-wan`;
  const server = `${id}-wgserver`;
  const echoName = `${id}-echo`;
  const dir = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-wg-'));
  let removed = false;
  const remove = async () => {
    if (removed) return;
    removed = true;
    await nodeExec('docker', ['rm', '-f', '-v', server, echoName], {
      cwd: '/',
    });
    await nodeExec('docker', ['network', 'rm', network], { cwd: '/' });
    // The server's image writes into its /config as root.
    await removeAsRoot(dir);
  };
  try {
    const serverKeys = wireguardKeys();
    const clientKeys = wireguardKeys();
    await mkdir(join(dir, 'wg_confs'), { recursive: true });
    await writeFile(
      join(dir, 'wg_confs', 'wg0.conf'),
      [
        '[Interface]',
        `Address = ${TUNNEL.server}`,
        'ListenPort = 51820',
        `PrivateKey = ${serverKeys.privateKey}`,
        `PostUp = iptables -t nat -A POSTROUTING -s ${TUNNEL.server} -j MASQUERADE`,
        `PostDown = iptables -t nat -D POSTROUTING -s ${TUNNEL.server} -j MASQUERADE`,
        '',
        '[Peer]',
        `PublicKey = ${clientKeys.publicKey}`,
        `AllowedIPs = ${TUNNEL.client}`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    // Busybox httpd gives REMOTE_ADDR as [::ffff:a.b.c.d]; answer a.b.c.d. The header
    // ends in CRLF, which Node's fetch insists on.
    await mkdir(join(dir, 'www', 'cgi-bin'), { recursive: true });
    const cgi = join(dir, 'www', 'cgi-bin', 'ip');
    await writeFile(
      cgi,
      [
        '#!/bin/sh',
        'addr=${REMOTE_ADDR#[}',
        'addr=${addr%]}',
        'printf \'Content-Type: text/plain\\r\\n\\r\\nip=%s\\n\' "${addr#::ffff:}"',
        '',
      ].join('\n'),
    );
    await chmod(cgi, 0o755);

    await docker('network', 'create', network);
    const gateway = await docker(
      'network',
      'inspect',
      '--format',
      '{{range .IPAM.Config}}{{.Gateway}}{{end}}',
      network,
    );
    // --init: busybox httpd as PID 1 would not stop on SIGTERM.
    await docker(
      'run',
      '-d',
      '--init',
      '--name',
      echoName,
      '--network',
      network,
      '-p',
      `${gateway}::80`,
      '-v',
      `${join(dir, 'www')}:/www:ro`,
      BUSYBOX,
      'httpd',
      '-f',
      '-p',
      '80',
      '-h',
      '/www',
    );
    await docker(
      'run',
      '-d',
      '--name',
      server,
      '--network',
      network,
      '-p',
      `${gateway}::51820/udp`,
      '--cap-add',
      'NET_ADMIN',
      '--sysctl',
      'net.ipv4.ip_forward=1',
      '--sysctl',
      'net.ipv4.conf.all.src_valid_mark=1',
      '-e',
      `PUID=${String(process.getuid?.() ?? 1000)}`,
      '-e',
      `PGID=${String(process.getgid?.() ?? 1000)}`,
      '-e',
      'TZ=Etc/UTC',
      '-v',
      `${dir}:/config`,
      WIREGUARD,
    );
    // The image's init brings wg0 up from /config/wg_confs; wait until it has.
    for (let attempt = 0; ; attempt++) {
      const up = await nodeExec('docker', ['exec', server, 'wg', 'show', 'wg0'], {
        cwd: '/',
      });
      if (up.code === 0) break;
      if (attempt === 60) {
        const logs = await nodeExec('docker', ['logs', '--tail', '30', server], {
          cwd: '/',
        });
        throw new Error(
          `the WireGuard server did not bring wg0 up:\n${logs.stdout}${logs.stderr}`,
        );
      }
      await new Promise((done) => setTimeout(done, 1000));
    }
    return {
      gateway,
      endpointPort: await publishedPort(server, '51820/udp'),
      serverPublicKey: serverKeys.publicKey,
      clientPrivateKey: clientKeys.privateKey,
      echo: await addressOn(echoName, network),
      leakPort: await publishedPort(echoName, '80/tcp'),
      exit: await addressOn(server, network),
      stop: async () => {
        await docker('stop', '-t', '2', server);
      },
      remove,
    };
  } catch (cause) {
    await remove();
    throw cause;
  }
}
```

`docker exec` here is the test's own call on the host, outside Mediaplane and its proxy.

- [ ] **Step 2: The test**

Create `test/e2e/vpn.e2e.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeExec,
  nodeProbe,
  readSecretStore,
  type ExecResult,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { BUSYBOX, composeDown, makeHome } from './helpers';
import { startWireGuard, TUNNEL, type WireGuardServer } from './wireguard';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-vpn`;
/** qBittorrent's web UI port, moved off the default to check WEBUI_PORT behind Gluetun. */
const QBT_PORT = 8090;
/** Two documentation subnets (RFC 5737), to check Gluetun takes a comma-separated list. */
const OUTBOUND = ['192.0.2.0/24', '198.51.100.0/24'];

/**
 * qBittorrent behind Gluetun, Gluetun on the test's WireGuard server (Gluetun's `custom`
 * provider), and the media server every stack has. Gluetun's health checks aim at the
 * echo server, and its own DNS, public-IP and version lookups are off, so it needs no
 * internet. Values are JSON strings, which are valid YAML.
 */
function vpnStack(data: string, wg: WireGuardServer): string {
  const q = (value: string | number) => JSON.stringify(String(value));
  return `version: 1
user: { uid: ${String(process.getuid?.() ?? 1000)}, gid: ${String(process.getgid?.() ?? 1000)} }
paths: { data: ${q(data)} }
network: { bind: localhost }
media_server: jellyfin
vpn:
  provider: custom
  private_key: { file: secrets/wg.key }
  addresses: ${q(TUNNEL.client)}
apps:
  qbittorrent: { port: ${String(QBT_PORT)} }
  gluetun:
    env:
      WIREGUARD_ENDPOINT_IP: ${q(wg.gateway)}
      WIREGUARD_ENDPOINT_PORT: ${q(wg.endpointPort)}
      WIREGUARD_PUBLIC_KEY: ${q(wg.serverPublicKey)}
      HEALTH_TARGET_ADDRESSES: ${q(`${wg.echo}:80`)}
      HEALTH_ICMP_TARGET_IPS: ${q(wg.echo)}
      DNS_SERVER: "off"
      PUBLICIP_ENABLED: "off"
      VERSION_INFORMATION: "off"
      FIREWALL_OUTBOUND_SUBNETS: ${q(OUTBOUND.join(','))}
`;
}

/**
 * A command in a throwaway busybox container on `network`: a network name, or
 * `container:<id>` for a container's own namespace. `--init`, because busybox as PID 1
 * never stops a wget that hangs.
 */
function busybox(network: string, ...args: string[]): Promise<ExecResult> {
  return nodeExec(
    'docker',
    ['run', '--rm', '--init', '--network', network, BUSYBOX, ...args],
    { cwd: '/', timeoutMs: 60_000 },
  );
}

/** `wget` of `url` from `network`, giving up after 5 seconds. */
function fetchFrom(network: string, url: string): Promise<ExecResult> {
  return busybox(network, 'wget', '-T', '5', '-q', '-O', '-', url);
}

/** The HTTP status busybox `wget -S` printed, or 0 when there was no answer. */
function statusOf(result: ExecResult): number {
  return Number(/HTTP\/1\.1 (\d{3})/.exec(result.stderr)?.[1] ?? 0);
}

describe('the VPN kill switch, against a local WireGuard server', () => {
  it('sends qBittorrent through the tunnel, and lets nothing out once the tunnel or Gluetun is down', async () => {
    const home = await makeHome();
    const wg = await startWireGuard(PROJECT);
    try {
      await writeFile(join(home, 'stack.yaml'), vpnStack(join(home, 'data'), wg));
      await mkdir(join(home, 'secrets'), { mode: 0o700 });
      await writeFile(join(home, 'secrets', 'wg.key'), `${wg.clientPrivateKey}\n`, {
        mode: 0o600,
      });
      const runtime = createDockerRuntime({ home, project: PROJECT });
      const applied = await apply({
        home,
        catalog,
        host: detectHostFacts(),
        env: process.env,
        runtime,
        probe: nodeProbe,
        confirm: () => Promise.resolve(true),
      });
      expect(applied.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(applied.outcome).toBe('success');

      // Gluetun's own health check gates qBittorrent (depends_on: service_healthy).
      const containers = await runtime.containers();
      expect(containers.map((c) => `${c.service} ${c.state} ${c.health}`).sort()).toEqual(
        [
          'gluetun running healthy',
          'jellyfin running healthy',
          'qbittorrent running healthy',
        ],
      );
      const gluetun = containers.find((c) => c.service === 'gluetun')?.id ?? 'missing';
      const qbittorrent =
        containers.find((c) => c.service === 'qbittorrent')?.id ?? 'missing';
      const inGluetun = `container:${gluetun}`;
      const inspect = await nodeExec(
        'docker',
        ['container', 'inspect', '--format', '{{.HostConfig.NetworkMode}}', qbittorrent],
        { cwd: '/' },
      );
      expect(inspect.stdout.trim()).toBe(inGluetun);

      // qBittorrent's web UI, on WEBUI_PORT inside Gluetun's namespace, answers on
      // localhost without FIREWALL_OUTBOUND_SUBNETS covering it.
      const ui = await fetch(`http://127.0.0.1:${String(QBT_PORT)}/`, {
        signal: AbortSignal.timeout(10_000),
      });
      expect(ui.status).toBe(200);

      // Gluetun's control server answers only with Mediaplane's key, and only the two
      // routes its role lists. The key never appears in a failure message.
      const key = (await readSecretStore(home)).apps.gluetun?.controlApiKey ?? '';
      expect(key !== '', 'no Gluetun control key stored').toBe(true);
      const control = (path: string, ...header: string[]) =>
        busybox(inGluetun, 'wget', '-S', '-T', '5', '-q', '-O', '-', ...header, path);
      const status = 'http://127.0.0.1:8000/v1/vpn/status';
      expect(statusOf(await control(status))).toBe(401);
      const withKey = await control(status, '--header', `X-API-Key: ${key}`);
      expect(statusOf(withKey)).toBe(200);
      expect(withKey.stdout.trim()).toBe('{"status":"running"}');
      const settings = 'http://127.0.0.1:8000/v1/vpn/settings';
      expect(statusOf(await control(settings, '--header', `X-API-Key: ${key}`))).toBe(
        401,
      );

      // The tunnel is up: the route is tun0, Gluetun took both outbound subnets, and the
      // echo sees the WireGuard server's address for qBittorrent, and the host's for us.
      const route = await busybox(inGluetun, 'ip', 'route', 'get', wg.echo);
      expect(route.stdout).toMatch(/ dev tun0 /);
      const routes = await busybox(inGluetun, 'ip', 'route', 'show', 'table', 'all');
      for (const subnet of OUTBOUND) expect(routes.stdout).toContain(`${subnet} via `);
      const echo = `http://${wg.echo}/cgi-bin/ip`;
      expect((await fetchFrom(inGluetun, echo)).stdout.trim()).toBe(`ip=${wg.exit}`);
      const fromHost = await fetch(echo, { signal: AbortSignal.timeout(10_000) });
      expect((await fromHost.text()).trim()).toBe(`ip=${wg.gateway}`);

      // The tunnel goes down. At once, nothing gets out of Gluetun's namespace, while an
      // ordinary container on the stack's network still reaches the same target.
      await wg.stop();
      const leak = `http://${wg.gateway}:${String(wg.leakPort)}/cgi-bin/ip`;
      expect((await fetchFrom(inGluetun, echo)).code).not.toBe(0);
      expect((await fetchFrom(inGluetun, leak)).code).not.toBe(0);
      const ordinary = await fetchFrom(`${PROJECT}_default`, leak);
      expect(ordinary.code, ordinary.stderr).toBe(0);
      expect(ordinary.stdout.trim()).toBe(`ip=${wg.gateway}`);
      expect((await busybox(inGluetun, 'ip', 'route', 'get', wg.echo)).stdout).toMatch(
        / dev tun0 /,
      );

      // Gluetun stops: qBittorrent keeps running, with nothing but loopback.
      const stopped = await nodeExec('docker', ['stop', '-t', '5', gluetun], {
        cwd: '/',
      });
      expect(stopped.code, stopped.stderr).toBe(0);
      const inQbittorrent = `container:${qbittorrent}`;
      const links = await busybox(inQbittorrent, 'ip', '-o', 'link');
      expect(
        links.stdout
          .trim()
          .split('\n')
          .map((l) => l.split(':')[1]?.trim()),
      ).toEqual(['lo']);
      const unreachable = await fetchFrom(inQbittorrent, leak);
      expect(unreachable.code).not.toBe(0);
      expect(unreachable.stderr).toContain('Network is unreachable');
    } finally {
      const down = await composeDown(PROJECT);
      await wg.remove();
      expect(down.code, down.stderr).toBe(0);
    }
  }, 600_000);
});
```

In `test/e2e/helpers.ts`, replace the first line of `stackFor`'s doc comment with:

```ts
 * The M1 video stack without the VPN (vpn.e2e.test.ts has its own, behind the VPN).
```

- [ ] **Step 3: Load the module in CI**

In `.github/workflows/ci.yml`, job `e2e`, replace

```yaml
      - run: docker version && docker compose version
      - run: pnpm test:e2e
```

with

```yaml
      - run: docker version && docker compose version
      # The kill-switch test's WireGuard server needs the kernel module, and can't load it
      # from inside its container. The test fails, and never skips, without it.
      - name: Load the WireGuard kernel module
        run: sudo modprobe wireguard && test -d /sys/module/wireguard
      - run: pnpm test:e2e
```

- [ ] **Step 4: Run it on real Docker, and look for leftovers**

```bash
test -d /sys/module/wireguard || sudo modprobe wireguard
pnpm typecheck && pnpm lint
docker volume ls -q | wc -l
pnpm test:e2e test/e2e/vpn.e2e.test.ts
docker ps -a --filter name=mediaplane-e2e --format '{{.Names}}'
docker network ls --filter name=mediaplane-e2e --format '{{.Name}}'
docker volume ls -q | wc -l
```

Expected: PASS, in about 40 seconds on the dev box with the images cached (the first run
pulls the WireGuard image, about 40 MB). The two `docker … ls` listings print nothing, and
the volume count is the same before and after. The test passes against the code as it
is: there is nothing to make fail first, because it proves what Slices 1 and 2 built.
If Gluetun never becomes healthy, read its log (`docker logs <PROJECT>-gluetun-1` while
the test waits) for the WireGuard handshake: the usual cause is a missing module or a
firewall dropping UDP to the gateway.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add test/e2e .github/workflows/ci.yml
git commit -m "test(e2e): prove the VPN kill switch against a local WireGuard server" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Decision: the controller may push the branch now, for a first CI run that settles R1 on
both runners while Tasks 3 to 9 are built (decision 16). Implementers never push.

#### If CI can't load the module (the R1 contingency)

Only if the first CI run fails at "Load the WireGuard kernel module" (`modprobe: FATAL:
Module wireguard not found`) on either runner. Not needed on the dev box, which has the
module, and not replayed.

- **Swap the server for a userspace one.** Add `test/e2e/wireguard/Dockerfile`: a pinned
  Alpine base (`alpine:<tag>@sha256:<digest>`) with `apk add --no-cache wireguard-tools
  wireguard-go iptables` at pinned versions, and `ENTRYPOINT ["/bin/sh", "-c",
  "wg-quick up /config/wg_confs/wg0.conf && exec sleep infinity"]`. `wg-quick` tries the
  kernel first and falls back to `wireguard-go` when `ip link add … type wireguard`
  fails, which is exactly a runner without the module. Check the package names and
  versions against the Alpine release you pin.
- **In `test/e2e/wireguard.ts`:** build that image as `mediaplane-e2e-wg:<pid>` in
  `startWireGuard()` (and remove it in `remove()`), run it instead of `WIREGUARD` with
  `--device /dev/net/tun` added, and drop `requireWireGuardModule()`. The ready check
  (`wg show wg0`) and everything the test sees stay the same, so
  `vpn.e2e.test.ts` doesn't change.
- **In `ci.yml`:** remove the module step.
- **Docs:** the roadmap's S8 "Pins outside the catalog" lists the Alpine base and the
  apk pins instead of the LinuxServer image; CONTRIBUTING drops the `modprobe` note.
- **Commit** as `test(e2e): a userspace WireGuard server for the kill-switch test`, and
  record in spec §11 (Slice 3d) that the hosted runners lack the module.

---
### Task 3: The runtime: one-off commands and container details

`vpn-check` needs two things from Docker that the runtime can't give yet: a command run
in a throwaway container of the `qbittorrent` service, with something on its stdin, and
each container's network mode and start time.

Decision: `run(service, command)` is the `compose run --rm --no-deps -T` the ownership
helper already makes, generalised; `chown` becomes a call to it, with the same arguments
as before (decision 4). Its output comes back with `command.values` replaced by `***`.
Decision: `inspect(ids)` runs `docker container inspect --format '{{.Id}}
{{.HostConfig.NetworkMode}} {{.State.StartedAt}}' <ids…>` (`GET containers/{id}/json`,
already on the proxy's allow-list), and refuses anything that is not a container ID, so
no name or option can reach the command line.

**Files:**
- Modify: `packages/engine/src/runtime/types.ts`, `packages/engine/src/runtime/docker.ts`,
  `packages/engine/src/testing/fakes.ts`
- Modify (a comment only): `deploy/deploy.test.ts`
- Test: `packages/engine/src/runtime/docker.test.ts`

**Interfaces:**
- **Consumes:** `ExecResult` from `runtime/exec.ts`; `redact`, `projectArgs`, `docker`,
  `firstLine`, `commandResult` and `DOCKER_TIMEOUTS` inside `runtime/docker.ts`.
- **Produces:**
  - `interface OneOffCommand { user: { uid: number; gid: number }; entrypoint: string; args: readonly string[]; input?: string; values: Record<string, string> }`;
  - `interface ContainerDetails { id: string; networkMode: string; startedAt: string }`;
  - `Runtime.run(service: string, command: OneOffCommand): Promise<ExecResult>`;
  - `Runtime.inspect(ids: readonly string[]): Promise<ContainerDetails[]>` (throws
    `RuntimeError`);
  - `parseDetails(stdout: string): ContainerDetails[]` in `runtime/docker.ts`;
  - in the fakes: `FakeRuntimeOptions.run?: (service, command) => ExecResult | Promise<ExecResult>`
    (default: exit 0, no output), recorded as
    `run <service> <entrypoint> as <uid>:<gid>`;
    `FakeRuntimeOptions.details?: Record<string, Partial<Omit<ContainerDetails, 'id'>>>`
    (default: `networkMode: 'bridge'`, `startedAt: FAKE_STARTED_AT`), recorded as
    `inspect <ids…>`; and `FAKE_STARTED_AT = '2026-10-10T10:00:00.000000001Z'`.

- [ ] **Step 1: Write the failing tests**

Add to `describe('createDockerRuntime', …)` in
`packages/engine/src/runtime/docker.test.ts`, before
`it("reports a failed command with Compose's last lines, secrets replaced", …)`:

```ts
  it('runs a one-off in a throwaway container of the service, with its input on stdin', async () => {
    const dir = await tempDir('mediaplane-runtime-');
    const { exec, calls } = recorder(() => ({
      code: 3,
      stdout: 'route fake-key-0123 ok\n',
      stderr: 'Container x Creating\nfake-key-0123 refused\n',
    }));
    const runtime = createDockerRuntime({ home: dir, project: 'mediaplane-test', exec });
    const result = await runtime.run('qbittorrent', {
      user: { uid: 65534, gid: 65534 },
      entrypoint: 'sh',
      args: ['-c', 'read -r key', 'probe', '8000'],
      input: 'fake-key-0123\n',
      values: { key: 'fake-key-0123' },
    });
    expect(result).toEqual({
      code: 3,
      stdout: 'route *** ok\n',
      stderr: 'Container x Creating\n*** refused\n',
    });
    expect(calls[0]?.args).toEqual([
      ...projectArgs(dir),
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--user',
      '65534:65534',
      '--entrypoint',
      'sh',
      'qbittorrent',
      '-c',
      'read -r key',
      'probe',
      '8000',
    ]);
    // The secret goes in on stdin: never in the arguments or the environment.
    expect(calls[0]?.options?.input).toBe('fake-key-0123\n');
    expect(calls[0]?.args.join(' ')).not.toContain('fake-key-0123');
    expect(Object.values(calls[0]?.options?.env ?? {})).not.toContain('fake-key-0123');
    expect(calls[0]?.options?.timeoutMs).toBe(300_000);
  });

  it("reads containers' network mode and start time", async () => {
    const other = 'e'.repeat(64);
    const { exec, calls } = recorder(() =>
      ok(
        `${SONARR_ID} container:${other} 2026-10-10T10:00:01.5Z\n${other} mediaplane_default 2026-10-10T10:00:00Z\n`,
      ),
    );
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    expect(await runtime.inspect([SONARR_ID, other])).toEqual([
      {
        id: SONARR_ID,
        networkMode: `container:${other}`,
        startedAt: '2026-10-10T10:00:01.5Z',
      },
      { id: other, networkMode: 'mediaplane_default', startedAt: '2026-10-10T10:00:00Z' },
    ]);
    expect(calls[0]?.args).toEqual([
      'container',
      'inspect',
      '--format',
      '{{.Id}} {{.HostConfig.NetworkMode}} {{.State.StartedAt}}',
      SONARR_ID,
      other,
    ]);
  });

  it('inspects container IDs only, and asks nothing for none', async () => {
    const { exec, calls } = recorder(() => ok(''));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    await expect(runtime.inspect([SONARR_ID, '--help'])).rejects.toThrow(
      'not a container ID: "--help"',
    );
    expect(await runtime.inspect([])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('explains an inspect docker could not do', async () => {
    const { exec } = recorder(() => ({
      code: 1,
      stdout: '',
      stderr: `Error: No such container: ${SONARR_ID}\n`,
    }));
    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
    await expect(runtime.inspect([SONARR_ID])).rejects.toThrow(
      `docker container inspect failed: Error: No such container: ${SONARR_ID}`,
    );
  });
```

The existing "runs chown as root in a throwaway container of the service" test stays as it
is: `chown`'s arguments must not change.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/runtime`

Expected: FAIL: `runtime.run is not a function` and `runtime.inspect is not a function`.

- [ ] **Step 3: Implement**

In `packages/engine/src/runtime/types.ts`:

- add `import type { ExecResult } from './exec';` and a blank line at the top;
- add before `/** The host helper's output, or why it failed; … */`:

  ```ts
  /** What `docker container inspect` says about one container. */
  export interface ContainerDetails {
    id: string;
    /** `HostConfig.NetworkMode`, such as "container:<id>" for one that shares another's. */
    networkMode: string;
    /** `State.StartedAt`: when it last started (RFC 3339). */
    startedAt: string;
  }

  /** A command for a throwaway container of one of the stack's services (`compose run`). */
  export interface OneOffCommand {
    /** Who it runs as. */
    user: { uid: number; gid: number };
    entrypoint: string;
    args: readonly string[];
    /**
     * Written to its standard input, then closed. A secret sent this way stays off every
     * command line, out of the container's environment, and out of `docker inspect`.
     */
    input?: string;
    /** Secret values, replaced with `***` in what it prints. */
    values: Record<string, string>;
  }

  ```

- add to `interface Runtime`, after `up(…)`:

  ```ts
    /**
     * Run `command` in a throwaway container of `service` (`compose run --rm --no-deps -T`),
     * with the service's own image, mounts and network: for a service with `network_mode:
     * service:gluetun`, inside Gluetun's network namespace. Its exit code and output, with
     * `command.values` replaced. Throws a `RuntimeError` when docker can't be started.
     */
    run(service: string, command: OneOffCommand): Promise<ExecResult>;
    /**
     * Details of the containers `ids`, as `containers()` gives their IDs, in that order.
     * Throws a `RuntimeError` when docker fails.
     */
    inspect(ids: readonly string[]): Promise<ContainerDetails[]>;
  ```

In `packages/engine/src/runtime/docker.ts`:

- add `type ContainerDetails,` after `type CommandResult,` and `type OneOffCommand,` after
  `type HelperResult,` in the import from `./types`;
- add inside `createDockerRuntime`, after `projectArgs()` and before `return {`:

  ```ts
    async function run(service: string, command: OneOffCommand): Promise<ExecResult> {
      const result = await docker(
        'compose run',
        [
          ...(await projectArgs()),
          'run',
          '--rm',
          '--no-deps',
          // -T, not --no-tty: Compose v2 spells the long form --no-TTY, v5 --no-tty.
          '-T',
          '--user',
          `${String(command.user.uid)}:${String(command.user.gid)}`,
          '--entrypoint',
          command.entrypoint,
          service,
          ...command.args,
        ],
        { input: command.input, timeoutMs: DOCKER_TIMEOUTS.run },
      );
      return {
        code: result.code,
        stdout: redact(result.stdout, command.values),
        stderr: redact(result.stderr, command.values),
      };
    }

  ```

- replace the whole `async chown(service, path, owner, values) { … },` member with:

  ```ts
      run,

      async inspect(ids) {
        // IDs, never names or options: they come from containers().
        const bad = ids.find((id) => !/^[0-9a-f]{12,64}$/.test(id));
        if (bad !== undefined) {
          throw new RuntimeError(`not a container ID: ${JSON.stringify(bad)}`);
        }
        if (ids.length === 0) return [];
        const result = await docker('container inspect', [
          'container',
          'inspect',
          '--format',
          '{{.Id}} {{.HostConfig.NetworkMode}} {{.State.StartedAt}}',
          ...ids,
        ]);
        if (result.code !== 0) {
          throw new RuntimeError(
            `docker container inspect failed: ${firstLine(result.stderr)}`,
          );
        }
        return parseDetails(result.stdout);
      },

      async chown(service, path, owner, values) {
        const result = await run(service, {
          user: { uid: 0, gid: 0 },
          entrypoint: 'chown',
          args: ['-R', `${String(owner.uid)}:${String(owner.gid)}`, path],
          values,
        });
        return commandResult(result, {});
      },
  ```

  (`run` already replaced the values, so `commandResult` gets none.)

- add before `/** \`docker compose config --hash\` output: … */`:

  ```ts
  /** `docker container inspect` lines of "<id> <network mode> <started at>". */
  export function parseDetails(stdout: string): ContainerDetails[] {
    return stdout
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .flatMap(([id, networkMode, startedAt]) =>
        id === undefined || networkMode === undefined || startedAt === undefined
          ? []
          : [{ id, networkMode, startedAt }],
      );
  }

  ```

In `packages/engine/src/testing/fakes.ts`:

- add `import type { ExecResult } from '../runtime/exec';` after the
  `import type { HostRequest } from '../host/report';` line, and `type ContainerDetails,`
  and `type OneOffCommand,` to the import from `../runtime/types`;
- add before `export interface FakeRuntimeOptions {`:

  ```ts
  /** When a fake container started, unless the test says otherwise. */
  export const FAKE_STARTED_AT = '2026-10-10T10:00:00.000000001Z';

  ```

- add to `FakeRuntimeOptions`, after `chown?: CommandResult;`:

  ```ts
    /** Answers a one-off command; without it, every one-off exits 0 and prints nothing. */
    run?: (service: string, command: OneOffCommand) => ExecResult | Promise<ExecResult>;
    /**
     * `inspect` details by container ID. Any other container is on "bridge" and started at
     * FAKE_STARTED_AT.
     */
    details?: Record<string, Partial<Omit<ContainerDetails, 'id'>>>;
  ```

  and replace the `calls` doc comment with:

  ```ts
    /**
     * Each call is appended here, e.g. "pull", "chown seerr 1000:1000 /app/config" or
     * "run qbittorrent sh as 65534:65534".
     */
  ```

- add to the object `fakeRuntime` returns, before `chown: (service, path, owner) => {`:

  ```ts
      // async: a throwing callback rejects like a failed docker call.
      run: async (service, command) => {
        const { uid, gid } = command.user;
        record(`run ${service} ${command.entrypoint} as ${String(uid)}:${String(gid)}`);
        return (
          (await options.run?.(service, command)) ?? { code: 0, stdout: '', stderr: '' }
        );
      },
      inspect: (ids) => {
        record(`inspect ${ids.join(' ')}`);
        return Promise.resolve(
          ids.map((id) => ({
            id,
            networkMode: 'bridge',
            startedAt: FAKE_STARTED_AT,
            ...options.details?.[id],
          })),
        );
      },
  ```

In `deploy/deploy.test.ts`, replace the last line of the comment above `ENGINE_CALLS`,
` * query.`, with:

```ts
 * query. vpn-check (Slice 3d) adds none: its probe is a `compose run` like the chown
 * helper, its `container inspect` is `GET containers/{id}/json`, and its host side is the
 * host helper.
```

`ENGINE_CALLS` itself doesn't change: decision 1.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/runtime packages/engine/src/apply deploy`

Expected: PASS, the chown tests in `runtime` and `apply` included.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/runtime packages/engine/src/testing/fakes.ts deploy/deploy.test.ts
git commit -m "feat(engine): run one-off commands in a service's container, and inspect containers" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 4: The host's own address: `fetchEgress`, and the host helper's `egress`

`vpn-check` compares the address qBittorrent's traffic leaves from with the host's own
(ruling D9), as an IP-echo service sees them: `https://1.1.1.1/cdn-cgi/trace` by default,
or `MEDIAPLANE_VPN_CHECK_URL`. This task builds the host's side.

Decision: run from source, the CLI fetches the URL itself. In the image, the Mediaplane
container has no route out, so the host helper, which runs on the host network, fetches
it: its request gets an optional `egress` URL, and its report an `egress` answer
(decision 3). The helper and the engine share one image, so the report format stays
`mediaplane.host-report/v1`. A failure is an answer (`{ ok: false, error }`), not an
exception: `vpn-check` only warns when the host can't ask (D9).
Decision: the answer is read from an `ip=` line, as Cloudflare's trace gives it, or from
an answer that is only an address, as plain-text services give it; `node:net`'s `isIP`
decides what is an address. Only the first 16 KiB of the answer is parsed, and the fetch
never follows a redirect and gives up after 10 seconds.

**Files:**
- Create: `packages/engine/src/vpn/egress.ts`, `packages/engine/src/vpn/egress.test.ts`
- Modify: `packages/engine/src/host/report.ts`, `packages/engine/src/host/helper.ts`,
  `packages/engine/src/index.ts`
- Test: `packages/engine/src/host/report.test.ts`, `packages/engine/src/host/helper.test.ts`

**Interfaces:**
- **Consumes:** `runHelper`, `parseHostReport` and `HelperOptions` in `host/helper.ts`;
  `collectHostReport` in `host/report.ts`.
- **Produces:**
  - `DEFAULT_VPN_CHECK_URL = 'https://1.1.1.1/cdn-cgi/trace'`, `EGRESS_TIMEOUT_MS = 10_000`;
  - `type EgressResult = { ok: true; address: string } | { ok: false; error: string }`;
  - `egressAddress(answer: string): string | undefined`;
  - `isEgressUrl(url: string): boolean` (http and https only);
  - `fetchEgress(url: string, fetchFn?: typeof fetch, timeoutMs?: number): Promise<EgressResult>`;
  - `HostRequest.egress?: string` and `HostReport.egress?: EgressResult`;
    `collectHostReport(request, probe?, facts?, egress?: (url: string) => Promise<EgressResult>)`;
  - `helperEgress(options: HelperOptions, url: string): Promise<EgressResult>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/src/vpn/egress.test.ts`:

```ts
import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { egressAddress, fetchEgress, isEgressUrl } from './egress';

/** A local web server answering every request with `status` and `body`. */
async function answering(
  status: number,
  body: string,
): Promise<{ url: string; server: Server }> {
  const server = createServer((_request, response) => {
    response.writeHead(status, { 'content-type': 'text/plain' });
    response.end(body);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { url: `http://127.0.0.1:${String(port)}/cdn-cgi/trace`, server };
}

function close(server: Server): Promise<void> {
  return new Promise((done) => {
    server.close(() => {
      done();
    });
  });
}

describe('egressAddress', () => {
  it("reads the ip= line of Cloudflare's trace", () => {
    expect(egressAddress('fl=1f1\nh=1.1.1.1\nip=203.0.113.7\nts=1.2\n')).toBe(
      '203.0.113.7',
    );
    expect(egressAddress('ip=2001:db8::7\n')).toBe('2001:db8::7');
  });

  it('reads an answer that is only the address', () => {
    expect(egressAddress('198.51.100.2\n')).toBe('198.51.100.2');
  });

  it('finds nothing in an answer without a valid address', () => {
    for (const answer of ['', 'ip=\n', 'ip=203.0.113.999\n', '<html>blocked</html>']) {
      expect(egressAddress(answer), answer).toBeUndefined();
    }
  });
});

describe('isEgressUrl', () => {
  it('takes http and https URLs only', () => {
    expect(isEgressUrl('https://1.1.1.1/cdn-cgi/trace')).toBe(true);
    expect(isEgressUrl('http://192.0.2.10/cgi-bin/ip')).toBe(true);
    for (const url of ['', 'not a url', 'file:///etc/passwd', 'ftp://192.0.2.10/']) {
      expect(isEgressUrl(url), url).toBe(false);
    }
  });
});

describe('fetchEgress', () => {
  it('asks the service, and reads the address it saw', async () => {
    const { url, server } = await answering(200, 'h=x\nip=127.0.0.1\n');
    try {
      expect(await fetchEgress(url)).toEqual({ ok: true, address: '127.0.0.1' });
    } finally {
      await close(server);
    }
  });

  it('reports an HTTP error, or an answer without an address', async () => {
    const refused = await answering(503, 'ip=127.0.0.1\n');
    const empty = await answering(200, 'nothing here\n');
    try {
      expect(await fetchEgress(refused.url)).toEqual({
        ok: false,
        error: `${refused.url} answered HTTP 503`,
      });
      expect(await fetchEgress(empty.url)).toEqual({
        ok: false,
        error: `${empty.url} answered without an address`,
      });
    } finally {
      await close(refused.server);
      await close(empty.server);
    }
  });

  it('reports no answer, with the network error or how long it waited', async () => {
    const url = 'http://192.0.2.10/';
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('connect ECONNREFUSED 192.0.2.10:80'),
    });
    expect(await fetchEgress(url, () => Promise.reject(refused))).toEqual({
      ok: false,
      error: `no answer from ${url}: connect ECONNREFUSED 192.0.2.10:80`,
    });
    const timeout = new DOMException('The operation was aborted', 'TimeoutError');
    expect(await fetchEgress(url, () => Promise.reject(timeout), 10_000)).toEqual({
      ok: false,
      error: `no answer from ${url}: nothing within 10 s`,
    });
    const other = new Error('fake: refused');
    expect(await fetchEgress(url, () => Promise.reject(other))).toEqual({
      ok: false,
      error: `no answer from ${url}: fake: refused`,
    });
  });
});
```

The local server listens on `127.0.0.1:0`: no network beyond this machine, and no Docker.

In `packages/engine/src/host/report.test.ts`:

- add before `describe('parseHostRequest', …)`:

  ```ts
  describe('collectHostReport, asked for the egress address', () => {
    it('asks the IP-echo service only when the request names one', async () => {
      const asked: string[] = [];
      const egress = (url: string) => {
        asked.push(url);
        return Promise.resolve({ ok: true as const, address: '198.51.100.2' });
      };
      const none = { facts: false, stat: [], free: [], ports: [] };
      const url = 'https://1.1.1.1/cdn-cgi/trace';
      const report = await collectHostReport(
        { ...none, egress: url },
        fakeProbe(),
        () => FIXTURE_HOST,
        egress,
      );
      expect(report.egress).toEqual({ ok: true, address: '198.51.100.2' });
      const without = await collectHostReport(
        none,
        fakeProbe(),
        () => FIXTURE_HOST,
        egress,
      );
      expect(without).not.toHaveProperty('egress');
      expect(asked).toEqual([url]);
    });
  });

  ```

- add to `describe('parseHostRequest', …)`, after "reads back what the engine sends":

  ```ts
    it('reads back an egress URL, and refuses one that is not http or https', () => {
      const asking = { ...REQUEST, egress: 'https://1.1.1.1/cdn-cgi/trace' };
      expect(parseHostRequest(JSON.stringify(asking))).toEqual(asking);
      expect(() =>
        parseHostRequest(JSON.stringify({ ...REQUEST, egress: 'file:///etc/shadow' })),
      ).toThrow('egress: must be an http or https URL');
    });
  ```

- add to `describe('parseHostReport', …)`, before "refuses a report from another
  version, or none at all":

  ```ts
    it('reads the egress answer', () => {
      const report = {
        schema: HOST_REPORT_SCHEMA,
        stat: {},
        free: {},
        ports: {},
        egress: { ok: false, error: 'no answer from https://1.1.1.1/cdn-cgi/trace' },
      };
      expect(parseHostReport(JSON.stringify(report))).toEqual(report);
    });
  ```

In `packages/engine/src/host/helper.test.ts`:

- change the import from `./helper` to
  `import { helperEgress, helperHostFacts, helperMountSources, helperProbe } from './helper';`;
- add before `describe('helperProbe', …)`:

  ```ts
  describe('helperEgress', () => {
    const TRACE = 'https://1.1.1.1/cdn-cgi/trace';

    it('asks the helper, on the host network, which address the host comes from', async () => {
      const seen: HostRequest[] = [];
      const runtime = fakeRuntime({
        hostHelper: async (request) => {
          seen.push(request);
          const report = await collectHostReport(
            request,
            fakeProbe(),
            () => FIXTURE_HOST,
            () => Promise.resolve({ ok: true, address: '198.51.100.2' }),
          );
          return { ok: true, stdout: JSON.stringify(report) };
        },
      });
      expect(await helperEgress({ runtime, image: IMAGE, user: USER }, TRACE)).toEqual({
        ok: true,
        address: '198.51.100.2',
      });
      expect(seen).toEqual([
        { facts: false, stat: [], free: [], ports: [], egress: TRACE },
      ]);
    });

    it('turns every failure into a failed answer, never an error', async () => {
      const failed = await helperEgress(
        { runtime: fakeRuntime(), image: IMAGE, user: USER },
        TRACE,
      );
      expect(failed).toEqual({
        ok: false,
        error: 'the host helper failed: this fake Docker has no host helper',
      });
      const silent = fakeRuntime({
        hostHelper: () => ({
          ok: true,
          stdout: JSON.stringify({
            schema: HOST_REPORT_SCHEMA,
            stat: {},
            free: {},
            ports: {},
          }),
        }),
      });
      expect(
        await helperEgress({ runtime: silent, image: IMAGE, user: USER }, TRACE),
      ).toEqual({
        ok: false,
        error: 'the host helper reported no address',
      });
      const refused = await helperEgress(
        { runtime: fakeRuntime(), image: '--privileged', user: USER },
        TRACE,
      );
      expect(refused).toEqual({
        ok: false,
        error:
          'the host helper image "--privileged" is not an image name: it must not start with "-"',
      });
    });
  });

  ```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/vpn packages/engine/src/host`

Expected: FAIL. `egress.test.ts` can't import `./egress`, `helperEgress` is not exported,
`collectHostReport` ignores `egress`, and `parseHostRequest` refuses it as an unknown
key.

- [ ] **Step 3: Implement**

Create `packages/engine/src/vpn/egress.ts`:

```ts
import { isIP } from 'node:net';

/**
 * Where vpn-check asks "which address do I come from?" by default: Cloudflare's trace, by
 * IP, so no DNS is needed. Cloudflare is already Gluetun's own DNS-over-TLS resolver.
 */
export const DEFAULT_VPN_CHECK_URL = 'https://1.1.1.1/cdn-cgi/trace';

/** How long each side of the egress check waits for an answer, in ms. */
export const EGRESS_TIMEOUT_MS = 10_000;

/** The most of an answer Mediaplane reads: a trace is a few hundred bytes. */
const MAX_ANSWER = 16_384;

/** The address an IP-echo service saw, or why there is none. */
export type EgressResult = { ok: true; address: string } | { ok: false; error: string };

/**
 * The caller's address in an IP-echo service's answer: an `ip=` line, as Cloudflare's
 * /cdn-cgi/trace gives it, or an answer that is only an address, as plain-text services
 * give it. Undefined when there is no valid IPv4 or IPv6 address.
 */
export function egressAddress(answer: string): string | undefined {
  const text = answer.slice(0, MAX_ANSWER);
  const candidate = (/^ip=(.*)$/m.exec(text)?.[1] ?? text).trim();
  return isIP(candidate) === 0 ? undefined : candidate;
}

/** Whether `url` can be an egress check's: an http or https URL. */
export function isEgressUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Ask the IP-echo service at `url` which address this machine comes from. */
export async function fetchEgress(
  url: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = EGRESS_TIMEOUT_MS,
): Promise<EgressResult> {
  let answer: string;
  try {
    const response = await fetchFn(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, error: `${url} answered HTTP ${String(response.status)}` };
    }
    answer = await response.text();
  } catch (cause) {
    return { ok: false, error: `no answer from ${url}: ${reason(cause, timeoutMs)}` };
  }
  const address = egressAddress(answer);
  return address === undefined
    ? { ok: false, error: `${url} answered without an address` }
    : { ok: true, address };
}

/** Why a fetch failed, in words: undici keeps the network error in `cause`. */
function reason(cause: unknown, timeoutMs: number): string {
  if (cause instanceof Error && cause.name === 'TimeoutError') {
    return `nothing within ${String(timeoutMs / 1000)} s`;
  }
  const inner = cause instanceof Error ? cause.cause : undefined;
  if (inner instanceof Error) return inner.message;
  return cause instanceof Error ? cause.message : String(cause);
}
```

In `packages/engine/src/host/report.ts`:

- add `import { fetchEgress, isEgressUrl, type EgressResult } from '../vpn/egress';` after
  the `HelperError` import;
- add to `hostRequestSchema`, after `ports`:

  ```ts
    /** An IP-echo service to ask which address the host comes from (vpn-check). */
    egress: z.string().refine(isEgressUrl, 'must be an http or https URL').optional(),
  ```

- add to `hostReportSchema`, after `ports`:

  ```ts
    egress: z
      .union([
        z.strictObject({ ok: z.literal(true), address: z.string() }),
        z.strictObject({ ok: z.literal(false), error: z.string() }),
      ])
      .optional(),
  ```

- add a fourth parameter to `collectHostReport`, after `facts`:

  ```ts
    egress: (url: string) => Promise<EgressResult> = fetchEgress,
  ```

  and a last entry to the object it returns, after `ports,`:

  ```ts
      ...(request.egress === undefined ? {} : { egress: await egress(request.egress) }),
  ```

In `packages/engine/src/host/helper.ts`:

- add `import type { EgressResult } from '../vpn/egress';` after the
  `import { compare, unique } from '../util/sort';` line;
- add after `helperHostFacts`:

  ```ts
  /**
   * Which address the host comes from, as the IP-echo service at `url` sees it, asked by the
   * host helper on the host network: this container has no route out (spec §4.2). A helper
   * that fails is a failed answer, not an error, because vpn-check then only warns.
   */
  export async function helperEgress(
    options: HelperOptions,
    url: string,
  ): Promise<EgressResult> {
    try {
      const result = await runHelper(
        options,
        { facts: false, stat: [], free: [], ports: [], egress: url },
        [],
      );
      if (!result.ok)
        return { ok: false, error: `the host helper failed: ${result.error}` };
      return (
        parseHostReport(result.stdout).egress ?? {
          ok: false,
          error: 'the host helper reported no address',
        }
      );
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  ```

In `packages/engine/src/index.ts`, add `export * from './vpn/egress';` at the end.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/vpn packages/engine/src/host packages/cli`

Expected: PASS. The CLI's `host-report` tests still pass: a request without `egress` is
read as before.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/vpn packages/engine/src/host packages/engine/src/index.ts
git commit -m "feat(engine): ask an IP-echo service for the host's address, through the host helper in the image" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: The probe inside qBittorrent's network

What runs on the VPN's side (decision 1): a POSIX shell script for `sh -c`, run by
`runtime.run('qbittorrent', probeCommand(…))`. Inside Gluetun's namespace it:

- looks up the route to `1.1.1.1` (`ip route get`: no traffic, only the routing table);
- asks Gluetun's control server for `/v1/vpn/status` without the key (Gluetun not
  restarted since S3a answers it: the roadmap's last S3d input);
- asks `/v1/vpn/status` and `/v1/publicip/ip` with the key;
- with a URL, asks the IP-echo service which address it comes from.

Decision: the key comes in on stdin, and goes to curl as a header file on stdin
(`printf … | curl -H @-`), so it is never an argument (decision 2). `printf` is a
builtin of the image's busybox `sh` (checked): no process ever carries the key in its
arguments. The URL and the port are
positional arguments (`"$1"`, `"$2"`), never pasted into the script, so a URL can't
inject shell.
Decision: one line per check, `<name> <exit status> <output in base64>`, so a multi-line
body or a curl error can't break the parse, and Compose's progress lines are ignored
(decision 6). The tools are all in the pinned qBittorrent image (`/sbin/ip` and
`/bin/base64` are busybox, curl is 8.22), checked as uid 65534 on the dev box.

**Files:**
- Create: `packages/engine/src/vpn/probe.ts`, `packages/engine/src/vpn/probe.test.ts`
- Modify: `packages/engine/src/testing/fakes.ts`, `packages/engine/src/index.ts`

**Interfaces:**
- **Consumes:** `OneOffCommand` (Task 3), `EGRESS_TIMEOUT_MS` (Task 4), `nodeExec`.
- **Produces:**
  - `ROUTE_TARGET = '1.1.1.1'`, `PROBE_USER = { uid: 65534, gid: 65534 }`,
    `PROBE_SCRIPT: string`;
  - `type ProbeCheck = 'route' | 'anonymous' | 'status' | 'publicip' | 'egress'`,
    `interface ProbeLine { exit: number; output: string }`,
    `type ProbeOutput = Partial<Record<ProbeCheck, ProbeLine>>`;
  - `probeCommand(key: string, controlPort: number, url: string | undefined): OneOffCommand`
    (args `['-c', PROBE_SCRIPT, 'vpn-check', <port>, <url or "">]`, input `<key>\n`,
    values `{ controlApiKey: key }`);
  - `parseProbe(stdout: string): ProbeOutput`;
  - `routeDevice(line: ProbeLine | undefined): string | undefined`;
  - `httpAnswer(line: ProbeLine | undefined): { status: number; body: string }`;
  - in the fakes: `type ProbeAnswers = Partial<Record<ProbeCheck, readonly [number, string]>>`
    and `probeOutput(answers: ProbeAnswers): string`, what the script prints for them.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/src/vpn/probe.test.ts`:

```ts
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeExec } from '../runtime/exec';
import { tempDir } from '../testing/temp';
import {
  httpAnswer,
  parseProbe,
  PROBE_SCRIPT,
  PROBE_USER,
  probeCommand,
  routeDevice,
} from './probe';

const KEY = 'fake-key-0123';
const line = (name: string, exit: number, output: string) =>
  `${name} ${String(exit)} ${Buffer.from(output).toString('base64')}`;

/**
 * Stand-ins for the image's `ip` and `curl`: curl logs its arguments, and answers as
 * Gluetun's control server (echoing the header it read from stdin) or the echo would.
 */
async function stubs(dir: string): Promise<void> {
  const ip = join(dir, 'ip');
  await writeFile(ip, '#!/bin/sh\necho "1.1.1.1 dev tun0  src 10.66.0.2 "\n');
  const curl = join(dir, 'curl');
  await writeFile(
    curl,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$CURL_LOG"',
      'case "$*" in',
      '  *"-H @-"*) read -r header; printf "{\\"header\\":\\"%s\\"}\\n200" "$header" ;;',
      '  *"-o /dev/null"*) printf 401 ;;',
      '  *) echo "ip=203.0.113.7" ;;',
      'esac',
      '',
    ].join('\n'),
  );
  await chmod(ip, 0o755);
  await chmod(curl, 0o755);
}

describe('PROBE_SCRIPT', () => {
  it('reports each check on a line of its own, with the key only ever on stdin', async () => {
    const dir = await tempDir('mediaplane-probe-');
    await stubs(dir);
    const log = join(dir, 'curl.log');
    const command = probeCommand(KEY, 8000, 'http://192.0.2.10/cgi-bin/ip');
    const result = await nodeExec('sh', command.args, {
      input: command.input,
      env: { PATH: `${dir}:${process.env.PATH ?? ''}`, CURL_LOG: log },
    });
    expect(result.code, result.stderr).toBe(0);
    const probe = parseProbe(result.stdout);
    expect(routeDevice(probe.route)).toBe('tun0');
    expect(httpAnswer(probe.anonymous)).toEqual({ status: 401, body: '' });
    expect(httpAnswer(probe.status)).toEqual({
      status: 200,
      body: `{"header":"X-API-Key: ${KEY}"}`,
    });
    expect(probe.publicip?.exit).toBe(0);
    expect(probe.egress).toEqual({ exit: 0, output: 'ip=203.0.113.7' });
    const calls = await readFile(log, 'utf8');
    expect(calls).toContain('http://127.0.0.1:8000/v1/vpn/status');
    expect(calls).toContain('http://127.0.0.1:8000/v1/publicip/ip');
    expect(calls).toContain('--max-time 10 http://192.0.2.10/cgi-bin/ip');
    expect(calls).not.toContain(KEY);
  });

  it('asks no egress question without a URL', async () => {
    const dir = await tempDir('mediaplane-probe-');
    await stubs(dir);
    const command = probeCommand(KEY, 8000, undefined);
    const result = await nodeExec('sh', command.args, {
      input: command.input,
      env: { PATH: `${dir}:${process.env.PATH ?? ''}`, CURL_LOG: join(dir, 'log') },
    });
    expect(Object.keys(parseProbe(result.stdout))).toEqual([
      'route',
      'anonymous',
      'status',
      'publicip',
    ]);
  });
});

describe('probeCommand', () => {
  it('runs the script as nobody, with the key on stdin and hidden in what it prints', () => {
    expect(probeCommand(KEY, 8000, undefined)).toEqual({
      user: PROBE_USER,
      entrypoint: 'sh',
      args: ['-c', PROBE_SCRIPT, 'vpn-check', '8000', ''],
      input: `${KEY}\n`,
      values: { controlApiKey: KEY },
    });
    expect(PROBE_USER).toEqual({ uid: 65534, gid: 65534 });
  });
});

describe('parseProbe', () => {
  it('reads each check, and ignores what else Compose or the shell printed', () => {
    const stdout = [
      'Container x Creating',
      line('route', 2, 'RTNETLINK answers: Network is unreachable'),
      line('anonymous', 7, '000'),
      `${line('egress', 28, 'curl: (28) Connection timed out')}  `,
      'egress 0 not!base64',
    ].join('\n');
    expect(parseProbe(stdout)).toEqual({
      route: { exit: 2, output: 'RTNETLINK answers: Network is unreachable' },
      anonymous: { exit: 7, output: '000' },
      egress: { exit: 28, output: 'curl: (28) Connection timed out' },
    });
  });
});

describe('routeDevice', () => {
  it('reads the device, or nothing when there is no route', () => {
    expect(
      routeDevice({ exit: 0, output: '1.1.1.1 via 172.20.0.1 dev eth0 src x' }),
    ).toBe('eth0');
    expect(routeDevice({ exit: 2, output: 'Network is unreachable' })).toBeUndefined();
    expect(routeDevice(undefined)).toBeUndefined();
  });
});

describe('httpAnswer', () => {
  it('splits the body from the status on the last line', () => {
    expect(httpAnswer({ exit: 0, output: '{"status":"running"}\n200' })).toEqual({
      status: 200,
      body: '{"status":"running"}',
    });
    expect(httpAnswer({ exit: 7, output: '\n000' })).toEqual({ status: 0, body: '' });
    expect(httpAnswer({ exit: 0, output: 'garbled' })).toEqual({ status: 0, body: '' });
    expect(httpAnswer(undefined)).toEqual({ status: 0, body: '' });
  });
});
```

The script test runs the real script with the host's `sh` (dash on Ubuntu; busybox `ash`
in the image, both POSIX) and the host's `base64` and `tr`. Only `ip` and `curl` are
stand-ins. Task 8 runs it for real, in the image.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/vpn/probe.test.ts`

Expected: FAIL: the test can't import `./probe`.

- [ ] **Step 3: Implement**

Create `packages/engine/src/vpn/probe.ts`:

```ts
import type { OneOffCommand } from '../runtime/types';
import { EGRESS_TIMEOUT_MS } from './egress';

/** A public address to ask the namespace's route to. Only the route is read: no traffic. */
export const ROUTE_TARGET = '1.1.1.1';

/** The probe runs as nobody: it reads, and writes nothing. */
export const PROBE_USER = { uid: 65534, gid: 65534 } as const;

/**
 * What vpn-check runs inside qBittorrent's network namespace, with `sh` from qBittorrent's
 * own image (busybox `ip` and `base64`, and curl). Its arguments are Gluetun's control
 * port and the egress URL ("" for none); Mediaplane's key to the control server comes on
 * stdin and goes to curl as a header file on stdin, so it is never on a command line.
 * Each check prints one line: its name, its exit status, and its output in base64.
 */
export const PROBE_SCRIPT = [
  'IFS= read -r key || true',
  'base="http://127.0.0.1:$1"',
  'url=$2',
  'anonymous() {',
  `  curl -s -o /dev/null --max-time 5 -w '%{http_code}' "$base/v1/vpn/status"`,
  '}',
  'withkey() {',
  `  printf 'X-API-Key: %s\\n' "$key" |`,
  `    curl -s --max-time 5 -H @- -w '\\n%{http_code}' "$base$1"`,
  '}',
  'report() {',
  '  name=$1',
  '  shift',
  '  out=$("$@" 2>&1)',
  '  code=$?',
  `  printf '%s %s %s\\n' "$name" "$code" "$(printf '%s' "$out" | base64 | tr -d '\\n')"`,
  '}',
  `report route ip route get ${ROUTE_TARGET}`,
  'report anonymous anonymous',
  'report status withkey /v1/vpn/status',
  'report publicip withkey /v1/publicip/ip',
  `[ -z "$url" ] || report egress curl -sS --max-time ${String(EGRESS_TIMEOUT_MS / 1000)} "$url"`,
  '',
].join('\n');

/** The probe's checks, in the order it runs them. */
export type ProbeCheck = 'route' | 'anonymous' | 'status' | 'publicip' | 'egress';

/** One check's exit status, and what it printed. */
export interface ProbeLine {
  exit: number;
  output: string;
}

export type ProbeOutput = Partial<Record<ProbeCheck, ProbeLine>>;

/** The one-off command for `runtime.run`: the probe, given the key and what to ask. */
export function probeCommand(
  key: string,
  controlPort: number,
  url: string | undefined,
): OneOffCommand {
  return {
    user: PROBE_USER,
    entrypoint: 'sh',
    args: ['-c', PROBE_SCRIPT, 'vpn-check', String(controlPort), url ?? ''],
    input: `${key}\n`,
    values: { controlApiKey: key },
  };
}

const LINE = /^(route|anonymous|status|publicip|egress) (\d+) ([A-Za-z0-9+/=]*)$/;

/** The probe's lines, by check. Anything else it printed is ignored. */
export function parseProbe(stdout: string): ProbeOutput {
  const found: ProbeOutput = {};
  for (const line of stdout.split('\n')) {
    const match = LINE.exec(line.trim());
    if (match?.[1] === undefined) continue;
    found[match[1] as ProbeCheck] = {
      exit: Number(match[2]),
      output: Buffer.from(match[3] ?? '', 'base64').toString('utf8'),
    };
  }
  return found;
}

/** The device a route goes through: "tun0" in `1.1.1.1 dev tun0 src 10.66.0.2`. */
export function routeDevice(line: ProbeLine | undefined): string | undefined {
  if (line === undefined || line.exit !== 0) return undefined;
  return /\bdev (\S+)/.exec(line.output)?.[1];
}

/**
 * An HTTP answer the probe's curl printed: the body, then the status code on the last
 * line. Status 0 means no answer at all.
 */
export function httpAnswer(line: ProbeLine | undefined): {
  status: number;
  body: string;
} {
  if (line === undefined) return { status: 0, body: '' };
  const lines = line.output.split('\n');
  const status = Number(lines.pop());
  return { status: Number.isInteger(status) ? status : 0, body: lines.join('\n') };
}
```

In `packages/engine/src/testing/fakes.ts`, add
`import type { ProbeCheck } from '../vpn/probe';` after the `ExecResult` import, and at
the end of the file:

```ts

/** vpn-check's probe answers: each check's exit status, and what it printed. */
export type ProbeAnswers = Partial<Record<ProbeCheck, readonly [number, string]>>;

/** What the probe script prints for `answers`, after a line of Compose's own. */
export function probeOutput(answers: ProbeAnswers): string {
  const lines = Object.entries(answers).map(
    ([name, [exit, output]]) =>
      `${name} ${String(exit)} ${Buffer.from(output).toString('base64')}`,
  );
  return ['Container mediaplane-qbittorrent-run-0 Creating', ...lines, ''].join('\n');
}
```

In `packages/engine/src/index.ts`, add `export * from './vpn/probe';` after
`export * from './vpn/egress';`.

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/vpn`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/vpn packages/engine/src/testing/fakes.ts packages/engine/src/index.ts
git commit -m "feat(engine): vpn-check's probe, run inside qBittorrent's network" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: `vpnCheck()`: the checks and the verdict

`vpnCheck()` is the engine side of `mediaplane vpn-check` (spec §5.2, §7.2(6); ruling
D9). It loads the stack, finds qBittorrent and Gluetun, looks at their containers, runs
the probe (Task 5) and, unless `--no-egress`, asks the host's own address (Task 4). It
writes nothing, and never prints the key.

The checks, in order, each `ok`, `warning`, `down` or `leak` (decision 7):

- `network`: qBittorrent's network mode is `container:<the running Gluetun's id>`, and
  qBittorrent started after Gluetun's current run. Decision: a qBittorrent that started
  first holds the network an earlier Gluetun had, which is gone, so it is `down`
  (decision 5). A network of its own is a `leak`; a Gluetun that has gone is `down`.
- `gluetun`: running and healthy. Not running is `down`, and nothing is probed:
  qBittorrent has only loopback. Running but not healthy is `down`, and the probe still
  runs.
- `control`: Gluetun's control server says the VPN is `running`. Another status is
  `down`; a refused key, no answer or another HTTP status is a `warning`.
- `control-key`: the control server refuses requests without the key. Decision: an
  answer without the key is a `warning` that Gluetun hasn't read its key file since
  Mediaplane wrote it (the roadmap's last S3d input), with the fix: restart Gluetun,
  then qBittorrent. No answer at all leaves this check out (`control` already warns).
- `route`: the route out goes into the tunnel (`tun0`, or `VPN_INTERFACE` from
  `apps.gluetun.env`: decision 11). Anything else is `down`.
- `egress` (unless `--no-egress`): no answer through the tunnel is `down`, and the host
  isn't asked (decision 9); an answer without an address is a `warning`; a host that
  can't ask is a `warning` (D9: "passes on structure"); the same address on both sides
  is a `leak`; different addresses are `ok`.

Decision: `apps.qbittorrent.vpn: false` is a `leak` verdict, found without asking Docker,
and a stack with no qBittorrent is an error (decision 8). The other errors (`ok: false`,
with diagnostics) are: a bad `stack.yaml`, the host facts, the resolver's errors, an
egress URL that is not http or https (`vpn-check.bad-url`), no stored control key
(`vpn-check.no-key`), no qBittorrent container (`vpn-check.not-applied`), a probe that
printed nothing it could read (`vpn-check.probe-failed`), and Docker unreachable
(`docker.unavailable`, with the socket-proxy hint in the image).
Decision: Gluetun's own public address is reported as `gluetunPublicIp`, never compared
(decision 10).

**Files:**
- Create: `packages/engine/src/vpn/check.ts`, `packages/engine/src/vpn/check.test.ts`
- Modify: `packages/engine/src/index.ts`

**Interfaces:**
- **Consumes:** `loadConfigFile`, `hostFactsOrFailure`, `dockerUnavailable`,
  `resolveStack`, `readSecretStore`; `Runtime.containers`, `inspect` and `run` (Task 3);
  `egressAddress`, `isEgressUrl` and `EgressResult` (Task 4); `probeCommand`,
  `parseProbe`, `routeDevice` and `httpAnswer` (Task 5). In the tests, `fakeRuntime`'s
  `run` and `details` (Task 3), and `probeOutput` and `ProbeAnswers` (Task 5).
- **Produces:**
  - `VPN_RUNBOOK = 'docs/runbooks/vpn-down.md'`;
  - `interface VpnCheckOptions { home: string; catalog: Catalog; host: HostFacts | (() => Promise<HostFacts>); env: NodeJS.ProcessEnv; runtime: Runtime; egress?: { url: string; fromHost: (url: string) => Promise<EgressResult> } }`;
  - `type VpnVerdict = 'pass' | 'leak' | 'down'`;
  - `interface VpnCheckItem { id: 'network' | 'gluetun' | 'control' | 'control-key' | 'route' | 'egress'; status: 'ok' | 'warning' | 'down' | 'leak'; message: string; hint?: string }`;
  - `interface VpnEgress { url: string; vpn: string | null; host: string | null }`;
  - `type VpnCheckResult = { ok: true; verdict: VpnVerdict; checks: VpnCheckItem[]; egress: VpnEgress | null; gluetunPublicIp: string | null } | { ok: false; diagnostics: Diagnostic[] }`;
  - `vpnCheck(options: VpnCheckOptions): Promise<VpnCheckResult>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine/src/vpn/check.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECRETS_PATH } from '../paths';
import type { ExecResult } from '../runtime/exec';
import {
  RuntimeError,
  type ContainerState,
  type OneOffCommand,
  type Runtime,
} from '../runtime/types';
import {
  fakeRuntime,
  probeOutput,
  type FakeRuntimeOptions,
  type ProbeAnswers as Answers,
} from '../testing/fakes';
import { FIXTURE_HOST, fixtureCatalog } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { vpnCheck, type VpnCheckOptions } from './check';
import type { EgressResult } from './egress';

const KEY = '0'.repeat(32);
const TRACE = 'https://1.1.1.1/cdn-cgi/trace';
const GLUETUN_ID = 'a'.repeat(64);
const QBITTORRENT_ID = 'b'.repeat(64);

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: custom, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
`;

async function homeWith({ stack = STACK, key = true } = {}): Promise<string> {
  const home = await tempDir('mediaplane-vpn-check-');
  await writeFile(join(home, 'stack.yaml'), stack);
  await mkdir(join(home, 'state'));
  const apps = key ? { gluetun: { controlApiKey: KEY } } : {};
  await writeFile(join(home, SECRETS_PATH), JSON.stringify({ version: 1, apps }));
  return home;
}

function container(service: string, id: string, extra: Partial<ContainerState> = {}) {
  return {
    service,
    id,
    state: 'running',
    health: 'healthy',
    configHash: undefined,
    published: [],
    ...extra,
  };
}

const UP: ContainerState[] = [
  container('gluetun', GLUETUN_ID),
  container('jellyfin', 'c'.repeat(64)),
  container('qbittorrent', QBITTORRENT_ID),
];

const HEALTHY: Answers = {
  route: [0, '1.1.1.1 dev tun0  src 10.66.0.2 '],
  anonymous: [0, '401'],
  status: [0, '{"status":"running"}\n200'],
  publicip: [0, '{"public_ip":""}\n200'],
  egress: [0, 'fl=1\nip=203.0.113.7\n'],
};

interface Setup {
  answers?: Answers;
  containers?: ContainerState[];
  details?: FakeRuntimeOptions['details'];
  host?: EgressResult;
  egress?: boolean;
  url?: string;
  runtime?: Partial<FakeRuntimeOptions>;
  /** Methods that replace the fake's own. */
  replace?: Partial<Runtime>;
}

/** vpnCheck against a fake Docker; the probe answers `answers` (or HEALTHY). */
async function checkWith(home: string, setup: Setup = {}) {
  const calls: string[] = [];
  const sent: OneOffCommand[] = [];
  const asked: string[] = [];
  const egressAsked = setup.egress ?? true;
  const answers = setup.answers ?? HEALTHY;
  const fake = fakeRuntime({
    calls,
    containers: setup.containers ?? UP,
    details: setup.details ?? {
      [QBITTORRENT_ID]: { networkMode: `container:${GLUETUN_ID}` },
    },
    run: (_service, command): ExecResult => {
      sent.push(command);
      // Like the script, the probe asks no egress question without a URL.
      const shown: Answers = { ...answers };
      if (command.args.at(-1) === '') delete shown.egress;
      return { code: 0, stdout: probeOutput(shown), stderr: '' };
    },
    ...setup.runtime,
  });
  const runtime: Runtime = { ...fake, ...setup.replace };
  const options: VpnCheckOptions = {
    home,
    catalog: fixtureCatalog,
    host: FIXTURE_HOST,
    env: {},
    runtime,
    ...(egressAsked
      ? {
          egress: {
            url: setup.url ?? TRACE,
            fromHost: (url) => {
              asked.push(url);
              return Promise.resolve(setup.host ?? { ok: true, address: '198.51.100.2' });
            },
          },
        }
      : {}),
  };
  return { result: await vpnCheck(options), calls, sent, asked };
}

const statuses = (result: Awaited<ReturnType<typeof vpnCheck>>) =>
  result.ok ? result.checks.map((c) => `${c.id} ${c.status}`) : [];

describe('vpnCheck', () => {
  it('passes when qBittorrent gets out only through the tunnel, from another address', async () => {
    const { result, calls, sent, asked } = await checkWith(await homeWith());
    expect(result).toMatchObject({
      ok: true,
      verdict: 'pass',
      egress: { url: TRACE, vpn: '203.0.113.7', host: '198.51.100.2' },
      gluetunPublicIp: null,
    });
    expect(statuses(result)).toEqual([
      'network ok',
      'gluetun ok',
      'control ok',
      'control-key ok',
      'route ok',
      'egress ok',
    ]);
    expect(calls).toEqual([
      'containers',
      `inspect ${QBITTORRENT_ID} ${GLUETUN_ID}`,
      'run qbittorrent sh as 65534:65534',
    ]);
    // The key goes in on stdin, and the probe asks the control port and the URL.
    expect(sent[0]?.input).toBe(`${KEY}\n`);
    expect(sent[0]?.args.slice(2)).toEqual(['vpn-check', '8000', TRACE]);
    expect(sent[0]?.args.join(' ')).not.toContain(KEY);
    expect(asked).toEqual([TRACE]);
  });

  it('checks the structure only with --no-egress, and asks no one for an address', async () => {
    const answers: Answers = {
      ...HEALTHY,
      publicip: [0, '{"public_ip":"203.0.113.7"}\n200'],
    };
    const { result, sent, asked } = await checkWith(await homeWith(), {
      egress: false,
      answers,
    });
    expect(result).toMatchObject({
      ok: true,
      verdict: 'pass',
      egress: null,
      gluetunPublicIp: '203.0.113.7',
    });
    expect(statuses(result)).not.toContain('egress ok');
    expect(sent[0]?.args.at(-1)).toBe('');
    expect(asked).toEqual([]);
  });

  it("finds a leak when qBittorrent leaves from the host's own address", async () => {
    const { result } = await checkWith(await homeWith(), {
      host: { ok: true, address: '203.0.113.7' },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'leak' });
    expect(result.ok && result.checks.at(-1)).toMatchObject({
      id: 'egress',
      status: 'leak',
      message:
        "qBittorrent's traffic leaves from 203.0.113.7, which is this host's own address: it does not go through the VPN",
      hint: 'see docs/runbooks/vpn-down.md',
    });
  });

  it('finds the VPN down when nothing answers through the tunnel, and asks the host nothing', async () => {
    const answers: Answers = {
      ...HEALTHY,
      egress: [28, 'curl: (28) Connection timed out after 10002 milliseconds'],
    };
    const { result, asked } = await checkWith(await homeWith(), { answers });
    expect(result).toMatchObject({
      ok: true,
      verdict: 'down',
      egress: { url: TRACE, vpn: null, host: null },
    });
    expect(result.ok && result.checks.at(-1)).toMatchObject({
      id: 'egress',
      status: 'down',
      message: `qBittorrent's traffic got no answer from ${TRACE}: curl: (28) Connection timed out after 10002 milliseconds`,
    });
    expect(asked).toEqual([]);
  });

  it('passes on the structure, with a warning, when the host gets no answer', async () => {
    const { result } = await checkWith(await homeWith(), {
      host: { ok: false, error: `no answer from ${TRACE}: nothing within 10 s` },
    });
    expect(result).toMatchObject({
      ok: true,
      verdict: 'pass',
      egress: { url: TRACE, vpn: '203.0.113.7', host: null },
    });
    expect(statuses(result).at(-1)).toBe('egress warning');
  });

  it('warns, without comparing, when the tunnel side answers without an address', async () => {
    const answers: Answers = { ...HEALTHY, egress: [0, '<html>blocked</html>'] };
    const { result, asked } = await checkWith(await homeWith(), { answers });
    expect(result).toMatchObject({ ok: true, verdict: 'pass' });
    expect(statuses(result).at(-1)).toBe('egress warning');
    expect(asked).toEqual([]);
  });

  it('finds a leak when qBittorrent has a network of its own', async () => {
    const { result } = await checkWith(await homeWith(), {
      details: { [QBITTORRENT_ID]: { networkMode: 'mediaplane_default' } },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'leak' });
    expect(statuses(result)[0]).toBe('network leak');
  });

  it('finds the VPN down when qBittorrent holds the network of an earlier Gluetun', async () => {
    // Gluetun restarted on its own, after qBittorrent: the probe would join Gluetun's new
    // network and pass, while qBittorrent itself has none.
    const { result } = await checkWith(await homeWith(), {
      details: {
        [QBITTORRENT_ID]: { networkMode: `container:${GLUETUN_ID}` },
        [GLUETUN_ID]: { startedAt: '2026-10-10T10:05:00Z' },
      },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'down' });
    expect(result.ok && result.checks[0]).toMatchObject({
      status: 'down',
      hint: 'restart qBittorrent: "docker restart mediaplane-qbittorrent-1"',
    });
  });

  it('finds the VPN down, without probing, when Gluetun is not running', async () => {
    const containers = [
      container('gluetun', GLUETUN_ID, { state: 'exited', health: '' }),
      container('qbittorrent', QBITTORRENT_ID),
    ];
    const { result, calls } = await checkWith(await homeWith(), { containers });
    expect(result).toMatchObject({
      ok: true,
      verdict: 'down',
      egress: { url: TRACE, vpn: null, host: null },
    });
    expect(statuses(result)).toEqual(['network ok', 'gluetun down']);
    expect(result.ok && result.checks[1]?.message).toBe(
      'Gluetun is exited, so qBittorrent has no network: nothing gets out',
    );
    expect(calls).not.toContain('run qbittorrent sh as 65534:65534');
  });

  it('finds the VPN down when Gluetun has no container, or one that has gone', async () => {
    const containers = [container('qbittorrent', QBITTORRENT_ID)];
    const { result } = await checkWith(await homeWith(), { containers });
    expect(statuses(result)).toEqual(['network down', 'gluetun down']);
    expect(result).toMatchObject({ ok: true, verdict: 'down' });
  });

  it('finds the VPN down when Gluetun is unhealthy, and still probes', async () => {
    const containers = [
      container('gluetun', GLUETUN_ID, { health: 'unhealthy' }),
      container('qbittorrent', QBITTORRENT_ID),
    ];
    const { result, calls } = await checkWith(await homeWith(), { containers });
    expect(result).toMatchObject({ ok: true, verdict: 'down' });
    expect(statuses(result)[1]).toBe('gluetun down');
    expect(calls).toContain('run qbittorrent sh as 65534:65534');
  });

  it('warns when the control server answers without the key: Gluetun has not been restarted', async () => {
    const answers: Answers = { ...HEALTHY, anonymous: [0, '200'] };
    const { result } = await checkWith(await homeWith(), { answers });
    expect(result).toMatchObject({ ok: true, verdict: 'pass' });
    expect(result.ok && result.checks.find((c) => c.id === 'control-key')).toMatchObject({
      status: 'warning',
      hint: expect.stringContaining('docker restart mediaplane-gluetun-1') as unknown,
    });
  });

  it('warns when the control server refuses the key or does not answer', async () => {
    for (const [status, message] of [
      ['\n401', "Gluetun's control server refused Mediaplane's key"],
      ['\n000', "Gluetun's control server did not answer"],
      ['oops\n500', "Gluetun's control server answered HTTP 500"],
    ]) {
      const answers: Answers = { ...HEALTHY, status: [0, status ?? ''] };
      const { result } = await checkWith(await homeWith(), { answers });
      expect(result).toMatchObject({ ok: true, verdict: 'pass' });
      expect(result.ok && result.checks.find((c) => c.id === 'control')).toMatchObject({
        status: 'warning',
        message,
      });
    }
  });

  it('finds the VPN down when the control server says it is stopped', async () => {
    const answers: Answers = { ...HEALTHY, status: [0, '{"status":"stopped"}\n200'] };
    const { result } = await checkWith(await homeWith(), { answers });
    expect(result).toMatchObject({ ok: true, verdict: 'down' });
    expect(statuses(result)).toContain('control down');
  });

  it('finds the VPN down when the route does not go into the tunnel', async () => {
    for (const route of [
      [0, '1.1.1.1 via 172.20.0.1 dev eth0  src 172.20.0.2'],
      [2, 'RTNETLINK answers: Network is unreachable'],
    ] as [number, string][]) {
      const { result } = await checkWith(await homeWith(), {
        answers: { ...HEALTHY, route },
      });
      expect(result).toMatchObject({ ok: true, verdict: 'down' });
      expect(statuses(result)).toContain('route down');
    }
  });

  it("takes Gluetun's tunnel from VPN_INTERFACE when apps.gluetun.env sets it", async () => {
    const stack = `${STACK}  gluetun: { env: { VPN_INTERFACE: wg0 } }\n`;
    const answers: Answers = { ...HEALTHY, route: [0, '1.1.1.1 dev wg0  src 10.66.0.2'] };
    const { result } = await checkWith(await homeWith({ stack }), { answers });
    expect(result).toMatchObject({ ok: true, verdict: 'pass' });
  });

  it('finds a leak, without asking Docker, when qBittorrent runs without the VPN', async () => {
    const stack = STACK.replace('qbittorrent: {}', 'qbittorrent: { vpn: false }');
    const { result, calls } = await checkWith(await homeWith({ stack }));
    expect(result).toMatchObject({ ok: true, verdict: 'leak', egress: null });
    expect(statuses(result)).toEqual(['network leak']);
    expect(calls).toEqual([]);
  });

  it('explains what it cannot check', async () => {
    const noQbittorrent = STACK.replace('apps:\n  qbittorrent: {}\n', 'apps: {}\n');
    const cases: [Promise<{ result: Awaited<ReturnType<typeof vpnCheck>> }>, string][] = [
      [checkWith(await tempDir('mediaplane-vpn-check-')), 'config.missing'],
      [checkWith(await homeWith({ stack: `${STACK}  sonar: {}\n` })), 'app.unknown'],
      [checkWith(await homeWith({ stack: noQbittorrent })), 'vpn-check.no-qbittorrent'],
      [checkWith(await homeWith(), { url: 'file:///etc/passwd' }), 'vpn-check.bad-url'],
      [checkWith(await homeWith({ key: false })), 'vpn-check.no-key'],
      [checkWith(await homeWith(), { containers: [] }), 'vpn-check.not-applied'],
      [
        checkWith(await homeWith(), {
          runtime: {
            run: () => ({
              code: 1,
              stdout: '',
              stderr: 'Error response from daemon: cannot join network namespace\n',
            }),
          },
        }),
        'vpn-check.probe-failed',
      ],
      [
        checkWith(await homeWith(), {
          replace: {
            containers: () => Promise.reject(new RuntimeError('fake: no Docker')),
          },
        }),
        'docker.unavailable',
      ],
    ];
    for (const [pending, code] of cases) {
      const { result } = await pending;
      expect(result.ok ? 'passed' : result.diagnostics.map((d) => d.code)).toEqual([
        code,
      ]);
    }
  });
});
```

The fixture catalog's Gluetun has the control port 8000, which is what the probe is
asked for. Every `checkWith` runs against a fake Docker; `calls` shows what was asked of
it, `sent` the probe's command, and `asked` what the host side was asked.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/vpn/check.test.ts`

Expected: FAIL: the test can't import `./check`.

- [ ] **Step 3: Implement**

Create `packages/engine/src/vpn/check.ts`:

```ts
import { join, resolve } from 'node:path';
import type { Catalog } from '../catalog/types';
import { loadConfigFile } from '../config/load';
import { error, withHint, type Diagnostic } from '../diagnostics';
import type { HostFacts } from '../host/facts';
import { dockerUnavailable, hostFactsOrFailure } from '../host/failure';
import { STACK_PATH } from '../paths';
import { resolveStack, type ResolvedApp } from '../resolver/resolve';
import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
import { readSecretStore } from '../secrets/store';
import { egressAddress, isEgressUrl, type EgressResult } from './egress';
import {
  httpAnswer,
  parseProbe,
  probeCommand,
  routeDevice,
  type ProbeOutput,
} from './probe';

/** Where a failed check sends you. */
export const VPN_RUNBOOK = 'docs/runbooks/vpn-down.md';

export interface VpnCheckOptions {
  home: string;
  catalog: Catalog;
  /** Facts about the host, or how to get them (the host helper, in the image). */
  host: HostFacts | (() => Promise<HostFacts>);
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  /**
   * Compare the addresses qBittorrent and this host come from, as the IP-echo service at
   * `url` sees them. `fromHost` asks it from the host. Leave it out to check the
   * structure only (`--no-egress`).
   */
  egress?: { url: string; fromHost: (url: string) => Promise<EgressResult> };
}

/** pass: qBittorrent gets out only through the tunnel. down: it can't get out at all. */
export type VpnVerdict = 'pass' | 'leak' | 'down';

/** What one check found. `down` and `leak` fail the check, and say how. */
export interface VpnCheckItem {
  id: 'network' | 'gluetun' | 'control' | 'control-key' | 'route' | 'egress';
  status: 'ok' | 'warning' | 'down' | 'leak';
  message: string;
  hint?: string;
}

/** The addresses the IP-echo service at `url` saw; null where there was none. */
export interface VpnEgress {
  url: string;
  vpn: string | null;
  host: string | null;
}

export type VpnCheckResult =
  | {
      ok: true;
      verdict: VpnVerdict;
      checks: VpnCheckItem[];
      /** The addresses compared; null with --no-egress. */
      egress: VpnEgress | null;
      /** The address Gluetun reports for itself, when its public-IP lookup is on. */
      gluetunPublicIp: string | null;
    }
  | { ok: false; diagnostics: Diagnostic[] };

/**
 * `mediaplane vpn-check` (spec §5.2, §7.2(6)): whether qBittorrent can reach the internet
 * only through Gluetun's tunnel. It looks at the containers, then runs a probe inside
 * qBittorrent's network namespace (a throwaway container of qBittorrent's image, through
 * the runtime), and with `egress` compares where qBittorrent's traffic and the host's
 * come from. It changes nothing.
 */
export async function vpnCheck(options: VpnCheckOptions): Promise<VpnCheckResult> {
  try {
    return await check(options);
  } catch (cause) {
    if (cause instanceof RuntimeError) {
      return { ok: false, diagnostics: [dockerUnavailable(cause, options.env)] };
    }
    throw cause;
  }
}

async function check(options: VpnCheckOptions): Promise<VpnCheckResult> {
  const { egress, runtime } = options;
  if (egress !== undefined && !isEgressUrl(egress.url)) {
    return failure(
      'vpn-check.bad-url',
      `the egress check's URL must be an http or https URL, not "${egress.url}"`,
      'set MEDIAPLANE_VPN_CHECK_URL to an IP-echo service such as https://1.1.1.1/cdn-cgi/trace, or unset it',
    );
  }
  const home = resolve(options.home);
  const loaded = await loadConfigFile(join(home, STACK_PATH));
  if (!loaded.ok) return { ok: false, diagnostics: loaded.diagnostics };
  const facts = await hostFactsOrFailure(options.host, options);
  if (!facts.ok) return { ok: false, diagnostics: [facts.diagnostic] };
  const resolved = resolveStack(loaded.config, options.catalog, facts.host, home);
  if (resolved.stack === undefined) {
    return {
      ok: false,
      diagnostics: resolved.diagnostics.filter((d) => d.severity === 'error'),
    };
  }
  const app = (id: string) => resolved.stack?.apps.find((a) => a.def.id === id);
  const qbittorrentApp = app('qbittorrent');
  const gluetunApp = app('gluetun');
  if (qbittorrentApp === undefined) {
    return failure(
      'vpn-check.no-qbittorrent',
      'this stack has no qBittorrent, so there is no VPN to check',
    );
  }
  if (qbittorrentApp.networkVia !== 'gluetun' || gluetunApp === undefined) {
    return verdictOf(
      [
        {
          id: 'network',
          status: 'leak',
          message:
            "qBittorrent runs without the VPN (apps.qbittorrent.vpn: false): peers see this host's own address",
          hint: 'add a vpn: block to stack.yaml, remove apps.qbittorrent.vpn: false, and run mediaplane apply',
        },
      ],
      null,
      null,
    );
  }
  const key = (await readSecretStore(home)).apps.gluetun?.controlApiKey;
  if (key === undefined) {
    return failure(
      'vpn-check.no-key',
      "Mediaplane has no key to Gluetun's control server yet",
      'run "mediaplane apply": it generates the key before Gluetun first starts',
    );
  }

  const containers = await runtime.containers();
  const qbittorrent = containers.find((c) => c.service === 'qbittorrent');
  const gluetun = containers.find((c) => c.service === 'gluetun');
  if (qbittorrent === undefined) {
    return failure(
      'vpn-check.not-applied',
      'qBittorrent has no container in this stack yet',
      'run "mediaplane apply" first',
    );
  }
  const checks: VpnCheckItem[] = [
    await networkCheck(runtime, qbittorrent, gluetun),
    gluetunCheck(gluetun),
  ];
  // A stopped Gluetun leaves qBittorrent with loopback only, and nothing to probe.
  if (gluetun === undefined || gluetun.state !== 'running') {
    const unmeasured =
      egress === undefined ? null : { url: egress.url, vpn: null, host: null };
    return verdictOf(checks, unmeasured, null);
  }

  const command = probeCommand(
    key,
    gluetunApp.containerPorts.control ?? 8000,
    egress?.url,
  );
  const result = await runtime.run('qbittorrent', command);
  const probe = parseProbe(result.stdout);
  if (Object.keys(probe).length === 0) {
    return failure(
      'vpn-check.probe-failed',
      `the probe in qBittorrent's network could not run: ${lastLine(result.stderr)}`,
      'check that the qBittorrent image is present ("docker image ls"), then run vpn-check again',
    );
  }
  checks.push(...controlChecks(probe), routeCheck(probe, tunnelInterface(gluetunApp)));
  const publicIp = gluetunPublicIp(probe);
  if (egress === undefined) return verdictOf(checks, null, publicIp);
  const compared = await egressCheck(probe, egress);
  checks.push(compared.item);
  return verdictOf(checks, compared.egress, publicIp);
}

async function networkCheck(
  runtime: Runtime,
  qbittorrent: ContainerState,
  gluetun: ContainerState | undefined,
): Promise<VpnCheckItem> {
  const ids = gluetun === undefined ? [qbittorrent.id] : [qbittorrent.id, gluetun.id];
  const [itself, joined] = await runtime.inspect(ids);
  const mode = itself?.networkMode ?? '';
  if (gluetun !== undefined && mode === `container:${gluetun.id}`) {
    // A container joins another's namespace when it starts. Gluetun started again on its
    // own, after qBittorrent, has a new one; qBittorrent keeps the old, which is gone.
    if (
      gluetun.state === 'running' &&
      Date.parse(itself?.startedAt ?? '') < Date.parse(joined?.startedAt ?? '')
    ) {
      return {
        id: 'network',
        status: 'down',
        message:
          'qBittorrent started before Gluetun last did, so it still holds the network Gluetun had then, which is gone: it has none',
        hint: 'restart qBittorrent: "docker restart mediaplane-qbittorrent-1"',
      };
    }
    return {
      id: 'network',
      status: 'ok',
      message: "qBittorrent uses Gluetun's network, and has none of its own",
    };
  }
  // A container: mode that names no running Gluetun: the one it joined has gone.
  if (mode.startsWith('container:')) {
    return {
      id: 'network',
      status: 'down',
      message:
        'qBittorrent uses the network of a Gluetun that no longer runs, so it has none',
      hint: 'run "mediaplane apply" to start Gluetun and qBittorrent again',
    };
  }
  return {
    id: 'network',
    status: 'leak',
    message: `qBittorrent has a network of its own ("${mode}"), not Gluetun's: its traffic does not go through the VPN`,
    hint: 'run "mediaplane apply" to recreate it behind Gluetun, and check compose.override.yaml for a network_mode of its own',
  };
}

function gluetunCheck(gluetun: ContainerState | undefined): VpnCheckItem {
  if (gluetun === undefined || gluetun.state !== 'running') {
    const state = gluetun === undefined ? 'has no container' : `is ${gluetun.state}`;
    return {
      id: 'gluetun',
      status: 'down',
      message: `Gluetun ${state}, so qBittorrent has no network: nothing gets out`,
      hint: `see ${VPN_RUNBOOK}`,
    };
  }
  if (gluetun.health !== 'healthy') {
    return {
      id: 'gluetun',
      status: 'down',
      message: `Gluetun is running, but ${gluetun.health === '' ? 'has no health status' : gluetun.health}: its health check needs a working tunnel`,
      hint: `see ${VPN_RUNBOOK}`,
    };
  }
  return { id: 'gluetun', status: 'ok', message: 'Gluetun is running and healthy' };
}

/** What Gluetun's control server says with Mediaplane's key, and without it. */
function controlChecks(probe: ProbeOutput): VpnCheckItem[] {
  const checks: VpnCheckItem[] = [];
  const status = httpAnswer(probe.status);
  const vpn = status.status === 200 ? jsonField(status.body, 'status') : undefined;
  if (vpn === 'running') {
    checks.push({
      id: 'control',
      status: 'ok',
      message: "Gluetun's control server says the VPN is running",
    });
  } else if (vpn !== undefined) {
    checks.push({
      id: 'control',
      status: 'down',
      message: `Gluetun's control server says the VPN is ${vpn}`,
      hint: `see ${VPN_RUNBOOK}`,
    });
  } else {
    checks.push({
      id: 'control',
      status: 'warning',
      message:
        status.status === 401 || status.status === 403
          ? "Gluetun's control server refused Mediaplane's key"
          : status.status === 0
            ? "Gluetun's control server did not answer"
            : `Gluetun's control server answered HTTP ${String(status.status)}`,
      hint:
        status.status === 401 || status.status === 403
          ? 'appdata/gluetun/auth/config.toml holds another key than state/secrets.json: see Gluetun\'s README, "Set up before Slice 3a"'
          : `see ${VPN_RUNBOOK}`,
    });
  }
  const anonymous = httpAnswer(probe.anonymous).status;
  if (anonymous === 401) {
    checks.push({
      id: 'control-key',
      status: 'ok',
      message: "Gluetun's control server refuses requests without Mediaplane's key",
    });
  } else if (anonymous >= 200 && anonymous < 300) {
    checks.push({
      id: 'control-key',
      status: 'warning',
      message:
        "Gluetun's control server answers anyone on the stack's network, without a key: Gluetun has not read its key file since Mediaplane wrote it",
      hint: 'restart Gluetun, then qBittorrent: "docker restart mediaplane-gluetun-1", then "docker restart mediaplane-qbittorrent-1" (Gluetun\'s README, "Set up before Slice 3a")',
    });
  }
  return checks;
}

function routeCheck(probe: ProbeOutput, tunnel: string): VpnCheckItem {
  const device = routeDevice(probe.route);
  if (device === tunnel) {
    return {
      id: 'route',
      status: 'ok',
      message: `qBittorrent's traffic is routed into the tunnel (${tunnel})`,
    };
  }
  return {
    id: 'route',
    status: 'down',
    message:
      device === undefined
        ? "qBittorrent's network has no route out"
        : `qBittorrent's traffic is routed to ${device}, not into the tunnel (${tunnel})`,
    hint: `see ${VPN_RUNBOOK}`,
  };
}

async function egressCheck(
  probe: ProbeOutput,
  egress: NonNullable<VpnCheckOptions['egress']>,
): Promise<{ item: VpnCheckItem; egress: VpnEgress }> {
  const { url } = egress;
  const tunnel = probe.egress;
  if (tunnel === undefined || tunnel.exit !== 0) {
    return {
      item: {
        id: 'egress',
        status: 'down',
        message: `qBittorrent's traffic got no answer from ${url}: ${lastLine(tunnel?.output ?? 'the probe did not ask')}`,
        hint: `the VPN is down, and nothing gets out (fail-closed); see ${VPN_RUNBOOK}`,
      },
      egress: { url, vpn: null, host: null },
    };
  }
  const vpn = egressAddress(tunnel.output) ?? null;
  if (vpn === null) {
    return {
      item: {
        id: 'egress',
        status: 'warning',
        message: `${url} answered qBittorrent without an address, so the addresses were not compared`,
        hint: 'set MEDIAPLANE_VPN_CHECK_URL to an IP-echo service, or unset it',
      },
      egress: { url, vpn, host: null },
    };
  }
  const host = await egress.fromHost(url);
  if (!host.ok) {
    return {
      item: {
        id: 'egress',
        status: 'warning',
        message: `qBittorrent's traffic leaves from ${vpn}, but this host could not ask ${url} for its own address (${host.error}), so the two were not compared`,
      },
      egress: { url, vpn, host: null },
    };
  }
  if (host.address === vpn) {
    return {
      item: {
        id: 'egress',
        status: 'leak',
        message: `qBittorrent's traffic leaves from ${vpn}, which is this host's own address: it does not go through the VPN`,
        hint: `see ${VPN_RUNBOOK}`,
      },
      egress: { url, vpn, host: host.address },
    };
  }
  return {
    item: {
      id: 'egress',
      status: 'ok',
      message: `qBittorrent's traffic leaves from ${vpn}, and this host's from ${host.address}`,
    },
    egress: { url, vpn, host: host.address },
  };
}

function verdictOf(
  checks: VpnCheckItem[],
  egress: VpnEgress | null,
  gluetunPublicIp: string | null,
): VpnCheckResult {
  const verdict: VpnVerdict = checks.some((c) => c.status === 'leak')
    ? 'leak'
    : checks.some((c) => c.status === 'down')
      ? 'down'
      : 'pass';
  return { ok: true, verdict, checks, egress, gluetunPublicIp };
}

/** Gluetun's tunnel interface: tun0, unless apps.gluetun.env sets VPN_INTERFACE. */
function tunnelInterface(gluetun: ResolvedApp): string {
  const set = gluetun.settings.env.VPN_INTERFACE;
  return typeof set === 'string' && set !== '' ? set : 'tun0';
}

function gluetunPublicIp(probe: ProbeOutput): string | null {
  const answer = httpAnswer(probe.publicip);
  if (answer.status !== 200) return null;
  const address = jsonField(answer.body, 'public_ip');
  return address === undefined || address === '' ? null : address;
}

/** A string field of a JSON object, or undefined. */
function jsonField(body: string, field: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const value = (parsed as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function lastLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .at(-1) ?? 'no output'
  );
}

function failure(code: string, message: string, hint?: string): VpnCheckResult {
  return { ok: false, diagnostics: [error(code, message, withHint(hint))] };
}
```

In `packages/engine/src/index.ts`, add `export * from './vpn/check';` after
`export * from './vpn/probe';`.

- [ ] **Step 4: Run them to verify they pass, with coverage**

```bash
pnpm vitest run packages/engine/src/vpn
pnpm test:coverage
```

Expected: PASS, and coverage stays at or above 90% on every measure. On the dev box,
`vpn/check.ts` has about 96% of its lines and 90% of its branches covered; the line left
is the host helper failing, which `hostFactsOrFailure`'s own tests cover.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/engine/src/vpn packages/engine/src/index.ts
git commit -m "feat(engine): vpnCheck, the kill switch's structure and its egress" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: `mediaplane vpn-check`

The command (spec §5.2): `mediaplane vpn-check [--home <dir>] [--no-egress] [--json]`.
It reads `MEDIAPLANE_VPN_CHECK_URL`, default `https://1.1.1.1/cdn-cgi/trace` (ruling D9).
Human output is one line per check, its hint under any that isn't `ok`, then the
verdict:

```console
$ mediaplane vpn-check
  ok    qBittorrent uses Gluetun's network, and has none of its own
  ok    Gluetun is running and healthy
  ok    Gluetun's control server says the VPN is running
  ok    Gluetun's control server refuses requests without Mediaplane's key
  ok    qBittorrent's traffic is routed into the tunnel (tun0)
  ok    qBittorrent's traffic leaves from 203.0.113.7, and this host's from 198.51.100.2

Passed: qBittorrent reaches the internet only through the VPN.
```

Decision: `--json` prints `{ schema: 'mediaplane.vpn-check/v1', ok: true, verdict, checks,
egress, gluetunPublicIp }`: `ok` says the check ran, as in `mediaplane.plan/v1`, and the
exit code says whether it passed (decision 12). Errors print the existing
`mediaplane.error/v1` envelope.
Decision: `CliDeps` gains `egress`, the host's side: `fetchEgress` from source,
`helperEgress` in the image, chosen by `MEDIAPLANE_IMAGE` like `host` and `probe`
(decision 3).

**Files:**
- Create: `packages/cli/src/vpn-check.ts`, `packages/cli/src/vpn-check.test.ts`
- Modify: `packages/cli/src/run.ts`
- Generated: `docs/reference/cli.md`

**Interfaces:**
- **Consumes:** `vpnCheck`, `VpnCheckResult`, `VpnCheckItem`, `VPN_RUNBOOK` (Task 6);
  `DEFAULT_VPN_CHECK_URL`, `fetchEgress`, `EgressResult` and `helperEgress` (Task 4);
  `printDiagnostics` from `./output`.
- **Produces:**
  - `VPN_CHECK_JSON_SCHEMA = 'mediaplane.vpn-check/v1'`;
  - `printVpnCheck(result: VpnCheckResult, options: { json: boolean }, io: Io): number`,
    which returns the exit code (0 only for `pass`);
  - `CliDeps.egress: (runtime: Runtime) => (url: string) => Promise<EgressResult>`;
  - `EXIT_CODES['vpn-check']`, and `MEDIAPLANE_VPN_CHECK_URL` in `ENVIRONMENT`.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/vpn-check.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  collectHostReport,
  type ContainerState,
  type HostRequest,
  type OneOffCommand,
} from '@mediaplane/engine';
import {
  FIXTURE_HOST,
  fakeProbe,
  fakeRuntime,
  probeOutput,
  tempDir,
  type ProbeAnswers,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { run, type CliDeps, type Io } from './run';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
`;
const KEY = '0'.repeat(32);
const GLUETUN_ID = 'a'.repeat(64);
const QBITTORRENT_ID = 'b'.repeat(64);
const TRACE = 'https://1.1.1.1/cdn-cgi/trace';

async function makeHome(): Promise<string> {
  const home = await tempDir('mediaplane-cli-');
  await writeFile(join(home, 'stack.yaml'), STACK);
  await mkdir(join(home, 'state'));
  await writeFile(
    join(home, 'state', 'secrets.json'),
    JSON.stringify({ version: 1, apps: { gluetun: { controlApiKey: KEY } } }),
  );
  return home;
}

const running = (service: string, id: string): ContainerState => ({
  service,
  id,
  state: 'running',
  health: 'healthy',
  configHash: undefined,
  published: [],
});

const HEALTHY: ProbeAnswers = {
  route: [0, '1.1.1.1 dev tun0  src 10.66.0.2'],
  anonymous: [0, '401'],
  status: [0, '{"status":"running"}\n200'],
  publicip: [0, '{"public_ip":""}\n200'],
  egress: [0, 'ip=203.0.113.7\n'],
};

/** A Docker running qBittorrent behind Gluetun, whose probe answers `answers`. */
function vpnDocker(answers: ProbeAnswers = HEALTHY, sent: OneOffCommand[] = []) {
  return fakeRuntime({
    containers: [running('gluetun', GLUETUN_ID), running('qbittorrent', QBITTORRENT_ID)],
    details: { [QBITTORRENT_ID]: { networkMode: `container:${GLUETUN_ID}` } },
    run: (_service, command) => {
      sent.push(command);
      const shown: ProbeAnswers = { ...answers };
      if (command.args.at(-1) === '') delete shown.egress;
      return { code: 0, stdout: probeOutput(shown), stderr: '' };
    },
  });
}

function capture(env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    env,
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

function deps(
  runtime = vpnDocker(),
  hostAddress = '198.51.100.2',
  asked: string[] = [],
): Partial<CliDeps> {
  return {
    host: () => Promise.resolve(FIXTURE_HOST),
    runtime: () => runtime,
    probe: () => fakeProbe(),
    egress: () => (url) => {
      asked.push(url);
      return Promise.resolve({ ok: true, address: hostAddress });
    },
  };
}

describe('mediaplane vpn-check', () => {
  it('passes, showing each check and the two addresses', async () => {
    const term = capture();
    const asked: string[] = [];
    const home = await makeHome();
    expect(
      await run(
        ['vpn-check', '--home', home],
        term.io,
        deps(vpnDocker(), undefined, asked),
      ),
    ).toBe(0);
    expect(term.stdout()).toBe(
      [
        "  ok    qBittorrent uses Gluetun's network, and has none of its own",
        '  ok    Gluetun is running and healthy',
        "  ok    Gluetun's control server says the VPN is running",
        "  ok    Gluetun's control server refuses requests without Mediaplane's key",
        "  ok    qBittorrent's traffic is routed into the tunnel (tun0)",
        "  ok    qBittorrent's traffic leaves from 203.0.113.7, and this host's from 198.51.100.2",
        '',
        'Passed: qBittorrent reaches the internet only through the VPN.',
        '',
      ].join('\n'),
    );
    expect(term.stderr()).toBe('');
    expect(asked).toEqual([TRACE]);
  });

  it('prints versioned JSON, and exits 1 on a leak', async () => {
    const term = capture();
    const home = await makeHome();
    expect(
      await run(
        ['vpn-check', '--home', home, '--json'],
        term.io,
        deps(vpnDocker(), '203.0.113.7'),
      ),
    ).toBe(1);
    const shown = JSON.parse(term.stdout()) as Record<string, unknown>;
    expect(shown).toMatchObject({
      schema: 'mediaplane.vpn-check/v1',
      ok: true,
      verdict: 'leak',
      egress: { url: TRACE, vpn: '203.0.113.7', host: '203.0.113.7' },
      gluetunPublicIp: null,
    });
    expect(term.stdout()).not.toContain(KEY);
  });

  it('asks the URL in MEDIAPLANE_VPN_CHECK_URL, and none with --no-egress', async () => {
    const echo = 'http://192.0.2.10/cgi-bin/ip';
    const sent: OneOffCommand[] = [];
    const asked: string[] = [];
    const home = await makeHome();
    const term = capture({ MEDIAPLANE_VPN_CHECK_URL: echo });
    expect(
      await run(
        ['vpn-check', '--home', home],
        term.io,
        deps(vpnDocker(HEALTHY, sent), undefined, asked),
      ),
    ).toBe(0);
    expect(sent[0]?.args.at(-1)).toBe(echo);
    expect(asked).toEqual([echo]);

    const structure = capture({ MEDIAPLANE_VPN_CHECK_URL: echo });
    expect(
      await run(
        ['vpn-check', '--home', home, '--no-egress'],
        structure.io,
        deps(vpnDocker(HEALTHY, sent), undefined, asked),
      ),
    ).toBe(0);
    expect(sent[1]?.args.at(-1)).toBe('');
    expect(asked).toEqual([echo]);
    expect(structure.stdout()).toContain(
      "Passed: qBittorrent has no way out but the tunnel. Run without --no-egress to compare its address with this host's.",
    );
  });

  it('exits 1, with the runbook, when the VPN is down', async () => {
    const term = capture();
    const answers: ProbeAnswers = {
      ...HEALTHY,
      egress: [28, 'curl: (28) Connection timed out after 10001 milliseconds'],
    };
    const home = await makeHome();
    expect(
      await run(['vpn-check', '--home', home], term.io, deps(vpnDocker(answers))),
    ).toBe(1);
    expect(term.stdout()).toContain(
      `  DOWN  qBittorrent's traffic got no answer from ${TRACE}: curl: (28) Connection timed out after 10001 milliseconds\n        hint: the VPN is down, and nothing gets out (fail-closed); see docs/runbooks/vpn-down.md\n`,
    );
    expect(term.stdout()).toContain(
      "VPN down: qBittorrent can't reach the internet, and nothing leaks (fail-closed). See docs/runbooks/vpn-down.md.",
    );
  });

  it('explains what it cannot check, as an error', async () => {
    const home = await makeHome();
    const term = capture();
    expect(await run(['vpn-check', '--home', home], term.io, deps(fakeRuntime()))).toBe(
      1,
    );
    expect(term.stderr()).toBe(
      'error: qBittorrent has no container in this stack yet\n  hint: run "mediaplane apply" first\n',
    );
    const json = capture({ MEDIAPLANE_VPN_CHECK_URL: 'file:///etc/passwd' });
    expect(await run(['vpn-check', '--home', home, '--json'], json.io, deps())).toBe(1);
    expect(JSON.parse(json.stdout())).toMatchObject({
      schema: 'mediaplane.error/v1',
      ok: false,
    });
  });

  it('asks for the host address through the host helper when it runs from its image', async () => {
    const seen: HostRequest[] = [];
    const runtime = fakeRuntime({
      containers: [
        running('gluetun', GLUETUN_ID),
        running('qbittorrent', QBITTORRENT_ID),
      ],
      details: { [QBITTORRENT_ID]: { networkMode: `container:${GLUETUN_ID}` } },
      run: () => ({ code: 0, stdout: probeOutput(HEALTHY), stderr: '' }),
      hostHelper: async (request) => {
        seen.push(request);
        const report = await collectHostReport(
          request,
          fakeProbe(),
          () => FIXTURE_HOST,
          () => Promise.resolve({ ok: true, address: '198.51.100.2' }),
        );
        return { ok: true, stdout: JSON.stringify(report) };
      },
    });
    const term = capture({ MEDIAPLANE_IMAGE: 'mediaplane:test' });
    const home = await makeHome();
    // No egress override: the image's own, through the host helper.
    expect(
      await run(['vpn-check', '--home', home, '--json'], term.io, {
        runtime: () => runtime,
        probe: () => fakeProbe(),
      }),
    ).toBe(0);
    expect(seen.map((r) => r.egress)).toEqual([undefined, TRACE]);
  });
});
```

The last test leaves `egress` and `host` to `defaultDeps`, with `MEDIAPLANE_IMAGE` set,
so the host's facts and its address both come from the (fake) host helper.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/cli/src/vpn-check.test.ts`

Expected: FAIL: `error: unknown command 'vpn-check'`, so every `run` exits 1.

- [ ] **Step 3: Implement**

Create `packages/cli/src/vpn-check.ts`:

```ts
import { VPN_RUNBOOK, type VpnCheckItem, type VpnCheckResult } from '@mediaplane/engine';
import { printDiagnostics } from './output';
import type { Io } from './run';

export const VPN_CHECK_JSON_SCHEMA = 'mediaplane.vpn-check/v1';

const MARKS: Record<VpnCheckItem['status'], string> = {
  ok: 'ok',
  warning: 'warn',
  down: 'DOWN',
  leak: 'LEAK',
};

/**
 * `mediaplane vpn-check` (spec §5.2): each check, then the verdict. With --json, the
 * result as `mediaplane.vpn-check/v1`, where `ok` says the check ran and `verdict` what
 * it found. Returns the exit code: 0 only for a pass.
 */
export function printVpnCheck(
  result: VpnCheckResult,
  options: { json: boolean },
  io: Io,
): number {
  if (!result.ok) {
    printDiagnostics(result.diagnostics, options, io);
    return 1;
  }
  const code = result.verdict === 'pass' ? 0 : 1;
  if (options.json) {
    io.stdout(
      `${JSON.stringify({ schema: VPN_CHECK_JSON_SCHEMA, ...result }, null, 2)}\n`,
    );
    return code;
  }
  for (const check of result.checks) {
    io.stdout(`  ${MARKS[check.status].padEnd(4)}  ${check.message}\n`);
    if (check.status !== 'ok' && check.hint !== undefined) {
      io.stdout(`        hint: ${check.hint}\n`);
    }
  }
  if (result.gluetunPublicIp !== null) {
    io.stdout(`Gluetun reports its public address as ${result.gluetunPublicIp}.\n`);
  }
  io.stdout(`\n${verdict(result)}\n`);
  return code;
}

function verdict(result: Extract<VpnCheckResult, { ok: true }>): string {
  switch (result.verdict) {
    case 'pass':
      return result.egress === null
        ? "Passed: qBittorrent has no way out but the tunnel. Run without --no-egress to compare its address with this host's."
        : 'Passed: qBittorrent reaches the internet only through the VPN.';
    case 'down':
      return `VPN down: qBittorrent can't reach the internet, and nothing leaks (fail-closed). See ${VPN_RUNBOOK}.`;
    case 'leak':
      return `LEAK: qBittorrent's traffic does not go through the VPN. See ${VPN_RUNBOOK}.`;
  }
}
```

In `packages/cli/src/run.ts`:

- add to the import from `'@mediaplane/engine'`: `DEFAULT_VPN_CHECK_URL,` after
  `credentials,`; `fetchEgress,` and `helperEgress,` after `detectHostFacts,`;
  `vpnCheck,` and `type EgressResult,` after `status,`;
- add `import { printVpnCheck } from './vpn-check';` after the `./version` import;
- add to `interface CliDeps`, after `probe`:

  ```ts
    /** Which address the host comes from, as the IP-echo service at a URL sees it. */
    egress: (runtime: Runtime) => (url: string) => Promise<EgressResult>;
  ```

- add to `EXIT_CODES`, after `init`:

  ```ts
    'vpn-check': [
      '0: passed: qBittorrent reaches the internet only through the VPN',
      '1: a leak, or the VPN is down',
      '1: an error: stack.yaml, Docker unreachable, or the stack not applied yet',
    ],
  ```

- add to `ENVIRONMENT`, before the `DOCKER_HOST` entry:

  ```ts
    {
      name: 'MEDIAPLANE_VPN_CHECK_URL',
      description: `The IP-echo service vpn-check asks which address qBittorrent and this host come from: an http or https URL that answers ip=<address>, as Cloudflare's trace does, or only the address. Default ${DEFAULT_VPN_CHECK_URL}. vpn-check --no-egress asks none.`,
    },
  ```

- in `defaultDeps`, add `egress: () => (url) => fetchEgress(url),` after
  `probe: () => nodeProbe,` (from source), and
  `egress: (docker) => (url) => helperEgress({ runtime: docker, image, user }, url),`
  after the `probe` line of the image's deps;
- add before `program.command('init')`:

  ```ts
    program
      .command('vpn-check')
      .description(
        "Check that qBittorrent reaches the internet only through the VPN, and compare its address with this host's",
      )
      .option('--home <dir>', 'Mediaplane home directory', defaultHome)
      .option(
        '--no-egress',
        'check the containers and the tunnel only, asking no IP-echo service for the two addresses',
      )
      .option('--json', 'print machine-readable JSON')
      .addHelpText('after', exitCodesHelp('vpn-check'))
      .action(async (options: { home: string; egress: boolean; json?: boolean }) => {
        const home = resolve(options.home);
        const runtime = deps.runtime(home, project);
        const url = setting(io.env, 'MEDIAPLANE_VPN_CHECK_URL') ?? DEFAULT_VPN_CHECK_URL;
        const result = await vpnCheck({
          home,
          catalog,
          // In the image, the host helper: as for plan, one that fails is an error result.
          host: () => deps.host(runtime),
          env: io.env,
          runtime,
          ...(options.egress ? { egress: { url, fromHost: deps.egress(runtime) } } : {}),
        });
        setExitCode(printVpnCheck(result, { json: options.json === true }, io));
      });

  ```

  Commander turns `--no-egress` into `egress: true` by default and `false` when given.

- [ ] **Step 4: Run them to verify they pass, and regenerate the CLI reference**

```bash
pnpm vitest run packages/cli scripts
pnpm docs:generate
git diff --stat docs/reference
```

Expected: PASS (the `--help` test keeps every exit-code line within 80 columns), and
`docs:generate` adds a `mediaplane vpn-check` section to `docs/reference/cli.md`, before
`mediaplane init`, and `MEDIAPLANE_VPN_CHECK_URL` to its environment variables.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages/cli/src docs/reference/cli.md
git commit -m "feat(cli): mediaplane vpn-check" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 8: End-to-end: `vpn-check` against the kill switch, from source and from the image

What S3d proves on real Docker, on top of Task 2: `vpn-check` passes with the tunnel up
and fails with it down (the research's D10, assertion 6), and it does so from the
deployed image too, behind the real socket proxy, on a network with no route out:
S3d doesn't depend on D1, and the proxy needs nothing new (decision 1).

Decision: the kill-switch test's stack gets `vpn-check` at each stage, with
`MEDIAPLANE_VPN_CHECK_URL` set to the test's echo, which both sides reach (decision 14).
Decision: a new `deployMediaplane()` helper deploys `deploy/mediaplane.compose.yaml` for
the test, as `<project>-system`, with an override naming its container and project, like
`deploy.e2e.test.ts` does; that test keeps its own setup (decision 17). The image builds
from this checkout; in CI the earlier end-to-end files have warmed Docker's build cache.
Decision: two more states, at the end, where they disturb nothing: Gluetun stopped, and
Gluetun started again on its own without its key file. The second checks the roadmap's
last S3d input (a control server that answers without the key) and decision 5 (a
qBittorrent stranded in the old network) on real Docker.

**Files:**
- Modify: `test/e2e/helpers.ts`, `test/e2e/vpn.e2e.test.ts`

**Interfaces:**
- **Consumes:** the `vpn-check` command (Task 7); `startWireGuard` and the test from
  Task 2; `buildImage`, `REPO` and `nodeExec`.
- **Produces:**
  - `interface DeployedMediaplane { mediaplane(args: readonly string[], env?: Record<string, string>): Promise<ExecResult>; remove(): Promise<void> }`;
  - `deployMediaplane(options: { home: string; stack: string }): Promise<DeployedMediaplane>`,
    which tags the image `mediaplane-e2e:<stack without "mediaplane-e2e-">`.

- [ ] **Step 1: The deployment helper**

In `test/e2e/helpers.ts`, add `stat` to the `node:fs/promises` import
(`import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';`), and add at
the end:

```ts

/** Mediaplane deployed for a test, as `deployMediaplane` started it. */
export interface DeployedMediaplane {
  /** `mediaplane <args>` in its container, with `env` added to the command's. */
  mediaplane(args: readonly string[], env?: Record<string, string>): Promise<ExecResult>;
  /** Bring the deployment down, and remove its image. */
  remove(): Promise<void>;
}

/**
 * Mediaplane deployed as a user deploys it (deploy/mediaplane.compose.yaml): its image,
 * built from this checkout, behind the socket proxy, on a network with no route out,
 * managing the Compose project `stack` in `home`. Its own project is `<stack>-system`.
 */
export async function deployMediaplane(options: {
  home: string;
  stack: string;
}): Promise<DeployedMediaplane> {
  const { home, stack } = options;
  // mediaplane-e2e-<pid>-vpn is tagged mediaplane-e2e:<pid>-vpn.
  const tag = `mediaplane-e2e:${stack.replace(/^mediaplane-e2e-/, '')}`;
  const container = `${stack}-mediaplane`;
  await buildImage(tag);
  const dir = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-system-'));
  const override = join(dir, 'override.yaml');
  await writeFile(
    override,
    [
      'services:',
      '  mediaplane:',
      `    container_name: ${container}`,
      '    environment:',
      `      MEDIAPLANE_COMPOSE_PROJECT: ${stack}`,
      '',
    ].join('\n'),
  );
  const env = {
    ...process.env,
    MEDIAPLANE_IMAGE: tag,
    MEDIAPLANE_HOME: home,
    MEDIAPLANE_UID: String(process.getuid?.() ?? 1000),
    MEDIAPLANE_GID: String(process.getgid?.() ?? 1000),
    DOCKER_GID: String((await stat('/var/run/docker.sock')).gid),
  };
  const deploy = join(REPO, 'deploy', 'mediaplane.compose.yaml');
  const system = (...args: string[]) =>
    nodeExec(
      'docker',
      [
        'compose',
        '-p',
        `${stack}-system`,
        '--env-file',
        '/dev/null',
        '-f',
        deploy,
        '-f',
        override,
        ...args,
      ],
      { env, cwd: '/', timeoutMs: 300_000 },
    );
  const remove = async () => {
    const down = await system('down', '--remove-orphans');
    await rm(dir, { recursive: true, force: true });
    const image = await nodeExec('docker', ['image', 'rm', tag], { cwd: '/' });
    expect(down.code, down.stderr).toBe(0);
    expect(image.code, image.stderr).toBe(0);
  };
  const up = await system('up', '-d', '--wait');
  if (up.code !== 0) {
    await remove();
    throw new Error(`mediaplane-system did not start:\n${up.stderr}`);
  }
  return {
    mediaplane: (args, extra = {}) =>
      nodeExec(
        'docker',
        [
          'exec',
          ...Object.entries(extra).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
          container,
          'mediaplane',
          ...args,
        ],
        { cwd: '/', timeoutMs: 300_000 },
      ),
    remove,
  };
}
```

- [ ] **Step 2: Add `vpn-check` to the kill-switch test**

In `test/e2e/vpn.e2e.test.ts`:

- change the first import to `import { mkdir, rename, writeFile } from 'node:fs/promises';`,
  and the helpers import to:

  ```ts
  import {
    BUSYBOX,
    composeDown,
    deployMediaplane,
    makeHome,
    REPO,
    type DeployedMediaplane,
  } from './helpers';
  ```

- add after `fetchFrom`:

  ```ts

  const MAIN = join(REPO, 'packages', 'cli', 'src', 'main.ts');

  /** `mediaplane vpn-check --json <args>`, run from source as a user would. */
  function vpnCheck(
    home: string,
    env: Record<string, string>,
    ...args: string[]
  ): Promise<ExecResult> {
    return nodeExec(
      process.execPath,
      ['--import', 'tsx', MAIN, 'vpn-check', '--home', home, '--json', ...args],
      {
        cwd: REPO,
        env: { ...process.env, MEDIAPLANE_COMPOSE_PROJECT: PROJECT, ...env },
        timeoutMs: 120_000,
      },
    );
  }

  /** Each check vpn-check made, as "<id> <status>". */
  function checksOf(result: ExecResult): string[] {
    const parsed = JSON.parse(result.stdout) as {
      checks: { id: string; status: string }[];
    };
    return parsed.checks.map((c) => `${c.id} ${c.status}`);
  }
  ```

- add `let deployed: DeployedMediaplane | undefined;` after
  `const wg = await startWireGuard(PROJECT);`;
- add after `expect((await fromHost.text()).trim()).toBe(`ip=${wg.gateway}`);`:

  ```ts

        // vpn-check passes, and sees the same two addresses: from source, and from the image
        // behind the socket proxy, whose own network has no route to the stack (its probe
        // runs inside qBittorrent's namespace).
        const toEcho = { MEDIAPLANE_VPN_CHECK_URL: echo };
        const passed = await vpnCheck(home, toEcho);
        expect(passed.code, passed.stdout + passed.stderr).toBe(0);
        const addresses = { url: echo, vpn: wg.exit, host: wg.gateway };
        expect(JSON.parse(passed.stdout)).toMatchObject({
          verdict: 'pass',
          egress: addresses,
        });
        expect(checksOf(passed)).toEqual([
          'network ok',
          'gluetun ok',
          'control ok',
          'control-key ok',
          'route ok',
          'egress ok',
        ]);
        deployed = await deployMediaplane({ home, stack: PROJECT });
        const inImage = await deployed.mediaplane(['vpn-check', '--json'], toEcho);
        expect(inImage.code, inImage.stdout + inImage.stderr).toBe(0);
        expect(JSON.parse(inImage.stdout)).toMatchObject({
          verdict: 'pass',
          egress: addresses,
        });
        await deployed.remove();
        deployed = undefined;
  ```

- add after the `/ dev tun0 /` route check that follows `await wg.stop();`:

  ```ts
        // vpn-check finds the VPN down: nothing answers through the tunnel.
        const tunnelDown = await vpnCheck(home, toEcho);
        expect(tunnelDown.code, tunnelDown.stderr).toBe(1);
        expect(JSON.parse(tunnelDown.stdout)).toMatchObject({
          verdict: 'down',
          egress: { url: echo, vpn: null, host: null },
        });
        expect(checksOf(tunnelDown).at(-1)).toBe('egress down');
  ```

- add after `expect(unreachable.stderr).toContain('Network is unreachable');`:

  ```ts
        const gluetunDown = await vpnCheck(home, {}, '--no-egress');
        expect(gluetunDown.code, gluetunDown.stderr).toBe(1);
        expect(checksOf(gluetunDown)).toEqual(['network ok', 'gluetun down']);

        // Gluetun starts again on its own, without Mediaplane's key file, as one from before
        // Slice 3a that was never restarted. vpn-check says that its control server answers
        // without a key, and that qBittorrent, which kept running, still holds the network
        // the old Gluetun had: it has none.
        const auth = join(home, 'appdata', 'gluetun', 'auth', 'config.toml');
        await rename(auth, `${auth}.aside`);
        const started = await nodeExec('docker', ['start', gluetun], { cwd: '/' });
        expect(started.code, started.stderr).toBe(0);
        for (let attempt = 0; statusOf(await control(status)) !== 200; attempt++) {
          expect(attempt, "Gluetun's control server never answered").toBeLessThan(30);
          await new Promise((done) => setTimeout(done, 1000));
        }
        const open = await vpnCheck(home, {}, '--no-egress');
        expect(open.code, open.stderr).toBe(1);
        expect(checksOf(open)).toContain('network down');
        expect(checksOf(open)).toContain('control-key warning');
  ```

- in the `finally` block, add `await deployed?.remove();` as its first line.

`vpn-check`'s output never holds a key, so the failure messages may print it.

- [ ] **Step 3: Run it on real Docker, then the whole suite, and look for leftovers**

```bash
test -d /sys/module/wireguard || sudo modprobe wireguard
pnpm typecheck && pnpm lint
docker volume ls -q | wc -l
ls -d "$(node -p 'require("os").tmpdir()')"/mediaplane-e2e-* 2>/dev/null | wc -l
pnpm test:e2e test/e2e/vpn.e2e.test.ts
pnpm test:e2e
docker ps -a --filter name=mediaplane-e2e --format '{{.Names}}'
docker network ls --filter name=mediaplane-e2e --format '{{.Name}}'
docker ps -a --filter label=io.mediaplane.helper --format '{{.Names}}'
docker image ls --format '{{.Repository}}:{{.Tag}}' | grep '^mediaplane-e2e' || true
docker volume ls -q | wc -l
ls -d "$(node -p 'require("os").tmpdir()')"/mediaplane-e2e-* 2>/dev/null | wc -l
```

Expected: the VPN test passes in about 70 seconds on the dev box (the image build is
mostly cached), and the whole suite passes (about 2.5 minutes with the images cached).
The four listings print nothing, and both counts equal those before the run. If the
in-image `vpn-check` fails with `Forbidden`, the proxy refused a call: read
`docker logs <PROJECT>-system-socket-proxy-1` before anything else, and do not widen the
allow-list (Global Constraints): report it to the controller.

- [ ] **Step 4: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add test/e2e
git commit -m "test(e2e): vpn-check against the kill switch, from source and from the image behind the proxy" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Docs: the "VPN down" runbook, threat model, READMEs, install guide, architecture, spec, roadmap

Every slice writes its spec §9 docs as it goes (owner, 2026-10-09). The generated
references were refreshed by Tasks 1 and 7. This task writes the hand-written ones: the
new runbook, and what S3d changes in the others (D17: the threat model too). Every
statement must be true of the code as it now is; anything planned names its slice.
Diagrams stay within 40 columns, in `text` blocks.

**Files:**
- Create: `docs/runbooks/vpn-down.md`
- Modify: `docs/security/threat-model.md`, `catalog/gluetun/README.md`,
  `catalog/qbittorrent/README.md`, `catalog/gluetun/app.ts` (a comment),
  `deploy/README.md`, `docs/architecture.md`, `README.md`, `CONTRIBUTING.md`,
  `docs/design/m1-engine-cli.md` (§5.2, §7.2(6), §11), `docs/plans/m1-roadmap.md`

**Interfaces:**
- **Consumes:** what Tasks 1 to 8 built, and only that.
- **Produces:** `docs/runbooks/vpn-down.md`, which `VPN_RUNBOOK` (Task 6) and every
  `down` or `leak` hint point to.

- [ ] **Step 1: The runbook**

Create `docs/runbooks/vpn-down.md`, in the format of `app-wont-start.md` (symptoms,
checks, fix, prevention):

````markdown
# Runbook: the VPN is down

qBittorrent has no network of its own: it uses Gluetun's. So when the VPN is down,
qBittorrent can't reach anything, and nothing leaks (fail-closed). This page finds out
why, and gets it back. A leak is a different failure, and worse: see [A leak](#a-leak).

## Symptoms

- **`mediaplane vpn-check`** ends with `VPN down` and exits 1. Each line says what it
  checked, and `DOWN` marks what failed:

  ```console
  $ mediaplane vpn-check
    ok    qBittorrent uses Gluetun's network, and has none of its own
    ok    Gluetun is running and healthy
    ok    Gluetun's control server says the VPN is running
    ok    Gluetun's control server refuses requests without Mediaplane's key
    ok    qBittorrent's traffic is routed into the tunnel (tun0)
    DOWN  qBittorrent's traffic got no answer from https://1.1.1.1/cdn-cgi/trace: curl: (28) Connection timed out after 10002 milliseconds
          hint: the VPN is down, and nothing gets out (fail-closed); see docs/runbooks/vpn-down.md

  VPN down: qBittorrent can't reach the internet, and nothing leaks (fail-closed). See docs/runbooks/vpn-down.md.
  ```

- **`mediaplane status`** shows `gluetun` as `unhealthy` or `starting`, or not running.
  Gluetun's own health check notices a dead tunnel within a few minutes, and restarts the
  VPN.
- **qBittorrent** finds no peers, and its downloads stall. Its web UI still answers.
- **`mediaplane apply`** fails at the containers step, naming `gluetun` as unhealthy, and
  qBittorrent doesn't start. See [an app won't start](app-wont-start.md).

## Checks

1. **What vpn-check found:** `mediaplane vpn-check`, or `mediaplane vpn-check --json`.
   Each check has an id: `network`, `gluetun`, `control`, `control-key`, `route` and
   `egress`. `--no-egress` runs every check but the last, and asks no outside service.
2. **Gluetun's state:** `mediaplane status gluetun`.
3. **Gluetun's log,** on the host: `docker compose -p mediaplane logs --tail 100 gluetun`.
   Look for WireGuard errors, `healthcheck`, and `restarting VPN`.
4. **When each started,** on the host:
   `docker ps --filter name=mediaplane-gluetun --filter name=mediaplane-qbittorrent`.
5. **Your VPN account:** whether the key is still valid, and the provider's status page.

## Fix

Go by the first line marked `DOWN`.

- **`network`: qBittorrent started before Gluetun last did.** Gluetun was restarted on
  its own, by hand or after a crash, so it has a new network, and qBittorrent kept the
  old one, which has nothing but loopback. `mediaplane apply` doesn't fix this: Compose
  restarts qBittorrent only when it recreates Gluetun. Restart qBittorrent, on the host:

  ```bash
  docker restart mediaplane-qbittorrent-1
  ```

- **`gluetun`: Gluetun is exited, or has no container.** Run `mediaplane apply`, which
  starts it. Then restart qBittorrent as above: it kept the network Gluetun had before.
- **`gluetun`: running but unhealthy, or `egress`: no answer through the tunnel.** The
  tunnel doesn't carry traffic. Read Gluetun's log, then check, in this order:
  - **the key:** the file `vpn.private_key` points to (`secrets/wg.key` in the starter)
    holds the private key from your provider's WireGuard file, and the provider still
    knows it. A new key needs `mediaplane apply`, which recreates Gluetun and restarts
    qBittorrent;
  - **the address:** `vpn.addresses` is the `Address` line of that file, such as
    `10.64.0.2/32`. `plan` refuses one that is not an address with a prefix;
  - **the provider:** `vpn.provider` is the provider's name as Gluetun spells it;
  - **the server:** Gluetun's server choice goes in `apps.gluetun.env`, such as
    `SERVER_COUNTRIES: Netherlands`. Try another, then `mediaplane apply`.

  See [Gluetun's README](../../catalog/gluetun/README.md) and Gluetun's own wiki for each
  provider's settings.

- **`control`: Gluetun says the VPN is `stopped` or `crashed`.** Gluetun gave up on the
  tunnel. Its log says why. Fix the cause as above, then `mediaplane apply`.
- **`route`: traffic is not routed into the tunnel.** Gluetun is between two attempts,
  with no tunnel. Wait a minute, and run `mediaplane vpn-check` again. If it stays, read
  Gluetun's log.

Warnings don't fail the check, but say something is off:

- **`control-key`: the control server answers without a key.** Gluetun started before
  Mediaplane wrote its key file, and reads the file only when it starts. Restart Gluetun,
  then qBittorrent, as in Gluetun's README under "Set up before Slice 3a".
- **`control`: the control server refused Mediaplane's key.** Gluetun's
  `auth/config.toml` holds another key than `state/secrets.json`. See the same section.
- **`egress`: this host could not ask the IP-echo service.** The check passes on the
  rest. The host can't reach `https://1.1.1.1/cdn-cgi/trace`: set
  `MEDIAPLANE_VPN_CHECK_URL` to another service that answers with your address, or use
  `--no-egress`.

Then run `mediaplane vpn-check` again. It ends with `Passed` when qBittorrent reaches
the internet only through the VPN.

## A leak

`vpn-check` ends with `LEAK` and exits 1: qBittorrent's traffic doesn't go through the
VPN, so peers see this host's own address. Stop qBittorrent first, on the host:

```bash
docker stop mediaplane-qbittorrent-1
```

Then go by the line marked `LEAK`:

- **`network`: qBittorrent runs without the VPN.** `stack.yaml` says
  `apps.qbittorrent.vpn: false`. Add a `vpn:` block, remove that line, and run
  `mediaplane apply`.
- **`network`: qBittorrent has a network of its own.** Something gave it one: look for
  `network_mode` or `networks` under `qbittorrent` in `compose.override.yaml`, and take
  them out. Then `mediaplane apply`, which recreates it behind Gluetun.
- **`egress`: qBittorrent leaves from this host's own address.** Check that the
  IP-echo service is on the internet, not on your network: `MEDIAPLANE_VPN_CHECK_URL`
  must name one that both sides reach over the internet. If it is, treat it as a leak:
  keep qBittorrent stopped, and read Gluetun's log.

Run `mediaplane vpn-check` again before you start qBittorrent.

## Prevention

- **Run `mediaplane vpn-check`** after an `apply` that changes Gluetun, and from time to
  time. It exits 1 on a leak or a VPN that is down, so a cron job can alert on it.
- **Restart qBittorrent whenever you restart Gluetun** by hand.
- **Leave qBittorrent's network alone** in `compose.override.yaml`: anything about its
  network goes on `gluetun`.
- **Keep your VPN key current** with your provider.
````

- [ ] **Step 2: The threat model**

In `docs/security/threat-model.md`:

1. Replace the first sentence with:

   ```markdown
   This is the threat model for Mediaplane as built today: M1, up to and including Slice 3a,
   and Slice 3d.
   ```

2. In "What runs, and who can reach it", in the host helper's bullet, change
   ``During `init`, `plan` and `apply`, Mediaplane starts a container`` to

   ```markdown
   - **The host helper.** During `init`, `plan`, `apply` and `vpn-check`, Mediaplane
     starts a container of its own image on the host network, for a second or two.
   ```

   (rewrapping the bullet's first two lines), and replace its sub-bullet
   `- through the host network: the host's addresses and free ports;` with:

   ```markdown
     - through the host network: the host's addresses and free ports, and for `vpn-check`,
       the address the host's own traffic leaves from (see T13);
   ```

3. Add after the appdata ownership helper's bullet (it ends `Today only Seerr, which runs
   as uid 1000, needs it.`):

   ```markdown
   - **vpn-check's probe.** `mediaplane vpn-check` runs
     `docker compose run --rm --no-deps -T --user 65534:65534 --entrypoint sh qbittorrent`
     with a short script: a throwaway container of qBittorrent's own image, as nobody, in
     Gluetun's network namespace, as qBittorrent is. It asks Gluetun's control server for
     the VPN's state, looks up the route out, and, unless `--no-egress` is given, asks an
     IP-echo service which address it comes from. It writes nothing, and is removed when it
     exits. Gluetun's key reaches it on its standard input, never on a command line or in
     its environment. It uses the same Docker API calls as the ownership helper, so the
     proxy allows nothing new for it.
   ```

4. In the apps' bullet, replace the two sub-bullets that end
   `The automated test for that arrives in Slice 3d.` and
   `(see T11; Slice 3d's end-to-end test checks this).` with:

   ```markdown
     - With a VPN, qBittorrent has no network of its own. It uses Gluetun's, so it has no
       route out when the VPN is down (see T12).
     - Gluetun's control server (port 8000) is never published. It answers only Mediaplane's
       key, on two read-only routes (see T11).
   ```

5. In T4, add to "Controls today", after `- With a VPN, qBittorrent sits in Gluetun's
   network namespace.`:

   ```markdown
   - vpn-check's probe runs qBittorrent's image as nobody, writes nothing, and is removed
     when it exits.
   ```

   and to "What remains", as its first bullet:

   ```markdown
   - vpn-check measures qBittorrent's side with qBittorrent's own image, so a compromised
     image could make the check pass.
   ```

6. In T5, add to "Controls today", after the bullet that ends `never on its command
   line.`:

   ```markdown
   - Gluetun's control key reaches vpn-check's probe on its standard input, and the probe
     hands it to curl the same way. It is never on a command line, which every user on the
     host can list, nor in the container's settings, and it is replaced with `***` in what
     the probe prints.
   ```

7. In T11, replace the last three lines of the bullet that starts `Before Gluetun's first
   start` (from `` `GET /v1/publicip/ip`, and nothing else. ``) with:

   ```markdown
     `GET /v1/publicip/ip`, and nothing else. Requests without the key are refused, and so
     are other routes with it: the kill-switch test checks both. Without that file, Gluetun
     v3.41 answers anyone on the stack's network.
   - `mediaplane vpn-check` warns when the control server answers without the key.
   ```

8. Add after T11, before `## What the proxy does not stop`:

   ```markdown
   ### T12. The VPN fails, and qBittorrent's traffic leaks

   Controls today:

   - qBittorrent uses Gluetun's network (`network_mode: service:gluetun`) and has none of its
     own, so when the tunnel is down it has no way out (fail-closed). Gluetun's firewall
     lets traffic out only through the tunnel, to the stack's own network, and to the LAN
     subnets in `FIREWALL_OUTBOUND_SUBNETS` while the web UIs are on the LAN.
   - An end-to-end test proves it against a WireGuard server of its own, on amd64 and arm64:
     traffic leaves through the tunnel; with the server stopped, nothing gets out of
     qBittorrent's network while an ordinary container on the stack's network still does;
     with Gluetun stopped, qBittorrent has nothing but loopback.
   - `mediaplane vpn-check` checks the same on your host: qBittorrent's network mode, that
     it joined the Gluetun now running, Gluetun's health and its own report, the route into
     the tunnel, and where qBittorrent's traffic leaves from, compared with the host's. It
     exits 1 on a leak or a VPN that is down.
   - `plan` warns every time qBittorrent runs without the VPN
     (`apps.qbittorrent.vpn: false`).

   What remains:

   - vpn-check runs only when you run it. Alerts come in M3.
   - When Gluetun restarts on its own, qBittorrent keeps the old, empty network until it
     restarts too. That fails closed, and vpn-check reports it, but `apply` doesn't.
   - The address comparison asks one IP-echo service; one that answers wrongly could hide a
     leak. The checks before it don't depend on that service.

   ### T13. vpn-check tells an outside service your addresses

   Controls today:

   - Only when you run `mediaplane vpn-check`, and never with `--no-egress`.
   - The default service is Cloudflare's trace, by IP address
     (`https://1.1.1.1/cdn-cgi/trace`), so no DNS query goes out. Cloudflare is already
     Gluetun's DNS-over-TLS resolver and one of the services it asks for its own address.
   - `MEDIAPLANE_VPN_CHECK_URL` names another service, which must be http or https.

   What remains:

   - The service learns the VPN's exit address and the host's own address, once per run.
     In the Mediaplane container, the host helper makes the host's request, from the host
     network.
   ```

- [ ] **Step 3: Gluetun's and qBittorrent's READMEs, and Gluetun's catalog comment**

In `catalog/gluetun/README.md`:

1. In "What Mediaplane does today", in the "Your LAN" bullet, change
   `(Slice 3d's end-to-end test checks this)` to `(the kill-switch test checks this)`.
2. Replace the end of the control-server key bullet, from `` `GET /v1/publicip/ip`, and
   nothing else. `` up to, not including, `## Changing it`, with:

   ```markdown
     `GET /v1/publicip/ip`, and nothing else. Requests without the key are refused, and so
     are other routes with it (the kill-switch test checks both). Without the file, Gluetun
     answers anyone on the stack's network.
   - **The kill switch, tested.** qBittorrent has no network but Gluetun's. An end-to-end
     test runs Gluetun against a WireGuard server of its own, through Gluetun's `custom`
     provider, on amd64 and arm64, and checks that:
     - qBittorrent's traffic leaves through the tunnel, from the server's address;
     - with the server stopped, nothing gets out of qBittorrent's network, while an
       ordinary container on the stack's network still reaches the same target;
     - with Gluetun stopped, qBittorrent has nothing but loopback.
   - **`mediaplane vpn-check`** checks the same on your host: qBittorrent's network,
     Gluetun's health, what its control server says (with the key), the route into the
     tunnel, and where qBittorrent's traffic leaves from, compared with this host's address.
     It warns when the control server answers without the key. The
     [VPN down runbook](../../docs/runbooks/vpn-down.md) explains each failure.

   ## Not built yet

   Nothing for Gluetun itself. See the [roadmap](../../docs/plans/m1-roadmap.md).

   ```

3. In "Changing it", add after the `apps.gluetun.env` example:

   ````markdown
   - **A WireGuard server of your own,** or a provider Gluetun doesn't list, goes through
     Gluetun's `custom` provider. Copy the values from the server's WireGuard file: its
     `Endpoint` and `PublicKey` from `[Peer]`, and your `Address`. The kill-switch test runs
     this way.

     ```yaml
     vpn:
       provider: custom
       private_key: { file: secrets/wg.key }
       addresses: 10.66.0.2/32
     apps:
       gluetun:
         env:
           WIREGUARD_ENDPOINT_IP: 203.0.113.10
           WIREGUARD_ENDPOINT_PORT: '51820'
           WIREGUARD_PUBLIC_KEY: the server's public key
     ```
   ````

4. In "Known issues", add as the first bullet:

   ```markdown
   - **Restarting Gluetun on its own leaves qBittorrent without a network.** A container
     joins Gluetun's network when it starts. When Gluetun restarts alone, by hand or after a
     crash, it gets a new network, and qBittorrent keeps the old one, which has nothing but
     loopback. Nothing leaks, but nothing downloads either, and `mediaplane apply` doesn't
     notice: Compose restarts qBittorrent only when it recreates Gluetun. `mediaplane
     vpn-check` does notice. Restart qBittorrent after Gluetun:
     `docker restart mediaplane-qbittorrent-1`.
   ```

In `catalog/gluetun/app.ts`, replace the comment above `controlApiKey` with
`// Mediaplane's key to the control server: vpn-check reads the VPN's status with it.`
(it named Slice 3d as future work).

In `catalog/qbittorrent/README.md`:

1. In "What Mediaplane does today", in the "Behind the VPN" bullet, replace its second and
   last sub-bullets (`it starts only once Gluetun is healthy, …` and `` `stack.yaml` needs a
   `vpn:` block, … ``) so that the list reads:

   ```markdown
     - it starts only once Gluetun is healthy, and Compose restarts it when it recreates
       Gluetun;
     - its web UI is published on Gluetun's service;
     - `stack.yaml` needs a `vpn:` block, or `plan` reports an error;
     - an end-to-end test checks that it has no way out when the VPN is down, against a
       WireGuard server of its own, and `mediaplane vpn-check` checks the same on your host
       (see [Gluetun's README](../gluetun/README.md)). vpn-check runs its probe in
       qBittorrent's own image, as nobody: a throwaway container that writes nothing.
   ```

   ("updates" becomes "recreates": Compose restarts it when it recreates Gluetun, not when
   it only starts a stopped one, as the dev box showed.)
2. In "Not built yet", remove the `**Slice 3d:**` bullet (two lines).
3. In "Known issues", add as the first bullet:

   ```markdown
   - **After Gluetun restarts on its own, qBittorrent has no network.** It keeps the network
     the old Gluetun had, until it restarts too. `mediaplane vpn-check` reports it; see
     [Gluetun's README](../gluetun/README.md).
   ```

- [ ] **Step 4: The install guide, the architecture page, the README and CONTRIBUTING**

In `deploy/README.md`:

1. In "First run", add a last line to the command block:

   ```bash
   mediaplane vpn-check    # with a VPN: qBittorrent gets out only through it
   ```

2. In the "The VPN address" bullet, replace its last sentence
   (`` It is the `Address` line in the WireGuard file your provider gives you. ``) with the
   lines below, which also add a new bullet after it:

   ```markdown
     It is the `Address` line in the WireGuard file your provider gives you, such as
     `10.64.0.2/32`; several go comma-separated, without spaces.
   - **Checking the VPN.** `mediaplane vpn-check` checks that qBittorrent has no network
     but Gluetun's, that the VPN is up, and that qBittorrent's traffic leaves from another
     address than this host's. For that last check it asks Cloudflare
     (`https://1.1.1.1/cdn-cgi/trace`) twice: once from qBittorrent's network, and once
     from the host, through the host helper. `--no-egress` asks no one, and
     `MEDIAPLANE_VPN_CHECK_URL` names another service. It exits 0 on a pass, and 1 on a
     leak or a VPN that is down: the [VPN down runbook](../docs/runbooks/vpn-down.md) says
     what to do.
   ```

3. In "What runs where", change the diagram's last two lines to:

   ```text
   └─ host helper      seconds, during
                       init, plan, apply
                       and vpn-check
   ```

   change `So during \`init\`, \`plan\` and \`apply\` it starts` in the host helper's
   bullet to

   ```markdown
     network, ports, or folders outside its home. So during `init`, `plan`, `apply` and
     `vpn-check` it starts a throwaway container of its own image on the host network, and
     reads them there. That container:
   ```

   and add after the "Mediaplane's network" bullet:

   ```markdown
   - **vpn-check's probe** is a throwaway container of qBittorrent's image, in Gluetun's
     network, as qBittorrent is. That is how `vpn-check` reaches Gluetun and the internet
     from the VPN's side without a route of its own.
   ```

4. In "Troubleshooting", add before the `` `Error response from daemon: Forbidden` `` item:

   ```markdown
   - `VPN down: qBittorrent can't reach the internet`, or
     `LEAK: qBittorrent's traffic does not go through the VPN`

     From `mediaplane vpn-check`. Follow the
     [VPN down runbook](../docs/runbooks/vpn-down.md), which goes by the line marked `DOWN`
     or `LEAK`.

   ```

In `docs/architecture.md`:

1. Replace the intro's `(Slices 1 to 3a). The design describes the whole of M1;` line so
   it reads:

   ```markdown
   This page is a condensed version of the [M1 design](design/m1-engine-cli.md), §3 to §6,
   covering what is built so far (Slices 1 to 3a, and 3d). The design describes the whole
   of M1; this page describes what exists.
   ```

2. In "What runs where", change the diagram's last two lines to

   ```text
   └─ host helper        container
        throwaway, during init,
        plan, apply, vpn-check
   ```

   and in the host helper's bullet, change `So during \`init\`, \`plan\` and \`apply\`, it
   runs` so it reads:

   ```markdown
     network, free ports, devices, or folders outside the home. So during `init`, `plan`,
     `apply` and `vpn-check`, it runs a throwaway container of its own image on the host
     network, which reports what it sees as JSON. That container:
   ```

3. In "The engine", add after the `credentials` bullet:

   ```markdown
   - **vpn** (`packages/engine/src/vpn`): `vpn-check`. It reads the containers, runs a probe
     inside qBittorrent's network, and compares where qBittorrent's traffic and the host's
     leave from (see [`vpn-check`](#vpn-check)).
   ```

4. Add a section before `## Security`:

   ````markdown
   ## `vpn-check`

   `mediaplane vpn-check` checks that qBittorrent reaches the internet only through the
   VPN. It changes nothing.

   ```text
   containers, through Docker
     │ qBittorrent in Gluetun's
     │ network, joined since
     │ Gluetun last started;
     │ Gluetun running, healthy
     ▼
   probe, inside that network
     │ compose run of qbittorrent,
     │ as nobody, key on stdin:
     │ Gluetun's control server,
     │ the route into tun0, and
     │ the IP-echo service
     ▼
   the host's own address
     │ the same service, from the
     │ host (the host helper in
     │ the image)
     ▼
   pass, down or leak
   ```

   - **The probe** is a `compose run` of the `qbittorrent` service, so it starts in
     Gluetun's network namespace, as qBittorrent does. It reaches Gluetun's control server
     on `127.0.0.1:8000` there. So `vpn-check` needs no network route from the Mediaplane
     container, and no Docker API call that `apply` doesn't already make.
   - **The egress check** asks `https://1.1.1.1/cdn-cgi/trace`, or
     `MEDIAPLANE_VPN_CHECK_URL`, from both sides. A leak is the same address on both. No
     answer through the tunnel means the VPN is down. `--no-egress` skips it.
   - **The verdict:** a leak beats down, and down beats a pass. Warnings, such as a control
     server that answers without a key, don't change it. The exit code is 0 only for a pass.

   ````

5. In "What comes next", replace the first bullet (`the VPN's kill-switch test and
   \`vpn-check\` (Slice 3d), then the wiring, app by app (Slices 3b to 7);`) with
   `- the wiring, app by app (Slices 3b to 7);`.

In `README.md`:

1. In the status box, replace the "Works today" bullet with:

   ```markdown
   > - **Works today:** `mediaplane plan` checks a real host and shows exactly what it
   >   would do. `mediaplane apply` then starts the stack and confirms that every app
   >   is healthy. `mediaplane vpn-check` confirms that qBittorrent reaches the internet
   >   only through the VPN. Mediaplane runs in its own hardened container, behind a
   >   Docker socket proxy.
   ```

2. In "What works so far", add after the `credentials` row (`pnpm format` realigns the
   table):

   ```markdown
   | A VPN kill switch, tested against a real WireGuard server, and `vpn-check` | Done |
   ```

3. In "Why not just write the Compose file myself?", replace
   `- qBittorrent routed through the VPN, so it has no network when the VPN is down;` with:

   ```markdown
   - qBittorrent routed through the VPN, so it has no network when the VPN is down, with
     an automated test of that and `mediaplane vpn-check` to confirm it on your host;
   ```

In `CONTRIBUTING.md`, add after the paragraph that ends `because they share host ports.`:

```markdown

The VPN kill-switch test (`test/e2e/vpn.e2e.test.ts`) runs a WireGuard server in a
container, which needs the host's `wireguard` kernel module: run
`sudo modprobe wireguard` once after each boot. CI does this in its end-to-end job. The
test fails, and never skips, without it.
```

- [ ] **Step 5: The spec**

In `docs/design/m1-engine-cli.md`:

1. In the §5.2 table, replace the `vpn-check` row with:

   ```markdown
   | `vpn-check` | Check that qBittorrent reaches the internet only through the VPN: its network, Gluetun's state and the route into the tunnel, then its egress IP against the host's (`--no-egress` skips that) |
   ```

2. In §7.2(6), replace `` - `mediaplane vpn-check` compares qBittorrent's egress IP with the
   host's. `` with:

   ```markdown
      - `mediaplane vpn-check` checks this topology, and compares qBittorrent's egress
        IP with the host's (§11, Slice 3d).
   ```

3. Add at the end of §11:

   ```markdown

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
     The default of asking Cloudflare is the controller's ruling, logged for the owner.
   - **vpn-check needs no route of its own.** Its probe is a `compose run` of the
     `qbittorrent` service, so it starts in Gluetun's network namespace, in qBittorrent's
     own image, as nobody. It reaches Gluetun's control server on `127.0.0.1:8000` there,
     and gets the key on its standard input, never on a command line. It uses only Docker
     API calls that `apply` already makes. So it doesn't depend on how the Mediaplane
     container will reach the apps (Slice 3b), and the socket proxy allows nothing new. In
     the image, the host helper asks for the host's own address.
   - **The runtime runs one-off commands and inspects containers (§3.2).** `run` is the
     `compose run` that the ownership helper's `chown` now uses too. `inspect` reads a
     container's network mode and start time (`GET containers/{id}/json`).
   - **Gluetun started again on its own strands qBittorrent.** qBittorrent keeps the network
     namespace Gluetun had when qBittorrent started. Compose restarts qBittorrent when it
     recreates Gluetun (§6.4), but not when it only starts it again (verified with Compose
     5.5.1), so `apply` doesn't fix it. `vpn-check` reports it from the two start times, and
     the "VPN down" runbook gives the fix. Having `apply` restart qBittorrent is a Slice 3b
     input.
   - **`vpn.addresses` (§4.2)** is one or more IPv4 or IPv6 addresses with a prefix length,
     separated by commas without spaces, as Gluetun's `WIREGUARD_ADDRESSES` takes them.
   ```

- [ ] **Step 6: The roadmap**

In `docs/plans/m1-roadmap.md`:

1. **"Detailed plans so far".** Change the Slice 3a line to end in `(done).`, and add
   after it: `` - Slice 3d: [`m1-s3d-vpn-check.md`](m1-s3d-vpn-check.md). ``
2. **"Things S1 encodes".** Replace the three rows whose last cell is `S3d` with:

   ```markdown
   | Gluetun's built-in health check with `depends_on: service_healthy`. **Verified on 2026-10-10** by `test/e2e/vpn.e2e.test.ts`, against a local WireGuard server: `apply` waits for Gluetun to be healthy, then starts qBittorrent, and both end healthy | S3d (done) |
   | `FIREWALL_OUTBOUND_SUBNETS` accepting a comma-separated list. **Verified on 2026-10-10** by `test/e2e/vpn.e2e.test.ts`: two subnets, given through `apps.gluetun.env`, are both routed in Gluetun's namespace | S3d (done) |
   | qBittorrent `WEBUI_PORT` behaviour inside Gluetun's namespace. **Verified on 2026-10-10** by `test/e2e/vpn.e2e.test.ts`: with `apps.qbittorrent.port: 8090` and `bind: localhost`, the web UI answers on `127.0.0.1:8090` | S3d (done) |
   ```

   (If CI has run them by now, add "on amd64 and arm64 in CI at `<sha>`" to each, as the
   S2b row does.)
3. **"Inputs for later slices from the reviews".**
   - In the intro paragraph, replace `Slice 3a (2026-10-10) added the last three S3 items,`
     with `Slice 3a (2026-10-10) added three S3 items,`, and add at the end of its
     second-last sentence: `Slice 3d (2026-10-10) added the last S3 item and the last S8
     item.` so the paragraph ends:

     ```markdown
     four S8 items. Slice 3a (2026-10-10) added three S3 items, the S3d list, three
     S4 items, two S6 items, an S8 item and an M2 item. Slice 3d (2026-10-10) added the last
     S3 item and the last S8 item. Each slice plan must address the items for that slice.
     ```

   - Add at the end of the S3 list, before `**S3d:**`:

     ```markdown
     - **qBittorrent stranded by a Gluetun started again on its own (S3b).** When Gluetun
       restarts alone, by hand or after a crash, qBittorrent keeps the old, empty network
       namespace. Compose restarts qBittorrent only when it recreates Gluetun, not when it
       starts a stopped one (Compose 5.5.1), so `apply` leaves it stranded and its health
       check still passes on loopback. `vpn-check` reports it (S3d). Make the verify stage's
       VPN topology check (spec §6.4) catch it too, by reusing `vpnCheck` without the egress
       check, and have `plan` restart qBittorrent then.
     ```

   - Change `**S3d:**` to `**S3d:** all of these are in the S3d plan.`
   - In the S8 list, replace the `**Tests:**` bullet and the "Pins outside the catalog"
     list with:

     ```markdown
     - **Tests:** tighten the catalog tag test, and add Renovate. Let
       `test/e2e/deploy.e2e.test.ts` deploy with `deployMediaplane()` from
       `test/e2e/helpers.ts` (S3d), as the VPN test does.
     - **Pins outside the catalog.** Renovate must also bump the images pinned in:
       - `Dockerfile` (`node`, `docker:*-cli`);
       - `deploy/mediaplane.compose.yaml` (`wollomatic/socket-proxy`);
       - `.github/workflows/ci.yml` (Trivy and gitleaks), `.githooks/pre-commit`
         (gitleaks), `test/e2e/helpers.ts` (busybox) and `test/e2e/wireguard.ts` (the
         `lscr.io/linuxserver/wireguard` test server, rebuilt weekly upstream).
     ```

- [ ] **Step 7: Check, and commit**

```bash
pnpm docs:generate
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
node -e '
const fs = require("fs");
for (const f of process.argv.slice(1)) {
  let indent = -1;
  fs.readFileSync(f, "utf8").split("\n").forEach((l, i) => {
    const fence = /^(\s*)```(\S*)/.exec(l);
    if (fence) {
      indent = indent < 0 && fence[2] === "text" ? fence[1].length : -1;
      return;
    }
    if (indent >= 0 && [...l].length - indent > 40) console.log(`${f}:${i + 1}`);
  });
}' docs/architecture.md docs/runbooks/vpn-down.md deploy/README.md README.md
git grep -n -e '```mermaid' -- '*.md' || true
git grep -n -E "arrives in Slice 3d|Slice 3d's end-to-end|\*\*Slice 3d:\*\*" \
  -- '*.md' '*.ts' ':!docs/plans/m1-s*' ':!docs/design' || true
git add README.md CONTRIBUTING.md deploy/README.md catalog docs
git commit -m "docs: the VPN down runbook, vpn-check and the kill-switch test" \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `pnpm docs:generate` writes nothing, every check passes, and the width check
(every line of a `text` block, measured from its fence, within 40 columns) and both
`git grep`s print nothing (`git grep` exits 1 when it finds nothing, hence `|| true`): no
doc still says Slice 3d is to come. The spec is left out of
the last one on purpose: its Slice 3a entry says "Slice 3d's end-to-end test checks
this", which is history, and now true.

---

## Slice 3d completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements.
- [ ] `pnpm test:e2e` leaves no `mediaplane-e2e-*` container, network or image, no host
  helper, and no new volume or `mediaplane-e2e-*` folder (Task 8, Step 3).
- [ ] `deploy/mediaplane.compose.yaml` and the allow-list in `deploy/deploy.test.ts` are
  unchanged: `git diff main -- deploy/mediaplane.compose.yaml` prints nothing, and
  `ENGINE_CALLS` and `OVERRIDE_CALLS` are as they were.
- [ ] By hand, on a scratch home with a working VPN of your own, from source or through the
  image as in `deploy/README.md`: `mediaplane vpn-check` passes and shows two different
  addresses; `--no-egress` passes and asks no one; with the VPN key file emptied and
  `mediaplane apply` run, `vpn-check` ends with `VPN down`. Then bring the stack down
  (`down -v`) and remove the scratch home. (Without a VPN account, the end-to-end test's
  WireGuard server is the stand-in, and this step is the owner's.)
- [ ] No committed file contains a real path, user name, host name or address from this
  machine: `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing
  outside the GitHub URLs.
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B main.. | grep -c Claude-Session` prints `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - whether CI loaded the WireGuard module on both runners (R1), and, if not, that the
    contingency in Task 2 is needed;
  - the logged rulings for the owner to confirm or reverse: `vpn-check` asks Cloudflare
    by default (`--no-egress` to skip);
  - for the owner's manual-steps list: run `sudo modprobe wireguard` on the dev box after
    each boot, before the end-to-end tests; and after restarting Gluetun by hand, restart
    qBittorrent too;
  - the S3b input recorded in the roadmap: a qBittorrent stranded by a Gluetun started
    again on its own, which `apply` doesn't fix.
