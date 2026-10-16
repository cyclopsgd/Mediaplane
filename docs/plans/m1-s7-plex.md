# M1 Slice 7: Plex — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a Plex stack is wired headlessly, except for the single Plex sign-in (success
criterion 2). `mediaplane plex-login` signs you in to plex.tv with its PIN flow and saves
your token. `apply` then claims Plex for your account before its web UI is published,
names it, gives it its Movies and TV Shows libraries, connects Sonarr and Radarr to it,
signs Seerr in with your Plex account before Seerr is published, and links Seerr to Plex.
A nightly job checks it all against the real plex.tv.

**Architecture:**

- **plex.tv through a short-lived helper.** Mediaplane's container has no route out (S3b,
  ADR 0011). Each plex.tv call is one throwaway container of Mediaplane's own image,
  `mediaplane plex-tv`, on Docker's default `bridge` network, which has a route out and
  reaches none of the stack's networks. The request, your token in it, goes on its
  standard input. Run from source, the CLI calls plex.tv itself. The socket proxy allows
  nothing new.
- **`mediaplane plex-login`** uses plex.tv's PIN flow: a link, then a wait, then your
  long-lived token, saved where `plex.token` names a file.
- **Plex is a first-run setup** (S5's bootstrap step, made keyless and ordered in S6). An
  unclaimed Plex lets anyone who reaches it claim it, so it starts unpublished. Its first
  start gets `PLEX_CLAIM` (`Bootstrap.firstStart`), a claim token fetched with your token
  the moment before, through the Compose file on standard input, as a reference to
  Compose's own environment. The setup waits until Plex is claimed, then asks plex.tv
  whose account the token Plex's claim gave it is: it must be yours.
- **Plex's resources** (`plex.server`, `plex.library_movies`, `plex.library_tv`), and the
  arrs' `PlexServer` connections, which share S5's connection code.
- **Seerr on a Plex stack:** `notWiredYet` goes. Seerr's first sign-in is with your Plex
  token, after Plex's setup, and `seerr.media_server_plex` links it to Plex.
- **Logins of your own and web paths:** `login` may be `{ own: 'Plex' }`, and an app may
  have a `webPath` (Plex's is `/web`).
- **Tests:** fakes of plex.tv and Plex built from the probes; an every-PR end-to-end test
  of a Plex that can't claim itself, and of `plex-login` from the image; a nightly job
  with a plex.tv test account's token.

**Tech Stack:** as Slice 6 (Node 24, pnpm 10.15.0, TypeScript 6.0, Zod 4, `yaml` 2,
Commander 15, Vitest 4, Prettier 3, esbuild 0.28.2). No new dependency and no new image.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md), in particular:

- §2.3, success criterion 2 ("Plex has exactly one manual input"), and criterion 3 (a
  second `apply` changes nothing);
- §5 steps 4, 8 and 9, and §5.2 (`plan` changes nothing in the stack, but for its
  documented marks; `plex-login`'s row);
- §6.1, Plex's and Seerr's rows; §6.2, the media-server rows, Plex's libraries and the
  ordering; §6.3 (secrets verified, never compared); §6.4 (bootstrap before publish);
- §7 (security), §8.1 ("Plex": the nightly job), §9 (the documentation set), §10 (Plex's
  risks), §11.

Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md): the S7 row ("`plex-login`
(the plex.tv PIN flow), the Plex claim through a plex.tv helper, its libraries, the arr →
Plex connections, Seerr's sign-in with the Plex token, and a nightly Plex CI job"; it
proves success criterion 2), the four S7 items in "Inputs for later slices from the
reviews", and the S3b decision on the private wiring network ("The plex.tv calls go
through a short-lived helper in S7"); ADR 0008 and ADR 0011.

## How to read the code in this plan

- **A new file is given whole** (`Create`). Write it as shown.
- **A changed file is given as a `diff` block** (`Change`): the exact `git diff -U1`
  output, with one line of context. Save it to a file and run `git apply <file>` from the
  repo root, or make the same edit by hand. Apply a task's blocks in the order given.
- **Generated files are never edited by hand.** A step that changes a catalog fact, a
  schema description or the CLI says to run `pnpm docs:generate`, and names what it
  rewrites.
- Every block was applied in order to a fresh worktree at `e83f86f`, and each task's
  tests failed before its implementation and passed after it (see the completion
  checklist).

## Global Constraints

Everything in the Slice 1, 2a, 2b, 2c, 3a, 3d, 3b, 3c, 4, 5 and 6 Global Constraints still
holds (`docs/plans/m1-s1-pure-core.md`, `m1-s2a-plan-against-docker.md`, `m1-s2b-apply.md`,
`m1-s2c-packaging.md`, `m1-s3a-admin-and-seed-files.md`, `m1-s3d-vpn-check.md`,
`m1-s3b-wiring.md`, `m1-s3c-download-path.md`, `m1-s4-indexers.md`, `m1-s5-jellyfin.md`,
`m1-s6-requests.md`):

- fake values only, because the repo is public, and nothing personal: no real paths, user
  names, addresses, hostnames, tokens or plex.tv ids in committed files. Test secrets look
  like `fake-plex-token-0001` or `'0'.repeat(32)`. Addresses in tests and docs come from
  the documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), private
  ranges, or `fd00::/8`;
- neutral framing: no piracy-flavoured language or examples (spec §1.4(6));
- determinism, and `compare` instead of `localeCompare`;
- Prettier `printWidth: 90`;
- `plan` writes no file, and changes nothing in the apps but for its documented marks. Its
  one change to Docker is still joining the wiring network from the image (S3b decision 2);
- Docker is reached only through the `Runtime` (the end-to-end tests may call `docker`
  themselves);
- unit tests never need Docker, except the spawned tests in
  `packages/cli/src/main.test.ts`, and never reach a real app or plex.tv: HTTP tests use
  `fakeHttpApp`, `fakeStackApis` or `fakePlexTv` on `127.0.0.1`;
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
- the integration contract (S3b to S6): `observe`, `create`, `update`, `requires`,
  `after`, `resolve` and `verify`; resource records hold names only; a resource that
  requires a failed or skipped one is `skipped`; a resource may `require` another app's
  only when that app comes before it through `after` (the catalog invariant test);
- the shared Servarr provider (`catalog/_shared/servarr-provider.ts`, S4) stays the one way
  to wire a Servarr provider, and the arrs' media-server connections share one spec
  (`catalog/_shared/servarr-connection.ts`);
- bootstrap before publish (S5, S6): `plan` never runs a setup; an app whose setup is open
  is never published, while a setup waits either; the re-check before publishing stays;
  a setup that makes no key and fails in any way never publishes its app;
- keys go only to the stack's own address for an app (S6), never to a host, port, URL
  base or TLS setting read from an app;
- never push.

The spec's exact values for this slice, verbatim:

- §2.3, criterion 2: "**Plex has exactly one manual input.** The Plex path is identical
  except that the user supplies a Plex token."
- §5.2: "`plex-login` | Run the plex.tv PIN flow and save the token to
  `secrets/plex-token`".
- §6.1, Plex: "User-provided token from **`mediaplane plex-login`**, which runs the
  plex.tv PIN flow (prints a link, then polls until the user has signed in). Uses the
  long-lived legacy token, not the 7-day JWT"; "A claim token is fetched from plex.tv at
  apply time using the user's token, then passed as `PLEX_CLAIM` on first start, so the
  4-minute claim expiry is never a problem"; "The one unavoidable interactive step. The
  M2 wizard reuses the same flow".
- §6.1, Seerr: "Mediaplane signs in with `POST /api/v1/auth/jellyfin` as the Jellyfin
  admin it created, or with `POST /api/v1/auth/plex` and the user's token."
- §6.1: "Jellyfin, Plex and Seerr always require login, because they have real user
  accounts."
- §6.2: "Sonarr / Radarr → Jellyfin or Plex | Connection (`MediaBrowser` / `PlexServer`)
  that updates the library on import | host, port, apiKey / authToken, updateLibrary |
  `POST /notification/test`"; "Plex | Libraries Movies and TV Shows | name, type,
  location | —"; "The `after` relationships give this order: qBittorrent and
  Jellyfin/Plex, then Sonarr and Radarr, then Prowlarr, then Seerr".
- §6.3: "Secrets are verified, never compared."
- §6.4: "These start first with **no published ports**. Mediaplane completes setup over
  the internal Docker network, then re-renders with ports and recreates the container.
  There is never a window in which a LAN client could claim the admin account."
- §8.1: "Plex paths run in a nightly job that uses a token stored as a GitHub secret,
  which is never exposed to fork PRs".
- §10: "`plex-login` stores the legacy token. A token-refresh path is designed in if the
  legacy flow is withdrawn. Nightly Plex CI detects breakage".

These are added or restated for this slice:

- **Secrets never appear** in diagnostics, errors, change records,
  `state/resources.json`, logs, human or JSON output, command lines, `compose.yaml`,
  `.env`, the public CI log or end-to-end failure messages. This slice adds:
  - **your Plex token**, a user secret read once per run, sent only in Plex's
    `X-Plex-Token` header once Plex is shown to be yours, in request bodies to the
    arrs and Seerr, and to plex.tv. Of the secrets you give, only an app's key reaches
    setups and resources; the VPN key is only redacted;
  - **claim tokens**, fetched by the `apply` that first starts Plex, passed to Compose
    through its environment, never in a file;
  - **Plex's own token** (`PlexOnlineToken` in its `Preferences.xml`), read only to ask
    plex.tv whose it is, never kept;
  - **Seerr's session cookie** from its Plex sign-in, and every key Seerr shows;
  - end-to-end checks compare plex.tv account ids or yes-or-no facts, never a token, and
    the nightly job hides each value made from the token with `::add-mask::`.
- **No new socket-proxy permission.** `deploy/mediaplane.compose.yaml` and
  `deploy/deploy.test.ts` don't change.
- **`plan` never calls plex.tv,** never claims Plex, and never signs Seerr in.
- **plex.tv in tests.** Unit tests never reach the real plex.tv. Three end-to-end tests
  do: the deploy test asks it for one PIN, which needs no account, and passes when
  plex.tv is down too; the every-PR Plex test's real Plex image sends the fake plex.tv's
  claim token to the real plex.tv, which refuses it, with no account involved; and the
  nightly job uses the test account's token.
- **Docker and Compose.** CI runs Docker 28 with Compose v2.38.2; the dev box runs Docker
  29.8 with Compose 5.5.1; the image bundles Compose 5.5.1. This slice adds no Compose
  flag; Compose now gets variables in its environment for the file on its standard input.
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
  - Short, plain sentences; lists rather than wide tables; no internal jargon (no
    "controller", "ruling" or decision numbers in public docs).
  - Diagrams are plain-text `text` blocks no wider than 40 columns, never Mermaid,
    because Mermaid doesn't render in the GitHub mobile app.
  - Generated files carry a "generated, do not edit" line and are never edited by hand.

## Decisions taken in this plan

The spec, the roadmap and the reviews leave these open. Each is marked `Decision:` where
it is applied. The ones to look at first are marked **(check)**. Every fact about an app
or plex.tv below was probed while writing this plan, on real Docker (29.8, Compose 5.5.1,
aarch64), with the pinned images (Plex `1.43.4.10903-e5521bd8c-ls327`; Seerr 3.5.0;
Sonarr 4.0.20; Radarr 6.4.4), against plex.tv with a test account kept for it, unless it
says it was read from Seerr's own code in the image (`/app/dist`). Every server a probe
claimed was removed from the test account afterwards.

1. **(check) Plex is a first-run setup, unpublished until it is claimed** (Task 3; §6.4).
   Probed, on a Plex that has just started, unclaimed:
   - reached at an address (`Host: 127.0.0.1:32400`, as a LAN client reaches it), it
     answers its whole admin API with no token: `GET /:/prefs`, `POST /library/sections`;
     by a name (`Host: plex:32400`), 401, its guard against DNS rebinding;
   - `POST /myplex/claim?token=<claim>` with a claim token of another plex.tv account
     answered 200, and Plex was that account's from then on.

   So anyone on the LAN who reaches an unclaimed Plex owns it: §6.4's "anonymous
   first-run endpoints" include Plex. It gets a `bootstrap`, as Jellyfin and Seerr have,
   and starts with no published port. Its setup makes no key (Plex's key is your token,
   which you give), so it is keyless, as Seerr's is (S6): it counts as done only when its
   file says so and `setUp` in `state/secrets.json` names it. Its file is
   `Preferences.xml`, which holds `PlexOnlineToken` once Plex is claimed (probed: written
   0600, as the stack's `user:`). The claimed-setup rule holds: a failure of a keyless
   setup never publishes its app.
2. **(check) The claim token goes in `PLEX_CLAIM`, through Compose's environment, on the
   unpublished start only** (Task 3; §6.1). §6.1 says "passed as `PLEX_CLAIM` on first
   start", and the image's own init trades it at plex.tv before Plex starts for good
   (probed: claimed about 20 seconds after `up`). A new `Bootstrap.firstStart` gives the
   start step's `up` the variables an unpublished app's first start needs. The start step
   fetches the claim token the moment before `up` (it lasts four minutes, and works once),
   only for an app the plan starts unpublished whose setup isn't done. It never reaches a
   file: the extra Compose file on standard input (S5) says
   `PLEX_CLAIM: "${MP_START_PLEX_PLEX_CLAIM}"`, and Compose takes the value from its own
   environment, which the runtime gives it (probed on Compose 5.5.1 and 2.38.2). That is
   the secret-reference pattern of `.env`, without the file. The publishing `up` doesn't
   pass it, so the container that publishes Plex is made without it.
   - What remains: Plex's unpublished container holds the claim token in its
     environment, which `docker inspect` shows to whoever has Docker access, until the
     publishing `up` recreates it. By then it is spent: one use, four minutes. The other
     way, Mediaplane sending `POST /myplex/claim` itself over the wiring network, would
     keep it out of the container, but isn't what §6.1 says; not taken.
   - The claim token is fetched first in the start step, before Mediaplane leaves the
     wiring network or stops the VPN's guests, so a failure changes nothing. Without
     your token, or without a claim token (plex.tv refused your token, or didn't
     answer), the step fails with what to do, and first stops each running app it was
     for (`runtime.stop`, which the proxy allows): a Plex whose setup isn't done isn't
     shown to be yours, and must not stay published, as one an `apply` before this
     slice published unclaimed would (S6's README let it be).
3. **(check) Whose Plex it is: plex.tv's answer for the token Plex's claim gave it**
   (Task 3). The review rule: an answer the app's admin can shape must not decide
   ownership. Probed:
   - Plex's admin can change Plex's machine identifier: `PUT /:/prefs?MachineIdentifier=…`
     answered 200, and `/identity` said the new one. So a check of plex.tv's list of your
     servers by machine identifier (this plan's first draft) can be fooled: whoever claims
     Plex first sets the identifier of a Plex of yours, which `/identity` shows anyone who
     reaches that Plex. It is not used.
   - `GET /api/v2/user` with Plex's own token, from `PlexOnlineToken`, answered the
     account that claimed Plex (the same id as for your token); once the server was
     removed from that account, 401.

   So the setup waits until `/identity` says `claimed`, reads `PlexOnlineToken` from
   `Preferences.xml`, and asks plex.tv whose account it is, and whose yours is. Plex can
   hold a token of your account only through a claim token of yours. Not the same, or
   Plex's token refused, is claimed (`auth`). Fail closed: plex.tv unanswered (a timeout,
   a 5xx, a 429, no connection) is `unsure`, and so is a claimed Plex whose file holds no
   token; the file unreadable, or your token refused, is `rejected`. Every one keeps Plex
   unpublished. Each has a test, the machine-identifier trick among them.
   - Until then, Plex never gets your token: `/identity` needs none, and the setup asks
     it without (`AppApi.until`'s `anonymous`), in `open`, the claim wait and the
     re-check before publishing. A test checks that no request of the setup's carries
     it before plex.tv has said Plex is yours.
4. **The setup waits for the claim** (Task 3). Probed: with no `Preferences.xml`, the
   image starts Plex once for its config, unclaimed, and the container can be healthy
   then; after the claim, Plex restarts and says `claimed: false` for a moment. So the
   setup asks `/identity` until it says `claimed`, for as long as `apply` waits for an
   app (`AppApi.until`, new). A Plex that doesn't claim itself in that time stays
   unpublished: its claim token ran out, or it couldn't reach plex.tv, which its log
   says. The next `apply` starts it unpublished again, with a new claim token.
5. **(check) Safe remedies first for a Plex claimed by another account** (Task 3;
   `Bootstrap.claimedHint`). In order: if that account is yours too, `plex-login` as it;
   or, keeping what Plex holds, stop it, remove every `PlexOnline*` attribute from its
   `Preferences.xml`, and `apply` again, which claims it for you (probed: it kept its
   libraries and its machine identifier, and was claimed again); last, only if you need
   nothing it holds, start it afresh. Seerr's remedies move from the engine into its own
   `claimedHint`, the engine keeping a plain fallback.
6. **(check) The plex.tv helper** (Task 1; ADR 0012, new). Mediaplane's container is on
   two internal networks, so it has no route out (ADR 0011), and the allow-list must not
   grow (ADR 0008). Weighed, by probe:
   - the host helper's host network reaches every Docker network on the host, the
     stack's wiring network included: a helper there could call the apps;
   - the stack's own network has every app on it, and doesn't exist before the first
     start;
   - Docker's default `bridge` network has a route out, and reached neither a container
     on an internal network nor one on another bridge network.

   So each call is `docker run --rm --interactive --init --pull never --network bridge
   --user <uid>:<gid> --cap-drop ALL --security-opt no-new-privileges --read-only --label
   io.mediaplane.helper=plex-tv --entrypoint mediaplane <image> plex-tv`: no mount, no
   socket, no stack network. For the token, weighed: in the helper's environment,
   `docker inspect` shows it as long as the container exists; in a mounted file, it needs
   a host mount and a file written with it; on standard input, it is on no command line,
   in no setting and in no file. It goes on standard input, as one line of JSON
   (`mediaplane.plex-tv/v1`), and the answer comes back as one line on standard output.
   The helper takes four strict requests (a PIN, the wait for its sign-in, a claim token,
   the account a token is of), and fixes plex.tv's address. A run's time limit covers
   the client's own tries inside it: three of 30 seconds, 5 and 15 seconds between them,
   and a minute for the container, 170 seconds (the wait for a sign-in, its seconds
   more). A helper that runs out of time is `PlexTvError` `unreachable`, unsure, as the
   client inside would have said. `docker run -i` uses
   `create`, `attach`, `start` and `wait`, which the allow-list has for the host helper:
   the deploy end-to-end test runs `plex-login` from the image, through the proxy (probed
   first with the allow-list as it is).
7. **(check) From source, the CLI calls plex.tv itself** (Task 1). ADR 0011 keeps
   Mediaplane's container offline; it says nothing against the host's own route, which
   source runs already use (vpn-check's host side asks the IP-echo service from the
   host). So `defaultDeps` gives
   `plexTvClient()` from source and `helperPlexTv()` in the image. The client has an
   HTTPS agent of its own, so a proxy from the environment never sees your token.
8. **The plex.tv client** (Task 1). Each call has a 30-second timeout and reads at most
   1 MiB. A GET that plex.tv didn't answer, failed (5xx) or was asked too often for (429)
   is asked twice more, after 5 then 15 seconds; a POST (a PIN) is sent once. Its
   messages name the method and path, never a query or a value, and every token is
   redacted. Its calls carry the product `Mediaplane` and the fixed client id
   `mediaplane`, which add no device to your account (probed: a call with no client id,
   or another, made none either).
9. **(check) A 429 counts as "couldn't tell"** (Tasks 1, 3). The reviews' rule keeps
   "unsure" to a timeout, a 5xx or no connection. plex.tv's 429 is plex.tv saying "later",
   not an answer an app's admin can shape, and the setup fails closed either way: Plex
   stays unpublished. "Run apply again" is the right advice for it, where "plex.tv refused
   your token" would not be. This departs from the rule's wording, not its aim (roadmap
   S9 item).
10. **(check) `plex-login`** (Task 2; §5.2, §6.1, §10). Probed:
    - `POST /api/v2/pins?strong=true` answers 201 with a 25-character code that lasts
      1800 seconds (a PIN without `strong` has 4 characters and 900 seconds), and
      `GET /api/v2/pins/<id>` gives `authToken: null` until someone signs in;
    - only the client id that made the PIN can read it: another gets 404 ("Code not found
      or expired").

    So each sign-in has a client id of its own, `mediaplane-<uuid>`, with the product
    `Mediaplane`; the link is `https://app.plex.tv/auth#?clientID=…&code=…&context[device][product]=Mediaplane`;
    the wait asks every two seconds, as long as the PIN lasts or `--timeout` seconds (1
    to 1800). The token the PIN gives is the account's long-lived one: the 7-day JWT
    needs the device to register a key pair, which Mediaplane doesn't (read in plex.tv's
    developer documentation, not probed: the test account's token came from that flow).
    - A saved token plex.tv still takes (`GET /api/v2/user`) is kept, and nothing opens,
      unless `--force`; one it refuses (401) is replaced.
    - Nobody signed in in time, or the PIN ran out: exit 1, saying to run it again for a
      new link. plex.tv unreachable: exit 1, saying so.
    - A `plex.token` read from the environment is refused: there is nowhere to save it.
    - It writes the token 0600, never half-written, makes `secrets/` 0700, prints only
      the link (to stderr with `--json`) and never the token.
11. **`plan` never calls plex.tv** (Tasks 3, 5; §5.2). A claim token works once and
    lasts four minutes, so only the `apply` that starts Plex can use one, and whose a
    Plex or a Seerr is matters only to the setup, which `plan` never runs. `plan` lists
    Plex (and Seerr) under `First-run setup:`, and checks Plex's key, your token, with
    Plex's own `/library/sections`, which Plex checks with plex.tv itself.
12. **(check) A new mark of `plan`'s** (Task 4; §5.2). Probed: the first test of an arr's
    connection to Plex lists the arr among Plex's devices (Settings, Authorized Devices),
    as a test from the arr's web UI does. A test that fails leaves a failure in the arr's
    status of the connection, as for Jellyfin's. The docs that say what `plan` changes
    name it.
13. **Plex's name** (Task 4). Probed: a new Plex's `FriendlyName` is empty, so it shows
    its container's hostname, which Docker makes random; `PUT /:/prefs?FriendlyName=…`
    sets it, with no restart; an unknown preference is 400. So `plex.server` manages
    `name`: `Mediaplane`, or `apps.plex.server_name` (a new option, 1 to 64 characters),
    so it can't be taken for another Plex of yours. Mediaplane never calls another Plex.
14. **(check) Remote access, and the networks allowed without auth, are never set**
    (Task 4). Probed defaults: remote access (`PublishServerOnPlexOnlineKey`) off, and
    `allowedNetworks` empty. Mediaplane sets neither, so no network may skip Plex's
    sign-in, and Plex asks for no port on your router. Plex's relay (`RelayEnabled`) is
    on by default: through it, the accounts that may use your Plex reach it from outside.
    Mediaplane leaves it as Plex sets it, and the threat model says how to turn it off.
    The owner may prefer it off.
    - Probed: while Plex is unclaimed, anyone who reaches it at an address can set
      `allowedNetworks` over `PUT /:/prefs` (200, no token); `GET /:/prefs` reads it back
      as a `text` setting, `''` by default; and a value set then survives the claim, in
      Plex's answer and in `Preferences.xml`. So, once plex.tv has said Plex is yours,
      and before its setup reports done (so before its first publish), the setup reads
      Plex's preferences and requires `allowedNetworks` to be empty. Otherwise Plex stays
      unpublished (`rejected`), and the message names the setting and the remedy: clear
      it in `Preferences.xml` while Plex is stopped, then `apply`. It is checked in the
      setup only, never on later applies, so one you set after the publish, on purpose,
      is left alone. Remote access gives no access without a sign-in, so the threat
      model only names it (T16).
15. **Plex's libraries** (Task 4; §6.2). Probed on the pinned image: `POST
    /library/sections` needs `type`, `agent`, `scanner` and `language` (400 without), and
    takes a missing folder and a duplicate name; Plex's web UI gives a new library
    `tv.plex.agents.movie` and `Plex Movie`, or `tv.plex.agents.series` and `Plex TV
    Series`; `PUT /library/sections/<key>` needs the agent, replaces the locations, and
    refuses another type (400). So `Movies` and `TV Shows` are made with those, in
    `en-US`, on `/data/media/movies` and `/data/media/tv`. A library is known by name;
    one of the other kind is refused with what to do. Probed by the nightly test: Plex
    refuses a new library for a few seconds after it starts (400, "the server is still
    starting up"), while `/identity` says `startState`. So an app's API may say when it
    has started (`ApiSpec.started`), and the wire step waits for it.
16. **(check) The arrs' `PlexServer` connections share S5's code** (Task 4; §6.2).
    `catalog/_shared/servarr-connection.ts` becomes one spec for both media servers
    (`servarrMediaServer`), with `servarrJellyfin` and `servarrPlex`. Probed:
    - the arr's test passes with your token or with Plex's own, and refuses a wrong one
      (400, `AuthToken: Authentication Token is invalid`); an unknown host is `Host:
      Unable to connect to Plex Media Server`;
    - it needs a Plex library of the arr's kind (`At least one TV library is required`,
      or `Movie`, found by the nightly test), so each connection requires that library,
      and `plex.server`.

    The token is yours, `plex.token`: it is the stack's key for Plex, and Plex's own
    would have to be read from its appdata. It is checked with the arr's test, never
    compared. A connection held with TLS or a URL base is observed as the URL the arr
    calls, so it reads as moved, and the update sends `useSsl: false` and `urlBase: ''`:
    your token goes only to `plex:32400`. That now holds for the Jellyfin connection too
    (a change in behaviour: S5 compared the host only).
17. **(check) Seerr's Plex sign-in is a first-run setup after Plex's** (Task 5; §6.1).
    Probed on Seerr 3.5: before its first user, `POST /api/v1/auth/plex` with any
    account's token makes that account Seerr's admin (`id: 1`), and sets Plex as its media
    server type (`mediaServerType: 1`); a token plex.tv refuses is 500 ("Unable to
    authenticate."); after it, another account is 403. So Seerr's setup, on a Plex stack,
    signs in with your token, after Plex's setup (Seerr's integration comes after
    Plex's), and signs out at once. A Seerr set up already is Mediaplane's only when its
    admin's `plexId` (`GET /api/v1/auth/me`) is the id plex.tv gives for your token, and
    its Plex (`GET /api/v1/settings/plex`) is unset or the stack's without TLS; it is
    asked with Seerr's key, and never signed in to, which would hand your token to
    whoever set it up. Seerr's code sets `plexId` only from a sign-in with that account's
    token, or by linking an account with its token (read in `/app/dist`), so Seerr's
    admin can't shape it without your token. Unanswered questions fail closed, as on a
    Jellyfin stack.
18. **(check) Seerr's Plex link is a resource of its own, `seerr.media_server_plex`**
    (Task 5; §6.2). A resource's name can't change with the stack, and its fields differ
    from Jellyfin's: Seerr reaches Plex at `http(s)://<ip>:<port>`, with no URL base
    (probed), with its admin's token, so the link holds no secret of Mediaplane's.
    Probed: `POST /api/v1/settings/plex` saves `ip`, `port` and `useSsl` only once Seerr
    reached Plex there, and changes Seerr's settings in memory even when it fails; the
    libraries are synced (`POST …/plex/library/sync`) and enabled by id. It requires
    `plex.server` and both libraries. Seerr keeps the token it signed in with, so a new
    token from `plex-login` doesn't reach it (roadmap S8 item).
19. **Logins of your own, and web paths** (Task 5; §6.1). `AppLoginKind` is `'shared'`,
    `{ own: string }` or `{ comingIn: string }`, and `login` may be a function of the
    stack: Plex's is `{ own: 'Plex' }`, and Seerr's is too on a Plex stack. `credentials`
    prints "(sign in with your own Plex account)"; its JSON gains `login: 'own'` and
    `account`, which is additive within `mediaplane.credentials/v1`. `webPath` is added to
    each URL: Plex's is `/web`. `notWiredYet` goes, with the resolver's handling of it.
20. **(check) The every-PR end-to-end test runs without a token** (Task 6; §8.1). A real
    Plex trades a claim token only at the real plex.tv, so without the test account's
    token it can never be claimed. So the every-PR test runs a Plex stack against a fake
    plex.tv whose claim tokens the real Plex can't use: Plex starts unpublished, never
    claims itself, and `apply` fails at its setup with Plex still unpublished, which is
    the guarantee that matters most. Plex's image sends that claim token to the real
    plex.tv, which refuses it: no account is involved. The deploy test runs `plex-login`
    from the image, through the proxy, against the real plex.tv: one PIN, which needs no
    account, then a 4-second timeout, and no helper left behind. A plex.tv that is down,
    or refuses the PIN, gives "couldn't reach plex.tv" from inside the helper instead,
    which takes the same path: the test accepts either, checks the link only when a PIN
    was made, and an outage fails no pull request.
21. **(check) The nightly Plex job** (Task 6; §8.1). `.github/workflows/plex.yml`, on
    `main`: on a schedule, or by hand, by a maintainer, only in this repository, never
    for a pull request, so a fork never sees the secret. A dispatch runs the chosen
    branch's copy of the file, so the job checks `github.ref == 'refs/heads/main'` too;
    the real control is a GitHub environment limited to `main` holding `PLEX_TOKEN`
    (roadmap S9 item, for the owner). Without `PLEX_TOKEN` it does nothing. The secret is in the
    environment of the two steps that read it only, not of the install, and goes to a
    0600 file, never on a command line. The test claims a real Plex with the test
    account, wires the stack, checks each link, and hides each value it makes from the
    token (claim tokens, Plex's own token) with `::add-mask::`, as GitHub hides only the
    secret itself. It notes each server as soon as it knows it, and a last step that runs
    whatever happened removes them from the account: `DELETE /devices/<id>.xml` answered
    200 and the server was gone (probed; `DELETE /api/v2/devices/<id>` is 404). It runs on
    amd64 and arm64: the runners are free for a public repository, the test takes about
    four minutes (214 s on the dev box), and Plex's image is published for both.
22. **Fakes no kinder than the real ones** (Tasks 1, 3, 4, 5). The fake plex.tv answers
    the PIN, claim, user and refusal shapes probed (401 bodies, 404 for another client's
    PIN), and takes a server's own token only for `GET /api/v2/user`. The fake Plex
    answers anyone at `/identity`, refuses everything else without a token it takes (401,
    an HTML page), says it is starting and unclaimed for as long as a test says, refuses
    a library while starting, without an agent, or of another type, and writes
    `Preferences.xml` as Plex does. The fake arrs' Plex test refuses as the arrs do, the
    missing library included. The fake Seerr signs in through Plex as Seerr does, 500 for
    a refused token and 403 for a second account.
23. **No new socket-proxy permission** (all tasks; ADR 0008). The helper uses the host
    helper's calls (decision 6), and Plex's setup is the same unpublished `up` and
    recreate as Jellyfin's. `deploy/mediaplane.compose.yaml` and `deploy/deploy.test.ts`
    don't change.
24. **The docs** (Task 7). The §9 set for what Tasks 1 to 6 built: the wiring-failed
    runbook; the architecture; the threat model (new assets, the helper, T2, T4, T5,
    T14, T16); ADR 0012, and ADR 0011's and ADR 0006's consequences; the README; Plex's,
    Seerr's,
    Sonarr's and Radarr's READMEs; the deploy guide, with `plex-login`; the spec (a "Slice
    7" entry in §11, and §5.2's `plan` and `plex-login` rows); the roadmap (S7 done, five
    S8 items and four S9 items). The CLI reference is generated in Task 2.
    `docs/how-its-built.md` states no fact this slice changes, so it stays.
25. **Only an app's key reaches setups and resources** (Task 3; §6.3). `userSecrets` reads
    every secret you give, so that each is redacted, the VPN key too. But `stackKeys`
    puts into `keys` (a setup's context, each resource's `desired`, and `plan`'s) only
    those an app's API takes as its key (`api.key.secret`): Plex's token today. The VPN
    key never reaches a setup or a resource.
26. **One redaction map** (Task 1). `redactionValues` moves to `util/redact`, so the
    plex.tv client and helper use it rather than build their own; `integrations/wiring`
    re-exports it, so its callers don't change.

## File structure (new and changed in this slice)

`packages/engine/src/`:

- `plextv/client.ts` (+test), new: the plex.tv client (`plexTvClient`), `PlexTv`,
  `PlexTvError`, `PlexPin`, `signInLink`, `newClientId`, `NO_PLEX_TV`.
- `plextv/helper.ts` (+test), new: the plex.tv helper's request and answer
  (`answerPlexTvRequest`), and `helperPlexTv`, which runs it through the runtime.
- `runtime/types.ts`, `runtime/docker.ts` (+test): `Runtime.plexTvHelper`; `up`'s start
  variables, passed to Compose in its environment (`startEnvName`).
- `catalog/types.ts`: `BootstrapContext`, `Bootstrap.firstStart`, `Bootstrap.claimedHint`,
  `run`'s context; `ApiSpec.started`; `AppLoginKind` with `{ own }`, `login` as a function,
  `webPath`; `notWiredYet` removed.
- `http/client.ts` (+test): the `x-plex-token` key scheme; `AppApi.until`, with
  `anonymous`.
- `secrets/values.ts` (+test): `userSecrets`, and `stackKeys`, which keys only an app's
  API key of yours.
- `util/redact.ts`: `redactionValues`, moved from `integrations/wiring.ts`.
- `apply/apply.ts`, `apply/bootstrap.ts` (+test): `ApplyOptions.plexTv`; the start step's
  `startVariables` (`firstStartEnv`, first, and a stop of what it was for when it
  fails); the bootstrap step's context; a keyless claimed setup's hint.
- `plan/plan.ts`, `integrations/wire.ts`, `integrations/wiring.ts` (+test): your secrets
  as keys; `started`.
- `credentials.ts` (+test): your own logins, and web paths.
- `resolver/resolve.ts` (+test): `notWiredYet` removed.
- `config/secrets.ts`, `config/schema.ts`: `plex-login` in the missing token's hint, and
  `plex.token`'s description.
- `testing/`: `plextv.ts`, new (`fakePlexTv`, `freshPlexTv`, `answerPlexTv`,
  `FAKE_PLEX_ACCOUNT`); `plex.ts`, new (`fakePlex`, `freshPlex`, `claimFakePlex`,
  `testPlexConnection`, `plexTakes`, `FAKE_SERVER_TOKEN`, `PLEX_PREFERENCES`);
  `fakes.ts` (+test), `wiring.ts`, `bootstrap.ts`, `jellyfin.ts`, `providers.ts`,
  `seerr.ts` (+test), `index.ts`.

`packages/cli/src/`:

- `plex-login.ts` (+test), new; `run.ts` (+test): `plex-login`, the hidden `plex-tv`
  command, `Io.stdin`, `CliDeps.plexTv` and `plexTvDirect`; `main.ts`: standard input;
  `init.ts` (+test): the next step names `plex-login`; `credentials.ts` (+test).

`catalog/`:

- `plex/bootstrap.ts` (+test), `plex/integration.ts` (+test), new; `plex/app.ts`: its
  API, setup, integration, `server_name`, login and web path.
- `_shared/servarr-connection.ts` (+test): one spec for Jellyfin and Plex.
- `sonarr/integration.ts`, `radarr/integration.ts`: their Plex connection.
- `seerr/plex.ts`, new; `seerr/bootstrap.ts`, `seerr/integration.ts`, `seerr/app.ts`
  (+tests): the Plex sign-in, `seerr.media_server_plex`, its login.
- `catalog.test.ts`, `render.test.ts`, `jellyfin/integration.test.ts`: what changes.

Elsewhere:

- `scripts/docs/catalog-facts.ts` (+test): the `x-plex-token` scheme, `notWiredYet` gone.
- `test/e2e/plex.e2e.test.ts`, `plex-account.ts`, `plex-cleanup.ts`, new;
  `test/e2e/deploy.e2e.test.ts`; `.github/workflows/plex.yml`, new.
- docs: ADR 0012, new; the runbook, the architecture, the threat model, ADR 0011, the
  READMEs, the deploy guide, the spec and the roadmap; the generated CLI and
  `stack.yaml` references and the apps' facts.

**Tasks:**

1. plex.tv from source, and through a short-lived helper on the default bridge in the
   image.
2. `mediaplane plex-login`.
3. Plex claimed for your account before it is published.
4. Plex's name and libraries, and the arrs' connections to it.
5. Seerr signed in with your Plex account before it is published, and linked to Plex;
   logins of your own, and Plex's web path.
6. End-to-end: every PR without a token, and the nightly Plex job.
7. Docs.

**Out of scope here:**

- **Drift and Keep mine** for Plex's resources, the arrs' Plex connections and Seerr's
  Plex link; giving Seerr a new Plex token: Slice 8 (roadmap S8 items).
- **The M2 wizard's "Sign in with Plex"**, which reuses `plex-login`'s flow (§6.1): M2.
- **A token-refresh path** for the day plex.tv withdraws the legacy token (§10): the
  nightly job is what detects it.
- **Setting the `PLEX_TOKEN` secret** in the repository: the owner (roadmap S9 item).

---

### Task 1: plex.tv from source, and through a short-lived helper on the default bridge in the image

Every later task asks plex.tv through `PlexTv`. This task builds it: the client, the
helper that runs it in a throwaway container of Mediaplane's image, and a fake plex.tv
that answers as the real one did when probed.

Decision: the helper runs on Docker's default bridge network, with the request on its
standard input, and no mount, socket or stack network (decision 6).
Decision: from source, the CLI calls plex.tv itself (decision 7).
Decision: the client's timeouts, retries, client id and redaction (decisions 8 and 9).
Decision: the fake plex.tv answers the shapes probed, no kinder (decision 22).

**Files:**
- Create: `packages/engine/src/plextv/client.ts`, `packages/engine/src/plextv/helper.ts`,
  `packages/engine/src/testing/plextv.ts`
- Modify: `packages/engine/src/runtime/types.ts`, `packages/engine/src/runtime/docker.ts`,
  `packages/engine/src/testing/fakes.ts`, `packages/engine/src/testing/index.ts`,
  `packages/engine/src/index.ts`, `packages/engine/src/util/redact.ts`,
  `packages/engine/src/integrations/wiring.ts`, `packages/cli/src/run.ts`,
  `packages/cli/src/main.ts`
- Test: `packages/engine/src/plextv/client.test.ts` (new),
  `packages/engine/src/plextv/helper.test.ts` (new),
  `packages/engine/src/runtime/docker.test.ts`, `packages/engine/src/testing/fakes.test.ts`,
  `packages/cli/src/run.test.ts`

**Interfaces:**
- **Consumes:** S2c's runtime (`HelperError`, `HelperResult`, `DOCKER_TIMEOUTS`, the
  helper label), `redact`, `redactionValues`, `fakeHttpApp`, `fakeRuntime`.
- **Produces:**
  - `redactionValues(secrets)` in `util/redact.ts`, which `integrations/wiring.ts`
    re-exports;
  - from `@mediaplane/engine`: `PLEX_TV`, `PLEX_PRODUCT` (`'Mediaplane'`),
    `PLEX_CLIENT_ID` (`'mediaplane'`), `newClientId(): string` (`mediaplane-<uuid>`),
    `PLEX_TV_TIMEOUT_MS`, `PIN_POLL_MS`;
    `type PlexTvErrorKind = 'refused' | 'expired' | 'unreachable' | 'failed' | 'protocol'`,
    `class PlexTvError extends Error { kind; status?; unsure }` (`unsure` for
    `unreachable` and `failed`);
    `interface PlexPin { id: number; code: string; clientId: string; expiresIn: number }`;
    `interface PlexTv { createPin(clientId: string): Promise<PlexPin>; waitForPin(pin: PlexPin, seconds: number): Promise<string | undefined>; claimToken(token: string): Promise<string>; accountId(token: string): Promise<number> }`;
    `signInLink(pin: PlexPin): string`, `plexTvClient(options?: PlexTvOptions): PlexTv`;
    `PLEX_TV_HELPER_SCHEMA` (`'mediaplane.plex-tv/v1'`), `type PlexTvRequest`,
    `answerPlexTvRequest(input: string, client: PlexTv): Promise<string>`,
    `helperPlexTv(options: { runtime: Runtime; image: string; user: { uid: number; gid: number } }): PlexTv`;
  - `Runtime.plexTvHelper(image: string, input: string, user: { uid: number; gid: number }, timeoutMs: number): Promise<HelperResult>`;
  - the CLI: `Io.stdin?: () => Promise<string>`, `CliDeps.plexTv(runtime: Runtime): PlexTv`,
    `CliDeps.plexTvDirect(): PlexTv`, and the hidden command `mediaplane plex-tv`;
  - from `@mediaplane/engine/testing`: `fakePlexTv(state?): Promise<{ app: FakeApp; state: FakePlexTvState; client: PlexTv }>`,
    `freshPlexTv()`, `answerPlexTv(request, state)`, `FakePlexTvState`,
    `FakePlexAccount`, `FakePlexServer` (`{ machineId; owner; name; token }`),
    `FakePlexPin`, `FAKE_PLEX_ACCOUNT` (`{ id: 7_000_001, token: 'fake-plex-token-0001' }`),
    and `fakeRuntime`'s `plexTvHelper` option.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index f893bfd..ab021d1 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -31,2 +31,4 @@ import {
   fakeJellyfinSetUp,
+  FAKE_PLEX_ACCOUNT,
+  fakePlexTv,
   fakeProbe,
@@ -1607,2 +1609,36 @@ describe('mediaplane host-report', () => {
 
+describe('mediaplane plex-tv', () => {
+  it('makes the plex.tv call its standard input asks for, and is not listed in --help', async () => {
+    const plexTv = await fakePlexTv();
+    const term = capture();
+    const io: Io = {
+      ...term.io,
+      stdin: () =>
+        Promise.resolve(
+          JSON.stringify({ op: 'account', token: FAKE_PLEX_ACCOUNT.token }),
+        ),
+    };
+    expect(await run(['plex-tv'], io, { plexTvDirect: () => plexTv.client })).toBe(0);
+    expect(JSON.parse(term.stdout())).toEqual({
+      schema: 'mediaplane.plex-tv/v1',
+      ok: true,
+      value: FAKE_PLEX_ACCOUNT.id,
+    });
+    expect(plexTv.state.calls).toEqual(['GET /api/v2/user']);
+    const help = capture();
+    expect(await run(['--help'], help.io)).toBe(0);
+    expect(help.stdout()).not.toContain('plex-tv');
+  });
+
+  it('refuses an empty standard input without a call', async () => {
+    const plexTv = await fakePlexTv();
+    const term = capture();
+    expect(await run(['plex-tv'], term.io, { plexTvDirect: () => plexTv.client })).toBe(
+      0,
+    );
+    expect(JSON.parse(term.stdout())).toMatchObject({ ok: false, kind: 'protocol' });
+    expect(plexTv.state.calls).toEqual([]);
+  });
+});
+
 describe('--help', () => {
```

**Create** `packages/engine/src/plextv/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { closedPort, fakeHttpApp } from '../testing/http';
import { FAKE_PLEX_ACCOUNT, fakePlexTv } from '../testing/plextv';
import {
  newClientId,
  PLEX_CLIENT_ID,
  plexTvClient,
  PlexTvError,
  signInLink,
  type PlexPin,
} from './client';

const TOKEN = FAKE_PLEX_ACCOUNT.token;
const WRONG = 'wrong-plex-token-000';

/** What `call` threw. */
async function caught(call: Promise<unknown>): Promise<PlexTvError> {
  const error = await call.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  if (!(error instanceof PlexTvError)) throw new Error('expected a PlexTvError');
  return error;
}

describe('plexTvClient', () => {
  it('makes a strong PIN for the device that asks, and names the sign-in link', async () => {
    const { client, app } = await fakePlexTv();
    const clientId = newClientId();
    const pin = await client.createPin(clientId);
    expect(pin).toEqual({ id: 1, code: pin.code, clientId, expiresIn: 1800 });
    expect(pin.code).toHaveLength(25);
    expect(app.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/v2/pins?strong=true',
      headers: {
        'x-plex-product': 'Mediaplane',
        'x-plex-client-identifier': clientId,
      },
    });
    expect(app.requests[0]?.headers['x-plex-token']).toBeUndefined();
    expect(signInLink(pin)).toBe(
      `https://app.plex.tv/auth#?clientID=${clientId}&code=${pin.code}&context%5Bdevice%5D%5Bproduct%5D=Mediaplane`,
    );
  });

  it('gives each sign-in a device of its own', () => {
    expect(newClientId()).toMatch(/^mediaplane-[0-9a-f-]{36}$/);
    expect(newClientId()).not.toBe(newClientId());
  });

  it("waits for a PIN's sign-in, as the device it is for, and gives the token", async () => {
    const { client, state, app } = await fakePlexTv();
    state.signIn = { token: TOKEN, afterReads: 2 };
    const pin = await client.createPin(newClientId());
    expect(await client.waitForPin(pin, 60)).toBe(TOKEN);
    const asked = app.requests.slice(1);
    expect(asked).toHaveLength(3);
    for (const request of asked) {
      expect(request).toMatchObject({
        method: 'GET',
        path: `/api/v2/pins/${String(pin.id)}`,
      });
      expect(request.headers['x-plex-client-identifier']).toBe(pin.clientId);
      expect(request.headers['x-plex-token']).toBeUndefined();
    }
  });

  it('gives nothing when nobody signs in in time', async () => {
    const { client } = await fakePlexTv();
    const pin = await client.createPin(newClientId());
    expect(await client.waitForPin(pin, 0)).toBeUndefined();
  });

  it('says a PIN plex.tv has forgotten ran out, and never shows its code', async () => {
    const { client, state } = await fakePlexTv();
    const pin = await client.createPin(newClientId());
    if (state.pins[0] !== undefined) state.pins[0].expired = true;
    const error = await caught(client.waitForPin(pin, 60));
    expect(error).toMatchObject({
      kind: 'expired',
      status: 404,
      unsure: false,
      message:
        'plex.tv no longer knows the sign-in: its link ran out (GET /api/v2/pins/1)',
    });
    expect(error.message).not.toContain(pin.code);
  });

  it('reads a PIN only as the device it was made for', async () => {
    const { client } = await fakePlexTv();
    const pin = await client.createPin(newClientId());
    const other: PlexPin = { ...pin, clientId: newClientId() };
    expect(await caught(client.waitForPin(other, 60))).toMatchObject({ kind: 'expired' });
  });

  it("gets a claim token, and an account's id", async () => {
    const { client, state, app } = await fakePlexTv();
    const claim = await client.claimToken(TOKEN);
    expect(claim).toMatch(/^claim-.{20}$/);
    expect(state.claims).toEqual([
      { token: claim, account: FAKE_PLEX_ACCOUNT.id, used: false },
    ]);
    expect(await client.accountId(TOKEN)).toBe(FAKE_PLEX_ACCOUNT.id);
    for (const request of app.requests) {
      expect(request.headers['x-plex-token']).toBe(TOKEN);
      expect(request.headers['x-plex-client-identifier']).toBe(PLEX_CLIENT_ID);
    }
  });

  it("gives a server's own token as its owner's, until it is removed from the account", async () => {
    const { client, state } = await fakePlexTv();
    const server = {
      machineId: 'fake-machine',
      owner: FAKE_PLEX_ACCOUNT.id,
      name: 'x',
      token: 'fake-server-token-77',
    };
    state.servers.push(server);
    expect(await client.accountId(server.token)).toBe(FAKE_PLEX_ACCOUNT.id);
    state.servers = [];
    const gone = await caught(client.accountId(server.token));
    expect(gone).toMatchObject({ kind: 'refused', status: 401 });
    expect(gone.message).not.toContain(server.token);
  });

  it('says plex.tv refused a token, and never shows it', async () => {
    const { client } = await fakePlexTv();
    for (const call of [client.claimToken(WRONG), client.accountId(WRONG)]) {
      const error = await caught(call);
      expect(error).toMatchObject({ kind: 'refused', status: 401, unsure: false });
      expect(error.message).toMatch(/^plex\.tv refused the Plex token \(HTTP 401\)/);
      expect(error.message).not.toContain(WRONG);
    }
  });

  it('asks a GET again, twice, after a 5xx or a 429, then says plex.tv failed', async () => {
    const { client, state } = await fakePlexTv();
    state.failing.push({ path: '/api/claim/token.json', status: 503 });
    const error = await caught(client.claimToken(TOKEN));
    expect(error).toMatchObject({
      kind: 'failed',
      status: 503,
      unsure: true,
      message: 'plex.tv failed (HTTP 503) (GET /api/claim/token.json)',
    });
    expect(state.calls).toEqual([
      'GET /api/claim/token.json',
      'GET /api/claim/token.json',
      'GET /api/claim/token.json',
    ]);
    state.failing = [{ path: '/api/v2/user', status: 429 }];
    expect(await caught(client.accountId(TOKEN))).toMatchObject({
      kind: 'failed',
      status: 429,
      unsure: true,
    });
  });

  it('waits 5 then 15 seconds between tries', async () => {
    const slept: number[] = [];
    const app = await fakeHttpApp(() => ({ status: 502 }));
    const client = plexTvClient({
      base: `http://127.0.0.1:${String(app.port)}`,
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });
    await caught(client.accountId(TOKEN));
    expect(slept).toEqual([5_000, 15_000]);
  });

  it('never makes a second PIN after a failure: a POST is sent once', async () => {
    const { client, state } = await fakePlexTv();
    state.failing.push({ path: '/api/v2/pins', status: 503 });
    expect(await caught(client.createPin(newClientId()))).toMatchObject({
      kind: 'failed',
    });
    expect(state.calls).toEqual(['POST /api/v2/pins?strong=true']);
  });

  it('says nothing answered, as unsure, when plex.tv can not be reached', async () => {
    const port = await closedPort();
    const client = plexTvClient({
      base: `http://127.0.0.1:${String(port)}`,
      sleep: () => Promise.resolve(),
    });
    const error = await caught(client.accountId(TOKEN));
    expect(error).toMatchObject({
      kind: 'unreachable',
      unsure: true,
      message: 'plex.tv could not be reached (ECONNREFUSED) (GET /api/v2/user)',
    });
  });

  it('says plex.tv did not answer in time, as unsure', async () => {
    const app = await fakeHttpApp(() => 'hang');
    const client = plexTvClient({
      base: `http://127.0.0.1:${String(app.port)}`,
      timeoutMs: 50,
      sleep: () => Promise.resolve(),
    });
    expect(await caught(client.accountId(TOKEN))).toMatchObject({
      kind: 'unreachable',
      unsure: true,
      message: 'plex.tv did not answer within 0.05 s (GET /api/v2/user)',
    });
  });

  it("refuses an answer it doesn't understand, naming only where, not as unsure", async () => {
    const app = await fakeHttpApp((request) =>
      request.path.startsWith('/api/claim')
        ? { status: 200, body: { token: `not-a-claim ${TOKEN}` } }
        : { status: 200, body: `not json ${TOKEN}` },
    );
    const client = plexTvClient({ base: `http://127.0.0.1:${String(app.port)}` });
    const claim = await caught(client.claimToken(TOKEN));
    expect(claim).toMatchObject({
      kind: 'protocol',
      unsure: false,
      message:
        "plex.tv answered something Mediaplane doesn't understand (at token) (GET /api/claim/token.json)",
    });
    const user = await caught(client.accountId(TOKEN));
    expect(user.message).toBe(
      'plex.tv answered with something that is not JSON (GET /api/v2/user)',
    );
  });

  it('refuses another refusal, such as a 400, as plex.tv refusing the request', async () => {
    const app = await fakeHttpApp(() => ({ status: 400, body: 'no' }));
    const client = plexTvClient({ base: `http://127.0.0.1:${String(app.port)}` });
    expect(await caught(client.accountId(TOKEN))).toMatchObject({
      kind: 'protocol',
      status: 400,
      unsure: false,
      message: 'plex.tv refused the request (HTTP 400) (GET /api/v2/user)',
    });
  });

  it('stops reading an answer of more than 1 MiB', async () => {
    const app = await fakeHttpApp(() => ({
      status: 200,
      body: 'x'.repeat(1024 * 1024 + 1),
    }));
    const client = plexTvClient({ base: `http://127.0.0.1:${String(app.port)}` });
    expect(await caught(client.accountId(TOKEN))).toMatchObject({
      kind: 'protocol',
      message: 'plex.tv answered more than 1 MiB (GET /api/v2/user)',
    });
  });

  it('refuses a token that can not go in a header, without showing it', async () => {
    const { client, app } = await fakePlexTv();
    const bad = 'line\nbreak-token';
    const error = await caught(client.accountId(bad));
    expect(error).toMatchObject({ kind: 'protocol' });
    expect(error.message).toMatch(/^plex\.tv could not be asked \(/);
    expect(error.message).not.toContain('break-token');
    expect(app.requests).toEqual([]);
  });
});
```

**Create** `packages/engine/src/plextv/helper.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fakeRuntime } from '../testing/fakes';
import { FAKE_PLEX_ACCOUNT, fakePlexTv } from '../testing/plextv';
import { HelperError } from '../runtime/types';
import { newClientId, PlexTvError, type PlexTv } from './client';
import { answerPlexTvRequest, helperPlexTv, PLEX_TV_HELPER_SCHEMA } from './helper';

const TOKEN = FAKE_PLEX_ACCOUNT.token;
const USER = { uid: 1000, gid: 1000 };

/** What `call` threw. */
async function caught(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (cause: unknown) => cause,
  );
}

/** The plex.tv helper's answer to `request`, parsed. */
async function answered(request: unknown, client: PlexTv): Promise<unknown> {
  return JSON.parse(
    await answerPlexTvRequest(JSON.stringify(request), client),
  ) as unknown;
}

describe('answerPlexTvRequest', () => {
  it('makes the one plex.tv call it is asked for, and answers one line of JSON', async () => {
    const { client, state } = await fakePlexTv();
    const clientId = newClientId();
    const line = await answerPlexTvRequest(
      JSON.stringify({ op: 'pin', clientId }),
      client,
    );
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trimEnd()).not.toContain('\n');
    const pin = (JSON.parse(line) as { value: { id: number; code: string } }).value;
    expect(JSON.parse(line)).toEqual({
      schema: PLEX_TV_HELPER_SCHEMA,
      ok: true,
      value: { id: 1, code: pin.code, clientId, expiresIn: 1800 },
    });
    expect(
      await answered(
        { op: 'pin-wait', pin: { ...pin, clientId, expiresIn: 1800 }, seconds: 0 },
        client,
      ),
    ).toEqual({
      schema: PLEX_TV_HELPER_SCHEMA,
      ok: true,
      value: null,
    });
    expect(await answered({ op: 'claim', token: TOKEN }, client)).toEqual({
      schema: PLEX_TV_HELPER_SCHEMA,
      ok: true,
      value: state.claims[0]?.token,
    });
    expect(await answered({ op: 'account', token: TOKEN }, client)).toMatchObject({
      ok: true,
      value: FAKE_PLEX_ACCOUNT.id,
    });
  });

  it("answers plex.tv's refusal as a failure, without the token", async () => {
    const { client } = await fakePlexTv();
    const wrong = 'wrong-plex-token-000';
    const line = await answerPlexTvRequest(
      JSON.stringify({ op: 'claim', token: wrong }),
      client,
    );
    expect(JSON.parse(line)).toEqual({
      schema: PLEX_TV_HELPER_SCHEMA,
      ok: false,
      kind: 'refused',
      status: 401,
      message: 'plex.tv refused the Plex token (HTTP 401) (GET /api/claim/token.json)',
    });
    expect(line).not.toContain(wrong);
  });

  it('refuses a request it does not take, without a call and without its values', async () => {
    const { client, state } = await fakePlexTv();
    for (const request of [
      'not json',
      JSON.stringify({ op: 'delete-everything', token: TOKEN }),
      JSON.stringify({ op: 'claim', token: TOKEN, url: 'https://elsewhere.test/' }),
      JSON.stringify({ op: 'pin', clientId: 'not-a-mediaplane-device' }),
      JSON.stringify({ op: 'claim', token: '' }),
    ]) {
      const line = await answerPlexTvRequest(request, client);
      const answer = JSON.parse(line) as { ok: boolean; kind: string; message: string };
      expect(answer).toMatchObject({ ok: false, kind: 'protocol' });
      expect(line).not.toContain(TOKEN);
    }
    expect(state.calls).toEqual([]);
  });
});

describe('helperPlexTv', () => {
  /** A runtime whose plex.tv helper runs answerPlexTvRequest against a fake plex.tv. */
  async function helped() {
    const plexTv = await fakePlexTv();
    const inputs: string[] = [];
    const calls: string[] = [];
    const runtime = fakeRuntime({
      calls,
      plexTvHelper: async (input) => {
        inputs.push(input);
        return { ok: true, stdout: await answerPlexTvRequest(input, plexTv.client) };
      },
    });
    const helper = helperPlexTv({ runtime, image: 'mediaplane:test', user: USER });
    return { ...plexTv, helper, inputs, calls };
  }

  it('runs one helper per call, the token on its standard input', async () => {
    const { helper, inputs, calls, state } = await helped();
    const claim = await helper.claimToken(TOKEN);
    expect(claim).toBe(state.claims[0]?.token);
    expect(await helper.accountId(TOKEN)).toBe(FAKE_PLEX_ACCOUNT.id);
    const pin = await helper.createPin(newClientId());
    expect(pin).toMatchObject({ id: 1, expiresIn: 1800 });
    expect(await helper.waitForPin(pin, 0)).toBeUndefined();
    state.signIn = { token: TOKEN, afterReads: 0 };
    expect(await helper.waitForPin(pin, 0)).toBe(TOKEN);
    expect(calls).toEqual(Array.from({ length: 5 }, () => 'plex-tv-helper'));
    expect(JSON.parse(inputs[0] ?? '')).toEqual({ op: 'claim', token: TOKEN });
  });

  it("gives each call the client's tries and a minute more, and the whole wait to one helper", async () => {
    const seen: number[] = [];
    const plexTv = await fakePlexTv();
    const runtime = fakeRuntime();
    const helper = helperPlexTv({
      runtime: {
        ...runtime,
        plexTvHelper: async (_image, input, _user, timeoutMs) => {
          seen.push(timeoutMs);
          return { ok: true, stdout: await answerPlexTvRequest(input, plexTv.client) };
        },
      },
      image: 'mediaplane:test',
      user: USER,
    });
    const pin = await helper.createPin(newClientId());
    plexTv.state.signIn = { token: TOKEN, afterReads: 0 };
    await helper.waitForPin(pin, 300);
    // Three tries of 30 s, 5 s and 15 s between them, and a minute for the container.
    expect(seen).toEqual([170_000, 470_000]);
  });

  it("says a helper whose time ran out couldn't reach plex.tv, as unsure, without the token", async () => {
    const runtime = fakeRuntime({
      plexTvHelper: () => {
        throw new HelperError(`the plex.tv helper did not finish within 170 s ${TOKEN}`);
      },
    });
    const helper = helperPlexTv({ runtime, image: 'mediaplane:test', user: USER });
    const error = await caught(helper.claimToken(TOKEN));
    expect(error).toBeInstanceOf(PlexTvError);
    expect(error).toMatchObject({
      kind: 'unreachable',
      unsure: true,
      message:
        "the plex.tv helper did not finish within 170 s ***: check that this host reaches plex.tv from Docker's default bridge network",
    });
  });

  it("throws plex.tv's refusal as the helper answered it", async () => {
    const { helper } = await helped();
    const error = await caught(helper.accountId('wrong-plex-token-000'));
    expect(error).toBeInstanceOf(PlexTvError);
    expect(error).toMatchObject({ kind: 'refused', status: 401, unsure: false });
  });

  it("says a helper that failed couldn't reach plex.tv, as unsure, without the token", async () => {
    const runtime = fakeRuntime({
      plexTvHelper: () => ({
        ok: false,
        error: `docker: network bridge not found ${TOKEN}`,
      }),
    });
    const helper = helperPlexTv({ runtime, image: 'mediaplane:test', user: USER });
    const error = await caught(helper.claimToken(TOKEN));
    expect(error).toBeInstanceOf(PlexTvError);
    expect(error).toMatchObject({
      kind: 'unreachable',
      unsure: true,
      message: 'the plex.tv helper failed: docker: network bridge not found ***',
    });
  });

  it("refuses what it can't read, or an answer of another kind, as protocol", async () => {
    for (const stdout of [
      'not json',
      JSON.stringify({ schema: 'mediaplane.other/v1', ok: true, value: 1 }),
      `${JSON.stringify({ schema: PLEX_TV_HELPER_SCHEMA, ok: true, value: 7 })}\n`,
    ]) {
      const runtime = fakeRuntime({ plexTvHelper: () => ({ ok: true, stdout }) });
      const helper = helperPlexTv({ runtime, image: 'mediaplane:test', user: USER });
      expect(await caught(helper.claimToken(TOKEN))).toMatchObject({
        kind: 'protocol',
        unsure: false,
      });
    }
    const runtime = fakeRuntime({
      plexTvHelper: () => ({
        ok: true,
        stdout: JSON.stringify({ schema: PLEX_TV_HELPER_SCHEMA, ok: true, value: 'x' }),
      }),
    });
    const helper = helperPlexTv({ runtime, image: 'mediaplane:test', user: USER });
    expect(await caught(helper.createPin(newClientId()))).toMatchObject({
      kind: 'protocol',
    });
  });

  it('refuses an image name that docker would read as an option, without running it', async () => {
    const calls: string[] = [];
    const runtime = fakeRuntime({ calls });
    const helper = helperPlexTv({ runtime, image: '--privileged', user: USER });
    expect(await caught(helper.accountId(TOKEN))).toBeInstanceOf(HelperError);
    expect(calls).toEqual([]);
  });
});
```

**Change** `packages/engine/src/runtime/docker.test.ts`:

```diff
diff --git a/packages/engine/src/runtime/docker.test.ts b/packages/engine/src/runtime/docker.test.ts
index 66a7b27..1ac04cd 100644
--- a/packages/engine/src/runtime/docker.test.ts
+++ b/packages/engine/src/runtime/docker.test.ts
@@ -804,2 +804,76 @@ describe('createDockerRuntime', () => {
   });
+
+  it('runs the plex.tv helper on the default bridge, locked down, with no mount', async () => {
+    const { exec, calls } = recorder(() => ok('{"schema":"mediaplane.plex-tv/v1"}\n'));
+    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
+    const input = '{"op":"claim","token":"fake-plex-token-0001"}';
+    const result = await runtime.plexTvHelper(
+      'mediaplane:local',
+      input,
+      { uid: 1001, gid: 1002 },
+      90_000,
+    );
+    expect(result).toEqual({ ok: true, stdout: '{"schema":"mediaplane.plex-tv/v1"}\n' });
+    expect(calls[0]?.args).toEqual([
+      'run',
+      '--rm',
+      '--interactive',
+      '--init',
+      '--pull',
+      'never',
+      '--network',
+      'bridge',
+      '--user',
+      '1001:1002',
+      '--cap-drop',
+      'ALL',
+      '--security-opt',
+      'no-new-privileges',
+      '--read-only',
+      '--label',
+      'io.mediaplane.helper=plex-tv',
+      '--entrypoint',
+      'mediaplane',
+      'mediaplane:local',
+      'plex-tv',
+    ]);
+    // The token goes on its standard input, never on the command line.
+    expect(calls[0]?.options?.input).toBe(input);
+    expect(calls[0]?.args.join(' ')).not.toContain('fake-plex-token');
+    expect(calls[0]?.options?.timeoutMs).toBe(90_000);
+  });
+
+  it("reports a plex.tv helper that failed with docker's last lines", async () => {
+    const { exec } = recorder(() => ({
+      code: 125,
+      stdout: '',
+      stderr: 'docker: Error response from daemon: network bridge not found\n',
+    }));
+    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
+    expect(
+      await runtime.plexTvHelper(
+        'mediaplane:local',
+        '{}',
+        { uid: 1000, gid: 1000 },
+        60_000,
+      ),
+    ).toEqual({
+      ok: false,
+      error: 'docker: Error response from daemon: network bridge not found',
+    });
+  });
+
+  it('explains a plex.tv helper that does not finish, with its own hint', async () => {
+    const exec: Exec = () =>
+      Promise.reject(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }));
+    const runtime = createDockerRuntime({ home, project: 'mediaplane', exec });
+    const error = await runtime
+      .plexTvHelper('mediaplane:local', '{}', { uid: 1000, gid: 1000 }, 90_000)
+      .catch((caught: unknown) => caught);
+    expect(error).toBeInstanceOf(HelperError);
+    expect(error).toMatchObject({
+      message: 'the plex.tv helper did not finish within 90 s',
+      hint: "check that this host reaches plex.tv: the helper runs on Docker's default bridge network",
+    });
+  });
 });
```

**Change** `packages/engine/src/testing/fakes.test.ts`:

```diff
diff --git a/packages/engine/src/testing/fakes.test.ts b/packages/engine/src/testing/fakes.test.ts
index 5abb90c..2bd7f22 100644
--- a/packages/engine/src/testing/fakes.test.ts
+++ b/packages/engine/src/testing/fakes.test.ts
@@ -126,2 +126,27 @@ describe('fakeRuntime().hostHelper', () => {
 
+describe('fakeRuntime().plexTvHelper', () => {
+  it('fails unless the test gives it an answer, and records each run', async () => {
+    const calls: string[] = [];
+    const user = { uid: 1000, gid: 1000 };
+    const none = fakeRuntime({ calls });
+    expect(await none.plexTvHelper('mediaplane:test', '{}', user, 60_000)).toEqual({
+      ok: false,
+      error: 'this fake Docker has no plex.tv helper',
+    });
+    const inputs: string[] = [];
+    const answering = fakeRuntime({
+      calls,
+      plexTvHelper: (input) => {
+        inputs.push(input);
+        return { ok: true, stdout: 'answer' };
+      },
+    });
+    expect(
+      await answering.plexTvHelper('mediaplane:test', 'asked', user, 60_000),
+    ).toEqual({ ok: true, stdout: 'answer' });
+    expect(inputs).toEqual(['asked']);
+    expect(calls).toEqual(['plex-tv-helper', 'plex-tv-helper']);
+  });
+});
+
 describe('fakeRuntime().run', () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/cli/src/run.test.ts packages/engine/src/plextv/client.test.ts packages/engine/src/plextv/helper.test.ts packages/engine/src/runtime/docker.test.ts packages/engine/src/testing/fakes.test.ts`
Expected: FAIL. `client.test.ts` and `helper.test.ts` don't load (`Cannot find module '../testing/plextv'`), and 6 tests fail, 165 pass: 2 in `run.test.ts` (`TypeError: fakePlexTv is not a function`), 3 in `docker.test.ts` (`TypeError: runtime.plexTvHelper is not a function`) and 1 in `fakes.test.ts` (`TypeError: none.plexTvHelper is not a function`).

- [ ] **Step 3: Write the client, the helper and the fake**

**Change** `packages/cli/src/main.ts`:

```diff
diff --git a/packages/cli/src/main.ts b/packages/cli/src/main.ts
index 2f2fcf0..953f5e9 100644
--- a/packages/cli/src/main.ts
+++ b/packages/cli/src/main.ts
@@ -1 +1,2 @@
+import { text } from 'node:stream/consumers';
 import { terminalAsk, terminalAskSecret } from './prompt';
@@ -19,2 +20,3 @@ process.exitCode = await run(process.argv.slice(2), {
   env: process.env,
+  stdin: () => text(process.stdin),
   ...(interactive
```

**Change** `packages/cli/src/run.ts`:

```diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index daea13e..908604e 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -3,2 +3,3 @@ import { catalog } from '@mediaplane/catalog';
 import {
+  answerPlexTvRequest,
   apply,
@@ -13,2 +14,3 @@ import {
   helperHostFacts,
+  helperPlexTv,
   helperProbe,
@@ -20,2 +22,3 @@ import {
   plan,
+  plexTvClient,
   PROJECT_NAME,
@@ -27,2 +30,3 @@ import {
   type HostProbe,
+  type PlexTv,
   type Runtime,
@@ -59,2 +63,4 @@ export interface Io {
   askSecret?: (question: string) => Promise<string>;
+  /** All of the standard input, once it ends: what the plex.tv helper is asked. */
+  stdin?: () => Promise<string>;
 }
@@ -70,2 +76,6 @@ export interface CliDeps {
   egress: (runtime: Runtime) => (url: string) => Promise<EgressResult>;
+  /** plex.tv: called directly from source; through the plex.tv helper in the image. */
+  plexTv: (runtime: Runtime) => PlexTv;
+  /** plex.tv, called directly: what the plex.tv helper itself calls it with. */
+  plexTvDirect: () => PlexTv;
   /** For tests: where plan and apply reach the apps' APIs. */
@@ -189,2 +199,5 @@ export function defaultDeps(env: NodeJS.ProcessEnv): CliDeps {
               }),
+      // The host has a route out: spec §7.2(1) and ADR 0011 keep only the container off.
+      plexTv: () => plexTvClient(),
+      plexTvDirect: () => plexTvClient(),
       dataFolder: (path, home, user) => prepareDataFolder(path, home, false, user),
@@ -199,2 +212,5 @@ export function defaultDeps(env: NodeJS.ProcessEnv): CliDeps {
     egress: (docker) => (url) => helperEgress({ runtime: docker, image, user }, url),
+    // The container has no route out (ADR 0011): a throwaway helper reaches plex.tv.
+    plexTv: (docker) => helperPlexTv({ runtime: docker, image, user }),
+    plexTvDirect: () => plexTvClient(),
     // The container sees the host's folders only inside the home.
@@ -489,2 +505,12 @@ export function createProgram(
 
+  // What the plex.tv helper container runs (ADR 0011); not for people, so not in --help.
+  // The request, with any token in it, comes on the standard input, never as an argument.
+  program
+    .command('plex-tv', { hidden: true })
+    .description('Make the one plex.tv call that the standard input asks for')
+    .action(async () => {
+      const input = (await io.stdin?.()) ?? '';
+      io.stdout(await answerPlexTvRequest(input, deps.plexTvDirect()));
+    });
+
   return program;
```

**Change** `packages/engine/src/index.ts`:

```diff
diff --git a/packages/engine/src/index.ts b/packages/engine/src/index.ts
index cf2fb7e..edbc025 100644
--- a/packages/engine/src/index.ts
+++ b/packages/engine/src/index.ts
@@ -54 +54,3 @@ export * from './vpn/probe';
 export * from './vpn/check';
+export * from './plextv/client';
+export * from './plextv/helper';
```

**Change** `packages/engine/src/integrations/wiring.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index 426344e..f71e7c1 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -15,3 +15,3 @@ import type { ContainerState, RuntimeError, Runtime } from '../runtime/types';
 import type { SecretStore } from '../secrets/store';
-import { foundSecrets, redact, type FoundSecrets } from '../util/redact';
+import { foundSecrets, redact, redactionValues, type FoundSecrets } from '../util/redact';
 import { compare } from '../util/sort';
@@ -225,6 +225,3 @@ export function knownSecrets(
 
-/** `secrets` as redact() and the runtime take them, by position. */
-export function redactionValues(secrets: readonly string[]): Record<string, string> {
-  return Object.fromEntries(secrets.map((secret, i) => [String(i), secret]));
-}
+export { redactionValues };
 
```

**Create** `packages/engine/src/plextv/client.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { z } from 'zod';
import { codeOf } from '../util/error-code';
import { redact, redactionValues } from '../util/redact';

/** plex.tv, where Plex accounts, their sign-ins and their servers live. */
export const PLEX_TV = 'https://plex.tv';

/**
 * The product Mediaplane names itself as to plex.tv: the device a sign-in makes in the
 * account ("Mediaplane", under Authorized Devices) is named after it.
 */
export const PLEX_PRODUCT = 'Mediaplane';

/**
 * The client identifier Mediaplane's own calls carry. plex.tv makes a device only for a
 * sign-in, whose identifier is its own (`newClientId`); calls with a token make none.
 */
export const PLEX_CLIENT_ID = 'mediaplane';

/**
 * A new device's client identifier, for one sign-in: the token it gets belongs to that
 * device, which the account lists as "Mediaplane" until you remove it.
 */
export function newClientId(): string {
  return `mediaplane-${randomUUID()}`;
}

/** How long one request to plex.tv may take, in ms. */
export const PLEX_TV_TIMEOUT_MS = 30_000;

/** How often a sign-in's PIN is asked about while it waits, in ms. */
export const PIN_POLL_MS = 2_000;

/** The most of an answer Mediaplane reads from plex.tv, in bytes. */
const MAX_BYTES = 1024 * 1024;

/**
 * Why a plex.tv call failed:
 * - `refused`: plex.tv refused the token (401): it was revoked, or is not a Plex token;
 * - `expired`: plex.tv no longer knows the sign-in's PIN (404): it ran out;
 * - `unreachable`: nothing answered in time, or at all;
 * - `failed`: plex.tv failed (5xx), or kept refusing to be asked so often (429);
 * - `protocol`: it answered something Mediaplane doesn't understand, or another refusal.
 */
export type PlexTvErrorKind =
  'refused' | 'expired' | 'unreachable' | 'failed' | 'protocol';

/** A plex.tv call that failed, said for the user. It never holds a token or a code. */
export class PlexTvError extends Error {
  override readonly name = 'PlexTvError';
  readonly kind: PlexTvErrorKind;
  readonly status: number | undefined;
  /**
   * Whether Mediaplane couldn't tell: no answer, a timeout, a 5xx or a 429. An answer
   * that refuses, or that Mediaplane can't read, is not unsure.
   */
  readonly unsure: boolean;

  constructor(message: string, details: { kind: PlexTvErrorKind; status?: number }) {
    super(message);
    this.kind = details.kind;
    this.status = details.status;
    this.unsure = details.kind === 'unreachable' || details.kind === 'failed';
  }
}

/** A sign-in's PIN: plex.tv's id for it, its code, and which device asked for it. */
export interface PlexPin {
  id: number;
  /** In the sign-in link. Not a secret, but never kept. */
  code: string;
  /** The device (`X-Plex-Client-Identifier`) the PIN is for: only it may read the PIN. */
  clientId: string;
  /** How long the PIN lasts, in seconds, from when plex.tv made it. */
  expiresIn: number;
}

/**
 * plex.tv, as Mediaplane calls it (spec §6.1). Every method that takes a token keeps it
 * out of every message, as it does a claim token, a code and a sign-in's token.
 */
export interface PlexTv {
  /**
   * A new PIN for a sign-in by the device `clientId`: a strong one, whose 25-character code
   * goes in a link and lasts 30 minutes (probed).
   */
  createPin(clientId: string): Promise<PlexPin>;
  /**
   * Wait up to `seconds` for someone to sign in through `pin`'s link: the account's token
   * (its long-lived one, not the 7-day JWT), or undefined when nobody did by then.
   * Throws PlexTvError `expired` once plex.tv no longer knows the PIN.
   */
  waitForPin(pin: PlexPin, seconds: number): Promise<string | undefined>;
  /** A claim token for a new server, `claim-…`: it lasts 4 minutes, and is used once. */
  claimToken(token: string): Promise<string>;
  /**
   * The id of the account `token` is a token of: yours, or a Plex server's own, which its
   * claim gave it, and which plex.tv answers with its owner's id (probed).
   */
  accountId(token: string): Promise<number>;
}

/** How a plex.tv client is made; tests give a fake plex.tv's address and a clock. */
export interface PlexTvOptions {
  /** plex.tv's address: PLEX_TV, unless a test points it at a fake. */
  base?: string;
  timeoutMs?: number;
  /** How often waitForPin asks. */
  pollMs?: number;
  sleep?: (ms: number) => Promise<unknown>;
  /** A clock that only moves forward, in ms. */
  now?: () => number;
}

const pinSchema = z.looseObject({
  id: z.number(),
  code: z.string().min(1),
  expiresIn: z.number(),
  authToken: z.string().nullable(),
});
const claimSchema = z.looseObject({ token: z.string().regex(/^claim-./) });
const userSchema = z.looseObject({ id: z.number() });

/** How many times a request plex.tv was too busy for (429, 5xx) is asked again. */
const AGAIN = 2;

/** The link a sign-in through `pin` starts from: plex.tv's own page for it. */
export function signInLink(pin: PlexPin): string {
  const query = new URLSearchParams({
    clientID: pin.clientId,
    code: pin.code,
    'context[device][product]': PLEX_PRODUCT,
  });
  return `https://app.plex.tv/auth#?${query.toString()}`;
}

/**
 * A plex.tv client that calls plex.tv itself, as Mediaplane run from source does, and the
 * plex.tv helper does for Mediaplane in its image. It uses an agent of its own, so a proxy
 * from the environment never sees a token, follows no redirect, reads at most 1 MiB of an
 * answer, and asks again, twice, a GET that plex.tv was too busy for (429, 5xx) or that
 * went unanswered, after 5 then 15 seconds.
 */
export function plexTvClient(options: PlexTvOptions = {}): PlexTv {
  const base = new URL(options.base ?? PLEX_TV);
  const secure = base.protocol === 'https:';
  const agent = secure
    ? new HttpsAgent({ keepAlive: false })
    : new HttpAgent({ keepAlive: false });
  const timeoutMs = options.timeoutMs ?? PLEX_TV_TIMEOUT_MS;
  const pollMs = options.pollMs ?? PIN_POLL_MS;
  const sleep =
    options.sleep ??
    ((ms: number) =>
      new Promise((done) => {
        setTimeout(done, ms);
      }));
  const now = options.now ?? (() => performance.now());

  interface Call {
    method: 'GET' | 'POST';
    path: string;
    token?: string;
    clientId?: string;
    /** Secrets this call sends or may get back, kept out of every message. */
    secrets: readonly string[];
  }

  function attempt(call: Call): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Plex-Product': PLEX_PRODUCT,
        'X-Plex-Client-Identifier': call.clientId ?? PLEX_CLIENT_ID,
      };
      if (call.token !== undefined) headers['X-Plex-Token'] = call.token;
      const send = secure ? httpsRequest : httpRequest;
      try {
        const req = send(
          {
            agent,
            protocol: base.protocol,
            host: base.hostname,
            port: base.port === '' ? undefined : Number(base.port),
            method: call.method,
            path: call.path,
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          },
          (res) => {
            const chunks: Buffer[] = [];
            let size = 0;
            res.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > MAX_BYTES) {
                res.destroy();
                reject(failure(call, 'answered more than 1 MiB', { kind: 'protocol' }));
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', () => {
              resolve({
                status: res.statusCode ?? 0,
                body: Buffer.concat(chunks).toString('utf8'),
              });
            });
            res.on('error', (cause) => {
              reject(connectionFailure(call, cause));
            });
          },
        );
        req.on('error', (cause) => {
          reject(connectionFailure(call, cause));
        });
        req.end();
      } catch (cause) {
        // Node refuses to build the request, say for a token with a newline in it. Its
        // message could quote the value; the code says enough.
        reject(
          failure(call, `could not be asked (${codeOf(cause) ?? 'no reason given'})`, {
            kind: 'protocol',
          }),
        );
      }
    });
  }

  /** `what` went wrong with `call`: the message names the method and path, never a query. */
  function failure(
    call: Call,
    what: string,
    details: ConstructorParameters<typeof PlexTvError>[1],
  ): PlexTvError {
    const path = call.path.split('?')[0] ?? call.path;
    return new PlexTvError(
      redact(`plex.tv ${what} (${call.method} ${path})`, redactionValues(call.secrets)),
      details,
    );
  }

  function connectionFailure(call: Call, cause: unknown): PlexTvError {
    if (cause instanceof Error && cause.name === 'AbortError') {
      return failure(call, `did not answer within ${String(timeoutMs / 1000)} s`, {
        kind: 'unreachable',
      });
    }
    const code = codeOf(cause);
    return failure(
      call,
      `could not be reached (${code === undefined || code === '' ? 'no reason given' : code})`,
      { kind: 'unreachable' },
    );
  }

  /** `call`'s answer, of a status `ok` takes; plex.tv's refusals as PlexTvErrors. */
  async function send(
    call: Call,
    ok: (status: number) => boolean = (status) => status >= 200 && status < 300,
  ): Promise<{ status: number; body: string }> {
    for (let tries = 0; ; tries++) {
      let error: PlexTvError;
      try {
        const answer = await attempt(call);
        if (ok(answer.status)) return answer;
        error = statusFailure(call, answer.status);
      } catch (cause) {
        if (!(cause instanceof PlexTvError)) throw cause;
        error = cause;
      }
      // A POST makes something (a PIN): it isn't sent twice.
      if (!error.unsure || call.method !== 'GET' || tries >= AGAIN) throw error;
      await sleep(tries === 0 ? 5_000 : 15_000);
    }
  }

  function statusFailure(call: Call, status: number): PlexTvError {
    if (status === 401 || status === 403) {
      return failure(call, `refused the Plex token (HTTP ${String(status)})`, {
        kind: 'refused',
        status,
      });
    }
    if (status === 429) {
      return failure(call, 'is being asked too often (HTTP 429)', {
        kind: 'failed',
        status,
      });
    }
    if (status >= 500) {
      return failure(call, `failed (HTTP ${String(status)})`, { kind: 'failed', status });
    }
    return failure(call, `refused the request (HTTP ${String(status)})`, {
      kind: 'protocol',
      status,
    });
  }

  function parsed<T>(call: Call, body: string, schema: z.ZodType<T>): T {
    let data: unknown;
    try {
      data = JSON.parse(body) as unknown;
    } catch {
      throw failure(call, 'answered with something that is not JSON', {
        kind: 'protocol',
      });
    }
    const result = schema.safeParse(data);
    if (result.success) return result.data;
    // The paths only: a value could be a token.
    const at = [
      ...new Set(result.error.issues.map((i) => i.path.join('.') || '(the answer)')),
    ];
    throw failure(
      call,
      `answered something Mediaplane doesn't understand (at ${at.join(', ')})`,
      { kind: 'protocol' },
    );
  }

  async function get<T>(call: Call, schema: z.ZodType<T>): Promise<T> {
    return parsed(call, (await send(call)).body, schema);
  }

  return {
    async createPin(clientId) {
      const call: Call = {
        method: 'POST',
        path: '/api/v2/pins?strong=true',
        clientId,
        secrets: [],
      };
      const pin = parsed(call, (await send(call)).body, pinSchema);
      return { id: pin.id, code: pin.code, clientId, expiresIn: pin.expiresIn };
    },
    async waitForPin(pin, seconds) {
      const until = now() + seconds * 1000;
      const call: Call = {
        method: 'GET',
        path: `/api/v2/pins/${String(pin.id)}`,
        clientId: pin.clientId,
        secrets: [pin.code],
      };
      for (;;) {
        const answer = await send(call, (status) => status === 200 || status === 404);
        if (answer.status === 404) {
          throw failure(call, 'no longer knows the sign-in: its link ran out', {
            kind: 'expired',
            status: 404,
          });
        }
        const { authToken } = parsed(call, answer.body, pinSchema);
        if (authToken !== null && authToken !== '') return authToken;
        if (now() + pollMs > until) return undefined;
        await sleep(pollMs);
      }
    },
    async claimToken(token) {
      const call: Call = {
        method: 'GET',
        path: '/api/claim/token.json',
        token,
        secrets: [token],
      };
      const { token: claim } = await get(call, claimSchema);
      return claim;
    },
    async accountId(token) {
      const call: Call = { method: 'GET', path: '/api/v2/user', token, secrets: [token] };
      return (await get(call, userSchema)).id;
    },
  };
}
```

**Create** `packages/engine/src/plextv/helper.ts`:

```ts
import { z } from 'zod';
import { DOCKER_TIMEOUTS } from '../runtime/docker';
import { HelperError, type Runtime } from '../runtime/types';
import { redact, redactionValues } from '../util/redact';
import {
  PLEX_TV_TIMEOUT_MS,
  PlexTvError,
  type PlexPin,
  type PlexTv,
  type PlexTvErrorKind,
} from './client';

/** The version of the plex.tv helper's request and answer: both sides share one image. */
export const PLEX_TV_HELPER_SCHEMA = 'mediaplane.plex-tv/v1';

const pinSchema = z.strictObject({
  id: z.int(),
  code: z.string().min(1),
  clientId: z.string().regex(/^mediaplane-[0-9a-f-]{36}$/),
  expiresIn: z.number(),
});

const token = z.string().min(1);

/** What the engine asks the plex.tv helper: one plex.tv call, and nothing else. */
const requestSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('pin'), clientId: pinSchema.shape.clientId }),
  z.strictObject({
    op: z.literal('pin-wait'),
    pin: pinSchema,
    // A PIN lasts 30 minutes.
    seconds: z.int().min(0).max(1800),
  }),
  z.strictObject({ op: z.literal('claim'), token }),
  z.strictObject({ op: z.literal('account'), token }),
]);

export type PlexTvRequest = z.infer<typeof requestSchema>;

const kinds = z.enum(['refused', 'expired', 'unreachable', 'failed', 'protocol']);

const answerSchema = z.union([
  z.strictObject({
    schema: z.literal(PLEX_TV_HELPER_SCHEMA),
    ok: z.literal(true),
    value: z.union([pinSchema, z.string(), z.number(), z.null()]),
  }),
  z.strictObject({
    schema: z.literal(PLEX_TV_HELPER_SCHEMA),
    ok: z.literal(false),
    kind: kinds,
    status: z.int().optional(),
    message: z.string(),
  }),
]);

/** The secrets a request holds: what its answer, or a failure, must never show. */
function secretsOf(request: PlexTvRequest): string[] {
  return 'token' in request ? [request.token] : [];
}

/**
 * What the plex.tv helper does with what it reads on its standard input (spec §6.1): the
 * one plex.tv call it names, through `client`, and its answer as one line of JSON. A
 * request it can't read is refused without a call. A failure is an answer too (`ok:
 * false`), with what went wrong, never a token.
 */
export async function answerPlexTvRequest(
  input: string,
  client: PlexTv,
): Promise<string> {
  let data: unknown;
  try {
    data = JSON.parse(input) as unknown;
  } catch {
    return reply({ ok: false, kind: 'protocol', message: 'the request is not JSON' });
  }
  const parsed = requestSchema.safeParse(data);
  if (!parsed.success) {
    // The paths only: a value may be a token.
    const at = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || 'op'))];
    return reply({
      ok: false,
      kind: 'protocol',
      message: `the request is not one the plex.tv helper takes (at ${at.join(', ')})`,
    });
  }
  const request = parsed.data;
  try {
    return reply({ ok: true, value: await call(request, client) });
  } catch (cause) {
    if (!(cause instanceof PlexTvError)) throw cause;
    const values = redactionValues(secretsOf(request));
    return reply({
      ok: false,
      kind: cause.kind,
      ...(cause.status === undefined ? {} : { status: cause.status }),
      message: redact(cause.message, values),
    });
  }
}

async function call(
  request: PlexTvRequest,
  client: PlexTv,
): Promise<PlexPin | string | number | null> {
  switch (request.op) {
    case 'pin':
      return await client.createPin(request.clientId);
    case 'pin-wait':
      return (await client.waitForPin(request.pin, request.seconds)) ?? null;
    case 'claim':
      return await client.claimToken(request.token);
    case 'account':
      return await client.accountId(request.token);
  }
}

function reply(
  answer:
    | { ok: true; value: unknown }
    | { ok: false; kind: PlexTvErrorKind; status?: number; message: string },
): string {
  return `${JSON.stringify({ schema: PLEX_TV_HELPER_SCHEMA, ...answer })}\n`;
}

/** Who runs the plex.tv helper, and with what image: Mediaplane's own. */
export interface PlexTvHelperOptions {
  runtime: Runtime;
  /** The Mediaplane image this container runs (MEDIAPLANE_IMAGE). */
  image: string;
  /** Who the helper runs as: Mediaplane's own user. */
  user: { uid: number; gid: number };
}

/**
 * plex.tv, for Mediaplane in its image, whose container has no route out (ADR 0011): each
 * call is one run of the plex.tv helper, a throwaway container of Mediaplane's own image
 * on Docker's default bridge network, which has a route out but doesn't reach the
 * stack's networks. The request, and any token in it, goes on the helper's standard
 * input; the answer comes back on its standard output.
 */
export function helperPlexTv(options: PlexTvHelperOptions): PlexTv {
  async function ask(request: PlexTvRequest, timeoutMs: number): Promise<unknown> {
    if (options.image.startsWith('-')) {
      throw new HelperError(
        `the plex.tv helper image ${JSON.stringify(options.image)} is not an image name: it must not start with "-"`,
      );
    }
    const values = redactionValues(secretsOf(request));
    let result: Awaited<ReturnType<Runtime['plexTvHelper']>>;
    try {
      result = await options.runtime.plexTvHelper(
        options.image,
        JSON.stringify(request),
        options.user,
        timeoutMs,
      );
    } catch (cause) {
      // Its time ran out: plex.tv didn't answer, as the client inside would have said.
      if (!(cause instanceof HelperError)) throw cause;
      throw new PlexTvError(
        redact(
          `${cause.message}: check that this host reaches plex.tv from Docker's default bridge network`,
          values,
        ),
        { kind: 'unreachable' },
      );
    }
    if (!result.ok) {
      throw new PlexTvError(
        redact(`the plex.tv helper failed: ${result.error}`, values),
        { kind: 'unreachable' },
      );
    }
    let data: unknown;
    try {
      data = JSON.parse(result.stdout) as unknown;
    } catch {
      throw new PlexTvError('the plex.tv helper printed something that is not JSON', {
        kind: 'protocol',
      });
    }
    const answer = answerSchema.safeParse(data);
    if (!answer.success) {
      throw new PlexTvError(
        "the plex.tv helper printed an answer Mediaplane doesn't understand",
        { kind: 'protocol' },
      );
    }
    if (!answer.data.ok) {
      const { kind, status, message } = answer.data;
      throw new PlexTvError(redact(message, values), {
        kind,
        ...(status === undefined ? {} : { status }),
      });
    }
    return answer.data.value;
  }

  // A call's time in the helper: the client's three tries, the waits between them, and
  // the container's own start and end.
  const oneShot = 3 * PLEX_TV_TIMEOUT_MS + 20_000 + DOCKER_TIMEOUTS.query;
  const as = <T>(value: unknown, check: (v: unknown) => v is T): T => {
    if (!check(value)) {
      throw new PlexTvError("the plex.tv helper's answer is not of the kind asked for", {
        kind: 'protocol',
      });
    }
    return value;
  };
  const isString = (v: unknown): v is string => typeof v === 'string';
  return {
    async createPin(clientId) {
      const pin = pinSchema.safeParse(await ask({ op: 'pin', clientId }, oneShot));
      if (!pin.success) {
        throw new PlexTvError("the plex.tv helper's answer is not a PIN", {
          kind: 'protocol',
        });
      }
      return pin.data;
    },
    async waitForPin(pin, seconds) {
      // The helper asks plex.tv for the whole wait: a container per question would not do.
      const value = await ask({ op: 'pin-wait', pin, seconds }, seconds * 1000 + oneShot);
      return value === null ? undefined : as(value, isString);
    },
    async claimToken(t) {
      return as(await ask({ op: 'claim', token: t }, oneShot), isString);
    },
    async accountId(t) {
      return as(
        await ask({ op: 'account', token: t }, oneShot),
        (v): v is number => typeof v === 'number',
      );
    },
  };
}
```

**Change** `packages/engine/src/runtime/docker.ts`:

```diff
diff --git a/packages/engine/src/runtime/docker.ts b/packages/engine/src/runtime/docker.ts
index f9eb426..00b5c4e 100644
--- a/packages/engine/src/runtime/docker.ts
+++ b/packages/engine/src/runtime/docker.ts
@@ -543,2 +543,48 @@ export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
     },
+
+    async plexTvHelper(image, input, user, timeoutMs): Promise<HelperResult> {
+      const result = await docker(
+        'run (plex.tv helper)',
+        [
+          'run',
+          '--rm',
+          // Its standard input: the request, with any token in it.
+          '--interactive',
+          '--init',
+          '--pull',
+          'never',
+          // A route out, and none into the stack: the host network reaches the stack's
+          // networks, the default bridge doesn't.
+          '--network',
+          'bridge',
+          '--user',
+          `${String(user.uid)}:${String(user.gid)}`,
+          '--cap-drop',
+          'ALL',
+          '--security-opt',
+          'no-new-privileges',
+          '--read-only',
+          '--label',
+          `${HELPER_LABEL}=plex-tv`,
+          '--entrypoint',
+          'mediaplane',
+          image,
+          'plex-tv',
+        ],
+        {
+          input,
+          timeoutMs,
+          timeoutError: (cause) =>
+            new HelperError(
+              `the plex.tv helper did not finish within ${String(Math.round(timeoutMs / 1000))} s`,
+              {
+                cause,
+                hint: "check that this host reaches plex.tv: the helper runs on Docker's default bridge network",
+              },
+            ),
+        },
+      );
+      if (result.code === 0) return { ok: true, stdout: result.stdout };
+      return { ok: false, error: lastLines(result.stderr) };
+    },
   };
```

**Change** `packages/engine/src/runtime/types.ts`:

```diff
diff --git a/packages/engine/src/runtime/types.ts b/packages/engine/src/runtime/types.ts
index d60b51a..d22ce93 100644
--- a/packages/engine/src/runtime/types.ts
+++ b/packages/engine/src/runtime/types.ts
@@ -165,2 +165,18 @@ export interface Runtime {
   ): Promise<HelperResult>;
+  /**
+   * Run the plex.tv helper (spec §6.1, ADR 0011): a throwaway container of Mediaplane's own
+   * `image` on Docker's default bridge network, which has a route out but doesn't reach
+   * the stack's networks, as `user`, with no capabilities, a read-only root and no mount,
+   * running `mediaplane plex-tv` with `input` on its standard input, where a token stays
+   * off every command line and out of the container's environment. It never pulls, and
+   * is stopped after `timeoutMs`. A helper that ran and failed is a `HelperResult`; this
+   * throws a `HelperError` when it doesn't finish in time, and a `RuntimeError` when docker
+   * can't be started.
+   */
+  plexTvHelper(
+    image: string,
+    input: string,
+    user: { uid: number; gid: number },
+    timeoutMs: number,
+  ): Promise<HelperResult>;
 }
```

**Change** `packages/engine/src/testing/fakes.ts`:

```diff
diff --git a/packages/engine/src/testing/fakes.ts b/packages/engine/src/testing/fakes.ts
index c07cfa9..075c6d4 100644
--- a/packages/engine/src/testing/fakes.ts
+++ b/packages/engine/src/testing/fakes.ts
@@ -116,2 +116,8 @@ export interface FakeRuntimeOptions {
   ) => HelperResult | Promise<HelperResult>;
+  /**
+   * Answers the plex.tv helper, given what goes on its standard input; without it, the
+   * helper fails. answerPlexTvRequest with a fake plex.tv's client is what the real one
+   * runs.
+   */
+  plexTvHelper?: (input: string) => HelperResult | Promise<HelperResult>;
   /**
@@ -212,2 +218,10 @@ export function fakeRuntime(options: FakeRuntimeOptions = {}): Runtime {
     },
+    // async: a throwing callback rejects like a failed docker call.
+    plexTvHelper: async (_image, input) => {
+      record('plex-tv-helper');
+      if (options.plexTvHelper === undefined) {
+        return { ok: false, error: 'this fake Docker has no plex.tv helper' };
+      }
+      return await options.plexTvHelper(input);
+    },
   };
```

**Change** `packages/engine/src/testing/index.ts`:

```diff
diff --git a/packages/engine/src/testing/index.ts b/packages/engine/src/testing/index.ts
index 60956ae..12c1d37 100644
--- a/packages/engine/src/testing/index.ts
+++ b/packages/engine/src/testing/index.ts
@@ -6,2 +6,3 @@ export * from './http';
 export * from './jellyfin';
+export * from './plextv';
 export * from './prowlarr';
```

**Create** `packages/engine/src/testing/plextv.ts`:

```ts
import { plexTvClient, type PlexTv } from '../plextv/client';
import { fakeHttpApp, type FakeApp, type FakeReply, type FakeRequest } from './http';

/** A plex.tv account the fake knows: its id, and the token a sign-in gave it. */
export interface FakePlexAccount {
  id: number;
  token: string;
}

/** A server a fake account owns, by its machine identifier, as plex.tv lists it. */
export interface FakePlexServer {
  machineId: string;
  owner: number;
  name: string;
  /** Its own token, which its claim gave it: plex.tv takes it as its owner's. */
  token: string;
}

/** A sign-in's PIN, as the fake plex.tv keeps it. */
export interface FakePlexPin {
  id: number;
  code: string;
  clientId: string;
  /** The token of whoever signed in through its link; null until someone has. */
  authToken: string | null;
  /** Forgotten by plex.tv, as an expired PIN is: reading it is 404. */
  expired: boolean;
  /** How many times it was read. */
  reads: number;
}

/** What the fake plex.tv holds; a test may change it between calls. */
export interface FakePlexTvState {
  accounts: FakePlexAccount[];
  servers: FakePlexServer[];
  pins: FakePlexPin[];
  /** The claim tokens it gave, each with its account, until a server uses it. */
  claims: { token: string; account: number; used: boolean }[];
  /**
   * Someone signs in through each PIN's link once it has been read `afterReads` times, as
   * the account whose token is `token`. Unset: nobody does.
   */
  signIn?: { token: string; afterReads: number };
  /** Paths (without the query) that answer `status` instead, as plex.tv failing. */
  failing: { path: string; status: number }[];
  /** Every request's method and path (with the query), in order. */
  calls: string[];
}

/** The account a fake plex.tv knows from the start, and its token. */
export const FAKE_PLEX_ACCOUNT: FakePlexAccount = {
  id: 7_000_001,
  token: 'fake-plex-token-0001',
};

/** A plex.tv that knows FAKE_PLEX_ACCOUNT and nothing else. */
export function freshPlexTv(): FakePlexTvState {
  return {
    accounts: [{ ...FAKE_PLEX_ACCOUNT }],
    servers: [],
    pins: [],
    claims: [],
    failing: [],
    calls: [],
  };
}

/** plex.tv's refusal of a token it doesn't know, as `/api/v2/…` gives it (probed). */
const NOT_AUTHENTICATED: FakeReply = {
  status: 401,
  body: {
    errors: [{ code: 1001, message: 'User could not be authenticated', status: 401 }],
  },
};

/** plex.tv's answer for a PIN it doesn't know, or no longer does (probed). */
const NO_PIN: FakeReply = {
  status: 404,
  body: { errors: [{ code: 1020, message: 'Code not found or expired', status: 404 }] },
};

/** A strong PIN's code: 25 characters (probed). */
function pinCode(id: number): string {
  return `fakecode${String(id)}`.padEnd(25, 'x');
}

/**
 * plex.tv's API, as far as Mediaplane uses it, from `state`, as plex.tv answered it when
 * probed (2026-10-16):
 * - `POST /api/v2/pins?strong=true` makes a PIN for the device in
 *   `X-Plex-Client-Identifier` (201: a 25-character code, 1800 s), and `GET
 *   /api/v2/pins/<id>` reads it, `authToken` null until someone signs in, for that device
 *   only: another device, an unknown id or an expired PIN is 404;
 * - `GET /api/claim/token.json` gives a claim token (`claim-` and 20 characters) for the
 *   token's account; an unknown token is 401 with `{"error":…}`;
 * - `GET /api/v2/user` gives the token's account: an account's own token, or a server's,
 *   which its claim gave it, as its owner's; an unknown token, or a server's once the
 *   server is removed from its account, is 401.
 */
export function answerPlexTv(request: FakeRequest, state: FakePlexTvState): FakeReply {
  state.calls.push(`${request.method} ${request.path}`);
  const url = new URL(request.path, 'http://plex.tv');
  const failing = state.failing.find((f) => f.path === url.pathname);
  if (failing !== undefined) {
    return { status: failing.status, body: '<html>fake failure</html>' };
  }
  const clientId = request.headers['x-plex-client-identifier'];
  const account = state.accounts.find((a) => a.token === request.headers['x-plex-token']);
  if (url.pathname === '/api/v2/pins' && request.method === 'POST') {
    if (typeof clientId !== 'string' || clientId === '') {
      return {
        status: 400,
        body: {
          errors: [
            { code: 1000, message: 'X-Plex-Client-Identifier is missing', status: 400 },
          ],
        },
      };
    }
    const id = state.pins.length + 1;
    const pin: FakePlexPin = {
      id,
      code: pinCode(id),
      clientId,
      authToken: null,
      expired: false,
      reads: 0,
    };
    state.pins.push(pin);
    return {
      status: 201,
      body: {
        id,
        code: pin.code,
        product: 'Mediaplane',
        trusted: false,
        clientIdentifier: clientId,
        expiresIn: 1800,
        authToken: null,
        newRegistration: null,
      },
    };
  }
  const pinPath = /^\/api\/v2\/pins\/(\d+)$/.exec(url.pathname);
  if (pinPath !== null && request.method === 'GET') {
    const pin = state.pins.find((p) => p.id === Number(pinPath[1]));
    if (pin === undefined || pin.expired || pin.clientId !== clientId) return NO_PIN;
    pin.reads += 1;
    if (state.signIn !== undefined && pin.reads > state.signIn.afterReads) {
      pin.authToken = state.signIn.token;
    }
    return {
      status: 200,
      body: {
        id: pin.id,
        code: pin.code,
        clientIdentifier: pin.clientId,
        expiresIn: 1700,
        authToken: pin.authToken,
      },
    };
  }
  if (url.pathname === '/api/claim/token.json' && request.method === 'GET') {
    if (account === undefined) {
      return { status: 401, body: { error: 'Invalid authentication token.' } };
    }
    const token = `claim-fake${String(state.claims.length + 1)}`.padEnd(26, 'c');
    state.claims.push({ token, account: account.id, used: false });
    return { status: 200, body: { token } };
  }
  if (url.pathname === '/api/v2/user' && request.method === 'GET') {
    const server = state.servers.find((s) => s.token === request.headers['x-plex-token']);
    const whose = account ?? state.accounts.find((a) => a.id === server?.owner);
    if (whose === undefined) return NOT_AUTHENTICATED;
    return {
      status: 200,
      body: {
        id: whose.id,
        uuid: 'fakeuuid',
        username: 'fake-user',
        authToken: whose.token,
      },
    };
  }
  return { status: 404, body: { errors: [{ code: 1, message: 'Not Found' }] } };
}

/**
 * A fake plex.tv on 127.0.0.1, answering as answerPlexTv does, and a client of it as
 * Mediaplane's own (plexTvClient), on a clock of its own that a wait moves forward at
 * once: a sign-in's PIN is asked about every 2 seconds of that clock, and nobody waits.
 */
export async function fakePlexTv(state: FakePlexTvState = freshPlexTv()): Promise<{
  app: FakeApp;
  state: FakePlexTvState;
  client: PlexTv;
}> {
  const app = await fakeHttpApp((request) => answerPlexTv(request, state));
  let clock = 0;
  const client = plexTvClient({
    base: `http://127.0.0.1:${String(app.port)}`,
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
  });
  return { app, state, client };
}
```

**Change** `packages/engine/src/util/redact.ts`:

```diff
diff --git a/packages/engine/src/util/redact.ts b/packages/engine/src/util/redact.ts
index 32dfcdf..d6ed575 100644
--- a/packages/engine/src/util/redact.ts
+++ b/packages/engine/src/util/redact.ts
@@ -11,2 +11,7 @@ export function redact(text: string, values: Readonly<Record<string, string>>):
 
+/** `secrets` as redact() and the runtime take them, by position. */
+export function redactionValues(secrets: readonly string[]): Record<string, string> {
+  return Object.fromEntries(secrets.map((secret, i) => [String(i), secret]));
+}
+
 /**
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run packages/cli/src/run.test.ts packages/engine/src/plextv/client.test.ts packages/engine/src/plextv/helper.test.ts packages/engine/src/runtime/docker.test.ts packages/engine/src/testing/fakes.test.ts`
Expected: PASS.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages
git commit -m "feat(engine): plex.tv from source, and through a short-lived helper on the default bridge in the image" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1787 tests pass in 85 files (1753 in 83 files before this slice).

---

### Task 2: `mediaplane plex-login`

The one manual step of a Plex stack (success criterion 2): sign in to plex.tv in a
browser, and save the token where `plex.token` says.

Decision: a strong PIN, a client id per sign-in, the product `Mediaplane`, a wait of two
seconds between questions, `--timeout`, a saved token kept unless `--force` and replaced
when refused, an environment reference refused (decision 10).

**Files:**
- Create: `packages/cli/src/plex-login.ts`
- Modify: `packages/cli/src/run.ts`, `packages/cli/src/init.ts`,
  `packages/engine/src/config/secrets.ts`; generated: `docs/reference/cli.md`
- Test: `packages/cli/src/plex-login.test.ts` (new), `packages/cli/src/init.test.ts`,
  `packages/engine/src/config/secrets.test.ts`

**Interfaces:**
- **Consumes:** Task 1's `PlexTv`, `PlexTvError`, `newClientId`, `signInLink` and
  `CliDeps.plexTv`; `loadConfigFile`, `writeFileAtomic`, `printError`,
  `printDiagnostics`.
- **Produces:** `plexLogin(options: PlexLoginOptions, io: Io, plexTv: PlexTv): Promise<number>`,
  `interface PlexLoginOptions { home: string; json: boolean; force: boolean; timeout?: string }`,
  `PLEX_LOGIN_JSON_SCHEMA` (`'mediaplane.plex-login/v1'`), `PLEX_LOGIN_MAX_SECONDS`
  (1800); the command `mediaplane plex-login [--home <dir>] [--force] [--timeout <seconds>] [--json]`
  and `EXIT_CODES['plex-login']`.

- [ ] **Step 1: Write the failing tests**

**Change** `packages/cli/src/init.test.ts`:

```diff
diff --git a/packages/cli/src/init.test.ts b/packages/cli/src/init.test.ts
index 6e72564..5dcced2 100644
--- a/packages/cli/src/init.test.ts
+++ b/packages/cli/src/init.test.ts
@@ -228,3 +228,3 @@ describe('mediaplane init', () => {
     expect(term.stdout()).toContain(
-      `Save your Plex token in ${join(home, 'secrets', 'plex-token')}.`,
+      `Run "mediaplane plex-login" to sign in to Plex: it saves your Plex token in ${join(home, 'secrets', 'plex-token')}.`,
     );
```

**Create** `packages/cli/src/plex-login.test.ts`:

```ts
import { lstat, mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { plexTvClient, type PlexTv } from '@mediaplane/engine';
import {
  closedPort,
  FAKE_PLEX_ACCOUNT,
  fakePlexTv,
  tempDir,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { run, type Io } from './run';

const PLEX_STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: plex
plex: { token: { file: secrets/plex-token } }
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;

const TOKEN = FAKE_PLEX_ACCOUNT.token;
const OLD = 'old-plex-token-00001';

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

async function makeHome(stack = PLEX_STACK): Promise<string> {
  const home = await tempDir('mediaplane-plex-login-');
  await writeFile(join(home, 'stack.yaml'), stack);
  return home;
}

/** plex-login in `home`, against `plexTv`, with `args`. */
async function login(home: string, plexTv: PlexTv, args: string[] = [], env = {}) {
  const term = capture(env);
  const code = await run(['plex-login', '--home', home, ...args], term.io, {
    plexTv: () => plexTv,
  });
  const said = term.stdout() + term.stderr();
  return { code, said, stdout: term.stdout(), stderr: term.stderr() };
}

describe('mediaplane plex-login', () => {
  it('prints a link, waits for the sign-in, and saves the token 0600 where plex.token says', async () => {
    const home = await makeHome();
    const plexTv = await fakePlexTv();
    plexTv.state.signIn = { token: TOKEN, afterReads: 1 };
    const { code, stdout, said } = await login(home, plexTv.client);
    expect(code).toBe(0);
    const pin = plexTv.state.pins[0];
    expect(stdout).toContain(
      `Sign in to Plex in a browser, with this link:\n\n  https://app.plex.tv/auth#?clientID=${String(pin?.clientId)}&code=${String(pin?.code)}&context%5Bdevice%5D%5Bproduct%5D=Mediaplane\n\nWaiting for you to sign in (up to 30 minutes)...\n`,
    );
    expect(stdout).toContain(
      'Signed in. Saved your Plex token in secrets/plex-token. Next: run "mediaplane apply".\n',
    );
    expect(pin?.clientId).toMatch(/^mediaplane-[0-9a-f-]{36}$/);
    const path = join(home, 'secrets', 'plex-token');
    expect(await readFile(path, 'utf8')).toBe(`${TOKEN}\n`);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, 'secrets'))).mode & 0o777).toBe(0o700);
    expect(said).not.toContain(TOKEN);
  });

  it('prints JSON with --json, the link on stderr, and never the token', async () => {
    const home = await makeHome();
    const plexTv = await fakePlexTv();
    plexTv.state.signIn = { token: TOKEN, afterReads: 0 };
    const { code, stdout, stderr } = await login(home, plexTv.client, ['--json']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      schema: 'mediaplane.plex-login/v1',
      ok: true,
      saved: 'secrets/plex-token',
      signedIn: true,
      replaced: false,
    });
    expect(stderr).toContain('https://app.plex.tv/auth#?clientID=');
    expect(stdout + stderr).not.toContain(TOKEN);
  });

  it('keeps a saved token that plex.tv takes, without a sign-in, unless --force', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'plex-token'), `${TOKEN}\n`);
    const plexTv = await fakePlexTv();
    const kept = await login(home, plexTv.client);
    expect(kept.code).toBe(0);
    expect(kept.stdout).toBe(
      'The Plex token in secrets/plex-token works, so there is nothing to do. Run "mediaplane plex-login --force" to sign in again.\n',
    );
    expect(plexTv.state.calls).toEqual(['GET /api/v2/user']);

    plexTv.state.accounts.push({ id: 7_000_002, token: 'new-plex-token-00002' });
    plexTv.state.signIn = { token: 'new-plex-token-00002', afterReads: 0 };
    const forced = await login(home, plexTv.client, ['--force', '--json']);
    expect(forced.code).toBe(0);
    expect(JSON.parse(forced.stdout)).toMatchObject({ signedIn: true, replaced: true });
    expect(await readFile(join(home, 'secrets', 'plex-token'), 'utf8')).toBe(
      'new-plex-token-00002\n',
    );
    expect(forced.said).not.toContain('new-plex-token');
  });

  it('signs in again when plex.tv refuses the saved token, and replaces it', async () => {
    const home = await makeHome();
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'plex-token'), `${OLD}\n`);
    const plexTv = await fakePlexTv();
    plexTv.state.signIn = { token: TOKEN, afterReads: 0 };
    const { code, stderr, said } = await login(home, plexTv.client);
    expect(code).toBe(0);
    expect(stderr).toBe(
      'plex.tv refuses the Plex token in secrets/plex-token, so sign in again.\n',
    );
    expect(await readFile(join(home, 'secrets', 'plex-token'), 'utf8')).toBe(
      `${TOKEN}\n`,
    );
    expect(said).not.toContain(OLD);
    expect(said).not.toContain(TOKEN);
  });

  it('stops after --timeout when nobody signs in, and saves nothing', async () => {
    const home = await makeHome();
    const plexTv = await fakePlexTv();
    const { code, stdout, stderr } = await login(home, plexTv.client, ['--timeout', '1']);
    expect(code).toBe(1);
    expect(stdout).toContain('Waiting for you to sign in (up to 1 second)...');
    expect(stderr).toBe(
      'error: nobody signed in within 1 second; run plex-login again for a new link\n',
    );
    await expect(stat(join(home, 'secrets', 'plex-token'))).rejects.toThrow();
  });

  it('says the link ran out once plex.tv forgets the PIN', async () => {
    const home = await makeHome();
    const plexTv = await fakePlexTv();
    // A PIN plex.tv no longer knows, as one that has run out.
    const forgotten: PlexTv = {
      ...plexTv.client,
      createPin: async (clientId) => ({
        ...(await plexTv.client.createPin(clientId)),
        id: 999,
      }),
    };
    const { code, stderr } = await login(home, forgotten, ['--json']);
    expect(code).toBe(1);
    expect(stderr).toContain('https://app.plex.tv/auth#?clientID=');
    const { stdout } = await login(home, forgotten, ['--json']);
    expect(JSON.parse(stdout)).toEqual({
      schema: 'mediaplane.error/v1',
      ok: false,
      error: {
        message:
          'the link ran out before you signed in; run plex-login again for a new one',
      },
    });
  });

  it("says when plex.tv can't be reached", async () => {
    const home = await makeHome();
    const client = plexTvClient({
      base: `http://127.0.0.1:${String(await closedPort())}`,
      sleep: () => Promise.resolve(),
    });
    const { code, stderr } = await login(home, client);
    expect(code).toBe(1);
    expect(stderr).toBe(
      "error: couldn't reach plex.tv: plex.tv could not be reached (ECONNREFUSED) (POST /api/v2/pins); check this host's internet connection, then run plex-login again\n",
    );
  });

  it('refuses a --timeout that is not 1 to 1800 seconds, without asking plex.tv', async () => {
    const home = await makeHome();
    const plexTv = await fakePlexTv();
    for (const timeout of ['0', '1801', 'soon', '1.5', '-5']) {
      const { code, stderr } = await login(home, plexTv.client, [`--timeout=${timeout}`]);
      expect(code).toBe(1);
      expect(stderr).toBe(
        'error: --timeout must be a whole number of seconds from 1 to 1800\n',
      );
    }
    expect(plexTv.state.calls).toEqual([]);
  });

  it('refuses a stack.yaml without plex.token, or one that reads it from the environment', async () => {
    const plexTv = await fakePlexTv();
    const jellyfin = await makeHome(
      PLEX_STACK.replace(/media_server: plex\nplex: .*\n/, 'media_server: jellyfin\n'),
    );
    const none = await login(jellyfin, plexTv.client);
    expect(none.code).toBe(1);
    expect(none.stderr).toBe(
      'error: stack.yaml has no plex.token, which says where your Plex token goes: set media_server: plex and plex.token: { file: secrets/plex-token }, then run plex-login again\n',
    );
    const fromEnv = await makeHome(
      PLEX_STACK.replace('{ file: secrets/plex-token }', '{ env: PLEX_TOKEN }'),
    );
    const env = await login(fromEnv, plexTv.client, [], { PLEX_TOKEN: TOKEN });
    expect(env.code).toBe(1);
    expect(env.stderr).toBe(
      "error: plex.token is read from the environment variable PLEX_TOKEN, where plex-login can't save it: set plex.token: { file: secrets/plex-token } instead, then run plex-login again\n",
    );
    expect(plexTv.state.calls).toEqual([]);
  });

  it('says what is wrong with a missing stack.yaml', async () => {
    const home = await tempDir('mediaplane-plex-login-');
    const plexTv = await fakePlexTv();
    const { code, stderr } = await login(home, plexTv.client);
    expect(code).toBe(1);
    expect(stderr).toContain(`error: no stack.yaml at ${join(home, 'stack.yaml')}`);
  });

  it('replaces a link at the token file with the file itself, never writing through it', async () => {
    const home = await makeHome();
    const elsewhere = join(await tempDir('mediaplane-elsewhere-'), 'target');
    await writeFile(elsewhere, 'not yours\n');
    await mkdir(join(home, 'secrets'));
    await symlink(elsewhere, join(home, 'secrets', 'plex-token'));
    const plexTv = await fakePlexTv();
    plexTv.state.signIn = { token: TOKEN, afterReads: 0 };
    // The link's target holds no token plex.tv takes, so plex-login signs in again.
    expect((await login(home, plexTv.client)).code).toBe(0);
    expect(await readFile(elsewhere, 'utf8')).toBe('not yours\n');
    const saved = join(home, 'secrets', 'plex-token');
    expect((await lstat(saved)).isSymbolicLink()).toBe(false);
    expect(await readFile(saved, 'utf8')).toBe(`${TOKEN}\n`);
  });

  it('lists its exit codes in --help', async () => {
    const term = capture();
    expect(await run(['plex-login', '--help'], term.io)).toBe(0);
    expect(term.stdout()).toContain(
      'Exit codes:\n  0: signed in and saved your Plex token, or the saved one works\n  1: nobody signed in in time, the link ran out, or an error\n',
    );
  });
});
```

**Change** `packages/engine/src/config/secrets.test.ts`:

```diff
diff --git a/packages/engine/src/config/secrets.test.ts b/packages/engine/src/config/secrets.test.ts
index 7c0a6b8..124d1db 100644
--- a/packages/engine/src/config/secrets.test.ts
+++ b/packages/engine/src/config/secrets.test.ts
@@ -82,3 +82,7 @@ describe('secretRefs and checkSecretRefs', () => {
       expect.arrayContaining([
-        expect.objectContaining({ code: 'secret.missing', path: 'plex.token' }),
+        expect.objectContaining({
+          code: 'secret.missing',
+          path: 'plex.token',
+          hint: 'run "mediaplane plex-login": it signs you in to Plex, and saves your token where plex.token says',
+        }),
       ]),
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/cli/src/init.test.ts packages/cli/src/plex-login.test.ts packages/engine/src/config/secrets.test.ts`
Expected: FAIL. 14 tests fail in the 3 files, 95 pass: the 12 of `plex-login.test.ts` (`error: unknown command 'plex-login'`), `init.test.ts`'s next step (`expected … to contain 'Run "mediaplane plex-login" to sign i…'`), and `secrets.test.ts`'s hint for a missing `plex.token`.

- [ ] **Step 3: Write `plex-login`**

**Change** `packages/cli/src/init.ts`:

```diff
diff --git a/packages/cli/src/init.ts b/packages/cli/src/init.ts
index fa08e09..a671096 100644
--- a/packages/cli/src/init.ts
+++ b/packages/cli/src/init.ts
@@ -95,3 +95,5 @@ export async function init(
     ...(answers.mediaServer === 'plex'
-      ? [`Save your Plex token in ${join(secrets, 'plex-token')}.`]
+      ? [
+          `Run "mediaplane plex-login" to sign in to Plex: it saves your Plex token in ${join(secrets, 'plex-token')}.`,
+        ]
       : []),
@@ -328,3 +330,3 @@ export const NOTES = {
     'Media server: jellyfin needs no account. plex needs a Plex',
-    "account; Mediaplane can't claim it for you until Slice 7.",
+    'account: run "mediaplane plex-login" once init is done.',
   ],
```

**Create** `packages/cli/src/plex-login.ts`:

```ts
import { chmod, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import {
  loadConfigFile,
  newClientId,
  PlexTvError,
  readSecret,
  signInLink,
  STACK_PATH,
  writeFileAtomic,
  type PlexTv,
} from '@mediaplane/engine';
import { printDiagnostics, printError } from './output';
import type { Io } from './run';

export const PLEX_LOGIN_JSON_SCHEMA = 'mediaplane.plex-login/v1';

/** The longest plex-login waits: a strong PIN lasts 30 minutes (probed). */
export const PLEX_LOGIN_MAX_SECONDS = 1800;

export interface PlexLoginOptions {
  /** The Mediaplane home, absolute. */
  home: string;
  json: boolean;
  /** Sign in again even though the saved token works. */
  force: boolean;
  /** The longest to wait for the sign-in, in seconds; the link's own life by default. */
  timeout?: string;
}

/** Why the sign-in didn't happen, said once; never holds a token. */
class LoginStopped extends Error {}

/**
 * `mediaplane plex-login` (spec §5.2, §6.1): sign in to plex.tv with its PIN flow, and save
 * the token where stack.yaml's `plex.token` names a file, 0600. It prints a link, then waits
 * for the sign-in, asking plex.tv every 2 seconds, for as long as the link lasts (30
 * minutes) or `--timeout` says. The token is the account's long-lived one, which the PIN
 * gives: never the 7-day JWT. A saved token that plex.tv still takes is kept, unless
 * `--force`; one it refuses is replaced. The token is never printed. Returns the exit code.
 */
export async function plexLogin(
  options: PlexLoginOptions,
  io: Io,
  plexTv: PlexTv,
): Promise<number> {
  const { home, json } = options;
  const seconds = timeoutSeconds(options.timeout);
  if (seconds === undefined) {
    printError(
      `--timeout must be a whole number of seconds from 1 to ${String(PLEX_LOGIN_MAX_SECONDS)}`,
      { json },
      io,
    );
    return 1;
  }
  const loaded = await loadConfigFile(join(home, STACK_PATH));
  if (!loaded.ok) {
    printDiagnostics(loaded.diagnostics, { json }, io);
    return 1;
  }
  const ref = loaded.config.plex?.token;
  if (ref === undefined) {
    printError(
      'stack.yaml has no plex.token, which says where your Plex token goes: set media_server: plex and plex.token: { file: secrets/plex-token }, then run plex-login again',
      { json },
      io,
    );
    return 1;
  }
  if ('env' in ref) {
    printError(
      `plex.token is read from the environment variable ${ref.env}, where plex-login can't save it: set plex.token: { file: secrets/plex-token } instead, then run plex-login again`,
      { json },
      io,
    );
    return 1;
  }
  const path = isAbsolute(ref.file) ? ref.file : join(home, ref.file);
  const shown = isAbsolute(ref.file) ? ref.file : relative(home, path);
  try {
    const saved = await readSecret(ref, home, io.env);
    if (saved !== undefined && !options.force) {
      if (await works(plexTv, saved)) {
        report(options, io, {
          saved: shown,
          signedIn: false,
          replaced: false,
          said: `The Plex token in ${shown} works, so there is nothing to do. Run "mediaplane plex-login --force" to sign in again.`,
        });
        return 0;
      }
      io.stderr(`plex.tv refuses the Plex token in ${shown}, so sign in again.\n`);
    }
    const pin = await plexTv.createPin(newClientId());
    const wait = Math.min(seconds ?? pin.expiresIn, pin.expiresIn);
    // On stderr with --json: what to do, for you, apart from what scripts read.
    const say = (text: string) => {
      if (json) io.stderr(text);
      else io.stdout(text);
    };
    say(
      `Sign in to Plex in a browser, with this link:\n\n  ${signInLink(pin)}\n\nWaiting for you to sign in (up to ${minutes(wait)})...\n`,
    );
    const token = await plexTv.waitForPin(pin, wait);
    if (token === undefined) {
      throw new LoginStopped(
        `nobody signed in within ${minutes(wait)}; run plex-login again for a new link`,
      );
    }
    await mkdir(dirname(path), { recursive: true });
    if (dirname(path) === join(home, 'secrets')) await chmod(dirname(path), 0o700);
    // Whole or not at all, and 0600: the token is the key to your Plex account.
    await writeFileAtomic(path, `${token}\n`, 0o600);
    report(options, io, {
      saved: shown,
      signedIn: true,
      replaced: saved !== undefined,
      said: `Signed in. Saved your Plex token in ${shown}. Next: run "mediaplane apply".`,
    });
    return 0;
  } catch (cause) {
    if (cause instanceof LoginStopped) {
      printError(cause.message, { json }, io);
      return 1;
    }
    if (!(cause instanceof PlexTvError)) throw cause;
    const next =
      cause.kind === 'expired'
        ? 'the link ran out before you signed in; run plex-login again for a new one'
        : cause.unsure
          ? `couldn't reach plex.tv: ${cause.message}; check this host's internet connection, then run plex-login again`
          : `plex.tv refused: ${cause.message}`;
    printError(next, { json }, io);
    return 1;
  }
}

/** Whether plex.tv takes `token`: it refuses one that was revoked (401). */
async function works(plexTv: PlexTv, token: string): Promise<boolean> {
  try {
    await plexTv.accountId(token);
    return true;
  } catch (cause) {
    if (cause instanceof PlexTvError && cause.kind === 'refused') return false;
    throw cause;
  }
}

/** --timeout's seconds; null when it isn't given, undefined when it isn't one. */
function timeoutSeconds(value: string | undefined): number | null | undefined {
  if (value === undefined) return null;
  if (!/^[1-9][0-9]*$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds > PLEX_LOGIN_MAX_SECONDS ? undefined : seconds;
}

/** "30 minutes", "2 minutes", "1 minute", "45 seconds", "1 second". */
function minutes(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const count = seconds / 60;
    return `${String(count)} minute${count === 1 ? '' : 's'}`;
  }
  return `${String(seconds)} second${seconds === 1 ? '' : 's'}`;
}

function report(
  options: PlexLoginOptions,
  io: Io,
  result: { saved: string; signedIn: boolean; replaced: boolean; said: string },
): void {
  if (options.json) {
    io.stdout(
      `${JSON.stringify(
        {
          schema: PLEX_LOGIN_JSON_SCHEMA,
          ok: true,
          saved: result.saved,
          signedIn: result.signedIn,
          replaced: result.replaced,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  io.stdout(`${result.said}\n`);
}
```

**Change** `packages/cli/src/run.ts`:

```diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index 908604e..5d741f4 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -38,2 +38,3 @@ import { prepareDataFolder, type DataFolder } from './folders';
 import { init, type InitOptions } from './init';
+import { plexLogin, PLEX_LOGIN_MAX_SECONDS } from './plex-login';
 import {
@@ -114,2 +115,6 @@ export const EXIT_CODES: Readonly<Record<string, readonly string[]>> = {
   ],
+  'plex-login': [
+    '0: signed in and saved your Plex token, or the saved one works',
+    '1: nobody signed in in time, the link ran out, or an error',
+  ],
   'vpn-check': [
@@ -441,2 +446,38 @@ export function createProgram(
 
+  program
+    .command('plex-login')
+    .description(
+      'Sign in to Plex in a browser, and save your Plex token where plex.token in stack.yaml says',
+    )
+    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
+    .option('--force', 'sign in again, even though the saved token works')
+    .option(
+      '--timeout <seconds>',
+      `how long to wait for you to sign in (default: as long as the link lasts, ${String(PLEX_LOGIN_MAX_SECONDS / 60)} minutes)`,
+    )
+    .option('--json', 'print machine-readable JSON; the link still goes to stderr')
+    .addHelpText('after', exitCodesHelp('plex-login'))
+    .action(
+      async (options: {
+        home: string;
+        force?: boolean;
+        timeout?: string;
+        json?: boolean;
+      }) => {
+        const home = resolve(options.home);
+        setExitCode(
+          await plexLogin(
+            {
+              home,
+              json: options.json === true,
+              force: options.force === true,
+              ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
+            },
+            io,
+            deps.plexTv(deps.runtime(home, project)),
+          ),
+        );
+      },
+    );
+
   program
```

**Change** `packages/engine/src/config/secrets.ts`:

```diff
diff --git a/packages/engine/src/config/secrets.ts b/packages/engine/src/config/secrets.ts
index ce22297..90f7e3d 100644
--- a/packages/engine/src/config/secrets.ts
+++ b/packages/engine/src/config/secrets.ts
@@ -62,2 +62,7 @@ export async function checkSecretRefs(
           path,
+          ...(path === 'plex.token'
+            ? {
+                hint: 'run "mediaplane plex-login": it signs you in to Plex, and saves your token where plex.token says',
+              }
+            : {}),
         }),
```

- [ ] **Step 4: Run them to see them pass, and regenerate the CLI reference**

```bash
pnpm vitest run packages/cli/src/init.test.ts packages/cli/src/plex-login.test.ts packages/engine/src/config/secrets.test.ts
pnpm docs:generate
```

Expected: PASS. `docs:generate` adds `mediaplane plex-login` to `docs/reference/cli.md`.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages docs/reference
git commit -m "feat(cli): mediaplane plex-login, which signs in to plex.tv with its PIN and saves your Plex token" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1799 tests pass in 86 files.

---

### Task 3: Plex claimed for your account before it is published

Plex starts unpublished, with a claim token of your account in `PLEX_CLAIM`, and is
published only once plex.tv says the token its claim gave it is your account's.

Decision: Plex is a keyless first-run setup (decision 1).
Decision: the claim token reaches Compose through its environment, on the unpublished
start only, fetched the moment before (decision 2).
Decision: ownership is plex.tv's answer for Plex's own token, never what Plex says of
itself (decision 3), after a wait for the claim (decision 4).
Decision: the remedies for a Plex claimed by another account, safe ones first
(decision 5).
Decision: `plan` never calls plex.tv (decision 11).
Decision: Plex never gets your token before plex.tv says it is yours (decision 3); the
claim token is asked for before anything changes, and a running Plex it was for is
stopped when it can't be had (decision 2).
Decision: of the secrets you give, only an app's key is a key (decision 25).

**Files:**
- Create: `catalog/plex/bootstrap.ts`, `packages/engine/src/testing/plex.ts`
- Modify: `packages/engine/src/catalog/types.ts`, `packages/engine/src/http/client.ts`,
  `packages/engine/src/plextv/client.ts`, `packages/engine/src/secrets/values.ts`,
  `packages/engine/src/apply/apply.ts`, `packages/engine/src/apply/bootstrap.ts`,
  `packages/engine/src/plan/plan.ts`, `packages/engine/src/integrations/wire.ts`,
  `packages/engine/src/integrations/wiring.ts`, `packages/engine/src/runtime/types.ts`,
  `packages/engine/src/runtime/docker.ts`, `packages/engine/src/config/schema.ts`,
  `packages/engine/src/testing/bootstrap.ts`, `packages/engine/src/testing/fakes.ts`,
  `packages/engine/src/testing/wiring.ts`, `packages/engine/src/testing/index.ts`,
  `catalog/plex/app.ts`, `catalog/seerr/bootstrap.ts`, `packages/cli/src/run.ts`,
  `scripts/docs/catalog-facts.ts`; generated: `docs/reference/stack-yaml.md`,
  `docs/reference/stack.schema.json`, `catalog/plex/README.md`
- Test: `catalog/plex/bootstrap.test.ts` (new), `packages/engine/src/apply/apply.test.ts`,
  `packages/engine/src/http/client.test.ts`, `packages/engine/src/plextv/client.test.ts`,
  `packages/engine/src/runtime/docker.test.ts`, `packages/engine/src/secrets/values.test.ts`,
  `packages/engine/src/integrations/wire.test.ts`, `catalog/catalog.test.ts`,
  `catalog/jellyfin/integration.test.ts`, `catalog/seerr/bootstrap.test.ts`,
  `catalog/seerr/integration.test.ts`, `packages/cli/src/run.test.ts`,
  `scripts/docs/catalog-facts.test.ts`

**Interfaces:**
- **Consumes:** Task 1's `PlexTv`, `PlexTvError` and `fakePlexTv`; S5's and S6's bootstrap
  step (`bootstrapApps`, `BootstrapChange`, `SetupWaiting`, the `setUp` record, the
  Compose file on standard input that resets ports).
- **Produces:**
  - `type KeyScheme = 'x-api-key' | 'bearer' | 'mediabrowser' | 'x-plex-token'`;
    `AppApi.until<T>(path: string, schema: z.ZodType<T>, done: (answer: T) => boolean, options?: { anonymous?: boolean }): Promise<T>`;
  - `interface BootstrapContext { keys: Readonly<Record<string, Readonly<Record<string, string>>>>; plexTv: PlexTv }`;
    `Bootstrap.firstStart?(stack, ctx): Promise<Record<string, string>>`,
    `Bootstrap.run(api, admin, stack, ctx)`, `Bootstrap.claimedHint?(stack, container): string`;
  - `NO_PLEX_TV: PlexTv`; `userSecrets(stack, env)`, `stackKeys(stack, store, given)`;
    `firstStartEnv(stack, pending, ctx)`,
    `startVariables(stack, pending, ctx, runtime, values)`; `ApplyOptions.plexTv`,
    `BootstrapOptions.given` and `plexTv`;
  - `Runtime.up(waitSeconds, values, unpublished?, startEnv?)`,
    `startEnvName(service, variable)` (`MP_START_<SERVICE>_<VARIABLE>`);
  - in the catalog: `plexBootstrap`, `PREFERENCES`; Plex's `api`
    (`{ port: 'web', ready: '/identity', key: { secret: 'token', scheme: 'x-plex-token' }, check: '/library/sections' }`);
  - from `@mediaplane/engine/testing`: `fakePlex(request, plex, plexTv)`, `freshPlex()`,
    `FakePlex`, `FakePlexSection`, `claimFakePlex(plex, claim, plexTv): boolean`,
    `FAKE_SERVER_TOKEN` (`'fake-server-token-01'`), `PLEX_PREFERENCES`,
    `FAKE_PLEX_HOSTNAME`, `NO_SETUP_CONTEXT`; `fakeStackApis(plexTv?)` answers
    `Host: plex`, and `FakeAppState.plex`; `fakeRuntime`'s `onUp(unpublished, startEnv)`.

- [ ] **Step 1: Write the failing tests**

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index 7d746d3..38b3605 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -40,2 +40,3 @@ describe('catalog', () => {
       'jellyfin',
+      'plex',
       'prowlarr',
@@ -65,3 +66,3 @@ describe('catalog', () => {
     const set = catalog.filter((app) => app.bootstrap !== undefined);
-    expect(set.map((app) => app.id)).toEqual(['jellyfin', 'seerr']);
+    expect(set.map((app) => app.id)).toEqual(['jellyfin', 'plex', 'seerr']);
     for (const app of set) {
@@ -70,5 +71,9 @@ describe('catalog', () => {
       // One whose setup makes its key names it; one that makes none has a key of
-      // Mediaplane's, which its done file can't stand in for.
-      if (made === undefined) expect(app.secrets[key]).toEqual({ generate: 'hex32' });
-      else {
+      // Mediaplane's (Seerr's), or yours (Plex's token), which its done file can't stand
+      // in for.
+      if (made === undefined) {
+        expect([{ generate: 'hex32' }, { userProvided: 'plex.token' }]).toContainEqual(
+          app.secrets[key],
+        );
+      } else {
         expect(made).toBe(key);
```

**Change** `catalog/jellyfin/integration.test.ts`:

```diff
diff --git a/catalog/jellyfin/integration.test.ts b/catalog/jellyfin/integration.test.ts
index 52ad95f..9a8296c 100644
--- a/catalog/jellyfin/integration.test.ts
+++ b/catalog/jellyfin/integration.test.ts
@@ -12,2 +12,3 @@ import {
   freshAppState,
+  NO_SETUP_CONTEXT,
   wiringStack,
@@ -160,3 +161,8 @@ describe("Jellyfin's first-run setup", () => {
     expect(await jellyfinBootstrap.open(api)).toBe(true);
-    const key = await jellyfinBootstrap.run(api, ADMIN, contextOf().stack);
+    const key = await jellyfinBootstrap.run(
+      api,
+      ADMIN,
+      contextOf().stack,
+      NO_SETUP_CONTEXT,
+    );
     expect(key).toMatch(/^[0-9a-f]{32}$/);
@@ -187,3 +193,5 @@ describe("Jellyfin's first-run setup", () => {
     const { api, state, app } = await jellyfin(setUp());
-    expect(await jellyfinBootstrap.run(api, ADMIN, contextOf().stack)).toBe(KEY);
+    expect(
+      await jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
+    ).toBe(KEY);
     expect(state.apiKeys).toHaveLength(1);
@@ -199,5 +207,5 @@ describe("Jellyfin's first-run setup", () => {
     });
-    expect(await jellyfinBootstrap.run(api, ADMIN, contextOf().stack)).toMatch(
-      /^[0-9a-f]{32}$/,
-    );
+    expect(
+      await jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
+    ).toMatch(/^[0-9a-f]{32}$/);
     expect(state.wizard).toBe('done');
@@ -212,3 +220,5 @@ describe("Jellyfin's first-run setup", () => {
     });
-    const refused = await failure(jellyfinBootstrap.run(api, ADMIN, contextOf().stack));
+    const refused = await failure(
+      jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
+    );
     expect(refused.message).toBe(
@@ -223,3 +233,7 @@ describe("Jellyfin's first-run setup", () => {
     expect(
-      (await failure(jellyfinBootstrap.run(api, ADMIN, contextOf().stack))).message,
+      (
+        await failure(
+          jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
+        )
+      ).message,
     ).toContain(
@@ -233,3 +247,5 @@ describe("Jellyfin's first-run setup", () => {
     );
-    const failed = await failure(jellyfinBootstrap.run(api, ADMIN, contextOf().stack));
+    const failed = await failure(
+      jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
+    );
     expect(failed.status).toBe(502);
@@ -244,3 +260,7 @@ describe("Jellyfin's first-run setup", () => {
     expect(
-      (await failure(jellyfinBootstrap.run(both.api, ADMIN, contextOf().stack))).status,
+      (
+        await failure(
+          jellyfinBootstrap.run(both.api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
+        )
+      ).status,
     ).toBe(502);
@@ -265,5 +285,5 @@ describe("Jellyfin's first-run setup", () => {
     );
-    expect(await jellyfinBootstrap.run(api, ADMIN, contextOf().stack)).toBe(
-      '2'.repeat(32),
-    );
+    expect(
+      await jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
+    ).toBe('2'.repeat(32));
     expect(state.apiKeys).toHaveLength(4);
@@ -285,3 +305,5 @@ describe("Jellyfin's first-run setup", () => {
     );
-    const failed = await failure(jellyfinBootstrap.run(api, ADMIN, contextOf().stack));
+    const failed = await failure(
+      jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
+    );
     expect(failed.message).toBe(
@@ -301,5 +323,5 @@ describe("Jellyfin's first-run setup", () => {
     );
-    expect(await jellyfinBootstrap.run(api, ADMIN, contextOf().stack)).toBe(
-      '8'.repeat(32),
-    );
+    expect(
+      await jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
+    ).toBe('8'.repeat(32));
   });
@@ -314,3 +336,8 @@ describe("Jellyfin's first-run setup", () => {
     );
-    const made = await jellyfinBootstrap.run(api, ADMIN, contextOf().stack);
+    const made = await jellyfinBootstrap.run(
+      api,
+      ADMIN,
+      contextOf().stack,
+      NO_SETUP_CONTEXT,
+    );
     expect(made).not.toBe(KEY);
@@ -323,3 +350,5 @@ describe("Jellyfin's first-run setup", () => {
     );
-    const failed = await failure(jellyfinBootstrap.run(api, ADMIN, contextOf().stack));
+    const failed = await failure(
+      jellyfinBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT),
+    );
     expect(failed.message).toBe(
```

**Create** `catalog/plex/bootstrap.test.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppApiError,
  bootstrapApps,
  BootstrapFailed,
  createAppApi,
  firstStartEnv,
  inspectBootstrap,
  plexTvClient,
  readSecretStore,
  resolveStack,
  type BootstrapContext,
  type PlexTv,
  type ResolvedStack,
  type SecretStore,
} from '@mediaplane/engine';
import {
  claimFakePlex,
  closedPort,
  FAKE_PLEX_ACCOUNT,
  fakeContainer,
  fakePlexTv,
  fakeRuntime,
  fakeStackApis,
  FIXTURE_HOST,
  fixtureConfig,
  freshAppState,
  PLEX_PREFERENCES,
  tempDir,
  thrown,
  wiringStack,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import { plexBootstrap, PREFERENCES } from './bootstrap';

const TOKEN = FAKE_PLEX_ACCOUNT.token;
const ADMIN = { username: 'admin', password: 'fake-admin-password' };
/** Another plex.tv account, which can claim a Plex too. */
const SOMEONE = { id: 7_000_099, token: 'someone-plex-token-9' };

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: plex
plex: { token: { file: secrets/plex-token } }
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;

/** STACK, resolved in `home`. */
function stackIn(home: string): ResolvedStack {
  const resolved = resolveStack(fixtureConfig(STACK), catalog, FIXTURE_HOST, home);
  if (resolved.stack === undefined) throw new Error(JSON.stringify(resolved.diagnostics));
  return resolved.stack;
}

/**
 * The stack's fakes, Plex as it first starts, keeping its Preferences.xml in a home of
 * its own, plex.tv knowing your account and SOMEONE's, and a client of Plex with your
 * token, whose waits pass at once on a clock of its own (a deadline of `deadlineMs` on
 * it).
 */
async function plexOf(deadlineMs = 0) {
  const home = await tempDir('mediaplane-plex-');
  const plexTv = await fakePlexTv();
  plexTv.state.accounts.push({ ...SOMEONE });
  const apis = await fakeStackApis(plexTv.state);
  const state = freshAppState();
  state.plex.configDir = join(home, 'appdata', 'plex');
  apis.apps.set('plex', state);
  let clock = 0;
  const api = createAppApi({
    name: 'Plex',
    service: 'plex',
    port: 32400,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-plex-token', value: TOKEN },
    secrets: [TOKEN],
    retry: {
      deadlineMs,
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
    },
  });
  const ctx: BootstrapContext = {
    keys: { plex: { token: TOKEN } },
    plexTv: plexTv.client,
  };
  return { api, state, plexTv, ctx, stack: stackIn(home) };
}

describe("Plex's first-run setup", () => {
  it('is open until Plex is claimed, as Plex says to anyone', async () => {
    const { api, state, plexTv } = await plexOf();
    expect(await plexBootstrap.open(api)).toBe(true);
    const claim = await plexTv.client.claimToken(TOKEN);
    expect(claimFakePlex(state.plex, claim, plexTv.state)).toBe(true);
    expect(await plexBootstrap.open(api)).toBe(false);
    expect(plexBootstrap.done.path).toBe(PLEX_PREFERENCES);
    expect(PREFERENCES).toBe(PLEX_PREFERENCES);
  });

  it('gives its first start a claim token for your account, fetched with your token', async () => {
    const { plexTv, ctx, stack } = await plexOf();
    const env = await plexBootstrap.firstStart?.(stack, ctx);
    expect(env).toEqual({ PLEX_CLAIM: plexTv.state.claims[0]?.token });
    expect(plexTv.state.claims).toEqual([
      { token: env?.PLEX_CLAIM, account: FAKE_PLEX_ACCOUNT.id, used: false },
    ]);
  });

  it("says what to do when it can't get a claim token, and never shows the token", async () => {
    const { stack, plexTv } = await plexOf();
    const refused = await thrown(
      Promise.resolve(
        plexBootstrap.firstStart?.(stack, {
          keys: { plex: { token: 'revoked-plex-token-0' } },
          plexTv: plexTv.client,
        }),
      ),
    );
    expect(refused).toBeInstanceOf(BootstrapFailed);
    expect(refused).toMatchObject({
      message:
        "Plex's first start needs a claim token from plex.tv, which Mediaplane couldn't get, so nothing was started: plex.tv refused the Plex token (HTTP 401) (GET /api/claim/token.json)",
      hint: 'plex.tv refused your Plex token: it was revoked, or is not one. Run "mediaplane plex-login" to sign in again, then run apply again',
    });
    const away: PlexTv = plexTvClient({
      base: `http://127.0.0.1:${String(await closedPort())}`,
      sleep: () => Promise.resolve(),
    });
    const unreached = await thrown(
      Promise.resolve(
        plexBootstrap.firstStart?.(stack, {
          keys: { plex: { token: TOKEN } },
          plexTv: away,
        }),
      ),
    );
    expect(unreached).toMatchObject({
      hint: 'check that this host reaches plex.tv, then run apply again',
    });
    expect((unreached as Error).message).not.toContain(TOKEN);
    const none = await thrown(
      Promise.resolve(plexBootstrap.firstStart?.(stack, { keys: {}, plexTv: away })),
    );
    expect(none).toMatchObject({
      message:
        "Plex can't be claimed: Mediaplane has no Plex token, so nothing was started",
      hint: 'run "mediaplane plex-login", then run apply again',
    });
  });

  it('takes a Plex your account claimed, waiting while it claims itself as it starts', async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf(60_000);
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    // It says it is unclaimed twice more, as the image restarts it after its claim.
    state.plex.claimingFor = 2;
    expect(await plexBootstrap.run(api, ADMIN, stack, ctx)).toBeUndefined();
    expect(state.plex.claimingFor).toBe(0);
  });

  it("keeps a Plex that didn't claim itself unpublished, saying why", async () => {
    const { api, ctx, stack } = await plexOf(60_000);
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toBeInstanceOf(AppApiError);
    expect(failed).toMatchObject({
      kind: 'rejected',
      message:
        'Plex at http://plex:32400 (127.0.0.1) didn\'t claim itself as it started, so it stays unpublished: its claim token may have run out, or it couldn\'t reach plex.tv; its log says which ("mediaplane status plex" names its container)',
    });
  });

  it('refuses a Plex another plex.tv account claimed, asking plex.tv, not Plex', async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(
      state.plex,
      await plexTv.client.claimToken(SOMEONE.token),
      plexTv.state,
    );
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toMatchObject({
      kind: 'auth',
      unsure: false,
      message:
        "Plex at http://plex:32400 (127.0.0.1) is claimed by another plex.tv account than yours: plex.tv says the token its claim gave it is another account's",
    });
    expect(plexTv.state.calls.slice(-2)).toEqual([
      'GET /api/v2/user',
      'GET /api/v2/user',
    ]);
    expect((failed as Error).message).not.toContain(state.plex.serverToken);
  });

  it("refuses another account's Plex that says the machine identifier of a server of yours", async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    // A Plex of yours elsewhere, whose machine identifier anyone who reaches it can read.
    plexTv.state.servers.push({
      machineId: 'your-other-plex-0001',
      owner: FAKE_PLEX_ACCOUNT.id,
      name: 'Living room',
      token: 'fake-server-token-99',
    });
    claimFakePlex(
      state.plex,
      await plexTv.client.claimToken(SOMEONE.token),
      plexTv.state,
    );
    // Its admin gives it that identifier, as Plex's PUT /:/prefs takes it (probed).
    state.plex.machineId = 'your-other-plex-0001';
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toMatchObject({ kind: 'auth', unsure: false });
    expect((failed as Error).message).toContain('is claimed by another plex.tv account');
  });

  it('refuses a Plex whose token plex.tv refuses, as once it is removed from its account', async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    plexTv.state.servers = [];
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toMatchObject({
      kind: 'auth',
      unsure: false,
      message:
        'Plex at http://plex:32400 (127.0.0.1) is claimed by no plex.tv account of yours: plex.tv refuses the token its claim gave it, as it does once the server is removed from its account',
    });
  });

  it("refuses, as unsure, a Plex when plex.tv can't be asked whose it is", async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    plexTv.state.failing.push({ path: '/api/v2/user', status: 503 });
    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(failed).toMatchObject({ kind: 'auth', unsure: true });
    expect((failed as Error).message).toContain(
      "is claimed, and Mediaplane couldn't tell whether by your plex.tv account: plex.tv failed (HTTP 503)",
    );
  });

  it("refuses, as unsure, a claimed Plex whose Preferences.xml holds no token, and one Mediaplane can't read", async () => {
    const { api, state, plexTv, ctx, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    state.plex.serverToken = '';
    const tokenless = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
    expect(tokenless).toMatchObject({
      kind: 'auth',
      unsure: true,
      message:
        "Plex at http://plex:32400 (127.0.0.1) is claimed, and its Preferences.xml holds no token of its claim, so Mediaplane couldn't tell whether by your plex.tv account",
    });
    const other = await plexOf();
    other.state.plex.configDir = undefined;
    claimFakePlex(
      other.state.plex,
      await other.plexTv.client.claimToken(TOKEN),
      other.plexTv.state,
    );
    const unread = await thrown(
      plexBootstrap.run(other.api, ADMIN, other.stack, other.ctx),
    );
    expect(unread).toMatchObject({
      kind: 'rejected',
      message: `Plex at http://plex:32400 (127.0.0.1) is claimed, and Mediaplane can't read appdata/plex/${PLEX_PREFERENCES} (ENOENT) to tell by whose plex.tv account`,
    });
  });

  it('says plex.tv refused your token when asked whose Plex it is, never as claimed', async () => {
    const { api, state, plexTv, stack } = await plexOf();
    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
    const failed = await thrown(
      plexBootstrap.run(api, ADMIN, stack, {
        keys: { plex: { token: 'revoked-plex-token-0' } },
        plexTv: plexTv.client,
      }),
    );
    expect(failed).toMatchObject({ kind: 'rejected' });
    expect((failed as Error).message).toContain(
      'Run "mediaplane plex-login" to sign in again',
    );
    expect((failed as Error).message).not.toContain('revoked-plex-token');
  });

  it('gives the safe remedies for a Plex claimed by someone else first, and starting afresh last', () => {
    const hint = plexBootstrap.claimedHint?.(
      wiringStack(catalog, STACK),
      'mediaplane-plex-1',
    );
    expect(hint).toBe(
      'First: if that plex.tv account is yours too, run "mediaplane plex-login" and sign in as it, then run apply again. Or second, keeping what Plex holds: stop it ("docker stop mediaplane-plex-1"), remove every attribute whose name starts with PlexOnline from appdata/plex/Library/Application Support/Plex Media Server/Preferences.xml, then run apply again, which claims it as yours. Last, only if you don\'t need what it holds: start it afresh, as the runbook says',
    );
  });
});

describe("Plex's setup, as apply's bootstrap step runs it", () => {
  /**
   * Plex in a home of its own, set up by the engine's step as `apply` would run it:
   * planned from its Preferences.xml and the store, its first start given its claim, which
   * it trades at the fake plex.tv as the image does, then set up. `published` has, for
   * each publishing up, the apps it leaves unpublished.
   */
  async function stepOf() {
    const store: SecretStore = {
      version: 1,
      apps: {},
      shared: { adminPassword: ADMIN.password },
    };
    const home = await tempDir('mediaplane-plex-');
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'plex-token'), `${TOKEN}\n`);
    const plexTv = await fakePlexTv();
    plexTv.state.accounts.push({ ...SOMEONE });
    const apis = await fakeStackApis(plexTv.state);
    const state = freshAppState();
    state.plex.configDir = join(home, 'appdata', 'plex');
    apis.apps.set('plex', state);
    const stack = stackIn(home);
    const runtime = fakeRuntime({
      containers: [fakeContainer('plex', 'fake-plex')],
      addresses: apis.addresses,
    });
    const published: string[][] = [];
    const given = { plex: { token: TOKEN } };
    const ctx: BootstrapContext = { keys: given, plexTv: plexTv.client };
    const run = async (from: SecretStore) => {
      const pending = (await inspectBootstrap(stack, from)).changes;
      // The start step: Plex's first start, with what its setup gives it.
      const env = await firstStartEnv(stack, pending, ctx);
      claimFakePlex(state.plex, env.plex?.PLEX_CLAIM, plexTv.state);
      const set = await bootstrapApps({
        home,
        stack,
        store: from,
        values: {},
        given,
        plexTv: plexTv.client,
        env: {},
        runtime,
        project: 'mediaplane',
        pending,
        publish: (unpublished) => {
          published.push([...unpublished]);
          return Promise.resolve();
        },
        seams: apis.seams,
      });
      return { pending, env, ...set };
    };
    return { home, state, plexTv, published, run, store, ctx, stack, apis };
  }

  it('claims a fresh Plex with its claim token, records it, and publishes it', async () => {
    const { home, state, published, run, store, apis } = await stepOf();
    const first = await run(store);
    // Plex is asked whether it is claimed without your token, which it may not be yours
    // to have: every question of the setup's, and the re-check before publishing.
    const identity = apis.app.requests.filter(
      (r) => r.headers.host?.startsWith('plex') === true && r.path === '/identity',
    );
    expect(identity.length).toBeGreaterThanOrEqual(3);
    expect(identity.filter((r) => r.headers['x-plex-token'] !== undefined)).toEqual([]);
    // Plex never got your token: nothing else was asked of it.
    expect(
      apis.app.requests
        .filter((r) => r.headers.host?.startsWith('plex') === true)
        .filter((r) => r.headers['x-plex-token'] !== undefined)
        .map((r) => r.path),
    ).toEqual([]);
    expect(first.pending).toEqual([{ app: 'plex', unpublished: true }]);
    expect(Object.keys(first.env)).toEqual(['plex']);
    expect(state.plex.owner).toBe(FAKE_PLEX_ACCOUNT.id);
    expect(first.detail).toBe('set up plex; published plex');
    expect(published).toEqual([[]]);
    expect((await readSecretStore(home)).setUp).toEqual(['plex']);
    // Recorded, and its Preferences.xml says it is claimed: nothing more to do.
    const again = await run(first.store);
    expect(again.pending).toEqual([]);
    expect(again.env).toEqual({});
  });

  it('keeps a Plex claimed by someone else unpublished, on every apply, with the safe remedies first', async () => {
    const { home, state, plexTv, published, run, store } = await stepOf();
    claimFakePlex(
      state.plex,
      await plexTv.client.claimToken(SOMEONE.token),
      plexTv.state,
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = await thrown(run(store));
      expect(failed).toBeInstanceOf(BootstrapFailed);
      const said = (failed as Error).message;
      expect(said).toContain(
        "is claimed by another plex.tv account than yours: plex.tv says the token its claim gave it is another account's; Plex is set up, but Mediaplane can't show that it is its own, so it stays unpublished, on every apply until it can. First: if that plex.tv account is yours too",
      );
      expect(said).toContain('("docker stop mediaplane-plex-1")');
      expect(said.indexOf('afresh')).toBeGreaterThan(said.indexOf('PlexOnline'));
    }
    // Its Preferences.xml says it is claimed, so it gets no claim token.
    expect(plexTv.state.claims.filter((c) => c.account === FAKE_PLEX_ACCOUNT.id)).toEqual(
      [],
    );
    expect(published).toEqual([['plex'], ['plex']]);
    expect((await readSecretStore(home)).setUp).toBeUndefined();
  });

  it("asks for a claim token while Mediaplane can't read Preferences.xml, which can't say Plex is claimed", async () => {
    const { stack, ctx } = await stepOf();
    const unreadable = [{ app: 'plex', unpublished: true }];
    // A folder where the file should be: reading it fails.
    await mkdir(join(stack.home, 'appdata', 'plex', PLEX_PREFERENCES), {
      recursive: true,
    });
    expect(Object.keys(await firstStartEnv(stack, unreadable, ctx))).toEqual(['plex']);
    // Started published, it gets none: start variables go only with an unpublished start.
    expect(
      await firstStartEnv(stack, [{ app: 'plex', unpublished: false }], ctx),
    ).toEqual({});
  });
});
```

**Change** `catalog/seerr/bootstrap.test.ts`:

```diff
diff --git a/catalog/seerr/bootstrap.test.ts b/catalog/seerr/bootstrap.test.ts
index 73c552b..456ee35 100644
--- a/catalog/seerr/bootstrap.test.ts
+++ b/catalog/seerr/bootstrap.test.ts
@@ -23,2 +23,3 @@ import {
   freshAppState,
+  NO_SETUP_CONTEXT,
   SEERR_JELLYFIN,
@@ -128,3 +129,3 @@ describe("Seerr's first-run setup", () => {
     });
-    expect(await seerrBootstrap.run(api, ADMIN, stack)).toBeUndefined();
+    expect(await seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)).toBeUndefined();
     expect(state.seerr).toMatchObject({
@@ -153,3 +154,3 @@ describe("Seerr's first-run setup", () => {
     );
-    const waited = await thrown(seerrBootstrap.run(api, ADMIN, stack));
+    const waited = await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT));
     expect(waited).toBeInstanceOf(SetupWaiting);
@@ -164,3 +165,3 @@ describe("Seerr's first-run setup", () => {
     const { api, stack } = await seerrOf(fakeJellyfinSetUp({ up: false }));
-    const failed = await thrown(seerrBootstrap.run(api, ADMIN, stack));
+    const failed = await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT));
     expect(failed).toBeInstanceOf(AppApiError);
@@ -173,3 +174,3 @@ describe("Seerr's first-run setup", () => {
     const { api, calls, stack } = await seerrOf(fakeJellyfinSetUp(), SET_UP);
-    expect(await seerrBootstrap.run(api, ADMIN, stack)).toBeUndefined();
+    expect(await seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)).toBeUndefined();
     expect(calls()).toEqual([
@@ -197,3 +198,3 @@ describe("Seerr's first-run setup", () => {
     });
-    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack));
+    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT));
     expect(refused).toBeInstanceOf(AppApiError);
@@ -207,3 +208,3 @@ describe("Seerr's first-run setup", () => {
     });
-    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack));
+    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT));
     expect(refused).toBeInstanceOf(AppApiError);
@@ -227,3 +228,5 @@ describe("Seerr's first-run setup", () => {
     });
-    expect(await thrown(seerrBootstrap.run(api, ADMIN, stack))).toMatchObject({
+    expect(
+      await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)),
+    ).toMatchObject({
       kind: 'auth',
@@ -244,3 +247,3 @@ describe("Seerr's first-run setup", () => {
     });
-    expect(await seerrBootstrap.run(api, ADMIN, stack)).toBeUndefined();
+    expect(await seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)).toBeUndefined();
     expect(calls().filter((c) => c === 'POST /api/v1/auth/jellyfin')).toHaveLength(1);
@@ -253,3 +256,3 @@ describe("Seerr's first-run setup", () => {
     });
-    expect(await seerrBootstrap.run(api, ADMIN, stack)).toBeUndefined();
+    expect(await seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)).toBeUndefined();
     state.seerr.echoKey = true;
@@ -270,3 +273,5 @@ describe("Seerr's first-run setup", () => {
     );
-    expect(await thrown(seerrBootstrap.run(api, ADMIN, plex))).toMatchObject({
+    expect(
+      await thrown(seerrBootstrap.run(api, ADMIN, plex, NO_SETUP_CONTEXT)),
+    ).toMatchObject({
       kind: 'rejected',
@@ -300,3 +305,3 @@ describe("Seerr's first-run setup: what it can't confirm is not Mediaplane's", (
         const refused = await thrown(
-          seerrBootstrap.run(failingAt(api, path, kind), ADMIN, stack),
+          seerrBootstrap.run(failingAt(api, path, kind), ADMIN, stack, NO_SETUP_CONTEXT),
         );
@@ -317,3 +322,3 @@ describe("Seerr's first-run setup: what it can't confirm is not Mediaplane's", (
         const refused = await thrown(
-          seerrBootstrap.run(failingAt(api, path, kind), ADMIN, stack),
+          seerrBootstrap.run(failingAt(api, path, kind), ADMIN, stack, NO_SETUP_CONTEXT),
         );
@@ -333,3 +338,5 @@ describe("Seerr's first-run setup: what it can't confirm is not Mediaplane's", (
     });
-    expect(await thrown(seerrBootstrap.run(api, ADMIN, stack))).toMatchObject({
+    expect(
+      await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)),
+    ).toMatchObject({
       kind: 'auth',
@@ -341,3 +348,5 @@ describe("Seerr's first-run setup: what it can't confirm is not Mediaplane's", (
     });
-    expect(await thrown(seerrBootstrap.run(plex.api, ADMIN, plex.stack))).toMatchObject({
+    expect(
+      await thrown(seerrBootstrap.run(plex.api, ADMIN, plex.stack, NO_SETUP_CONTEXT)),
+    ).toMatchObject({
       kind: 'auth',
@@ -353,3 +362,3 @@ describe("Seerr's first-run setup: what it can't confirm is not Mediaplane's", (
     expect(
-      await seerrBootstrap.run(lookFails(own.api), ADMIN, own.stack),
+      await seerrBootstrap.run(lookFails(own.api), ADMIN, own.stack, NO_SETUP_CONTEXT),
     ).toBeUndefined();
@@ -357,3 +366,5 @@ describe("Seerr's first-run setup: what it can't confirm is not Mediaplane's", (
     expect(
-      await thrown(seerrBootstrap.run(lookFails(fresh.api), ADMIN, fresh.stack)),
+      await thrown(
+        seerrBootstrap.run(lookFails(fresh.api), ADMIN, fresh.stack, NO_SETUP_CONTEXT),
+      ),
     ).toMatchObject({ kind: 'auth' });
@@ -373,2 +384,3 @@ describe("Seerr's first-run setup: what it can't confirm is not Mediaplane's", (
         stack,
+        NO_SETUP_CONTEXT,
       ),
@@ -383,3 +395,3 @@ describe("Seerr's first-run setup: what it can't confirm is not Mediaplane's", (
     });
-    expect(await seerrBootstrap.run(api, ADMIN, stack)).toBeUndefined();
+    expect(await seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT)).toBeUndefined();
     expect(state.seerr.mediaServerType).toBe(SEERR_JELLYFIN);
@@ -394,3 +406,3 @@ describe("Seerr's first-run setup: what it can't confirm is not Mediaplane's", (
     });
-    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack));
+    const refused = await thrown(seerrBootstrap.run(api, ADMIN, stack, NO_SETUP_CONTEXT));
     expect(refused).toMatchObject({ kind: 'auth', status: undefined });
```

**Change** `catalog/seerr/integration.test.ts`:

```diff
diff --git a/catalog/seerr/integration.test.ts b/catalog/seerr/integration.test.ts
index dd7dc04..b9f5320 100644
--- a/catalog/seerr/integration.test.ts
+++ b/catalog/seerr/integration.test.ts
@@ -11,2 +11,3 @@ import {
   freshAppState,
+  NO_SETUP_CONTEXT,
   SERVARR_PROFILES,
@@ -103,3 +104,3 @@ async function seerr() {
   });
-  await seerrBootstrap.run(api, ADMIN, contextOf().stack);
+  await seerrBootstrap.run(api, ADMIN, contextOf().stack, NO_SETUP_CONTEXT);
   const calls = (from = 0) =>
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index ab021d1..c6aa73b 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -1,2 +1,2 @@
-import { mkdir, readFile, writeFile } from 'node:fs/promises';
+import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
 import { join } from 'node:path';
@@ -30,4 +30,6 @@ import {
   fakeDocker,
+  claimFakePlex,
   fakeJellyfinSetUp,
   FAKE_PLEX_ACCOUNT,
+  FAKE_SERVER_TOKEN,
   fakePlexTv,
@@ -287,6 +289,11 @@ function expectNoSecrets(output: string, secrets: readonly string[]): void {
 
-/** The apps' APIs, faked anew for each test: the test stack's Sonarr and qBittorrent. */
+/**
+ * The apps' APIs, faked anew for each test: the test stack's Sonarr and qBittorrent; and
+ * the plex.tv they and Mediaplane ask, so that no test reaches the real one.
+ */
 let apis: Awaited<ReturnType<typeof fakeStackApis>>;
+let plexTv: Awaited<ReturnType<typeof fakePlexTv>>;
 beforeEach(async () => {
-  apis = await fakeStackApis();
+  plexTv = await fakePlexTv();
+  apis = await fakeStackApis(plexTv.state);
 });
@@ -324,2 +331,3 @@ function deps(runtime: Runtime = fakeRuntime()): Partial<CliDeps> {
     wiring: apis.seams,
+    plexTv: () => plexTv.client,
   };
@@ -1410,2 +1418,131 @@ describe('mediaplane apply: Seerr in the stack', () => {
 
+describe('mediaplane apply: Plex as the media server', () => {
+  const PLEX_STACK = `version: 1
+paths: { data: /srv/data }
+network: { bind: localhost }
+media_server: plex
+plex: { token: { file: secrets/plex-token } }
+apps:
+  sonarr: {}
+  qbittorrent: { vpn: false }
+`;
+
+  /**
+   * A home of the Plex stack, with `token` saved as yours, and a Docker that starts Plex
+   * as its image does: trading its PLEX_CLAIM at plex.tv as it first starts, unless
+   * `claims` is false.
+   */
+  async function plexHome(token = FAKE_PLEX_ACCOUNT.token, claims = true) {
+    const home = await makeHome(PLEX_STACK);
+    await writeFile(join(home, 'secrets', 'plex-token'), `${token}\n`);
+    const plex = freshAppState();
+    plex.plex.configDir = join(home, 'appdata', 'plex');
+    apis.apps.set('plex', plex);
+    const docker = fakeDocker(home, {
+      onUp: (_unpublished, startEnv) => {
+        if (claims) claimFakePlex(plex.plex, startEnv.plex?.PLEX_CLAIM, plexTv.state);
+      },
+    });
+    return { home, plex: plex.plex, docker };
+  }
+
+  /** Every secret of the run: your token, the claim tokens, Plex's own token. */
+  function plexSecrets(): string[] {
+    return [
+      FAKE_PLEX_ACCOUNT.token,
+      FAKE_SERVER_TOKEN,
+      ...plexTv.state.claims.map((claim) => claim.token),
+    ];
+  }
+
+  it('claims Plex for your account before publishing it, then leaves it as it is', async () => {
+    const { home, plex, docker } = await plexHome();
+    const planned = capture();
+    expect(await run(['plan', '--home', home], planned.io, deps(docker))).toBe(2);
+    expect(planned.stdout()).toContain(
+      '+ plex (with no port published until it is done)\n',
+    );
+    // plan never asks plex.tv: the claim token is fetched only as apply starts Plex.
+    expect(plexTv.state.calls).toEqual([]);
+    const first = capture();
+    expect(await run(['apply', '--home', home, '--yes'], first.io, deps(docker))).toBe(0);
+    expect(docker.calls.filter((call) => call.startsWith('up'))).toEqual([
+      'up unpublished plex with plex.PLEX_CLAIM',
+      'up',
+    ]);
+    expect(first.stdout()).toContain(
+      '  done    first-run setup: set up plex; published plex\n',
+    );
+    expect(plex.owner).toBe(FAKE_PLEX_ACCOUNT.id);
+    expect((await readSecretStore(home)).setUp).toEqual(['plex']);
+    // One claim token, fetched with your token, and used.
+    expect(plexTv.state.claims).toEqual([
+      { token: plexTv.state.claims[0]?.token, account: FAKE_PLEX_ACCOUNT.id, used: true },
+    ]);
+    const records = await readdir(join(home, 'state', 'history'));
+    const recorded = await Promise.all(
+      records.map((name) => readFile(join(home, 'state', 'history', name), 'utf8')),
+    );
+    const secrets = [...(await secretsIn(home)), ...plexSecrets()];
+    expectNoSecrets(first.stdout() + first.stderr() + recorded.join(''), secrets);
+    expectNoSecrets(await readFile(join(home, 'state', 'secrets.json'), 'utf8'), [
+      FAKE_PLEX_ACCOUNT.token,
+      ...plexTv.state.claims.map((claim) => claim.token),
+    ]);
+    const again = capture();
+    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
+    expect(again.stdout()).toBe('No changes.\n');
+  });
+
+  it('starts nothing when plex.tv refuses your token, and says to sign in again', async () => {
+    const { home, docker } = await plexHome('revoked-plex-token-0');
+    const term = capture();
+    expect(await run(['apply', '--home', home, '--yes'], term.io, deps(docker))).toBe(1);
+    expect(term.stderr()).toContain(
+      'error: Plex\'s first start needs a claim token from plex.tv, which Mediaplane couldn\'t get, so nothing was started: plex.tv refused the Plex token (HTTP 401) (GET /api/claim/token.json)\n  hint: plex.tv refused your Plex token: it was revoked, or is not one. Run "mediaplane plex-login" to sign in again, then run apply again\n',
+    );
+    expect(docker.calls.some((call) => call.startsWith('up'))).toBe(false);
+    expectNoSecrets(term.stdout() + term.stderr(), ['revoked-plex-token-0']);
+  });
+
+  it('stops a Plex that runs published, unclaimed, when plex.tv refuses your token, changing nothing else', async () => {
+    const { home, docker } = await plexHome('revoked-plex-token-0');
+    expect(
+      await run(['apply', '--home', home, '--yes'], capture().io, deps(docker)),
+    ).toBe(1);
+    // As an apply from before this slice left it, or a "docker compose up": Plex
+    // published, and unclaimed.
+    expect((await docker.up(60, {}, [])).ok).toBe(true);
+    docker.calls.length = 0;
+    const term = capture();
+    expect(await run(['apply', '--home', home, '--yes'], term.io, deps(docker))).toBe(1);
+    expect(term.stderr()).toContain(
+      "plex.tv refused the Plex token (HTTP 401) (GET /api/claim/token.json); Mediaplane stopped plex, which ran, but isn't shown to be yours, so that it isn't left published\n",
+    );
+    // Stopped, and nothing else: Mediaplane didn't leave the wiring network, nor stop or
+    // start anything more.
+    expect(docker.calls.filter((call) => /^(up|stop|leave-wiring)\b/.test(call))).toEqual(
+      ['stop plex'],
+    );
+    expectNoSecrets(term.stdout() + term.stderr(), ['revoked-plex-token-0']);
+  });
+
+  it("keeps a Plex that didn't claim itself unpublished, and fails", async () => {
+    const { home, plex, docker } = await plexHome(FAKE_PLEX_ACCOUNT.token, false);
+    const term = capture();
+    expect(await run(['apply', '--home', home, '--yes'], term.io, deps(docker))).toBe(1);
+    // Still unpublished, still with its claim token: up recreates nothing.
+    expect(docker.calls.filter((call) => call.startsWith('up'))).toEqual([
+      'up unpublished plex with plex.PLEX_CLAIM',
+      'up unpublished plex with plex.PLEX_CLAIM',
+    ]);
+    expect(term.stderr()).toContain(
+      "didn't claim itself as it started, so it stays unpublished: its claim token may have run out, or it couldn't reach plex.tv",
+    );
+    expect(plex.owner).toBeNull();
+    expect((await readSecretStore(home)).setUp).toBeUndefined();
+    expectNoSecrets(term.stdout() + term.stderr(), plexSecrets());
+  });
+});
+
 describe('mediaplane status', () => {
```

**Change** `packages/engine/src/apply/apply.test.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.test.ts b/packages/engine/src/apply/apply.test.ts
index a0f0144..86da7ff 100644
--- a/packages/engine/src/apply/apply.test.ts
+++ b/packages/engine/src/apply/apply.test.ts
@@ -14,3 +14,3 @@ import { join } from 'node:path';
 import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
-import type { AppDefinition, Catalog } from '../catalog/types';
+import type { AppDefinition, BootstrapContext, Catalog } from '../catalog/types';
 import { AppApiError, type AppApi } from '../http/client';
@@ -37,2 +37,3 @@ import {
 } from '../testing/bootstrap';
+import { fakePlexTv } from '../testing/plextv';
 import {
@@ -47,2 +48,3 @@ import { FAKE_LOGIN, fakeSonarr, WIRED_CATALOG } from '../testing/wiring';
 import { apply, unhealthyServices, type ApplyOptions, type StepEvent } from './apply';
+import { BootstrapFailed } from './bootstrap';
 import { tempDir } from '../testing/temp';
@@ -2070,3 +2072,3 @@ describe('apply: a first-run setup that makes no key, after another', () => {
   const CLAIMED =
-    "sonarr is set up, but Mediaplane can't show that it is its own, so it stays unpublished, on every apply until it can. First: if the Jellyfin login it was set up with is yours, set admin.username and admin.password to it. Or second: make its admin (its first user) the Jellyfin login that admin.username names. Either needs its Jellyfin already at jellyfin:8096, with no URL base and no TLS; then run apply again. Last, if you did not set it up: start it afresh, as the runbook says";
+    "sonarr is set up, but Mediaplane can't show that it is its own, so it stays unpublished, on every apply until it can. First: sign in to mediaplane-sonarr-1 as the shared admin, then run apply again. Last: start it afresh";
   /**
@@ -2473,2 +2475,125 @@ describe('apply: a first-run setup that makes no key, after another', () => {
   });
+
+  it('says to start it afresh if you did not set it up, when its setup gives no remedies of its own', async () => {
+    const catalog = SIGN_IN_CATALOG.map((def) =>
+      def.id === 'sonarr' && def.bootstrap !== undefined
+        ? { ...def, bootstrap: { ...def.bootstrap, claimedHint: undefined } }
+        : def,
+    );
+    const { home, setup, run } = await signInStack(catalog);
+    setup.signIn.done = true;
+    await mkdir(join(home, 'appdata', 'sonarr'), { recursive: true });
+    await writeFile(join(home, 'appdata', 'sonarr', 'signed-in.txt'), 'yes\n');
+    const failed = await run();
+    expect(failed.diagnostics.at(-1)?.message).toBe(
+      "the first-run setup failed: sonarr at http://sonarr:8989 (127.0.0.1) was set up with another login (GET /signed-in/own); sonarr is set up, but Mediaplane can't show that it is its own, so it stays unpublished, on every apply until it can. If you did not set it up: start it afresh, as the runbook says",
+    );
+  });
+});
+
+describe("apply: a setup's first start, and what it is given", () => {
+  /** The value Sonarr's first start is given, as a claim token would be: a secret. */
+  const FIRST = 'fake-first-start-value';
+  /**
+   * SIGN_IN_CATALOG, Sonarr's setup giving its first start FIRST in FIRST_START, and
+   * noting what it and its run were given.
+   */
+  function startCatalog(seen: BootstrapContext[], fails?: Error): Catalog {
+    return SIGN_IN_CATALOG.map((def) => {
+      const bootstrap = def.bootstrap;
+      if (def.id !== 'sonarr' || bootstrap === undefined) return def;
+      return {
+        ...def,
+        bootstrap: {
+          ...bootstrap,
+          firstStart: (_stack, ctx) => {
+            seen.push(ctx);
+            return fails === undefined
+              ? Promise.resolve({ FIRST_START: FIRST })
+              : Promise.reject(fails);
+          },
+          run: (api, admin, stack, ctx) => {
+            seen.push(ctx);
+            return bootstrap.run(api, admin, stack, ctx);
+          },
+        },
+      };
+    });
+  }
+
+  /** The stack of the setups' tests, with the start variables each up was given. */
+  async function startStack(catalog: Catalog) {
+    const home = await makeHome();
+    const setup = await fakeSetUpApp(home);
+    const docker = fakeDocker(home, { addresses: setup.addresses });
+    const given: string[] = [];
+    const runtime: Runtime = {
+      ...docker,
+      up: (seconds, values, unpublished = [], startEnv = {}) => {
+        given.push(JSON.stringify(startEnv));
+        return docker.up(seconds, values, unpublished, startEnv);
+      },
+    };
+    const plexTv = (await fakePlexTv()).client;
+    const run = () =>
+      apply(options(home, runtime, { catalog, wiring: setup.seams, plexTv }));
+    return { home, setup, calls: docker.calls, given, plexTv, run };
+  }
+
+  it('gives an app it starts unpublished what its setup gives its first start, and only then', async () => {
+    const seen: BootstrapContext[] = [];
+    const { calls, given, plexTv, run } = await startStack(startCatalog(seen));
+    const first = await run();
+    expect(first.outcome).toBe('success');
+    expect(calls).toContain('up unpublished jellyfin sonarr with sonarr.FIRST_START');
+    // The publishing up keeps it only for an app still unpublished: none here.
+    expect(given).toEqual([JSON.stringify({ sonarr: { FIRST_START: FIRST } }), '{}']);
+    // The first start and the setup are given the stack's keys, and plex.tv as apply was
+    // given it, but no secret you give that no app's API takes as its key: the VPN key.
+    expect(seen).toHaveLength(2);
+    for (const ctx of seen) {
+      expect(ctx.plexTv).toBe(plexTv);
+      expect(ctx.keys.sonarr?.apiKey).toBeDefined();
+      expect(ctx.keys.gluetun?.wireguardKey).toBeUndefined();
+    }
+    // Never in a record or a result.
+    expect(JSON.stringify(first)).not.toContain(FIRST);
+    // Set up: its done file says so, so the next apply gives nothing.
+    const again = await run();
+    expect(again.outcome).toBe('no-changes');
+    expect(seen).toHaveLength(2);
+  });
+
+  it('keeps giving it to an app the publishing up leaves unpublished, so it is not recreated', async () => {
+    const seen: BootstrapContext[] = [];
+    const { setup, given, run } = await startStack(startCatalog(seen));
+    setup.signIn.refuse = true;
+    setup.signIn.claimant = true;
+    expect((await run()).outcome).toBe('failed');
+    expect(given).toEqual([
+      JSON.stringify({ sonarr: { FIRST_START: FIRST } }),
+      JSON.stringify({ sonarr: { FIRST_START: FIRST } }),
+    ]);
+  });
+
+  it('starts nothing when a first start can not be given what it needs, with what to do', async () => {
+    const seen: BootstrapContext[] = [];
+    const { calls, run } = await startStack(
+      startCatalog(
+        seen,
+        new BootstrapFailed('fake: no claim token', 'fake: sign in again'),
+      ),
+    );
+    const failed = await run();
+    expect(failed.outcome).toBe('failed');
+    expect(failed.diagnostics.at(-1)).toMatchObject({
+      code: 'apply.start-failed',
+      message: 'fake: no claim token',
+      hint: 'fake: sign in again',
+    });
+    expect(calls.some((call) => call.startsWith('up'))).toBe(false);
+    // Asked before anything changed: Mediaplane is still on the wiring network.
+    expect(calls).not.toContain('leave-wiring');
+    expect(failed.actions.map((a) => `${a.step} ${a.result}`)).toContain('start failed');
+  });
 });
```

**Change** `packages/engine/src/http/client.test.ts`:

```diff
diff --git a/packages/engine/src/http/client.test.ts b/packages/engine/src/http/client.test.ts
index a4d56e7..e310e72 100644
--- a/packages/engine/src/http/client.test.ts
+++ b/packages/engine/src/http/client.test.ts
@@ -131,2 +131,58 @@ describe('createAppApi', () => {
 
+  it('asks again until the answer says it is done, or the deadline passes, giving the last', async () => {
+    let asked = 0;
+    const slept: number[] = [];
+    let clock = 0;
+    const app = await fakeHttpApp(() => {
+      asked += 1;
+      return { status: 200, body: { claimed: asked >= 3 } };
+    });
+    const client = (deadlineMs: number) =>
+      createAppApi({
+        name: 'Plex',
+        service: 'plex',
+        port: 32400,
+        endpoint: { host: '127.0.0.1', port: app.port },
+        key: { scheme: 'x-plex-token', value: KEY },
+        secrets: [],
+        retry: {
+          deadlineMs,
+          now: () => clock,
+          sleep: (ms) => {
+            slept.push(ms);
+            clock += ms;
+            return Promise.resolve();
+          },
+        },
+      });
+    const claimed = z.looseObject({ claimed: z.boolean() });
+    expect(await client(60_000).until('/identity', claimed, (i) => i.claimed)).toEqual({
+      claimed: true,
+    });
+    expect(slept).toEqual([250, 500]);
+    // Out of time: the last answer, not done.
+    asked = -100;
+    expect(await client(0).until('/identity', claimed, (i) => i.claimed)).toEqual({
+      claimed: false,
+    });
+    expect(asked).toBe(-99);
+    // Without the key, when asked so: an app not shown to be yours never gets it.
+    await client(0).until('/identity', claimed, () => true, { anonymous: true });
+    expect(app.requests.at(-1)?.headers['x-plex-token']).toBeUndefined();
+    expect(app.requests.at(-2)?.headers['x-plex-token']).toBe(KEY);
+  });
+
+  it("sends Plex's token in X-Plex-Token when the app takes one", async () => {
+    const { api, app } = await sonarr(() => ({ status: 200, body: {} }), {
+      key: { scheme: 'x-plex-token', value: KEY },
+    });
+    await api.check('/library/sections');
+    expect(app.requests[0]?.headers['x-plex-token']).toBe(KEY);
+    expect(app.requests[0]?.headers['x-api-key']).toBeUndefined();
+    expect(app.requests[0]?.headers.authorization).toBeUndefined();
+    // Anonymous calls carry no token, as Plex's readiness path takes none.
+    await api.ready('/identity');
+    expect(app.requests[1]?.headers['x-plex-token']).toBeUndefined();
+  });
+
   it('checks a key with any 2xx answer, reading no JSON: qBittorrent answers plain text', async () => {
```

**Change** `packages/engine/src/integrations/wire.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wire.test.ts b/packages/engine/src/integrations/wire.test.ts
index 369dcbb..687467b 100644
--- a/packages/engine/src/integrations/wire.test.ts
+++ b/packages/engine/src/integrations/wire.test.ts
@@ -99,2 +99,23 @@ describe('wire', () => {
 
+  it('reaches an app with a key you give, as Plex takes your token, never keeping it, and keeps it out of what it says', async () => {
+    const store = { version: 1 as const, apps: {}, shared: { adminPassword: PASSWORD } };
+    const sonarr = await fakeSonarr({ key: KEY });
+    const given = await wireWith(sonarr, { store, given: { sonarr: { apiKey: KEY } } });
+    expect(await given.run).toEqual(['sonarr.login created']);
+    const keyed = sonarr.app.requests.filter((r) => r.path !== '/ping');
+    expect(keyed.every((r) => r.headers['x-api-key'] === KEY)).toBe(true);
+    expect(JSON.stringify(await readResources(given.home))).not.toContain(KEY);
+    // Refused, the app repeats the key it was sent: the step says so with ***.
+    const refusing = await fakeSonarr({ key: '1'.repeat(32) });
+    const refused = await wireWith(refusing, {
+      store,
+      given: { sonarr: { apiKey: KEY } },
+    });
+    expect(await refused.run.catch((cause: unknown) => cause)).toBeInstanceOf(
+      WiringFailed,
+    );
+    expect(JSON.stringify(refused.actions)).toContain('Unauthorized: ***');
+    expect(JSON.stringify(refused.actions)).not.toContain(KEY);
+  });
+
   it('updates what differs, saying what, and adopts what is already right', async () => {
```

**Change** `packages/engine/src/plextv/client.test.ts`:

```diff
diff --git a/packages/engine/src/plextv/client.test.ts b/packages/engine/src/plextv/client.test.ts
index 3577d61..3ab7eb0 100644
--- a/packages/engine/src/plextv/client.test.ts
+++ b/packages/engine/src/plextv/client.test.ts
@@ -4,2 +4,3 @@ import { FAKE_PLEX_ACCOUNT, fakePlexTv } from '../testing/plextv';
 import {
+  NO_PLEX_TV,
   newClientId,
@@ -253,2 +254,16 @@ describe('plexTvClient', () => {
 
+  it('fails every call, unsure, when it was given no plex.tv', async () => {
+    for (const call of [
+      NO_PLEX_TV.createPin(newClientId()),
+      NO_PLEX_TV.claimToken(TOKEN),
+      NO_PLEX_TV.accountId(TOKEN),
+    ]) {
+      expect(await caught(call)).toMatchObject({
+        kind: 'unreachable',
+        unsure: true,
+        message: 'Mediaplane was given no way to reach plex.tv',
+      });
+    }
+  });
+
   it('refuses a token that can not go in a header, without showing it', async () => {
```

**Change** `packages/engine/src/runtime/docker.test.ts`:

```diff
diff --git a/packages/engine/src/runtime/docker.test.ts b/packages/engine/src/runtime/docker.test.ts
index 1ac04cd..7023443 100644
--- a/packages/engine/src/runtime/docker.test.ts
+++ b/packages/engine/src/runtime/docker.test.ts
@@ -623,2 +623,27 @@ describe('createDockerRuntime', () => {
 
+  it("gives an unpublished service its start variables as references to Compose's environment", async () => {
+    const { exec, calls } = recorder(() => ({
+      code: 1,
+      stdout: '',
+      stderr: 'plex failed with claim-fake1cccccccccccccccc\n',
+    }));
+    const runtime = createDockerRuntime({ home, project: 'mediaplane-test', exec });
+    const claim = 'claim-fake1cccccccccccccccc';
+    expect(
+      await runtime.up(600, {}, ['jellyfin', 'plex'], { plex: { PLEX_CLAIM: claim } }),
+    ).toEqual({ ok: false, error: 'plex failed with ***' });
+    expect(calls[0]?.options?.input).toBe(
+      'services:\n  jellyfin:\n    ports: !reset []\n  plex:\n    ports: !reset []\n    environment:\n      PLEX_CLAIM: "${MP_START_PLEX_PLEX_CLAIM}"\n',
+    );
+    // The value goes in Compose's environment only: never in a file or an argument.
+    expect(calls[0]?.options?.env).toMatchObject({ MP_START_PLEX_PLEX_CLAIM: claim });
+    expect(calls[0]?.args.join(' ')).not.toContain(claim);
+    // A service started published gets none: start variables go with no published port.
+    await runtime.up(600, {}, [], { plex: { PLEX_CLAIM: claim } });
+    expect(calls[1]?.options?.input).toBeUndefined();
+    await expect(
+      runtime.up(600, {}, ['plex'], { plex: { 'PLEX CLAIM': claim } }),
+    ).rejects.toThrow('refusing the start variable "PLEX CLAIM"');
+  });
+
   it("reports a failed command with Compose's last lines, secrets replaced", async () => {
```

**Change** `packages/engine/src/secrets/values.test.ts`:

```diff
diff --git a/packages/engine/src/secrets/values.test.ts b/packages/engine/src/secrets/values.test.ts
index b48e036..d02f2ef 100644
--- a/packages/engine/src/secrets/values.test.ts
+++ b/packages/engine/src/secrets/values.test.ts
@@ -6,3 +6,9 @@ import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures
 import { emptySecretStore, type SecretStore } from './store';
-import { missingGeneratedSecrets, secretsToGenerate, secretValues } from './values';
+import {
+  missingGeneratedSecrets,
+  secretsToGenerate,
+  secretValues,
+  stackKeys,
+  userSecrets,
+} from './values';
 import { tempDir } from '../testing/temp';
@@ -104 +110,46 @@ describe('secretValues', () => {
 });
+
+describe('userSecrets and stackKeys', () => {
+  it("reads every secret you give, by app, and adds to the stored keys only an app's API key", async () => {
+    const stack = await stackIn();
+    const given = await userSecrets(stack, {});
+    // Every one is read, so that it is redacted: the VPN key too.
+    expect(given).toEqual({ gluetun: { wireguardKey: 'fake-wireguard-key-for-tests' } });
+    // No app's API takes the VPN key, so no setup or resource gets it.
+    expect(stackKeys(stack, stored, given)).toEqual(stored.apps);
+    // One an app's API takes as its key, as Plex's takes your token, is a key.
+    const keyed: ResolvedStack = {
+      ...stack,
+      apps: stack.apps.map((app) =>
+        app.def.id === 'gluetun'
+          ? {
+              ...app,
+              def: {
+                ...app.def,
+                api: {
+                  port: 'control',
+                  ready: '/',
+                  key: { secret: 'wireguardKey', scheme: 'x-api-key' },
+                  check: '/',
+                },
+              },
+            }
+          : app,
+      ),
+    };
+    expect(stackKeys(keyed, stored, given)).toEqual({
+      gluetun: {
+        controlApiKey: '1'.repeat(32),
+        wireguardKey: 'fake-wireguard-key-for-tests',
+      },
+      sonarr: { apiKey: '0'.repeat(32) },
+    });
+    // The store itself is left as it was: what you give is never saved in it.
+    expect(stored.apps.gluetun).toEqual({ controlApiKey: '1'.repeat(32) });
+  });
+
+  it('leaves out one that is missing', async () => {
+    const stack = await stackIn(STACK.replace('secrets/wg.key', 'secrets/none.key'));
+    expect(await userSecrets(stack, {})).toEqual({});
+  });
+});
```

**Change** `scripts/docs/catalog-facts.test.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.test.ts b/scripts/docs/catalog-facts.test.ts
index 0893983..2fdabce 100644
--- a/scripts/docs/catalog-facts.test.ts
+++ b/scripts/docs/catalog-facts.test.ts
@@ -58,2 +58,5 @@ describe('renderFacts', () => {
     expect(renderFacts(app('plex'))).toContain(
+      "with `token` in Plex's `X-Plex-Token` header\n",
+    );
+    expect(renderFacts(app('byparr'))).toContain(
       '- **API:** none over the wiring network\n',
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog/catalog.test.ts catalog/jellyfin/integration.test.ts catalog/plex/bootstrap.test.ts catalog/seerr/bootstrap.test.ts catalog/seerr/integration.test.ts packages/cli/src/run.test.ts packages/engine/src/apply/apply.test.ts packages/engine/src/http/client.test.ts packages/engine/src/integrations/wire.test.ts packages/engine/src/plextv/client.test.ts packages/engine/src/runtime/docker.test.ts packages/engine/src/secrets/values.test.ts scripts/docs/catalog-facts.test.ts`
Expected: FAIL. `catalog/plex/bootstrap.test.ts` doesn't load (`Cannot find module './bootstrap'`), and 21 tests fail in 9 more files, 634 pass: `catalog.test.ts` and `catalog-facts.test.ts` (Plex has no API or setup), `run.test.ts` (`Cannot set properties of undefined (setting 'configDir')`: no fake Plex), `apply.test.ts` (no start variables, no `claimedHint`), `http/client.test.ts` (`client(...).until is not a function`, and no `X-Plex-Token`), `wire.test.ts`, `plextv/client.test.ts` (no `NO_PLEX_TV`), `docker.test.ts` (no start variables) and `values.test.ts` (`userSecrets is not a function`).

- [ ] **Step 3: Write the claim, the context, the start variables and Plex's setup**

**Change** `catalog/plex/app.ts`:

```diff
diff --git a/catalog/plex/app.ts b/catalog/plex/app.ts
index 5d91aa7..b585040 100644
--- a/catalog/plex/app.ts
+++ b/catalog/plex/app.ts
@@ -1,2 +1,3 @@
 import { defineApp } from '@mediaplane/engine';
+import { plexBootstrap } from './bootstrap';
 
@@ -24,2 +25,10 @@ export default defineApp({
   },
+  // Your token is its key: Plex takes a token of the account that claimed it.
+  api: {
+    port: 'web',
+    ready: '/identity',
+    key: { secret: 'token', scheme: 'x-plex-token' },
+    check: '/library/sections',
+  },
+  bootstrap: plexBootstrap,
   env: () => ({ VERSION: 'docker' }),
```

**Create** `catalog/plex/bootstrap.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AppApiError,
  BootstrapFailed,
  PlexTvError,
  type AppApi,
  type Bootstrap,
  type BootstrapContext,
} from '@mediaplane/engine';
import { z } from 'zod';

/** Where Plex keeps its settings, its claim's token among them, in its appdata folder. */
export const PREFERENCES =
  'Library/Application Support/Plex Media Server/Preferences.xml';

/** Plex's own token, which its claim gave it, in Preferences.xml. */
const SERVER_TOKEN = /\sPlexOnlineToken="([^"]+)"/;

const identity = z.looseObject({
  MediaContainer: z.looseObject({ claimed: z.boolean() }),
});

type Identity = z.infer<typeof identity>['MediaContainer'];

/**
 * What Plex says of itself to anyone (`/identity`): whether it is claimed. Asked without
 * your token, which goes to Plex only once it is shown to be yours.
 */
async function identityOf(api: AppApi): Promise<Identity> {
  return (await api.until('/identity', identity, () => true, { anonymous: true }))
    .MediaContainer;
}

/** Your Plex token, which the setup claims Plex with, from the stack's keys. */
function tokenOf(ctx: BootstrapContext): string | undefined {
  return ctx.keys.plex?.token;
}

/**
 * Plex's own token, from its Preferences.xml in `home`; undefined when it holds none.
 * Throws AppApiError when the file can't be read.
 */
async function serverTokenOf(api: AppApi, home: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(join(home, 'appdata', 'plex', PREFERENCES), 'utf8');
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code ?? 'no reason given';
    throw new AppApiError(
      `${api.name} at ${api.where} is claimed, and Mediaplane can't read appdata/plex/${PREFERENCES} (${code}) to tell by whose plex.tv account`,
      { kind: 'rejected' },
    );
  }
  const found = SERVER_TOKEN.exec(text)?.[1];
  if (found !== undefined) api.addSecret(found);
  return found;
}

/**
 * The id of the plex.tv account `token` is a token of, as plex.tv says; undefined when
 * plex.tv refuses it. `whose` names the token in a failure.
 */
async function accountOf(
  api: AppApi,
  ctx: BootstrapContext,
  token: string,
  whose: 'yours' | "Plex's",
): Promise<number | undefined> {
  try {
    return await ctx.plexTv.accountId(token);
  } catch (cause) {
    if (!(cause instanceof PlexTvError)) throw cause;
    if (cause.unsure) {
      throw new AppApiError(
        `${api.name} at ${api.where} is claimed, and Mediaplane couldn't tell whether by your plex.tv account: ${cause.message}`,
        { kind: 'auth', unsure: true },
      );
    }
    if (cause.kind === 'refused' && whose === "Plex's") return undefined;
    throw new AppApiError(
      cause.kind === 'refused'
        ? `${api.name} at ${api.where} is claimed, and plex.tv refused your Plex token when asked whose it is: ${cause.message}. Run "mediaplane plex-login" to sign in again`
        : `${api.name} at ${api.where} is claimed, and plex.tv's answer doesn't say by whose account: ${cause.message}`,
      { kind: 'rejected' },
    );
  }
}

/**
 * Plex's first-run setup: its claim (spec §6.1, §6.4). An unclaimed Plex lets anyone who
 * reaches it at an address claim it, with a claim token of their own plex.tv account and
 * no sign-in (probed: `POST /myplex/claim` answered 200), so it starts unpublished.
 * - Its first start gets PLEX_CLAIM, a claim token apply fetches from plex.tv with your
 *   token just before (`firstStart`): the image trades it at plex.tv for a token of your
 *   account, and saves it in Preferences.xml, as Plex's `PlexOnlineToken`, before Plex
 *   starts for good. A claim token lasts four minutes and is used once.
 * - The setup waits, as long as apply waits for an app, until Plex says it is claimed:
 *   the image starts Plex once for its config, unclaimed, and the container can be healthy
 *   then (probed). One that doesn't claim itself in that time stays unpublished: its claim
 *   token ran out, or it couldn't reach plex.tv.
 * - A claimed Plex is yours only when plex.tv says the token its claim gave it, in its
 *   Preferences.xml, is your account's: plex.tv answers that, not Plex. Plex's admin can
 *   change what Plex says of itself, its machine identifier too (probed), but can't make
 *   it hold a token of your account without one. Anything else is refused (`auth`), and
 *   Plex stays unpublished: another account's token, or one plex.tv refuses, as it does
 *   once the server is removed from its account (probed). plex.tv unanswered (a timeout, a
 *   5xx, no connection) is `unsure`, as is a claimed Plex whose file holds no token.
 * - It is done once Preferences.xml holds a token (`PlexOnlineToken`), and Mediaplane's
 *   record names Plex: the token is yours, never one Mediaplane made.
 */
export const plexBootstrap: Bootstrap = {
  done: { path: PREFERENCES, pattern: /\sPlexOnlineToken="[^"]+"/ },
  open: async (api) => !(await identityOf(api)).claimed,
  async firstStart(_stack, ctx) {
    const token = tokenOf(ctx);
    if (token === undefined) {
      throw new BootstrapFailed(
        "Plex can't be claimed: Mediaplane has no Plex token, so nothing was started",
        'run "mediaplane plex-login", then run apply again',
      );
    }
    try {
      return { PLEX_CLAIM: await ctx.plexTv.claimToken(token) };
    } catch (cause) {
      if (!(cause instanceof PlexTvError)) throw cause;
      throw new BootstrapFailed(
        `Plex's first start needs a claim token from plex.tv, which Mediaplane couldn't get, so nothing was started: ${cause.message}`,
        cause.kind === 'refused'
          ? 'plex.tv refused your Plex token: it was revoked, or is not one. Run "mediaplane plex-login" to sign in again, then run apply again'
          : 'check that this host reaches plex.tv, then run apply again',
      );
    }
  },
  async run(api, _admin, stack, ctx) {
    const token = tokenOf(ctx);
    if (token === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} can't be claimed: Mediaplane has no Plex token (plex.token)`,
        { kind: 'rejected' },
      );
    }
    // As long as apply waits for an app, as Plex claims itself as it first starts.
    const held = (
      await api.until('/identity', identity, (i) => i.MediaContainer.claimed, {
        anonymous: true,
      })
    ).MediaContainer;
    if (!held.claimed) {
      throw new AppApiError(
        `${api.name} at ${api.where} didn't claim itself as it started, so it stays unpublished: its claim token may have run out, or it couldn't reach plex.tv; its log says which ("mediaplane status plex" names its container)`,
        { kind: 'rejected' },
      );
    }
    const serverToken = await serverTokenOf(api, stack.home);
    if (serverToken === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} is claimed, and its Preferences.xml holds no token of its claim, so Mediaplane couldn't tell whether by your plex.tv account`,
        { kind: 'auth', unsure: true },
      );
    }
    const yours = await accountOf(api, ctx, token, 'yours');
    const its = await accountOf(api, ctx, serverToken, "Plex's");
    if (its === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} is claimed by no plex.tv account of yours: plex.tv refuses the token its claim gave it, as it does once the server is removed from its account`,
        { kind: 'auth' },
      );
    }
    if (its !== yours) {
      throw new AppApiError(
        `${api.name} at ${api.where} is claimed by another plex.tv account than yours: plex.tv says the token its claim gave it is another account's`,
        { kind: 'auth' },
      );
    }
    return undefined;
  },
  claimedHint: (_stack, container) =>
    `First: if that plex.tv account is yours too, run "mediaplane plex-login" and sign in as it, then run apply again. Or second, keeping what Plex holds: stop it ("docker stop ${container}"), remove every attribute whose name starts with PlexOnline from appdata/plex/${PREFERENCES}, then run apply again, which claims it as yours. Last, only if you don't need what it holds: start it afresh, as the runbook says`,
};
```

**Change** `catalog/seerr/bootstrap.ts`:

```diff
diff --git a/catalog/seerr/bootstrap.ts b/catalog/seerr/bootstrap.ts
index 2468a21..e7e619a 100644
--- a/catalog/seerr/bootstrap.ts
+++ b/catalog/seerr/bootstrap.ts
@@ -7,2 +7,3 @@ import {
   type Bootstrap,
+  type ResolvedStack,
 } from '@mediaplane/engine';
@@ -84,2 +85,16 @@ async function ownSetup(
 
+/**
+ * What to do about a Seerr set up with a login Mediaplane can't show is its own: make
+ * that login the shared admin's, or the shared admin Seerr's admin, at the stack's
+ * Jellyfin; and only last, start Seerr afresh.
+ */
+function claimedHint(stack: ResolvedStack): string {
+  const jellyfin = stackAddress(stack, 'jellyfin');
+  const at =
+    jellyfin === undefined
+      ? "the stack's Jellyfin"
+      : `${jellyfin.host}:${String(jellyfin.port)}`;
+  return `First: if the Jellyfin login it was set up with is yours, set admin.username and admin.password to it. Or second: make its admin (its first user) the Jellyfin login that admin.username names. Either needs its Jellyfin already at ${at}, with no URL base and no TLS; then run apply again. Last, if you did not set it up: start it afresh, as the runbook says`;
+}
+
 /**
@@ -116,2 +131,3 @@ export const seerrBootstrap: Bootstrap = {
   open,
+  claimedHint,
   async run(api, admin, stack) {
```

**Change** `packages/cli/src/run.ts`:

```diff
diff --git a/packages/cli/src/run.ts b/packages/cli/src/run.ts
index 5d741f4..d0449d7 100644
--- a/packages/cli/src/run.ts
+++ b/packages/cli/src/run.ts
@@ -302,2 +302,3 @@ export function createProgram(
         project,
+        plexTv: deps.plexTv(runtime),
         confirm: async (shown) => {
```

**Change** `packages/engine/src/apply/apply.ts`:

```diff
diff --git a/packages/engine/src/apply/apply.ts b/packages/engine/src/apply/apply.ts
index 149a7f1..90695c4 100644
--- a/packages/engine/src/apply/apply.ts
+++ b/packages/engine/src/apply/apply.ts
@@ -16,2 +16,3 @@ import { COMPOSE_PATH, COMPOSE_PREV_PATH, ENV_PATH, STACK_PATH } from '../paths'
 import { plan, planStack, type PlanOptions, type PlanResult } from '../plan/plan';
+import { NO_PLEX_TV, type PlexTv } from '../plextv/client';
 import { PROJECT_NAME } from '../render/compose';
@@ -29,3 +30,3 @@ import { withGeneratedSecrets, type RandomBytes } from '../secrets/generate';
 import { writeSecretStore } from '../secrets/store';
-import { secretValues } from '../secrets/values';
+import { secretValues, stackKeys, userSecrets } from '../secrets/values';
 import { acquireLock, LockedError, type Lock } from '../state/lock';
@@ -37,3 +38,3 @@ import { compare } from '../util/sort';
 import { vpnCheck, VPN_RUNBOOK } from '../vpn/check';
-import { bootstrapApps, BootstrapFailed } from './bootstrap';
+import { bootstrapApps, BootstrapFailed, startVariables } from './bootstrap';
 import {
@@ -72,2 +73,7 @@ export interface ApplyOptions extends PlanOptions {
   project?: string;
+  /**
+   * plex.tv, for Plex's claim and the setups that ask it: called directly from source,
+   * through the plex.tv helper in the image. Without it, each call fails.
+   */
+  plexTv?: PlexTv;
 }
@@ -148,6 +154,17 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
   let values: Record<string, string> = {};
-  /** `up`, with `unpublished` started without their ports; a failure names the apps. */
+  /** The secrets you give, such as Plex's token: read once, never kept. */
+  const given = await userSecrets(stack, options.env);
+  const plexTv = options.plexTv ?? NO_PLEX_TV;
+  /** Each app's start variables while it starts unpublished (Plex's claim): secrets. */
+  let startEnv: Record<string, Record<string, string>> = {};
+  /**
+   * `up`, with `unpublished` started without their ports, and with their start variables;
+   * a failure names the apps.
+   */
   const up = async (unpublished: readonly string[]) => {
     const wait = options.waitSeconds ?? DEFAULT_WAIT_SECONDS;
-    const result = await runtime.up(wait, values, unpublished);
+    const env = Object.fromEntries(
+      Object.entries(startEnv).filter(([service]) => unpublished.includes(service)),
+    );
+    const result = await runtime.up(wait, values, unpublished, env);
     if (!result.ok) throw new Error(await startFailure(runtime, result.error));
@@ -196,2 +213,13 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
   await steps.run('start', async () => {
+    // An app whose setup needs something for its first start gets it now, as late as can
+    // be (Plex's claim token lasts four minutes), but before anything changes: one that
+    // can't be had stops the step, and stops the app it was for if it runs, since it
+    // isn't shown to be yours.
+    startEnv = await startVariables(
+      stack,
+      shown.bootstrap,
+      { keys: stackKeys(stack, store, given), plexTv },
+      runtime,
+      values,
+    );
     // Compose can't recreate the wiring network while another project's container is on
@@ -236,2 +264,4 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
         values,
+        given,
+        plexTv,
         env: options.env,
@@ -264,2 +294,3 @@ async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
         values,
+        given,
         env: options.env,
```

**Change** `packages/engine/src/apply/bootstrap.ts`:

```diff
diff --git a/packages/engine/src/apply/bootstrap.ts b/packages/engine/src/apply/bootstrap.ts
index d6c9b97..63616c9 100644
--- a/packages/engine/src/apply/bootstrap.ts
+++ b/packages/engine/src/apply/bootstrap.ts
@@ -1,2 +1,2 @@
-import type { Bootstrap } from '../catalog/types';
+import type { Bootstrap, BootstrapContext } from '../catalog/types';
 import { AppApiError, APP_DEADLINE_MS, type AppApi } from '../http/client';
@@ -13,4 +13,4 @@ import {
 } from '../integrations/wiring';
-import { stackAddress } from '../integrations/address';
 import { appSetupDone, type BootstrapChange } from '../plan/bootstrap';
+import { NO_PLEX_TV, type PlexTv } from '../plextv/client';
 import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
@@ -19,2 +19,3 @@ import { adminLogin } from '../secrets/admin';
 import { writeSecretStore, type SecretStore } from '../secrets/store';
+import { stackKeys } from '../secrets/values';
 import { foundSecrets, redact, type FoundSecrets } from '../util/redact';
@@ -27,2 +28,6 @@ export interface BootstrapOptions {
   values: Readonly<Record<string, string>>;
+  /** The secrets you give (userSecrets), such as Plex's token: keys, never kept. */
+  given?: Readonly<Record<string, Readonly<Record<string, string>>>>;
+  /** plex.tv, for a setup that asks it (Plex's, Seerr's with Plex); none by default. */
+  plexTv?: PlexTv;
   env: NodeJS.ProcessEnv;
@@ -137,10 +142,13 @@ export async function bootstrapApps(
   const admin = await adminLogin(stack.config, options.home, options.store, options.env);
-  const secrets = knownSecrets(options.values, options.store, admin);
+  const given = options.given ?? {};
+  const secrets = knownSecrets(options.values, options.store, admin, given);
   const found = options.found ?? foundSecrets();
-  // A key that Mediaplane chose, and the app takes from its environment (Seerr's), is
-  // carried: the setup asks an app that is set up already with it, never with the
-  // password. A key the setup makes isn't there yet, or may be stale.
+  const allKeys = stackKeys(stack, options.store, given);
+  // A key that Mediaplane chose, and the app takes from its environment (Seerr's), or
+  // one you give (Plex's token), is carried: the setup asks an app that is set up already
+  // with it, never with the password. A key the setup makes isn't there yet, or may be
+  // stale.
   const appKeys = Object.fromEntries(
     apps.flatMap((app) => {
-      const own = options.store.apps[app.def.id];
+      const own = allKeys[app.def.id];
       return app.def.bootstrap?.secret === undefined && own !== undefined
@@ -150,2 +158,3 @@ export async function bootstrapApps(
   );
+  const ctx: BootstrapContext = { keys: allKeys, plexTv: options.plexTv ?? NO_PLEX_TV };
   let reached: Map<string, ReachedApp>;
@@ -190,2 +199,3 @@ export async function bootstrapApps(
             stack,
+            ctx,
           })
@@ -320,2 +330,3 @@ async function setUp(
     stack: ResolvedStack;
+    ctx: BootstrapContext;
   },
@@ -329,3 +340,3 @@ async function setUp(
     await client.api.ready(api.ready);
-    const key = await bootstrap.run(client.api, admin, started.stack);
+    const key = await bootstrap.run(client.api, admin, started.stack, started.ctx);
     if (bootstrap.secret !== undefined && key === undefined) {
@@ -381,3 +392,3 @@ async function setUp(
  * setup that makes no key, `unsure` says the check couldn't be made, rather than found
- * the app isn't Mediaplane's.
+ * the app isn't Mediaplane's; otherwise the app's own remedies follow (claimedHint).
  */
@@ -387,3 +398,3 @@ async function claimed(
   unsure: boolean,
-  { home, stack }: { home: string; stack: ResolvedStack },
+  { home, stack, container }: { home: string; stack: ResolvedStack; container: string },
 ): Promise<string> {
@@ -397,8 +408,6 @@ async function claimed(
     }
-    const jellyfin = stackAddress(stack, 'jellyfin');
-    const at =
-      jellyfin === undefined
-        ? "the stack's Jellyfin"
-        : `${jellyfin.host}:${String(jellyfin.port)}`;
-    return `${said}. First: if the Jellyfin login it was set up with is yours, set admin.username and admin.password to it. Or second: make its admin (its first user) the Jellyfin login that admin.username names. Either needs its Jellyfin already at ${at}, with no URL base and no TLS; then run apply again. Last, if you did not set it up: start it afresh, as the runbook says`;
+    const remedies =
+      app.def.bootstrap?.claimedHint?.(stack, container) ??
+      'If you did not set it up: start it afresh, as the runbook says';
+    return `${said}. ${remedies}`;
   }
@@ -413 +422,76 @@ async function claimed(
 }
+
+/**
+ * The start variables of each app the plan starts unpublished whose setup gives some for
+ * its first start (`Bootstrap.firstStart`), while its appdata doesn't say the setup is done
+ * (a file Mediaplane can't read doesn't say so either), by service: Plex's PLEX_CLAIM. One
+ * that can't be made throws, before anything starts.
+ */
+export async function firstStartEnv(
+  stack: ResolvedStack,
+  pending: readonly BootstrapChange[],
+  ctx: BootstrapContext,
+): Promise<Record<string, Record<string, string>>> {
+  const env: Record<string, Record<string, string>> = {};
+  for (const app of await firstStartApps(stack, pending)) {
+    const bootstrap = app.def.bootstrap;
+    if (bootstrap?.firstStart === undefined) continue;
+    env[app.def.id] = await bootstrap.firstStart(stack, ctx);
+  }
+  return env;
+}
+
+/** The apps firstStartEnv asks for start variables, in the plan's order. */
+async function firstStartApps(
+  stack: ResolvedStack,
+  pending: readonly BootstrapChange[],
+): Promise<ResolvedApp[]> {
+  const apps: ResolvedApp[] = [];
+  for (const change of pending) {
+    if (!change.unpublished) continue;
+    const app = stack.apps.find((a) => a.def.id === change.app);
+    if (app?.def.bootstrap?.firstStart === undefined) continue;
+    if ((await appSetupDone(stack.home, app)) === true) continue;
+    apps.push(app);
+  }
+  return apps;
+}
+
+/**
+ * firstStartEnv, for apply's start step, before it changes anything. When it throws, each
+ * app it was for that runs is stopped first: an app whose setup isn't done isn't shown to
+ * be yours (Plex, unclaimed or claimed by someone else, such as one an apply before
+ * Slice 7 published), so it must not stay published. A BootstrapFailed then says so.
+ */
+export async function startVariables(
+  stack: ResolvedStack,
+  pending: readonly BootstrapChange[],
+  ctx: BootstrapContext,
+  runtime: Runtime,
+  values: Readonly<Record<string, string>>,
+): Promise<Record<string, Record<string, string>>> {
+  try {
+    return await firstStartEnv(stack, pending, ctx);
+  } catch (cause) {
+    const apps = (await firstStartApps(stack, pending)).map((app) => app.def.id);
+    let running: string[];
+    try {
+      running = (await runtime.containers())
+        .filter((c) => apps.includes(c.service) && c.state === 'running')
+        .map((c) => c.service);
+    } catch {
+      // Not known to be stopped: stop them all.
+      running = apps;
+    }
+    if (running.length === 0) throw cause;
+    const stopped = await runtime.stop(running, { ...values });
+    if (!(cause instanceof BootstrapFailed)) throw cause;
+    const names = running.join(', ');
+    throw new BootstrapFailed(
+      stopped.ok
+        ? `${cause.message}; Mediaplane stopped ${names}, which ran, but isn't shown to be yours, so that it isn't left published`
+        : `${cause.message}; ${names} runs, isn't shown to be yours, and couldn't be stopped: ${stopped.error}. Stop it yourself`,
+      cause.hint,
+    );
+  }
+}
```

**Change** `packages/engine/src/catalog/types.ts`:

```diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index fa6dce1..4fb6350 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -5,2 +5,3 @@ import type { AppApi, KeyScheme } from '../http/client';
 import type { Integration } from '../integrations/types';
+import type { PlexTv } from '../plextv/client';
 import type { ResolvedStack } from '../resolver/resolve';
@@ -119,2 +120,13 @@ export interface ApiSpec {
 
+/** What a first-run setup can use besides the app's API. It holds secrets: never print it. */
+export interface BootstrapContext {
+  /**
+   * The stack's keys, by app then name: those in state/secrets.json, and the ones you
+   * give, such as Plex's token (`keys.plex.token`).
+   */
+  keys: Readonly<Record<string, Readonly<Record<string, string>>>>;
+  /** plex.tv: called directly from source, through the plex.tv helper in the image. */
+  plexTv: PlexTv;
+}
+
 /**
@@ -123,3 +135,3 @@ export interface ApiSpec {
  * over the wiring network, without a key: Jellyfin's startup wizard, then the API key that
- * only the app can make; Seerr's first sign-in, through Jellyfin.
+ * only the app can make; Seerr's first sign-in, through Jellyfin; Plex's claim.
  */
@@ -141,2 +153,13 @@ export interface Bootstrap {
   open(api: AppApi): Promise<boolean>;
+  /**
+   * Environment variables for the app's start while its setup isn't done, which only
+   * apply's start step gives it, with its ports unpublished: Plex's PLEX_CLAIM, a claim
+   * token fetched from plex.tv. They reach Compose on its standard input, as references to
+   * values in its own environment: never in compose.yaml, .env, a record or the output.
+   * Each value is a secret of the run. Throws BootstrapFailed, and then nothing starts.
+   */
+  firstStart?(
+    stack: ResolvedStack,
+    ctx: BootstrapContext,
+  ): Promise<Record<string, string>>;
   /**
@@ -155,3 +178,11 @@ export interface Bootstrap {
     stack: ResolvedStack,
+    ctx: BootstrapContext,
   ): Promise<string | undefined>;
+  /**
+   * For a setup that makes no key: what to do about an app found set up that Mediaplane
+   * can't show is its own, the safe remedies first and starting afresh last, as sentences.
+   * `container` is the app's container's name. Without it, the step says to start the app
+   * afresh if you did not set it up.
+   */
+  claimedHint?(stack: ResolvedStack, container: string): string;
 }
```

**Change** `packages/engine/src/config/schema.ts`:

```diff
diff --git a/packages/engine/src/config/schema.ts b/packages/engine/src/config/schema.ts
index bcdd84c..a264164 100644
--- a/packages/engine/src/config/schema.ts
+++ b/packages/engine/src/config/schema.ts
@@ -233,3 +233,3 @@ const stackShape = {
       token: secretRefSchema.describe(
-        'Your Plex token, as a secret reference. Checked to exist, but not used yet: claiming the server arrives in Slice 7.',
+        'Your Plex token, as a secret reference: "mediaplane plex-login" saves it. Mediaplane claims Plex with it, as yours, and it is the key Mediaplane and the other apps reach Plex with.',
       ),
```

**Change** `packages/engine/src/http/client.ts`:

```diff
diff --git a/packages/engine/src/http/client.ts b/packages/engine/src/http/client.ts
index c6837fd..ebbc20c 100644
--- a/packages/engine/src/http/client.ts
+++ b/packages/engine/src/http/client.ts
@@ -73,6 +73,6 @@ export interface TestFailure {
  * How a request carries the key: the X-Api-Key header (Servarr), a Bearer token
- * (qBittorrent), or Jellyfin's `Authorization: MediaBrowser …` header, whose client
- * fields go with every request, a token or not.
+ * (qBittorrent), Jellyfin's `Authorization: MediaBrowser …` header, whose client fields go
+ * with every request, a token or not, or Plex's X-Plex-Token header.
  */
-export type KeyScheme = 'x-api-key' | 'bearer' | 'mediabrowser';
+export type KeyScheme = 'x-api-key' | 'bearer' | 'mediabrowser' | 'x-plex-token';
 
@@ -213,2 +213,14 @@ export interface AppApi {
   ready(path: string): Promise<void>;
+  /**
+   * GET `path` with the key (without it, when `anonymous`), checked with `schema`, again
+   * and again until `done` says so of the answer or the deadline passes, waiting a little
+   * longer each time, up to 2 s: the last answer, either way. For what an app finishes by
+   * itself once it is ready, such as Plex claiming itself as it first starts.
+   */
+  until<T>(
+    path: string,
+    schema: z.ZodType<T>,
+    done: (answer: T) => boolean,
+    options?: { anonymous?: boolean },
+  ): Promise<T>;
   /**
@@ -329,2 +341,3 @@ export function createAppApi(options: AppApiOptions): AppApi {
         if (options.key?.scheme === 'bearer') headers.Authorization = `Bearer ${key}`;
+        else if (options.key?.scheme === 'x-plex-token') headers['X-Plex-Token'] = key;
         else headers['X-Api-Key'] = key;
@@ -682,2 +695,13 @@ export function createAppApi(options: AppApiOptions): AppApi {
     },
+    async until(path, schema, done, how = {}) {
+      const start = retry.now();
+      const call: Call = { method: 'GET', path, anonymous: how.anonymous === true };
+      for (let tries = 0; ; tries++) {
+        const answer = parsed(call, await send(call, true), schema);
+        if (done(answer)) return answer;
+        const delay = Math.min(2_000, 250 * 2 ** tries);
+        if (retry.now() + delay - start > retry.deadlineMs) return answer;
+        await retry.sleep(delay);
+      }
+    },
     withKey: (value) =>
```

**Change** `packages/engine/src/integrations/wire.ts`:

```diff
diff --git a/packages/engine/src/integrations/wire.ts b/packages/engine/src/integrations/wire.ts
index 55684de..0e96656 100644
--- a/packages/engine/src/integrations/wire.ts
+++ b/packages/engine/src/integrations/wire.ts
@@ -8,2 +8,3 @@ import { adminLogin } from '../secrets/admin';
 import type { SecretStore } from '../secrets/store';
+import { stackKeys } from '../secrets/values';
 import { foundSecrets, redact, type FoundSecrets } from '../util/redact';
@@ -39,2 +40,4 @@ export interface WireOptions {
   values: Readonly<Record<string, string>>;
+  /** The secrets you give (userSecrets), such as Plex's token: keys, never kept. */
+  given?: Readonly<Record<string, Readonly<Record<string, string>>>>;
   env: NodeJS.ProcessEnv;
@@ -95,3 +98,5 @@ export async function wire(options: WireOptions): Promise<string[]> {
   const admin = await adminLogin(stack.config, options.home, options.store, options.env);
-  const secrets = knownSecrets(options.values, options.store, admin);
+  const given = options.given ?? {};
+  const keys = stackKeys(stack, options.store, given);
+  const secrets = knownSecrets(options.values, options.store, admin, given);
   const found = options.found ?? foundSecrets();
@@ -109,3 +114,3 @@ export async function wire(options: WireOptions): Promise<string[]> {
       current: await runtime.containers(),
-      keys: options.store.apps,
+      keys,
       secrets,
@@ -156,3 +161,3 @@ export async function wire(options: WireOptions): Promise<string[]> {
   for (const app of order) {
-    const ctx: WiringContext = { stack, app, admin, keys: options.store.apps };
+    const ctx: WiringContext = { stack, app, admin, keys };
     const targets = wiringTargets(ctx);
```

**Change** `packages/engine/src/integrations/wiring.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index f71e7c1..9f67233 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -207,5 +207,5 @@ export async function reachApps(
  * Every secret an app's answer could repeat: the .env values, every key in the store, the
- * admin password in use, and the one the store keeps. That one stays stored when you set
- * admin.password to a file of your own, and an app may still hold it. The client
- * replaces each with *** in what it says.
+ * ones you give (`given`: Plex's token), the admin password in use, and the one the store
+ * keeps. That one stays stored when you set admin.password to a file of your own, and an
+ * app may still hold it. The client replaces each with *** in what it says.
  */
@@ -215,2 +215,3 @@ export function knownSecrets(
   admin: { password: string },
+  given: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
 ): string[] {
@@ -219,2 +220,3 @@ export function knownSecrets(
     ...Object.values(store.apps).flatMap((secrets) => Object.values(secrets)),
+    ...Object.values(given).flatMap((secrets) => Object.values(secrets)),
     ...(store.shared?.adminPassword === undefined ? [] : [store.shared.adminPassword]),
```

**Change** `packages/engine/src/plan/plan.ts`:

```diff
diff --git a/packages/engine/src/plan/plan.ts b/packages/engine/src/plan/plan.ts
index 48ae5e3..8874941 100644
--- a/packages/engine/src/plan/plan.ts
+++ b/packages/engine/src/plan/plan.ts
@@ -35,3 +35,8 @@ import { withGeneratedSecrets } from '../secrets/generate';
 import { readSecretStore, type SecretStore } from '../secrets/store';
-import { secretsToGenerate, secretValues } from '../secrets/values';
+import {
+  secretsToGenerate,
+  secretValues,
+  stackKeys,
+  userSecrets,
+} from '../secrets/values';
 import { planAppdata } from './appdata';
@@ -228,2 +233,4 @@ export async function planStack(
     const admin = await adminLogin(stack.config, home, preview, options.env);
+    // The secrets you give, such as Plex's token, which is Plex's key.
+    const given = await userSecrets(stack, options.env);
     // An app to set up is asked once it is: without its key, it can't be asked now.
@@ -251,5 +258,5 @@ export async function planStack(
         runtime: options.runtime,
-        keys: preview.apps,
+        keys: stackKeys(stack, preview, given),
         admin,
-        secrets: knownSecrets(values, preview, admin),
+        secrets: knownSecrets(values, preview, admin, given),
         known,
```

**Change** `packages/engine/src/plextv/client.ts`:

```diff
diff --git a/packages/engine/src/plextv/client.ts b/packages/engine/src/plextv/client.ts
index d9bd902..f9dc31d 100644
--- a/packages/engine/src/plextv/client.ts
+++ b/packages/engine/src/plextv/client.ts
@@ -105,2 +105,19 @@ export interface PlexTv {
 
+/**
+ * plex.tv for a caller that was given none, such as a test of a stack without Plex: every
+ * call fails, as plex.tv out of reach does.
+ */
+export const NO_PLEX_TV: PlexTv = {
+  createPin: () => Promise.reject(unavailable()),
+  waitForPin: () => Promise.reject(unavailable()),
+  claimToken: () => Promise.reject(unavailable()),
+  accountId: () => Promise.reject(unavailable()),
+};
+
+function unavailable(): PlexTvError {
+  return new PlexTvError('Mediaplane was given no way to reach plex.tv', {
+    kind: 'unreachable',
+  });
+}
+
 /** How a plex.tv client is made; tests give a fake plex.tv's address and a clock. */
```

**Change** `packages/engine/src/runtime/docker.ts`:

```diff
diff --git a/packages/engine/src/runtime/docker.ts b/packages/engine/src/runtime/docker.ts
index 00b5c4e..0af7e16 100644
--- a/packages/engine/src/runtime/docker.ts
+++ b/packages/engine/src/runtime/docker.ts
@@ -366,4 +366,4 @@ export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
 
-    async up(waitSeconds, values, unpublished = []) {
-      const reset = unpublishedPorts(unpublished);
+    async up(waitSeconds, values, unpublished = [], startEnv = {}) {
+      const reset = unpublishedPorts(unpublished, startEnv);
       const result = await docker(
@@ -384,6 +384,6 @@ export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
           timeoutMs: (waitSeconds + 120) * 1000,
-          ...(reset === undefined ? {} : { input: reset }),
+          ...(reset === undefined ? {} : { input: reset.file, env: reset.values }),
         },
       );
-      return commandResult(result, values);
+      return commandResult(result, { ...values, ...reset?.values });
     },
@@ -695,10 +695,38 @@ function serviceName(service: string): string {
  */
-function unpublishedPorts(services: readonly string[]): string | undefined {
+function unpublishedPorts(
+  services: readonly string[],
+  startEnv: Readonly<Record<string, Readonly<Record<string, string>>>>,
+): { file: string; values: Record<string, string> } | undefined {
   if (services.length === 0) return undefined;
-  const names = services.map((service) => serviceName(service));
-  return [
-    'services:',
-    ...names.map((name) => `  ${name}:\n    ports: !reset []`),
-    '',
-  ].join('\n');
+  const values: Record<string, string> = {};
+  const blocks = services.map((service) => {
+    const name = serviceName(service);
+    const env = Object.entries(startEnv[service] ?? {});
+    const lines = env.map(([variable, value]) => {
+      const reference = startEnvName(service, variable);
+      values[reference] = value;
+      return `      ${variable}: "\${${reference}}"`;
+    });
+    return [
+      `  ${name}:`,
+      '    ports: !reset []',
+      ...(lines.length === 0 ? [] : ['    environment:', ...lines]),
+    ].join('\n');
+  });
+  return { file: ['services:', ...blocks, ''].join('\n'), values };
+}
+
+/**
+ * The variable in Compose's environment that holds `service`'s start variable `variable`:
+ * MP_START_<SERVICE>_<VARIABLE>. Throws for a variable name Compose's environment can't
+ * take, or that YAML would need quoting for.
+ */
+export function startEnvName(service: string, variable: string): string {
+  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)) {
+    throw new RuntimeError(
+      `refusing the start variable ${JSON.stringify(variable)}: it is not an environment variable name`,
+    );
+  }
+  const part = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '_');
+  return `MP_START_${part(service)}_${part(variable)}`;
 }
```

**Change** `packages/engine/src/runtime/types.ts`:

```diff
diff --git a/packages/engine/src/runtime/types.ts b/packages/engine/src/runtime/types.ts
index d22ce93..0e8f088 100644
--- a/packages/engine/src/runtime/types.ts
+++ b/packages/engine/src/runtime/types.ts
@@ -97,2 +97,6 @@ export interface Runtime {
    * resets their `ports`. An `up` without them recreates them with their ports.
+   * `startEnv` gives such a service more environment variables, by service: that file
+   * names each as a reference to a variable in Compose's own environment, where its value
+   * goes, so a value is never in a file nor on a command line (Plex's PLEX_CLAIM). Its
+   * values are redacted from errors, as `values` are.
    */
@@ -102,2 +106,3 @@ export interface Runtime {
     unpublished?: readonly string[],
+    startEnv?: Readonly<Record<string, Readonly<Record<string, string>>>>,
   ): Promise<CommandResult>;
```

**Change** `packages/engine/src/secrets/values.ts`:

```diff
diff --git a/packages/engine/src/secrets/values.ts b/packages/engine/src/secrets/values.ts
index 1b5b91d..71a4db1 100644
--- a/packages/engine/src/secrets/values.ts
+++ b/packages/engine/src/secrets/values.ts
@@ -41,2 +41,49 @@ export function secretsToGenerate(stack: ResolvedStack, store: SecretStore): str
 
+/**
+ * The secrets you give (`userProvided`), by app then name, read from their references in
+ * stack.yaml now: Plex's token, the VPN key. They are never kept in state/secrets.json.
+ * One that can't be read is left out, as plan has already said.
+ */
+export async function userSecrets(
+  stack: ResolvedStack,
+  env: NodeJS.ProcessEnv,
+): Promise<Record<string, Record<string, string>>> {
+  const given: Record<string, Record<string, string>> = {};
+  for (const app of stack.apps) {
+    for (const [name, source] of Object.entries(app.def.secrets).sort(([a], [b]) =>
+      compare(a, b),
+    )) {
+      if (!('userProvided' in source)) continue;
+      const ref = userProvidedRef(stack, source.userProvided);
+      const value =
+        ref === undefined ? undefined : await readSecret(ref, stack.home, env);
+      if (value !== undefined)
+        given[app.def.id] = { ...given[app.def.id], [name]: value };
+    }
+  }
+  return given;
+}
+
+/**
+ * Every app's keys, by app then name: the store's, and of the ones you give (userSecrets),
+ * only those an app's API takes as its key, such as Plex's token, which is Plex's key to
+ * Mediaplane. The others, such as the VPN key, are redacted, but never reach a setup or a
+ * resource.
+ */
+export function stackKeys(
+  stack: ResolvedStack,
+  store: SecretStore,
+  given: Readonly<Record<string, Readonly<Record<string, string>>>>,
+): Record<string, Record<string, string>> {
+  const keys: Record<string, Record<string, string>> = { ...store.apps };
+  for (const app of stack.apps) {
+    const name = app.def.api?.key.secret;
+    const value = name === undefined ? undefined : given[app.def.id]?.[name];
+    if (name !== undefined && value !== undefined) {
+      keys[app.def.id] = { ...keys[app.def.id], [name]: value };
+    }
+  }
+  return keys;
+}
+
 /** The value of every ${MP_…} variable compose.yaml references. Unknown values are "". */
```

**Change** `packages/engine/src/testing/bootstrap.ts`:

```diff
diff --git a/packages/engine/src/testing/bootstrap.ts b/packages/engine/src/testing/bootstrap.ts
index 0e9c855..8c84c45 100644
--- a/packages/engine/src/testing/bootstrap.ts
+++ b/packages/engine/src/testing/bootstrap.ts
@@ -4,5 +4,6 @@ import { z } from 'zod';
 import { SetupWaiting } from '../apply/bootstrap';
-import type { Bootstrap, Catalog } from '../catalog/types';
+import type { Bootstrap, BootstrapContext, Catalog } from '../catalog/types';
 import { AppApiError, type AppApi } from '../http/client';
 import type { WiringSeams } from '../integrations/wiring';
+import { NO_PLEX_TV } from '../plextv/client';
 import { FIXTURE_API, fixtureCatalog } from './fixtures';
@@ -10,2 +11,8 @@ import { fakeHttpApp, type FakeApp, type FakeReply, type FakeRequest } from './h
 
+/**
+ * What a setup gets besides the app's API, for one that needs none of it (Jellyfin's, and
+ * Seerr's through Jellyfin): no keys, and no plex.tv.
+ */
+export const NO_SETUP_CONTEXT: BootstrapContext = { keys: {}, plexTv: NO_PLEX_TV };
+
 /** The key the fake setup makes. */
@@ -86,2 +93,4 @@ export const FAKE_SIGN_IN: Bootstrap = {
   open: signInOpen,
+  claimedHint: (_stack, container) =>
+    `First: sign in to ${container} as the shared admin, then run apply again. Last: start it afresh`,
   async run(api, admin, stack) {
```

**Change** `packages/engine/src/testing/fakes.ts`:

```diff
diff --git a/packages/engine/src/testing/fakes.ts b/packages/engine/src/testing/fakes.ts
index 075c6d4..76d2dd8 100644
--- a/packages/engine/src/testing/fakes.ts
+++ b/packages/engine/src/testing/fakes.ts
@@ -92,2 +92,11 @@ export interface FakeRuntimeOptions {
   up?: CommandResult;
+  /**
+   * Called on each `up` that succeeds, before it answers, with the services it starts
+   * unpublished and their start variables: what an app does as it starts, such as Plex
+   * claiming itself with its PLEX_CLAIM.
+   */
+  onUp?: (
+    unpublished: readonly string[],
+    startEnv: Readonly<Record<string, Readonly<Record<string, string>>>>,
+  ) => void | Promise<void>;
   chown?: CommandResult;
@@ -158,5 +167,16 @@ export function fakeRuntime(options: FakeRuntimeOptions = {}): Runtime {
     },
-    up: (_seconds, _values, unpublished = []) => {
-      record(unpublished.length === 0 ? 'up' : `up unpublished ${unpublished.join(' ')}`);
-      return Promise.resolve(options.up ?? { ok: true });
+    // async: a throwing onUp rejects like a failed docker call.
+    up: async (_seconds, _values, unpublished = [], startEnv = {}) => {
+      // Start variables go only with an unpublished start, as the real runtime's do.
+      const given = unpublished.flatMap((service) =>
+        Object.keys(startEnv[service] ?? {}).map((name) => `${service}.${name}`),
+      );
+      record(
+        unpublished.length === 0
+          ? 'up'
+          : `up unpublished ${unpublished.join(' ')}${given.length === 0 ? '' : ` with ${given.join(' ')}`}`,
+      );
+      const result = options.up ?? { ok: true };
+      if (result.ok) await options.onUp?.(unpublished, startEnv);
+      return result;
     },
@@ -268,4 +288,4 @@ export function fakeDocker(
       }),
-    up: async (waitSeconds, values, unpublished = []) => {
-      const result = await base.up(waitSeconds, values, unpublished);
+    up: async (waitSeconds, values, unpublished = [], startEnv = {}) => {
+      const result = await base.up(waitSeconds, values, unpublished, startEnv);
       if (!result.ok || options.upChangesNothing === true) return result;
@@ -274,4 +294,16 @@ export function fakeDocker(
       };
-      // As `ports: !reset []` leaves them: with no ports at all.
-      for (const service of unpublished) delete compose.services[service]?.ports;
+      // As `ports: !reset []` leaves them: with no ports at all, and the start variables
+      // in their environment, which Compose's hash takes in.
+      for (const service of unpublished) {
+        const config = compose.services[service];
+        if (config === undefined) continue;
+        delete config.ports;
+        const env = startEnv[service] ?? {};
+        if (Object.keys(env).length > 0) {
+          config.environment = {
+            ...(config.environment as Record<string, string> | undefined),
+            ...env,
+          };
+        }
+      }
       for (const config of Object.values(compose.services)) {
```

**Change** `packages/engine/src/testing/index.ts`:

```diff
diff --git a/packages/engine/src/testing/index.ts b/packages/engine/src/testing/index.ts
index 12c1d37..385c4de 100644
--- a/packages/engine/src/testing/index.ts
+++ b/packages/engine/src/testing/index.ts
@@ -6,2 +6,3 @@ export * from './http';
 export * from './jellyfin';
+export * from './plex';
 export * from './plextv';
```

**Create** `packages/engine/src/testing/plex.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FakeReply, FakeRequest } from './http';
import type { FakePlexTvState } from './plextv';

/** One of Plex's libraries (its "sections"), as Plex keeps it. */
export interface FakePlexSection {
  key: string;
  title: string;
  type: 'movie' | 'show';
  agent: string;
  scanner: string;
  language: string;
  locations: string[];
}

/** What the fake Plex holds; a test may change it between calls. */
export interface FakePlex {
  /** Its machine identifier, which plex.tv lists it by once it is claimed. */
  machineId: string;
  /** The plex.tv account that claimed it; null while it is unclaimed. */
  owner: number | null;
  /** Its own token, from its claim (`PlexOnlineToken`); '' while unclaimed. */
  serverToken: string;
  /** Its name; '' leaves it the container's hostname, as Plex does. */
  friendlyName: string;
  sections: FakePlexSection[];
  /**
   * How many more times /identity says it is unclaimed though it is claimed: Plex stops a
   * server it started for its config, claims itself, then starts again (probed).
   */
  claimingFor: number;
  /**
   * Its appdata folder: the fake keeps Preferences.xml there as Plex does, with its
   * machine identifier, and its token once claimed. Unset: nowhere.
   */
  configDir?: string;
}

/** Where Plex keeps Preferences.xml in its appdata folder. */
export const PLEX_PREFERENCES =
  'Library/Application Support/Plex Media Server/Preferences.xml';

/** The hostname a container of the fake Plex has: Plex's name for itself by default. */
export const FAKE_PLEX_HOSTNAME = 'f00dfeed1234';

/** A fake Plex as it first starts: unclaimed, with no library. */
export function freshPlex(): FakePlex {
  return {
    machineId: 'fake-machine-identifier-0001',
    owner: null,
    serverToken: '',
    friendlyName: '',
    sections: [],
    claimingFor: 0,
  };
}

/** The server token a fake Plex gets from the first claim a fake plex.tv takes. */
export const FAKE_SERVER_TOKEN = 'fake-server-token-01';

/** Plex's refusal of a call it won't take: an HTML page, 401 (probed). */
const UNAUTHORIZED: FakeReply = {
  status: 401,
  body: '<html><head><title>Unauthorized</title></head><body><h1>401 Unauthorized</h1></body></html>',
};

/**
 * Preferences.xml, as Plex writes it: one element of attributes, its token among them
 * once it is claimed. The fake writes it on each request it answers, and at a claim.
 */
function keepPreferences(plex: FakePlex): void {
  if (plex.configDir === undefined) return;
  const path = join(plex.configDir, PLEX_PREFERENCES);
  mkdirSync(dirname(path), { recursive: true });
  const token = plex.serverToken === '' ? '' : ` PlexOnlineToken="${plex.serverToken}"`;
  writeFileSync(
    path,
    `<?xml version="1.0" encoding="utf-8"?>\n<Preferences MachineIdentifier="${plex.machineId}" ProcessedMachineIdentifier="${plex.machineId}"${token}/>\n`,
  );
}

/**
 * What Plex's first start does with its PLEX_CLAIM (the image's own claim step): trade the
 * claim token at plex.tv for a token of its own, which plex.tv takes as the account's
 * that asked for the claim, and save it in Preferences.xml. A token plex.tv doesn't know,
 * or one used already, leaves Plex unclaimed, as the image's "Unable to claim" does. True
 * when it claimed itself.
 */
export function claimFakePlex(
  plex: FakePlex,
  claim: string | undefined,
  plexTv: FakePlexTvState,
): boolean {
  const known = plexTv.claims.find((c) => c.token === claim && !c.used);
  if (known === undefined || plex.owner !== null) return false;
  known.used = true;
  plex.owner = known.account;
  plex.serverToken = `fake-server-token-${String(plexTv.servers.length + 1).padStart(2, '0')}`;
  plexTv.servers.push({
    machineId: plex.machineId,
    owner: known.account,
    name: plex.friendlyName === '' ? FAKE_PLEX_HOSTNAME : plex.friendlyName,
    token: plex.serverToken,
  });
  keepPreferences(plex);
  return true;
}

function sectionShown(section: FakePlexSection) {
  return {
    key: section.key,
    title: section.title,
    type: section.type,
    agent: section.agent,
    scanner: section.scanner,
    language: section.language,
    uuid: `fake-uuid-${section.key}`,
    Location: section.locations.map((path, i) => ({ id: i + 1, path })),
  };
}

/**
 * Plex Media Server 1.43's API, as fakeStackApis answers it for `Host: plex`, from `plex`,
 * as Plex answered it when probed (2026-10-16):
 * - `/identity` answers anyone, saying whether it is claimed;
 * - everything else takes only a token of the account that claimed it (from `plexTv`), or
 *   its own server token: no token, another account's, or any call while it is unclaimed
 *   (the `Host` is a name, so Plex's DNS-rebinding check refuses it) is a 401 page;
 * - `/library/sections` lists its libraries.
 */
export function fakePlex(
  request: FakeRequest,
  plex: FakePlex,
  plexTv: FakePlexTvState,
): FakeReply {
  keepPreferences(plex);
  const url = new URL(request.path, 'http://plex');
  const { method } = request;
  if (url.pathname === '/identity' && method === 'GET') {
    const starting = plex.claimingFor > 0;
    if (starting) plex.claimingFor -= 1;
    return {
      status: 200,
      body: {
        MediaContainer: {
          size: 0,
          apiVersion: '1.2.3',
          claimed: plex.owner !== null && !starting,
          machineIdentifier: plex.machineId,
          version: '1.43.4.10903-e5521bd8c',
        },
      },
    };
  }
  const token = request.headers['x-plex-token'];
  const account = plexTv.accounts.find((a) => a.token === token);
  const takes =
    plex.owner !== null &&
    typeof token === 'string' &&
    (account?.id === plex.owner || token === plex.serverToken);
  if (!takes) return UNAUTHORIZED;
  if (url.pathname === '/library/sections' && method === 'GET') {
    return {
      status: 200,
      body: {
        MediaContainer: {
          size: plex.sections.length,
          title1: 'Plex Library',
          ...(plex.sections.length === 0
            ? {}
            : { Directory: plex.sections.map(sectionShown) }),
        },
      },
    };
  }
  return { status: 404 };
}
```

**Change** `packages/engine/src/testing/wiring.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index f56a27d..c164844 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -17,2 +17,4 @@ import {
 } from './jellyfin';
+import { fakePlex, freshPlex, type FakePlex } from './plex';
+import { freshPlexTv, type FakePlexTvState } from './plextv';
 import { fakeProwlarr, type FakeProvider } from './prowlarr';
@@ -178,2 +180,4 @@ export interface FakeAppState {
   seerr: FakeSeerr;
+  /** What Plex holds (fakePlex). */
+  plex: FakePlex;
 }
@@ -226,2 +230,3 @@ export function freshAppState(): FakeAppState {
     seerr: freshSeerr(),
+    plex: freshPlex(),
   };
@@ -354,11 +359,14 @@ function fakeServarrDownloads(
  * (fakeJellyfin); Seerr its sign-in through Jellyfin, its settings and its tests of the
- * arrs (fakeSeerr). Any key is taken, but qBittorrent takes only a Bearer token (X-Api-Key
- * gets a 403): its `key` when that is set; Jellyfin only one of its own, in its
- * MediaBrowser header; and Seerr its `key`, once it has a user. `seams` send every app's
- * calls there. `mkdir` is what the wire step's folder helper does to them: pass it what a
- * fake runtime's `run` is given.
+ * arrs (fakeSeerr); Plex its identity and its libraries, once claimed (fakePlex). Any key
+ * is taken, but qBittorrent takes only a Bearer token (X-Api-Key gets a 403): its `key`
+ * when that is set; Jellyfin only one of its own, in its MediaBrowser header; Seerr its
+ * `key`, once it has a user; and Plex only a token of the plex.tv account that claimed it,
+ * as `plexTv` knows them. `seams` send every app's calls there. `mkdir` is what the wire
+ * step's folder helper does to them: pass it what a fake runtime's `run` is given.
  */
-export async function fakeStackApis(): Promise<{
+export async function fakeStackApis(plexTv: FakePlexTvState = freshPlexTv()): Promise<{
   app: FakeApp;
   apps: Map<string, FakeAppState>;
+  /** The plex.tv the fake apps ask: Plex's tokens, and its claims. */
+  plexTv: FakePlexTvState;
   seams: WiringSeams;
@@ -391,2 +399,3 @@ export async function fakeStackApis(): Promise<{
     if (service === 'seerr') return fakeSeerr(request, state, (other) => apps.get(other));
+    if (service === 'plex') return fakePlex(request, state.plex, plexTv);
     const keyed =
@@ -428,2 +437,3 @@ export async function fakeStackApis(): Promise<{
     apps,
+    plexTv,
     seams: {
@@ -435,2 +445,3 @@ export async function fakeStackApis(): Promise<{
       'jellyfin',
+      'plex',
       'prowlarr',
```

**Change** `scripts/docs/catalog-facts.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.ts b/scripts/docs/catalog-facts.ts
index f7bae86..19f62bf 100644
--- a/scripts/docs/catalog-facts.ts
+++ b/scripts/docs/catalog-facts.ts
@@ -86,3 +86,5 @@ function api(def: AppDefinition): string {
         ? "in Jellyfin's `Authorization: MediaBrowser` header"
-        : 'in the `X-Api-Key` header';
+        : key.scheme === 'x-plex-token'
+          ? "in Plex's `X-Plex-Token` header"
+          : 'in the `X-Api-Key` header';
   // An app not wired yet with Plex (`notWiredYet`) has no API there, until its slice.
```

- [ ] **Step 4: Run them to see them pass, and regenerate the facts**

```bash
pnpm vitest run catalog/catalog.test.ts catalog/jellyfin/integration.test.ts catalog/plex/bootstrap.test.ts catalog/seerr/bootstrap.test.ts catalog/seerr/integration.test.ts packages/cli/src/run.test.ts packages/engine/src/apply/apply.test.ts packages/engine/src/http/client.test.ts packages/engine/src/integrations/wire.test.ts packages/engine/src/plextv/client.test.ts packages/engine/src/runtime/docker.test.ts packages/engine/src/secrets/values.test.ts scripts/docs/catalog-facts.test.ts
pnpm docs:generate
```

Expected: PASS. `docs:generate` rewrites Plex's facts in `catalog/plex/README.md` (its
API) and `plex.token`'s description in `docs/reference/stack-yaml.md` and
`docs/reference/stack.schema.json`.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages catalog scripts docs/reference
git commit -m "feat: Plex claimed for your account before it is published, its claim token fetched as it first starts and passed as PLEX_CLAIM" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1830 tests pass in 87 files.

---

### Task 4: Plex's name and libraries, and the arrs' connections to it

Decision: `plex.server`, `Mediaplane` or `apps.plex.server_name` (decision 13).
Decision: remote access and the networks allowed without auth are never set (decision
14).
Decision: `Movies` and `TV Shows`, with Plex's own agents and scanners, after Plex has
started (decision 15).
Decision: one connection spec for Jellyfin and Plex, your token, the library it needs,
and the stack's address only (decision 16).
Decision: a new mark of `plan`'s: the arr among Plex's devices (decision 12).
Decision: before its setup is done, a Plex of yours must let no network in without a
sign-in (decision 14).

**Files:**
- Create: `catalog/plex/integration.ts`
- Modify: `catalog/plex/app.ts`, `catalog/plex/bootstrap.ts`,
  `catalog/_shared/servarr-connection.ts`,
  `catalog/sonarr/integration.ts`, `catalog/radarr/integration.ts`,
  `packages/engine/src/catalog/types.ts`, `packages/engine/src/integrations/wiring.ts`,
  `packages/engine/src/testing/plex.ts`, `packages/engine/src/testing/jellyfin.ts`,
  `packages/engine/src/testing/providers.ts`, `packages/engine/src/testing/wiring.ts`;
  generated: `catalog/plex/README.md`, `catalog/sonarr/README.md`,
  `catalog/radarr/README.md`, `docs/reference/stack-yaml.md`,
  `docs/reference/stack.schema.json`
- Test: `catalog/plex/integration.test.ts` (new), `catalog/plex/bootstrap.test.ts`,
  `catalog/_shared/servarr-connection.test.ts`, `catalog/catalog.test.ts`,
  `packages/engine/src/integrations/wiring.test.ts`, `packages/cli/src/run.test.ts`,
  `scripts/docs/catalog-facts.test.ts`

**Interfaces:**
- **Consumes:** Task 3's fake Plex, `claimFakePlex` and Plex's `api`; S5's
  `servarrProvider` and connection code.
- **Produces:**
  - `ApiSpec.started?: { path: string; done: (answer: unknown) => boolean }`, which
    `checkApp` waits for;
  - Plex's integration: `plex.server` (`name`), `plex.library_movies` and
    `plex.library_tv` (`name`, `type`, `location`); `SERVER_NAME` (`'Mediaplane'`),
    `LIBRARIES`; the option `apps.plex.server_name`;
  - `servarrJellyfin(triggers)`, `servarrPlex(triggers, library)`,
    `JELLYFIN_CONNECTION_NAME`, `PLEX_CONNECTION_NAME` (`'Plex (Mediaplane)'`); Sonarr's
    and Radarr's `connection_plex`, after `plex`; their `LIBRARY_TRIGGERS`;
  - from `@mediaplane/engine/testing`: the fake Plex's preferences and sections,
    `startingFor`, and `testPlexConnection(sent, token, state, plex, plexTv)`; the fake
    arrs' `PlexServer` connection.

- [ ] **Step 1: Write the failing tests**

**Change** `catalog/_shared/servarr-connection.test.ts`:

```diff
diff --git a/catalog/_shared/servarr-connection.test.ts b/catalog/_shared/servarr-connection.test.ts
index a2ddf34..d9299f8 100644
--- a/catalog/_shared/servarr-connection.test.ts
+++ b/catalog/_shared/servarr-connection.test.ts
@@ -10,3 +10,6 @@ import {
 import {
+  claimFakePlex,
+  FAKE_PLEX_ACCOUNT,
   fakeContainer,
+  fakePlexTv,
   fakeRuntime,
@@ -20,5 +23,10 @@ import { describe, expect, it } from 'vitest';
 import { catalog } from '../index';
-import { JELLYFIN_TRIGGERS as RADARR_TRIGGERS } from '../radarr/integration';
-import { JELLYFIN_TRIGGERS } from '../sonarr/integration';
-import { JELLYFIN_CONNECTION_NAME, servarrJellyfin } from './servarr-connection';
+import { LIBRARY_TRIGGERS as RADARR_TRIGGERS } from '../radarr/integration';
+import { LIBRARY_TRIGGERS } from '../sonarr/integration';
+import {
+  JELLYFIN_CONNECTION_NAME,
+  PLEX_CONNECTION_NAME,
+  servarrJellyfin,
+  servarrPlex,
+} from './servarr-connection';
 
@@ -56,3 +64,3 @@ function contextOf(
 
-const connection = servarrJellyfin(JELLYFIN_TRIGGERS);
+const connection = servarrJellyfin(LIBRARY_TRIGGERS);
 
@@ -187,3 +195,3 @@ describe("an arr's connection to Jellyfin", () => {
     const { api, state } = await sonarr();
-    const odd = servarrJellyfin([...JELLYFIN_TRIGGERS, 'onFictional']);
+    const odd = servarrJellyfin([...LIBRARY_TRIGGERS, 'onFictional']);
     const failure = await odd.create(api, wanted()).catch((cause: unknown) => cause);
@@ -319,2 +327,140 @@ describe("an arr's connection to Jellyfin", () => {
 
+describe("an arr's connection to Jellyfin, at another address", () => {
+  it("reads a URL base or TLS as another host, and the update puts the stack's address back", async () => {
+    const { api, state } = await sonarr();
+    const desired = wanted();
+    await connection.create(api, desired);
+    const [made] = state.connections;
+    if (made === undefined) throw new Error('no connection made');
+    // `@<host>` in the URL base takes the arr, and Jellyfin's key, to another host.
+    made.fields = made.fields.map((f) =>
+      f.name === 'urlBase' ? { ...f, value: '@198.51.100.7' } : f,
+    );
+    const held = await connection.observe(api, undefined);
+    expect(held?.fields.host).toBe('http://jellyfin:8096@198.51.100.7');
+    if (held === undefined) throw new Error('the connection is there');
+    await connection.update(api, desired, held);
+    expect(await connection.observe(api, undefined)).toMatchObject({
+      fields: { host: 'jellyfin', port: 8096 },
+    });
+    expect(state.connections[0]?.fields).toContainEqual({ name: 'urlBase', value: '' });
+    expect(state.connections[0]?.fields).toContainEqual({ name: 'useSsl', value: false });
+  });
+});
+
+describe("an arr's connection to Plex", () => {
+  const plexConnection = servarrPlex(LIBRARY_TRIGGERS, 'plex.library_tv');
+  const TOKEN = FAKE_PLEX_ACCOUNT.token;
+
+  /** Sonarr and a Plex your account claimed, with a TV library, as fakeStackApis fakes them. */
+  async function sonarrWithPlex() {
+    const plexTv = await fakePlexTv();
+    const apis = await fakeStackApis(plexTv.state);
+    const state = freshAppState();
+    apis.apps.set('sonarr', state);
+    const plex = freshAppState();
+    claimFakePlex(plex.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
+    plex.plex.sections.push({
+      key: '2',
+      title: 'TV Shows',
+      type: 'show',
+      agent: 'tv.plex.agents.series',
+      scanner: 'Plex TV Series',
+      language: 'en-US',
+      locations: ['/data/media/tv'],
+    });
+    apis.apps.set('plex', plex);
+    return { api: clientOf(apis), apis, state, plex };
+  }
+
+  const plexWanted = (keys: WiringContext['keys'] = { plex: { token: TOKEN } }) => {
+    const desired = plexConnection.desired(contextOf(stack('plex'), keys));
+    if (desired === undefined) throw new Error('the connection is wanted');
+    return desired;
+  };
+
+  it('reaches Plex by its service and container port, updates its library, and holds your token', () => {
+    expect(plexConnection).toMatchObject({
+      name: 'connection_plex',
+      fields: ['host', 'port', 'updateLibrary'],
+      secrets: ['authToken'],
+      requires: ['plex.server', 'plex.library_tv'],
+    });
+    expect(plexWanted()).toEqual({
+      name: PLEX_CONNECTION_NAME,
+      fields: { host: 'plex', port: 32400, updateLibrary: true },
+      secrets: { authToken: TOKEN },
+    });
+    expect(plexConnection.desired(contextOf(stack('jellyfin')))).toBeUndefined();
+    expect(connection.desired(contextOf(stack('plex')))).toBeUndefined();
+  });
+
+  it("is made from the arr's template with its triggers on, tested with your token as it is saved", async () => {
+    const { api, state } = await sonarrWithPlex();
+    await expect(
+      plexConnection.create(api, plexWanted({ plex: { token: 'revoked-plex-token-0' } })),
+    ).rejects.toThrow(
+      'refused the request (HTTP 400): AuthToken: Authentication Token is invalid',
+    );
+    expect(await plexConnection.create(api, plexWanted())).toEqual({ id: 1 });
+    expect(state.connections[0]).toMatchObject({
+      name: PLEX_CONNECTION_NAME,
+      implementation: 'PlexServer',
+      onDownload: true,
+      onRename: true,
+      onSeriesDelete: true,
+      onGrab: false,
+    });
+    expect(state.connections[0]?.fields).toContainEqual({
+      name: 'authToken',
+      value: TOKEN,
+    });
+    expect(await plexConnection.observe(api, undefined)).toEqual({
+      id: 1,
+      name: PLEX_CONNECTION_NAME,
+      fields: { host: 'plex', port: 32400, updateLibrary: true },
+    });
+  });
+
+  it("checks your token with the arr's own test, never compared: a refused one is an update", async () => {
+    const { api, state } = await sonarrWithPlex();
+    const desired = plexWanted();
+    await plexConnection.create(api, desired);
+    const held = await plexConnection.observe(api, undefined);
+    if (held === undefined) throw new Error('the connection is there');
+    expect(await plexConnection.verify?.(api, desired, held)).toBe(true);
+    const [made] = state.connections;
+    if (made === undefined) throw new Error('no connection made');
+    made.fields = made.fields.map((f) =>
+      f.name === 'authToken' ? { ...f, value: 'someone-elses-token' } : f,
+    );
+    expect(await plexConnection.verify?.(api, desired, held)).toBe(false);
+    await plexConnection.update(api, desired, held);
+    expect(state.connections[0]?.fields).toContainEqual({
+      name: 'authToken',
+      value: TOKEN,
+    });
+  });
+
+  it('is refused by the arr while Plex has no library of what the arr files', async () => {
+    const { api, plex } = await sonarrWithPlex();
+    plex.plex.sections = [];
+    await expect(plexConnection.create(api, plexWanted())).rejects.toThrow(
+      'refused the request (HTTP 400): Host: At least one TV library is required',
+    );
+  });
+
+  it("says the arr's own words when it can't reach Plex", async () => {
+    const { api, plex } = await sonarrWithPlex();
+    const desired = plexWanted();
+    await plexConnection.create(api, desired);
+    const held = await plexConnection.observe(api, undefined);
+    if (held === undefined) throw new Error('the connection is there');
+    plex.up = false;
+    await expect(plexConnection.verify?.(api, desired, held)).rejects.toThrow(
+      'Sonarr at http://sonarr:8989 (127.0.0.1) tested Plex (Mediaplane), and it failed: Host: Unable to connect to Plex Media Server (Resource temporarily unavailable (plex:32400)) (POST /api/v3/notification/test)',
+    );
+  });
+});
+
 describe("Radarr's connection to Jellyfin", () => {
```

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index 38b3605..65abf5f 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -156,3 +156,11 @@ apps:
       catalog.filter((app) => app.integration !== undefined).map((app) => app.id),
-    ).toEqual(['jellyfin', 'prowlarr', 'qbittorrent', 'radarr', 'seerr', 'sonarr']);
+    ).toEqual([
+      'jellyfin',
+      'plex',
+      'prowlarr',
+      'qbittorrent',
+      'radarr',
+      'seerr',
+      'sonarr',
+    ]);
   });
```

**Change** `catalog/plex/bootstrap.test.ts`:

```diff
diff --git a/catalog/plex/bootstrap.test.ts b/catalog/plex/bootstrap.test.ts
index c85e35e..c512c8e 100644
--- a/catalog/plex/bootstrap.test.ts
+++ b/catalog/plex/bootstrap.test.ts
@@ -168,2 +168,17 @@ describe("Plex's first-run setup", () => {
 
+  it('keeps a Plex of yours unpublished that lets a network in without a sign-in, naming the setting and what to do', async () => {
+    const { api, state, plexTv, ctx, stack } = await plexOf();
+    claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
+    // Set while it was unclaimed, by whoever reached it: it survives the claim (probed).
+    state.plex.allowedNetworks = '192.0.2.0/255.255.255.0';
+    const failed = await thrown(plexBootstrap.run(api, ADMIN, stack, ctx));
+    expect(failed).toMatchObject({
+      kind: 'rejected',
+      message: `Plex at http://plex:32400 (127.0.0.1) is yours, but lets 192.0.2.0/255.255.255.0 in without a sign-in (allowedNetworks), which Mediaplane never sets: it may have been set while Plex was unclaimed, so Plex stays unpublished. Stop it, clear allowedNetworks in appdata/plex/${PLEX_PREFERENCES}, then run apply again`,
+    });
+    // Cleared, it is taken.
+    state.plex.allowedNetworks = '';
+    expect(await plexBootstrap.run(api, ADMIN, stack, ctx)).toBeUndefined();
+  });
+
   it("keeps a Plex that didn't claim itself unpublished, saying why", async () => {
@@ -366,3 +381,4 @@ describe("Plex's setup, as apply's bootstrap step runs it", () => {
     expect(identity.filter((r) => r.headers['x-plex-token'] !== undefined)).toEqual([]);
-    // Plex never got your token: nothing else was asked of it.
+    // Plex got your token only once plex.tv said it is yours: to check that it lets no
+    // network in without a sign-in.
     expect(
@@ -372,3 +388,3 @@ describe("Plex's setup, as apply's bootstrap step runs it", () => {
         .map((r) => r.path),
-    ).toEqual([]);
+    ).toEqual(['/:/prefs']);
     expect(first.pending).toEqual([{ app: 'plex', unpublished: true }]);
```

**Create** `catalog/plex/integration.test.ts`:

```ts
import { createAppApi, type ResourceSpec, type WiringContext } from '@mediaplane/engine';
import {
  claimFakePlex,
  FAKE_PLEX_ACCOUNT,
  fakePlexTv,
  fakeStackApis,
  freshAppState,
  thrown,
  wiringStack,
  type FakeRequest,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { catalog } from '../index';
import integration, { LIBRARIES, SERVER_NAME } from './integration';

const TOKEN = FAKE_PLEX_ACCOUNT.token;

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: plex
plex: { token: { file: secrets/plex-token } }
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;

/** One of Plex's resources, by name. */
function resource(name: string): ResourceSpec {
  const found = integration.resources.find((r) => r.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
}

function contextOf(source = STACK): WiringContext {
  const stack = wiringStack(catalog, source);
  const app = stack.apps.find((a) => a.def.id === 'plex');
  if (app === undefined) throw new Error('no Plex in the stack');
  return {
    stack,
    app,
    admin: { username: 'admin', password: 'fake-admin-password' },
    keys: { plex: { token: TOKEN } },
  };
}

function wanted(name: string, ctx = contextOf()) {
  const desired = resource(name).desired(ctx);
  if (desired === undefined) throw new Error(`${name} is wanted`);
  return desired;
}

/** A Plex your account claimed, faked as fakeStackApis fakes it, and a client with your token. */
async function plexOf() {
  const plexTv = await fakePlexTv();
  const apis = await fakeStackApis(plexTv.state);
  const state = freshAppState();
  claimFakePlex(state.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
  apis.apps.set('plex', state);
  const api = createAppApi({
    name: 'Plex',
    service: 'plex',
    port: 32400,
    endpoint: { host: '127.0.0.1', port: apis.app.port },
    key: { scheme: 'x-plex-token', value: TOKEN },
    secrets: [TOKEN],
    retry: { deadlineMs: 0 },
  });
  const calls = () =>
    apis.app.requests.map(({ method, path }: FakeRequest) => `${method} ${path}`);
  return { api, plex: state.plex, calls };
}

describe("Plex's name", () => {
  it('is Mediaplane, or the name apps.plex.server_name gives', () => {
    expect(wanted('server')).toEqual({
      name: 'server',
      fields: { name: SERVER_NAME },
      secrets: {},
    });
    expect(SERVER_NAME).toBe('Mediaplane');
    const named = contextOf(`${STACK}  plex: { server_name: Living room }\n`);
    expect(wanted('server', named).fields).toEqual({ name: 'Living room' });
  });

  it("is set where Plex has none, and Plex's name for itself is then the one it shows", async () => {
    const { api, plex } = await plexOf();
    const spec = resource('server');
    // A new Plex has no name of its own: it shows its container's hostname.
    expect(await spec.observe(api, undefined)).toEqual({
      id: null,
      name: 'server',
      fields: { name: '' },
    });
    expect(plex.friendlyName).toBe('');
    await spec.create(api, wanted('server'));
    expect(plex.friendlyName).toBe('Mediaplane');
    plex.friendlyName = 'Renamed by hand';
    const held = await spec.observe(api, undefined);
    if (held === undefined) throw new Error('Plex has a name');
    await spec.update(api, wanted('server'), held);
    expect(plex.friendlyName).toBe('Mediaplane');
  });

  it('never turns on remote access, nor adds a network allowed in without signing in', async () => {
    const { api, plex, calls } = await plexOf();
    const spec = resource('server');
    await spec.create(api, wanted('server'));
    expect(plex.remoteAccess).toBe(false);
    expect(plex.allowedNetworks).toBe('');
    expect(calls().filter((c) => c.startsWith('PUT'))).toEqual([
      'PUT /:/prefs?FriendlyName=Mediaplane',
    ]);
  });
});

describe("Plex's API", () => {
  it('says Plex has started only once /identity has no startState', () => {
    const plex = catalog.find((app) => app.id === 'plex');
    const done = plex?.api?.started?.done;
    expect(plex?.api?.started?.path).toBe('/identity');
    expect(
      done?.({ MediaContainer: { claimed: true, startState: 'startingPlugins' } }),
    ).toBe(false);
    expect(done?.({ MediaContainer: { claimed: true } })).toBe(true);
    expect(done?.('not an identity')).toBe(false);
  });

  it('refuses a new library while it starts, which the fake says, as Plex does', async () => {
    const { api, plex } = await plexOf();
    plex.startingFor = 1;
    expect(
      await thrown(resource('library_movies').create(api, wanted('library_movies'))),
    ).toMatchObject({ kind: 'rejected', status: 400 });
  });
});

describe("Plex's libraries", () => {
  it('are Movies and TV Shows, on the folders the arrs fill, made first', () => {
    expect(LIBRARIES.map((l) => [l.resource, l.name])).toEqual([
      ['library_movies', 'Movies'],
      ['library_tv', 'TV Shows'],
    ]);
    expect(wanted('library_movies')).toEqual({
      name: 'Movies',
      fields: { name: 'Movies', type: 'movie', location: '/data/media/movies' },
      secrets: {},
      folders: ['/data/media/movies'],
    });
    expect(wanted('library_tv').fields).toEqual({
      name: 'TV Shows',
      type: 'show',
      location: '/data/media/tv',
    });
  });

  it("are made with Plex's agent and scanner for what they hold, and found again by their key", async () => {
    const { api, plex } = await plexOf();
    const movies = resource('library_movies');
    const tv = resource('library_tv');
    expect(await movies.observe(api, undefined)).toBeUndefined();
    expect(await movies.create(api, wanted('library_movies'))).toEqual({ id: '1' });
    expect(await tv.create(api, wanted('library_tv'))).toEqual({ id: '2' });
    expect(plex.sections).toEqual([
      {
        key: '1',
        title: 'Movies',
        type: 'movie',
        agent: 'tv.plex.agents.movie',
        scanner: 'Plex Movie',
        language: 'en-US',
        locations: ['/data/media/movies'],
      },
      {
        key: '2',
        title: 'TV Shows',
        type: 'show',
        agent: 'tv.plex.agents.series',
        scanner: 'Plex TV Series',
        language: 'en-US',
        locations: ['/data/media/tv'],
      },
    ]);
    // Renamed by hand, it is still found by the key resources.json recorded.
    const [made] = plex.sections;
    if (made === undefined) throw new Error('no library made');
    made.title = 'Films';
    const known = {
      id: '1',
      name: 'Movies',
      fields: {},
      secrets: [],
      appliedAt: '2026-10-16T12:00:00.000Z',
    };
    expect(await movies.observe(api, known)).toEqual({
      id: '1',
      name: 'Films',
      fields: { name: 'Films', type: 'movie', location: '/data/media/movies' },
    });
    // Without the record, a library of its name: none now.
    expect(await movies.observe(api, undefined)).toBeUndefined();
  });

  it('puts back its name and folder, keeping the agent you chose', async () => {
    const { api, plex } = await plexOf();
    const movies = resource('library_movies');
    await movies.create(api, wanted('library_movies'));
    const [made] = plex.sections;
    if (made === undefined) throw new Error('no library made');
    made.agent = 'tv.plex.agents.none';
    made.locations = ['/data/media/movies/', '/data/elsewhere'];
    const held = await movies.observe(api, undefined);
    expect(held?.fields.location).toBe('/data/elsewhere,/data/media/movies');
    if (held === undefined) throw new Error('the library is there');
    await movies.update(api, wanted('library_movies'), held);
    expect(plex.sections[0]).toMatchObject({
      title: 'Movies',
      agent: 'tv.plex.agents.none',
      locations: ['/data/media/movies'],
    });
  });

  it("refuses to change what a library holds, which Plex can't, saying what to do", async () => {
    const { api, plex } = await plexOf();
    const tv = resource('library_tv');
    plex.sections.push({
      key: '7',
      title: 'TV Shows',
      type: 'movie',
      agent: 'tv.plex.agents.movie',
      scanner: 'Plex Movie',
      language: 'en-US',
      locations: ['/data/media/tv'],
    });
    const held = await tv.observe(api, undefined);
    if (held === undefined) throw new Error('the library is there');
    expect(await thrown(tv.update(api, wanted('library_tv'), held))).toMatchObject({
      kind: 'rejected',
      message:
        "Plex at http://plex:32400 (127.0.0.1) has a library named TV Shows that holds movie, not show, and Plex can't change what a library holds: rename or remove it in Plex, and the next apply makes TV Shows (GET /library/sections)",
    });
    plex.sections = [];
    expect(
      await thrown(
        tv.update(api, wanted('library_tv'), {
          ...held,
          fields: { ...held.fields, type: 'show' },
        }),
      ),
    ).toMatchObject({
      message:
        'Plex at http://plex:32400 (127.0.0.1) no longer has the library TV Shows (GET /library/sections)',
    });
  });
});
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index c6aa73b..2490147 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -15,2 +15,3 @@ import {
   renderEnvFile,
+  RESOURCES_PATH,
   secretValues,
@@ -1477,2 +1478,26 @@ apps:
     expect((await readSecretStore(home)).setUp).toEqual(['plex']);
+    // Then wired: its name, its libraries, and Sonarr's connection to it with your token.
+    for (const line of [
+      'plex.server: updated name',
+      'plex.library_movies: created',
+      'plex.library_tv: created',
+      'sonarr.connection_plex: created',
+    ]) {
+      expect(first.stdout()).toContain(`  done    wiring ${line}\n`);
+    }
+    expect(plex.friendlyName).toBe('Mediaplane');
+    expect(plex.sections.map((s) => [s.title, s.locations])).toEqual([
+      ['Movies', ['/data/media/movies']],
+      ['TV Shows', ['/data/media/tv']],
+    ]);
+    const connection = apis.apps.get('sonarr')?.connections[0];
+    expect(connection).toMatchObject({
+      name: 'Plex (Mediaplane)',
+      implementation: 'PlexServer',
+    });
+    expect(connection?.fields).toContainEqual({
+      name: 'authToken',
+      value: FAKE_PLEX_ACCOUNT.token,
+    });
+    expectNoSecrets(await readFile(join(home, RESOURCES_PATH), 'utf8'), plexSecrets());
     // One claim token, fetched with your token, and used.
```

**Change** `packages/engine/src/integrations/wiring.test.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.test.ts b/packages/engine/src/integrations/wiring.test.ts
index 128f9aa..31b2e4e 100644
--- a/packages/engine/src/integrations/wiring.test.ts
+++ b/packages/engine/src/integrations/wiring.test.ts
@@ -589,2 +589,60 @@ describe('planWiring', () => {
 
+  it('waits for an app that says when it has started, and checks it after it has, or says it is still starting', async () => {
+    let asked = 0;
+    const app = await fakeHttpApp((request) => {
+      if (request.path === '/ping') return { status: 200 };
+      if (request.path === '/started') {
+        asked += 1;
+        return { status: 200, body: { starting: asked < 3 } };
+      }
+      return request.path === '/api/v3/system/status'
+        ? { status: 200, body: {} }
+        : { status: 200, body: { user: 'admin' } };
+    });
+    const started = {
+      path: '/started',
+      done: (answer: unknown) =>
+        typeof answer === 'object' &&
+        answer !== null &&
+        (answer as { starting?: unknown }).starting === false,
+    };
+    const catalog: Catalog = WIRED_CATALOG.map((def) =>
+      def.id === 'sonarr' ? { ...def, api: { ...FIXTURE_API, started } } : def,
+    );
+    let clock = 0;
+    const waiting = {
+      seams: {
+        endpoint: () => ({ host: '127.0.0.1', port: app.port }),
+        retry: {
+          deadlineMs: 60_000,
+          now: () => clock,
+          sleep: (ms: number) => {
+            clock += ms;
+            return Promise.resolve();
+          },
+        },
+      },
+      addresses: { 'fake-sonarr': '127.0.0.1' },
+    };
+    const planned = await planWiring(options(waiting, { stack: stackOf(catalog) }));
+    expect(planned.diagnostics).toEqual([]);
+    expect(asked).toBe(3);
+    // Out of time while it is still starting: unknown, with why.
+    asked = -100;
+    const early = await planWiring(
+      options(
+        { ...waiting, seams: { ...waiting.seams, retry: { deadlineMs: 0 } } },
+        { stack: stackOf(catalog) },
+      ),
+    );
+    expect(early.changes).toEqual([
+      {
+        resource: 'sonarr.login',
+        action: 'unknown',
+        reason:
+          'sonarr at http://sonarr:8989 (127.0.0.1) is still starting (GET /started)',
+      },
+    ]);
+  });
+
   it('checks after the start an app whose container apply changes, or that is not ready', async () => {
```

**Change** `scripts/docs/catalog-facts.test.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.test.ts b/scripts/docs/catalog-facts.test.ts
index 2fdabce..ec9035a 100644
--- a/scripts/docs/catalog-facts.test.ts
+++ b/scripts/docs/catalog-facts.test.ts
@@ -82,3 +82,5 @@ describe('renderFacts', () => {
     );
-    expect(renderFacts(app('plex'))).toContain('- **Managed in the app:** nothing yet\n');
+    expect(renderFacts(app('byparr'))).toContain(
+      '- **Managed in the app:** nothing yet\n',
+    );
   });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog/_shared/servarr-connection.test.ts catalog/catalog.test.ts catalog/plex/bootstrap.test.ts catalog/plex/integration.test.ts packages/cli/src/run.test.ts packages/engine/src/integrations/wiring.test.ts scripts/docs/catalog-facts.test.ts`
Expected: FAIL. `servarr-connection.test.ts` doesn't load (`TypeError: servarrPlex is not a function`), nor does `catalog/plex/integration.test.ts` (`Cannot find module './integration'`), and 5 tests fail, 288 pass: `catalog.test.ts` (Plex has no integration), `catalog/plex/bootstrap.test.ts` (no `allowedNetworks` check: `expected undefined to match object { kind: 'rejected', … }`, and `expected [] to deeply equal [ '/:/prefs' ]`), `run.test.ts` (no `plex.server` wired) and `wiring.test.ts` (`started` isn't waited for: `expected +0 to be 3`).

- [ ] **Step 3: Write Plex's integration and the shared connection**

**Change** `catalog/_shared/servarr-connection.ts`:

```diff
diff --git a/catalog/_shared/servarr-connection.ts b/catalog/_shared/servarr-connection.ts
index dfbbb45..0c8f2b2 100644
--- a/catalog/_shared/servarr-connection.ts
+++ b/catalog/_shared/servarr-connection.ts
@@ -4,2 +4,3 @@ import {
   type ResourceSpec,
+  type WiringContext,
 } from '@mediaplane/engine';
@@ -11,2 +12,3 @@ import {
   textOf,
+  type Provider,
   type ProviderKind,
@@ -17,21 +19,67 @@ export const JELLYFIN_CONNECTION_NAME = 'Jellyfin (Mediaplane)';
 
-/** Sonarr's and Radarr's "Emby / Jellyfin" connections, in their "notification" API. */
-const CONNECTIONS: ProviderKind = {
-  path: '/api/v3/notification',
-  implementation: 'MediaBrowser',
-  what: 'Emby / Jellyfin connection',
-  of: 'Jellyfin',
+/** The name of the connection to Plex Mediaplane makes in Sonarr and Radarr. */
+export const PLEX_CONNECTION_NAME = 'Plex (Mediaplane)';
+
+/** One media server an arr can tell of the changes in its library, and how. */
+interface MediaServer {
+  /** The app, and the resource named after it: `connection_<app>`. */
+  app: 'jellyfin' | 'plex';
+  /** The connection's name in the arr. */
+  name: string;
+  /** Its kind, in the arr's "notification" API. */
+  kind: ProviderKind;
+  /** The setting that holds the media server's key, which the arr shows masked. */
+  keyField: 'apiKey' | 'authToken';
+  /** The media server's key, from the stack's keys: undefined before there is one. */
+  keyOf: (keys: WiringContext['keys']) => string | undefined;
+  /** The settings the key is refused on: the arr's own test names it so. */
+  credentials: readonly string[];
+  /** The media server's resources the arr's own test needs in place first. */
+  requires: readonly string[];
+}
+
+const JELLYFIN: MediaServer = {
+  app: 'jellyfin',
+  name: JELLYFIN_CONNECTION_NAME,
+  kind: {
+    path: '/api/v3/notification',
+    implementation: 'MediaBrowser',
+    what: 'Emby / Jellyfin connection',
+    of: 'Jellyfin',
+  },
+  keyField: 'apiKey',
+  // Jellyfin makes its key in its first-run setup, which plan never runs.
+  keyOf: (keys) => keys.jellyfin?.apiKey,
+  credentials: ['ApiKey'],
+  requires: ['jellyfin.admin'],
 };
 
-/** The settings the connection's key is refused on: the arr's own test names it so. */
-const CREDENTIALS = ['ApiKey'];
+const PLEX: MediaServer = {
+  app: 'plex',
+  name: PLEX_CONNECTION_NAME,
+  kind: {
+    path: '/api/v3/notification',
+    implementation: 'PlexServer',
+    what: 'Plex Media Server connection',
+    of: 'Plex',
+  },
+  keyField: 'authToken',
+  // Your Plex token, which Plex takes as its claim's account's (probed): a secret you give.
+  keyOf: (keys) => keys.plex?.token,
+  credentials: ['AuthToken'],
+  requires: ['plex.server'],
+};
 
-/** The desired settings, Jellyfin's key in clear: Jellyfin's key goes to the arr. */
-function settingsOf(desired: DesiredResource): Record<string, unknown> {
-  return {
-    host: desired.fields.host,
-    port: desired.fields.port,
-    updateLibrary: desired.fields.updateLibrary,
-    apiKey: secretOf(desired, 'apiKey'),
-  };
+/**
+ * Where the arr reaches the media server, as one host to compare: its `host`, or, with TLS
+ * or a URL base, the whole URL the arr builds from them, which is never the stack's
+ * service (a URL base of `@<host>` is another host).
+ */
+function heldHost(held: Provider): string {
+  const host = textOf(settingOf(held, 'host'));
+  const tls = settingOf(held, 'useSsl') === true;
+  const base = textOf(settingOf(held, 'urlBase'));
+  if (!tls && base === '') return host;
+  const port = String(numberOf(settingOf(held, 'port')));
+  return `${tls ? 'https' : 'http'}://${host}:${port}${base}`;
 }
@@ -39,26 +87,41 @@ function settingsOf(desired: DesiredResource): Record<string, unknown> {
 /**
- * The connection of Sonarr or Radarr to Jellyfin (spec §6.2), named
- * JELLYFIN_CONNECTION_NAME, that has Jellyfin update its library on import.
- * - Its host is Jellyfin's service on the stack's network, at its container port, and it
- *   updates the library; Jellyfin's key is its secret, which the arr shows masked.
+ * The connection of Sonarr or Radarr to the stack's media server (spec §6.2), named
+ * `server.name`, that has the media server update its library on import.
+ * - Its host is the media server's service on the stack's network, at its container port,
+ *   without TLS or a URL base, and it updates the library; the media server's key is its
+ *   secret, which the arr shows masked. With TLS or a URL base held, `host` is observed as
+ *   the URL the arr calls, so it differs, and the update puts the stack's address back:
+ *   the arr's test of what it holds sends the key it holds only to the stack's address.
  * - It is made from the arr's own template, with `triggers` on: what makes the arr tell
- *   Jellyfin, as files come, are upgraded, renamed or deleted. They stay yours after. A
- *   template without one of them is refused, as the arr would drop it unsaid.
+ *   the media server, as files come, are upgraded, renamed or deleted. They stay yours
+ *   after. A template without one of them is refused, as the arr would drop it unsaid.
  * - Its key is checked with the arr's own test of the connection it holds: a refused key
- *   (`ApiKey`) means an update, which sets it; any other failure the arr explains. The
- *   arr tests a new connection with a trigger on as it saves it, forceSave or not, so a
- *   create fails while it can't reach Jellyfin; an update is saved untested.
- * - It requires Jellyfin's admin, the first thing Mediaplane checks in Jellyfin, after its
- *   key: while Jellyfin is still to be set up, or refuses its key, `plan` leaves the
- *   connection's key unchecked, and the wire step skips it when Jellyfin's admin fails.
+ *   means an update, which sets it; any other failure the arr explains. The arr tests a
+ *   new connection with a trigger on as it saves it, forceSave or not, so a create fails
+ *   while it can't reach the media server; an update is saved untested.
+ * - It requires the media server's first resource, which Mediaplane checks after its key:
+ *   while the media server is still to be set up, or refuses its key, `plan` leaves the
+ *   connection's key unchecked, and the wire step skips it when that resource fails.
  */
-export function servarrJellyfin(triggers: readonly string[]): ResourceSpec {
+function servarrMediaServer(
+  server: MediaServer,
+  triggers: readonly string[],
+): ResourceSpec {
+  const settingsOf = (desired: DesiredResource): Record<string, unknown> => ({
+    host: desired.fields.host,
+    port: desired.fields.port,
+    useSsl: false,
+    urlBase: '',
+    updateLibrary: desired.fields.updateLibrary,
+    // The media server's key goes to the arr, in this request body only.
+    [server.keyField]: secretOf(desired, server.keyField),
+  });
   return {
-    name: 'connection_jellyfin',
+    name: `connection_${server.app}`,
     fields: ['host', 'port', 'updateLibrary'],
-    secrets: ['apiKey'],
-    requires: ['jellyfin.admin'],
+    secrets: [server.keyField],
+    requires: server.requires,
     desired: ({ stack, keys }) => {
       const at = serviceAddress(
-        stack.apps.find((app) => app.def.id === 'jellyfin'),
+        stack.apps.find((app) => app.def.id === server.app),
         'web',
@@ -66,10 +129,9 @@ export function servarrJellyfin(triggers: readonly string[]): ResourceSpec {
       if (at === undefined) return undefined;
-      // Jellyfin makes its key in its first-run setup, which plan never runs: until then
-      // the connection is still wanted, and apply has the key by the wire step.
-      const key = keys.jellyfin?.apiKey;
-      const secrets: Record<string, string> = key === undefined ? {} : { apiKey: key };
+      // Until there is a key, the connection is still wanted: apply has it by the wire
+      // step.
+      const key = server.keyOf(keys);
       return {
-        name: JELLYFIN_CONNECTION_NAME,
+        name: server.name,
         fields: { host: at.host, port: at.port, updateLibrary: true },
-        secrets,
+        secrets: key === undefined ? {} : { [server.keyField]: key },
       };
@@ -77,7 +139,7 @@ export function servarrJellyfin(triggers: readonly string[]): ResourceSpec {
     ...servarrProvider({
-      kind: CONNECTIONS,
-      name: JELLYFIN_CONNECTION_NAME,
-      credentials: CREDENTIALS,
+      kind: server.kind,
+      name: server.name,
+      credentials: server.credentials,
       fieldsOf: (held) => ({
-        host: textOf(settingOf(held, 'host')),
+        host: heldHost(held),
         port: numberOf(settingOf(held, 'port')),
@@ -91 +153,15 @@ export function servarrJellyfin(triggers: readonly string[]): ResourceSpec {
 }
+
+/** The connection of Sonarr or Radarr to Jellyfin, an Emby / Jellyfin one (`MediaBrowser`). */
+export function servarrJellyfin(triggers: readonly string[]): ResourceSpec {
+  return servarrMediaServer(JELLYFIN, triggers);
+}
+
+/**
+ * The connection of Sonarr or Radarr to Plex, a Plex Media Server one (`PlexServer`). The
+ * arr's own test needs a Plex library of what it files (probed: "At least one TV library
+ * is required"), so it requires that one too: `library`.
+ */
+export function servarrPlex(triggers: readonly string[], library: string): ResourceSpec {
+  return servarrMediaServer({ ...PLEX, requires: [...PLEX.requires, library] }, triggers);
+}
```

**Change** `catalog/plex/app.ts`:

```diff
diff --git a/catalog/plex/app.ts b/catalog/plex/app.ts
index b585040..d9edd46 100644
--- a/catalog/plex/app.ts
+++ b/catalog/plex/app.ts
@@ -1,3 +1,19 @@
 import { defineApp } from '@mediaplane/engine';
+import { z } from 'zod';
 import { plexBootstrap } from './bootstrap';
+import integration from './integration';
+
+/**
+ * Whether Plex has started: /identity answers as soon as Plex listens, with a `startState`
+ * while it still starts its plugins, and Plex refuses a new library until it has none
+ * ("the server is still starting up", probed).
+ */
+function started(answer: unknown): boolean {
+  const parsed = z
+    .looseObject({
+      MediaContainer: z.looseObject({ startState: z.unknown().optional() }),
+    })
+    .safeParse(answer);
+  return parsed.success && parsed.data.MediaContainer.startState === undefined;
+}
 
@@ -31,4 +47,16 @@ export default defineApp({
     check: '/library/sections',
+    started: { path: '/identity', done: started },
   },
   bootstrap: plexBootstrap,
+  integration,
+  options: z.strictObject({
+    server_name: z
+      .string()
+      .min(1)
+      .max(64)
+      .optional()
+      .describe(
+        'The name Plex shows for this server, in its apps and your plex.tv account. Default Mediaplane.',
+      ),
+  }),
   env: () => ({ VERSION: 'docker' }),
```

**Change** `catalog/plex/bootstrap.ts`:

```diff
diff --git a/catalog/plex/bootstrap.ts b/catalog/plex/bootstrap.ts
index d5a494c..aac7b18 100644
--- a/catalog/plex/bootstrap.ts
+++ b/catalog/plex/bootstrap.ts
@@ -19,2 +19,8 @@ const SERVER_TOKEN = /\sPlexOnlineToken="([^"]+)"/;
 
+const prefs = z.looseObject({
+  MediaContainer: z.looseObject({
+    Setting: z.array(z.looseObject({ id: z.string(), value: z.unknown() })),
+  }),
+});
+
 const identity = z.looseObject({
@@ -108,2 +114,4 @@ async function accountOf(
  *   5xx, no connection) is `unsure`, as is a claimed Plex whose file holds no token.
+ * - Before it is done, a Plex of yours must let no network in without a sign-in
+ *   (`allowedNetworks` empty): anyone could set that while it was unclaimed.
  * - It is done once Preferences.xml holds a token (`PlexOnlineToken`), and Mediaplane's
@@ -175,2 +183,15 @@ export const plexBootstrap: Bootstrap = {
     }
+    // Yours, so it may have your token now. While it was unclaimed, anyone who reached it
+    // could change its settings, and they survive the claim (probed): a network let in
+    // without a sign-in would be open once it is published. Asked here only, so one you
+    // set later, on purpose, is left alone.
+    const allowed = (await api.get('/:/prefs', prefs)).MediaContainer.Setting.find(
+      (s) => s.id === 'allowedNetworks',
+    )?.value;
+    if (allowed !== '') {
+      throw new AppApiError(
+        `${api.name} at ${api.where} is yours, but lets ${typeof allowed === 'string' ? allowed : 'networks it does not name'} in without a sign-in (allowedNetworks), which Mediaplane never sets: it may have been set while Plex was unclaimed, so Plex stays unpublished. Stop it, clear allowedNetworks in appdata/plex/${PREFERENCES}, then run apply again`,
+        { kind: 'rejected' },
+      );
+    }
     return undefined;
```

**Create** `catalog/plex/integration.ts`:

```ts
import {
  AppApiError,
  defineIntegration,
  type AppApi,
  type ResourceSpec,
} from '@mediaplane/engine';
import { z } from 'zod';

/** The name Plex shows for itself, unless `apps.plex.server_name` names another. */
export const SERVER_NAME = 'Mediaplane';

const prefs = z.looseObject({
  MediaContainer: z.looseObject({
    Setting: z.array(z.looseObject({ id: z.string(), value: z.unknown() })),
  }),
});

/**
 * Plex's name for itself (spec §6.2): `FriendlyName`, which Plex shows in its apps and in
 * your plex.tv account. A new Plex has none, so it shows its container's hostname, which
 * Docker makes random (probed). Mediaplane names it, so it can't be taken for another Plex
 * of yours: "Mediaplane", or `apps.plex.server_name`. It is set with your token, through
 * `PUT /:/prefs`, which needs no restart.
 */
const server: ResourceSpec = {
  name: 'server',
  fields: ['name'],
  secrets: [],
  desired: ({ app }) => {
    const named = app.context.options.server_name;
    return {
      name: 'server',
      fields: { name: typeof named === 'string' ? named : SERVER_NAME },
      secrets: {},
    };
  },
  async observe(api) {
    const { Setting } = (await api.get('/:/prefs', prefs)).MediaContainer;
    const name = Setting.find((s) => s.id === 'FriendlyName')?.value;
    return {
      id: null,
      name: 'server',
      fields: { name: typeof name === 'string' ? name : '' },
    };
  },
  async create(api, desired) {
    await setName(api, String(desired.fields.name));
    return { id: null };
  },
  update: (api, desired) => setName(api, String(desired.fields.name)),
};

async function setName(api: AppApi, name: string): Promise<void> {
  const query = new URLSearchParams({ FriendlyName: name });
  await api.put(`/:/prefs?${query.toString()}`, {});
}

/**
 * The libraries Mediaplane makes in Plex (spec §6.2): Movies and TV Shows, on the folders
 * under /data/media that Radarr and Sonarr fill, with the agent and scanner Plex's web UI
 * gives a new one (probed on the pinned image).
 */
export const LIBRARIES = [
  {
    resource: 'library_movies',
    name: 'Movies',
    type: 'movie',
    agent: 'tv.plex.agents.movie',
    scanner: 'Plex Movie',
    path: '/data/media/movies',
  },
  {
    resource: 'library_tv',
    name: 'TV Shows',
    type: 'show',
    agent: 'tv.plex.agents.series',
    scanner: 'Plex TV Series',
    path: '/data/media/tv',
  },
] as const;

/** The language a new library's metadata comes in; yours to change in Plex after. */
const LANGUAGE = 'en-US';

const SECTIONS = '/library/sections';

const section = z.looseObject({
  key: z.string(),
  title: z.string(),
  type: z.string(),
  agent: z.string(),
  Location: z.array(z.looseObject({ path: z.string() })).optional(),
});

const sections = z.looseObject({
  MediaContainer: z.looseObject({ Directory: z.array(section).optional() }),
});

const made = z.looseObject({
  MediaContainer: z.looseObject({ Directory: z.array(section).min(1) }),
});

/** Plex's libraries, as it lists them: none is no Directory at all. */
async function sectionsOf(api: AppApi): Promise<z.infer<typeof section>[]> {
  return (await api.get(SECTIONS, sections)).MediaContainer.Directory ?? [];
}

/** A library's folders as one sorted list, each once and without a trailing "/". */
function locationsOf(held: z.infer<typeof section>): string {
  const trimmed = (held.Location ?? []).map(({ path }) =>
    path.length > 1 ? path.replace(/\/+$/, '') : path,
  );
  return [...new Set(trimmed)].sort().join(',');
}

/**
 * One of Plex's libraries (spec §6.2), known by Plex's key for it (`resources.json`),
 * else by its name. Plex takes a second library of one name, so one is made only when
 * none has the name. Its managed fields are its name, what it holds and its folder, which
 * the wire step makes first, though Plex takes one that doesn't exist (probed). An update
 * sends the library back with the agent it has, which Plex needs (400 without), so it
 * stays yours; Plex can't change what a library holds (400), which the update refuses with
 * what to do.
 */
function libraryResource(spec: (typeof LIBRARIES)[number]): ResourceSpec {
  return {
    name: spec.resource,
    fields: ['name', 'type', 'location'],
    secrets: [],
    desired: () => ({
      name: spec.name,
      fields: { name: spec.name, type: spec.type, location: spec.path },
      secrets: {},
      folders: [spec.path],
    }),
    async observe(api, known) {
      const held = await sectionsOf(api);
      const found =
        held.find((s) => known !== undefined && s.key === known.id) ??
        held.find((s) => s.title === spec.name);
      return found === undefined
        ? undefined
        : {
            id: found.key,
            name: found.title,
            fields: { name: found.title, type: found.type, location: locationsOf(found) },
          };
    },
    async create(api) {
      const query = new URLSearchParams({
        name: spec.name,
        type: spec.type,
        agent: spec.agent,
        scanner: spec.scanner,
        language: LANGUAGE,
        location: spec.path,
      });
      const answer = await api.post(`${SECTIONS}?${query.toString()}`, {}, made);
      const [first] = answer.MediaContainer.Directory;
      return { id: first?.key ?? null };
    },
    async update(api, _desired, observed) {
      const holds = String(observed.fields.type);
      if (holds !== spec.type) {
        throw new AppApiError(
          `${api.name} at ${api.where} has a library named ${String(observed.fields.name)} that holds ${holds}, not ${spec.type}, and Plex can't change what a library holds: rename or remove it in Plex, and the next apply makes ${spec.name} (GET ${SECTIONS})`,
          { kind: 'rejected' },
        );
      }
      const held = (await sectionsOf(api)).find((s) => s.key === observed.id);
      if (held === undefined) {
        throw new AppApiError(
          `${api.name} at ${api.where} no longer has the library ${String(observed.fields.name)} (GET ${SECTIONS})`,
          { kind: 'rejected' },
        );
      }
      const query = new URLSearchParams({
        agent: held.agent,
        name: spec.name,
        location: spec.path,
      });
      await api.put(
        `${SECTIONS}/${encodeURIComponent(held.key)}?${query.toString()}`,
        {},
      );
    },
  };
}

/**
 * What Mediaplane wires in Plex (spec §6.2): its name, and the Movies and TV Shows
 * libraries. Its claim (bootstrap.ts) comes before. Its remote access, and the networks
 * allowed in without signing in, stay Plex's defaults (off, and none) and yours: Mediaplane
 * never sets them.
 */
export default defineIntegration({
  after: [],
  resources: [server, ...LIBRARIES.map(libraryResource)],
});
```

**Change** `catalog/radarr/integration.ts`:

```diff
diff --git a/catalog/radarr/integration.ts b/catalog/radarr/integration.ts
index 9bcbe9d..13ffe50 100644
--- a/catalog/radarr/integration.ts
+++ b/catalog/radarr/integration.ts
@@ -1,3 +1,3 @@
 import { servarrIntegration } from '../_shared/servarr';
-import { servarrJellyfin } from '../_shared/servarr-connection';
+import { servarrJellyfin, servarrPlex } from '../_shared/servarr-connection';
 import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';
@@ -5,6 +5,7 @@ import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-dow
 /**
- * What tells Jellyfin of a change in Radarr's library: a film imported, upgraded or
- * renamed, or a film or its file deleted.
+ * What tells the media server of a change in Radarr's library: a film imported, upgraded
+ * or renamed, or a film or its file deleted. Radarr's Plex connection offers each of them
+ * too (probed).
  */
-export const JELLYFIN_TRIGGERS = [
+export const LIBRARY_TRIGGERS = [
   'onDownload',
@@ -23,5 +24,5 @@ export const ROOT_FOLDER = '/data/media/movies';
  * download client, filing under the `movies` category, the root folder
- * /data/media/movies, and its connection to Jellyfin. It comes after qBittorrent, whose
- * category the download client needs, and after Jellyfin, whose admin the connection
- * needs.
+ * /data/media/movies, and its connection to the media server, Jellyfin or Plex. It comes
+ * after qBittorrent, whose category the download client needs, and after the media
+ * server, whose first resource the connection needs.
  */
@@ -29,3 +30,3 @@ export default servarrIntegration(
   'v3',
-  ['jellyfin', 'qbittorrent'],
+  ['jellyfin', 'plex', 'qbittorrent'],
   [
@@ -33,3 +34,4 @@ export default servarrIntegration(
     servarrRootFolder(ROOT_FOLDER),
-    servarrJellyfin(JELLYFIN_TRIGGERS),
+    servarrJellyfin(LIBRARY_TRIGGERS),
+    servarrPlex(LIBRARY_TRIGGERS, 'plex.library_movies'),
   ],
```

**Change** `catalog/sonarr/integration.ts`:

```diff
diff --git a/catalog/sonarr/integration.ts b/catalog/sonarr/integration.ts
index 3d85692..2f9f46c 100644
--- a/catalog/sonarr/integration.ts
+++ b/catalog/sonarr/integration.ts
@@ -1,3 +1,3 @@
 import { servarrIntegration } from '../_shared/servarr';
-import { servarrJellyfin } from '../_shared/servarr-connection';
+import { servarrJellyfin, servarrPlex } from '../_shared/servarr-connection';
 import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-download';
@@ -5,6 +5,7 @@ import { servarrDownloadClient, servarrRootFolder } from '../_shared/servarr-dow
 /**
- * What tells Jellyfin of a change in Sonarr's library: an episode imported, upgraded or
- * renamed, or a series or an episode's file deleted.
+ * What tells the media server of a change in Sonarr's library: an episode imported,
+ * upgraded or renamed, or a series or an episode's file deleted. Sonarr's Plex
+ * connection offers each of them too (probed).
  */
-export const JELLYFIN_TRIGGERS = [
+export const LIBRARY_TRIGGERS = [
   'onDownload',
@@ -23,4 +24,5 @@ export const ROOT_FOLDER = '/data/media/tv';
  * download client, filing under the `tv` category, the root folder /data/media/tv, and
- * its connection to Jellyfin. It comes after qBittorrent, whose category the download
- * client needs, and after Jellyfin, whose admin the connection needs.
+ * its connection to the media server, Jellyfin or Plex. It comes after qBittorrent, whose
+ * category the download client needs, and after the media server, whose first resource
+ * the connection needs.
  */
@@ -28,3 +30,3 @@ export default servarrIntegration(
   'v3',
-  ['jellyfin', 'qbittorrent'],
+  ['jellyfin', 'plex', 'qbittorrent'],
   [
@@ -32,3 +34,4 @@ export default servarrIntegration(
     servarrRootFolder(ROOT_FOLDER),
-    servarrJellyfin(JELLYFIN_TRIGGERS),
+    servarrJellyfin(LIBRARY_TRIGGERS),
+    servarrPlex(LIBRARY_TRIGGERS, 'plex.library_tv'),
   ],
```

**Change** `packages/engine/src/catalog/types.ts`:

```diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index 4fb6350..ed01499 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -118,2 +118,9 @@ export interface ApiSpec {
   check: string;
+  /**
+   * For an app that answers `ready` before it takes changes, what says it has started:
+   * the answer of `path`, asked with the key, that `done` takes. Plex answers /identity
+   * while it still starts its plugins (`startState`), and refuses a new library until then
+   * (probed). Asked after `ready`, again until `done` or the deadline.
+   */
+  started?: { path: string; done: (answer: unknown) => boolean };
 }
```

**Change** `packages/engine/src/integrations/wiring.ts`:

```diff
diff --git a/packages/engine/src/integrations/wiring.ts b/packages/engine/src/integrations/wiring.ts
index 9f67233..a50b234 100644
--- a/packages/engine/src/integrations/wiring.ts
+++ b/packages/engine/src/integrations/wiring.ts
@@ -1 +1,2 @@
+import { z } from 'zod';
 import { error, warning, type Diagnostic } from '../diagnostics';
@@ -229,3 +230,7 @@ export { redactionValues };
 
-/** The app is up, and still takes Mediaplane's key (spec §6.3, "the source"). */
+/**
+ * The app is up, has started if it says when (`started`), and still takes Mediaplane's
+ * key (spec §6.3, "the source"). One still starting at the deadline is unreachable for
+ * now, as one that doesn't answer is.
+ */
 export async function checkApp(reached: ReachedApp): Promise<void> {
@@ -234,2 +239,11 @@ export async function checkApp(reached: ReachedApp): Promise<void> {
   await reached.api.ready(spec.ready);
+  if (spec.started !== undefined) {
+    const { path, done } = spec.started;
+    if (!done(await reached.api.until(path, z.unknown(), done))) {
+      throw new AppApiError(
+        `${reached.api.name} at ${reached.api.where} is still starting (GET ${path})`,
+        { kind: 'unreachable', transient: true },
+      );
+    }
+  }
   await reached.api.check(spec.check);
```

**Change** `packages/engine/src/testing/jellyfin.ts`:

```diff
diff --git a/packages/engine/src/testing/jellyfin.ts b/packages/engine/src/testing/jellyfin.ts
index 578616d..b5d59dc 100644
--- a/packages/engine/src/testing/jellyfin.ts
+++ b/packages/engine/src/testing/jellyfin.ts
@@ -3,2 +3,4 @@ import { join } from 'node:path';
 import type { FakeReply, FakeRequest } from './http';
+import { testPlexConnection } from './plex';
+import type { FakePlexTvState } from './plextv';
 import {
@@ -471,2 +473,25 @@ const TRIGGERS: Readonly<Record<string, readonly string[]>> = {
 
+/** Sonarr's or Radarr's template for a "Plex Media Server" connection (probed). */
+function plexServerTemplate(service: string) {
+  return {
+    name: '',
+    implementation: 'PlexServer',
+    tags: [],
+    presets: [],
+    ...Object.fromEntries((TRIGGERS[service] ?? []).map((t) => [t, false])),
+    fields: [
+      { name: 'server' },
+      { name: 'host', value: '' },
+      { name: 'port', value: 32400 },
+      { name: 'useSsl', value: false },
+      { name: 'urlBase' },
+      { name: 'authToken' },
+      { name: 'signIn', value: 'startOAuth' },
+      { name: 'updateLibrary', value: true },
+      { name: 'mapFrom' },
+      { name: 'mapTo' },
+    ],
+  };
+}
+
 /** Sonarr's or Radarr's template for an "Emby / Jellyfin" connection. */
@@ -508,2 +533,3 @@ function testConnection(
   if (state.testFailure !== '') return refusal('Host', state.testFailure);
+  const base = value('urlBase');
   const why = unreachable(
@@ -511,3 +537,7 @@ function testConnection(
     {
-      resolves: value('host') === 'jellyfin' && jellyfin.up,
+      // A URL base is another URL than Jellyfin's: `@<host>` is another host.
+      resolves:
+        value('host') === 'jellyfin' &&
+        jellyfin.up &&
+        (base === undefined || base === ''),
       portOpen: value('port') === 8096,
@@ -529,3 +559,4 @@ function testConnection(
  * arrs: served as their other providers are, one with a trigger on tested as it is saved
- * (one with none is saved untested), and tested against `jellyfin`.
+ * (one with none is saved untested), and tested against `media.jellyfin`, or for a Plex
+ * one, `media.plex` with the tokens `media.plexTv` knows.
  */
@@ -535,3 +566,3 @@ export function fakeServarrConnections(
   state: FakeAppState,
-  jellyfin: FakeAppState,
+  media: { jellyfin: FakeAppState; plex: FakeAppState; plexTv: FakePlexTvState },
 ): FakeReply | undefined {
@@ -540,4 +571,7 @@ export function fakeServarrConnections(
     held: state.connections,
-    templates: () => [mediaBrowserTemplate(service)],
-    test: (sent, key) => testConnection(sent, key, state, jellyfin),
+    templates: () => [mediaBrowserTemplate(service), plexServerTemplate(service)],
+    test: (sent, key) =>
+      sent.implementation === 'PlexServer'
+        ? testPlexConnection(sent, key, state, media.plex, media.plexTv)
+        : testConnection(sent, key, state, media.jellyfin),
     testedOnCreate: (sent) =>
```

**Change** `packages/engine/src/testing/plex.ts`:

```diff
diff --git a/packages/engine/src/testing/plex.ts b/packages/engine/src/testing/plex.ts
index 48eda0e..4891aee 100644
--- a/packages/engine/src/testing/plex.ts
+++ b/packages/engine/src/testing/plex.ts
@@ -4,2 +4,10 @@ import type { FakeReply, FakeRequest } from './http';
 import type { FakePlexTvState } from './plextv';
+import {
+  fieldValue,
+  refusal,
+  unreachable,
+  type FakeProviderBase,
+  type FakeRefusal,
+} from './providers';
+import type { FakeAppState } from './wiring';
 
@@ -26,2 +34,6 @@ export interface FakePlex {
   friendlyName: string;
+  /** Whether its remote access is on (`PublishServerOnPlexOnlineKey`): off, at first. */
+  remoteAccess: boolean;
+  /** The networks allowed in without signing in (`allowedNetworks`): none, at first. */
+  allowedNetworks: string;
   sections: FakePlexSection[];
@@ -32,2 +44,7 @@ export interface FakePlex {
   claimingFor: number;
+  /**
+   * How many more times /identity says it is still starting (`startState`), and a new
+   * library is refused, as Plex does for a few seconds after every start (probed).
+   */
+  startingFor: number;
   /**
@@ -53,4 +70,7 @@ export function freshPlex(): FakePlex {
     friendlyName: '',
+    remoteAccess: false,
+    allowedNetworks: '',
     sections: [],
     claimingFor: 0,
+    startingFor: 0,
   };
@@ -67,2 +87,8 @@ const UNAUTHORIZED: FakeReply = {
 
+/** Plex's refusal of a request it can't take, such as a section without its agent. */
+const BAD_REQUEST: FakeReply = {
+  status: 400,
+  body: '<html><head><title>Bad Request</title></head><body><h1>400 Bad Request</h1></body></html>',
+};
+
 /**
@@ -109,2 +135,54 @@ export function claimFakePlex(
 
+/** Whether the fake Plex takes `token`: its claim's account's, or its own. */
+function plexTakes(plex: FakePlex, token: unknown, plexTv: FakePlexTvState): boolean {
+  const account = plexTv.accounts.find((a) => a.token === token);
+  return (
+    plex.owner !== null &&
+    typeof token === 'string' &&
+    token !== '' &&
+    (account?.id === plex.owner || token === plex.serverToken)
+  );
+}
+
+/**
+ * Sonarr's or Radarr's test of a connection to Plex, `sent` holding `token` in clear: its
+ * refusal, or undefined when it passes. As theirs does (probed), it reaches Plex by its
+ * service (plex), while it runs, at 32400, without TLS or a URL base, and asks for its
+ * libraries with the token: one Plex refuses is `AuthToken: Authentication Token is
+ * invalid`. A `testFailure` set on the arr overrides every check.
+ */
+export function testPlexConnection(
+  sent: FakeProviderBase,
+  token: unknown,
+  state: FakeAppState,
+  plex: FakeAppState,
+  plexTv: FakePlexTvState,
+): FakeRefusal | undefined {
+  const value = (name: string) => fieldValue(sent, name);
+  if (state.testFailure !== '') return refusal('Host', state.testFailure);
+  const base = value('urlBase');
+  const why = unreachable(
+    `${String(value('host'))}:${String(value('port'))}`,
+    {
+      resolves:
+        value('host') === 'plex' && plex.up && (base === undefined || base === ''),
+      portOpen: value('port') === 32400,
+      tls: value('useSsl') === true,
+    },
+    'Resource temporarily unavailable',
+  );
+  if (why !== undefined) {
+    return refusal('Host', 'Unable to connect to Plex Media Server', why);
+  }
+  if (!plexTakes(plex.plex, token, plexTv)) {
+    return refusal('AuthToken', 'Authentication Token is invalid');
+  }
+  // The arr needs a library of what it files (probed): Sonarr a TV one, Radarr a Movie one.
+  const radarr = 'onMovieDelete' in sent;
+  const holds = radarr ? 'movie' : 'show';
+  return plex.plex.sections.some((s) => s.type === holds)
+    ? undefined
+    : refusal('Host', `At least one ${radarr ? 'Movie' : 'TV'} library is required`);
+}
+
 function sectionShown(section: FakePlexSection) {
@@ -129,3 +207,7 @@ function sectionShown(section: FakePlexSection) {
  *   (the `Host` is a name, so Plex's DNS-rebinding check refuses it) is a 401 page;
- * - `/library/sections` lists its libraries.
+ * - `/:/prefs` lists its settings, and a PUT sets them (an unknown one is a 400);
+ * - `/library/sections` lists its libraries; a POST makes one, which needs its type,
+ *   agent, scanner and language (400 without), and takes a second of one name and a
+ *   folder that doesn't exist; a PUT of one needs its agent, sets its name and folders,
+ *   and can't change its type (400); a DELETE removes one.
  */
@@ -139,5 +221,8 @@ export function fakePlex(
   const { method } = request;
+  const query = (name: string) => url.searchParams.get(name) ?? '';
   if (url.pathname === '/identity' && method === 'GET') {
-    const starting = plex.claimingFor > 0;
-    if (starting) plex.claimingFor -= 1;
+    const claiming = plex.claimingFor > 0;
+    if (claiming) plex.claimingFor -= 1;
+    const starting = plex.startingFor > 0;
+    if (starting) plex.startingFor -= 1;
     return {
@@ -148,4 +233,5 @@ export function fakePlex(
           apiVersion: '1.2.3',
-          claimed: plex.owner !== null && !starting,
+          claimed: plex.owner !== null && !claiming,
           machineIdentifier: plex.machineId,
+          ...(starting ? { startState: 'startingPlugins' } : {}),
           version: '1.43.4.10903-e5521bd8c',
@@ -155,9 +241,53 @@ export function fakePlex(
   }
-  const token = request.headers['x-plex-token'];
-  const account = plexTv.accounts.find((a) => a.token === token);
-  const takes =
-    plex.owner !== null &&
-    typeof token === 'string' &&
-    (account?.id === plex.owner || token === plex.serverToken);
-  if (!takes) return UNAUTHORIZED;
+  if (!plexTakes(plex, request.headers['x-plex-token'], plexTv)) return UNAUTHORIZED;
+  if (url.pathname === '/' && method === 'GET') {
+    return {
+      status: 200,
+      body: {
+        MediaContainer: {
+          friendlyName: plex.friendlyName === '' ? FAKE_PLEX_HOSTNAME : plex.friendlyName,
+          machineIdentifier: plex.machineId,
+        },
+      },
+    };
+  }
+  if (url.pathname === '/:/prefs' && method === 'GET') {
+    return {
+      status: 200,
+      body: {
+        MediaContainer: {
+          size: 3,
+          Setting: [
+            { id: 'FriendlyName', type: 'text', default: '', value: plex.friendlyName },
+            {
+              id: 'PublishServerOnPlexOnlineKey',
+              type: 'bool',
+              default: false,
+              value: plex.remoteAccess,
+            },
+            {
+              id: 'allowedNetworks',
+              type: 'text',
+              default: '',
+              value: plex.allowedNetworks,
+            },
+          ],
+        },
+      },
+    };
+  }
+  if (url.pathname === '/:/prefs' && method === 'PUT') {
+    for (const [name, value] of url.searchParams) {
+      if (name === 'FriendlyName') plex.friendlyName = value;
+      else if (name === 'PublishServerOnPlexOnlineKey') plex.remoteAccess = value === '1';
+      else if (name === 'allowedNetworks') plex.allowedNetworks = value;
+      else {
+        return {
+          status: 400,
+          body: `cannot set preference value for unknown preference ${name}`,
+        };
+      }
+    }
+    return { status: 200 };
+  }
   if (url.pathname === '/library/sections' && method === 'GET') {
@@ -176,2 +306,51 @@ export function fakePlex(
   }
+  if (url.pathname === '/library/sections' && method === 'POST') {
+    if (plex.startingFor > 0) {
+      return {
+        status: 400,
+        body: 'the server is still starting up. Please retry later\n',
+      };
+    }
+    const type = query('type');
+    if (
+      (type !== 'movie' && type !== 'show') ||
+      query('agent') === '' ||
+      query('scanner') === '' ||
+      query('language') === '' ||
+      query('name') === ''
+    ) {
+      return BAD_REQUEST;
+    }
+    const made: FakePlexSection = {
+      key: String(Math.max(0, ...plex.sections.map((s) => Number(s.key))) + 1),
+      title: query('name'),
+      type,
+      agent: query('agent'),
+      scanner: query('scanner'),
+      language: query('language'),
+      locations: url.searchParams.getAll('location'),
+    };
+    plex.sections.push(made);
+    return {
+      status: 201,
+      body: { MediaContainer: { size: 1, Directory: [sectionShown(made)] } },
+    };
+  }
+  const one = /^\/library\/sections\/(\d+)$/.exec(url.pathname);
+  const section = plex.sections.find((s) => s.key === one?.[1]);
+  if (one !== null && method === 'PUT') {
+    if (section === undefined) return { status: 404 };
+    if (query('agent') === '') return BAD_REQUEST;
+    if (url.searchParams.has('type') && query('type') !== section.type)
+      return BAD_REQUEST;
+    if (url.searchParams.has('name')) section.title = query('name');
+    const locations = url.searchParams.getAll('location');
+    if (locations.length > 0) section.locations = locations;
+    return { status: 200 };
+  }
+  if (one !== null && method === 'DELETE') {
+    if (section === undefined) return { status: 404 };
+    plex.sections.splice(plex.sections.indexOf(section), 1);
+    return { status: 200 };
+  }
   return { status: 404 };
```

**Change** `packages/engine/src/testing/providers.ts`:

```diff
diff --git a/packages/engine/src/testing/providers.ts b/packages/engine/src/testing/providers.ts
index 1c3bb39..785c7f5 100644
--- a/packages/engine/src/testing/providers.ts
+++ b/packages/engine/src/testing/providers.ts
@@ -68,2 +68,5 @@ export function refusal(
 
+/** The settings a provider holds a secret in: a key, or Plex's token. */
+const SECRET_FIELDS: ReadonlySet<string> = new Set(['apiKey', 'authToken']);
+
 /** A provider as the app shows it: its key masked. */
@@ -73,3 +76,5 @@ export function maskedProvider<P extends FakeProviderBase>(held: P): P {
     fields: held.fields.map((f) =>
-      f.name === 'apiKey' && f.value !== undefined ? { ...f, value: '********' } : f,
+      SECRET_FIELDS.has(f.name) && f.value !== undefined
+        ? { ...f, value: '********' }
+        : f,
     ),
@@ -117,7 +122,7 @@ export function fakeProviders<P extends FakeProviderBase>(
   const keyOf = (sent: P) => {
-    const key = sent.fields.find((f) => f.name === 'apiKey')?.value;
+    const field = sent.fields.find((f) => SECRET_FIELDS.has(f.name));
     const stored = held
       .find((p) => p.id === sent.id)
-      ?.fields.find((f) => f.name === 'apiKey')?.value;
-    return key === '********' ? stored : key;
+      ?.fields.find((f) => f.name === field?.name)?.value;
+    return field?.value === '********' ? stored : field?.value;
   };
@@ -144,3 +149,3 @@ export function fakeProviders<P extends FakeProviderBase>(
     // "********" keeps the key it holds.
-    const key = found.fields.find((f) => f.name === 'apiKey')?.value;
+    const kept = (name: string) => found.fields.find((f) => f.name === name)?.value;
     Object.assign(found, {
@@ -148,3 +153,5 @@ export function fakeProviders<P extends FakeProviderBase>(
       fields: sent.fields.map((f) =>
-        f.name === 'apiKey' && f.value === '********' ? { ...f, value: key } : f,
+        SECRET_FIELDS.has(f.name) && f.value === '********'
+          ? { ...f, value: kept(f.name) }
+          : f,
       ),
```

**Change** `packages/engine/src/testing/wiring.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index c164844..a2bc0d6 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -431,3 +431,7 @@ export async function fakeStackApis(plexTv: FakePlexTvState = freshPlexTv()): Pr
         : (fakeServarrDownloads(request, service, state, peek('qbittorrent')) ??
-          fakeServarrConnections(request, service, state, peek('jellyfin')));
+          fakeServarrConnections(request, service, state, {
+            jellyfin: peek('jellyfin'),
+            plex: peek('plex'),
+            plexTv,
+          }));
     return answered ?? { status: 404 };
```

- [ ] **Step 4: Run them to see them pass, and regenerate the facts**

```bash
pnpm vitest run catalog/_shared/servarr-connection.test.ts catalog/catalog.test.ts catalog/plex/bootstrap.test.ts catalog/plex/integration.test.ts packages/cli/src/run.test.ts packages/engine/src/integrations/wiring.test.ts scripts/docs/catalog-facts.test.ts
pnpm docs:generate
```

Expected: PASS. `docs:generate` rewrites what Plex, Sonarr and Radarr manage in their
READMEs, and adds `apps.plex.server_name` to `docs/reference/stack-yaml.md` and
`docs/reference/stack.schema.json`.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages catalog scripts docs/reference
git commit -m "feat(catalog): Plex named and given its Movies and TV Shows libraries, and Sonarr and Radarr connected to it with your token" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1849 tests pass in 88 files.

---

### Task 5: Seerr signed in with your Plex account before it is published, and linked to Plex; logins of your own, and Plex's web path

Decision: Seerr's Plex sign-in is a first-run setup after Plex's, and a Seerr set up
already is checked with plex.tv's answer for your token, never signed in to
(decision 17).
Decision: `seerr.media_server_plex`, a resource of its own (decision 18).
Decision: `login` may be your own account, or a function of the stack; `webPath`;
`notWiredYet` goes (decision 19).

**Files:**
- Create: `catalog/seerr/plex.ts`
- Modify: `catalog/seerr/bootstrap.ts`, `catalog/seerr/integration.ts`,
  `catalog/seerr/app.ts`, `catalog/plex/app.ts`, `packages/engine/src/catalog/types.ts`,
  `packages/engine/src/credentials.ts`, `packages/engine/src/resolver/resolve.ts`,
  `packages/engine/src/testing/seerr.ts`, `packages/engine/src/testing/plex.ts`,
  `packages/engine/src/testing/wiring.ts`, `packages/cli/src/credentials.ts`,
  `scripts/docs/catalog-facts.ts`; generated: `catalog/seerr/README.md`
- Test: `catalog/seerr/bootstrap.test.ts`, `catalog/seerr/integration.test.ts`,
  `catalog/catalog.test.ts`, `catalog/render.test.ts`,
  `packages/engine/src/credentials.test.ts`, `packages/engine/src/resolver/resolve.test.ts`,
  `packages/engine/src/testing/seerr.test.ts`, `packages/cli/src/credentials.test.ts`,
  `packages/cli/src/run.test.ts`, `scripts/docs/catalog-facts.test.ts`

**Interfaces:**
- **Consumes:** Task 3's `BootstrapContext` and `plexTv.accountId`; Task 4's Plex
  resources; S6's Seerr setup (`session`, `ownSetup`, the `setUp` record) and
  `enableLibraries`.
- **Produces:**
  - `type AppLoginKind = 'shared' | { own: string } | { comingIn: string }`,
    `AppDefinition.login?: AppLoginKind | ((config: StackConfig) => AppLoginKind)`,
    `AppDefinition.webPath?: string`; `AppLogin` gains
    `{ login: 'own'; account: string }`; `AppDefinition.notWiredYet` is gone;
  - `seerr.media_server_plex` (`hostname`, `port`, `libraries`); `plexSettings`,
    `atStackPlex(held, at)`, `heldPlexHost(held)` in `catalog/seerr/plex.ts`;
  - from `@mediaplane/engine/testing`: `SEERR_PLEX` (1), the fake Seerr's Plex sign-in,
    settings and libraries (`plexUsers`, `plexTokens`, `plex`, `plexClaimant`), and
    `plexTakes(plex, token, plexTv)`.

- [ ] **Step 1: Write the failing tests**

**Change** `catalog/catalog.test.ts`:

```diff
diff --git a/catalog/catalog.test.ts b/catalog/catalog.test.ts
index 65abf5f..feb6566 100644
--- a/catalog/catalog.test.ts
+++ b/catalog/catalog.test.ts
@@ -85,3 +85,3 @@ describe('catalog', () => {
 
-  it("isn't wired with Plex yet, Seerr, whose login there comes with Slice 7", () => {
+  it('wires Seerr with Plex as with Jellyfin, and you sign in to it with your own Plex account there', () => {
     const seerr = (server: string) =>
@@ -98,14 +98,16 @@ apps:
 `,
-      ).apps.find((app) => app.def.id === 'seerr')?.def;
+      ).apps.find((app) => app.def.id === 'seerr');
     const plex = seerr('media_server: plex\nplex: { token: { env: PLEX_TOKEN } }');
-    expect([plex?.api, plex?.integration, plex?.bootstrap]).toEqual([
-      undefined,
-      undefined,
-      undefined,
-    ]);
-    expect(plex?.login).toEqual({ comingIn: 'Slice 7' });
     const jellyfin = seerr('media_server: jellyfin');
-    expect(jellyfin?.api).toBeDefined();
-    expect(jellyfin?.bootstrap).toBeDefined();
-    expect(jellyfin?.login).toBe('shared');
+    for (const app of [plex, jellyfin]) {
+      expect(app?.def.api).toBeDefined();
+      expect(app?.def.integration).toBeDefined();
+      expect(app?.def.bootstrap).toBeDefined();
+    }
+    const loginIn = (app: typeof plex) =>
+      typeof app?.def.login === 'function'
+        ? app.def.login(app.context.config)
+        : app?.def.login;
+    expect(loginIn(plex)).toEqual({ own: 'Plex' });
+    expect(loginIn(jellyfin)).toBe('shared');
   });
@@ -130,12 +132,12 @@ apps:
 
-  it('names the slice that brings each login still to come', () => {
+  it("has no login still to come, and Plex's is your own Plex account, at /web", () => {
+    expect(
+      catalog.filter((app) => typeof app.login === 'object' && 'comingIn' in app.login),
+    ).toEqual([]);
+    const plex = catalog.find((app) => app.id === 'plex');
+    expect(plex?.login).toEqual({ own: 'Plex' });
+    expect(plex?.webPath).toBe('/web');
     expect(
-      Object.fromEntries(
-        catalog.flatMap((app) =>
-          app.login === undefined || app.login === 'shared'
-            ? []
-            : [[app.id, app.login.comingIn]],
-        ),
-      ),
-    ).toEqual({ plex: 'Slice 7' });
+      catalog.filter((app) => app.webPath !== undefined).map((app) => app.id),
+    ).toEqual(['plex']);
   });
```

**Change** `catalog/render.test.ts`:

```diff
diff --git a/catalog/render.test.ts b/catalog/render.test.ts
index 4ae7f0c..ebeae73 100644
--- a/catalog/render.test.ts
+++ b/catalog/render.test.ts
@@ -296,5 +296,5 @@ describe('the real catalog', () => {
     expect(compose.services.jellyfin).toBeUndefined();
-    // Seerr isn't wired with Plex until Slice 7: nothing calls it, so it stays off the
-    // wiring network.
-    expect(compose.services.seerr?.networks).toBeUndefined();
+    // Seerr is wired with Plex too: it joins the wiring network, as Plex does.
+    expect(compose.services.seerr?.networks).toEqual(['default', 'wiring']);
+    expect(compose.services.plex?.networks).toEqual(['default', 'wiring']);
   });
```

**Change** `catalog/seerr/bootstrap.test.ts`:

```diff
diff --git a/catalog/seerr/bootstrap.test.ts b/catalog/seerr/bootstrap.test.ts
index 456ee35..b31986c 100644
--- a/catalog/seerr/bootstrap.test.ts
+++ b/catalog/seerr/bootstrap.test.ts
@@ -12,2 +12,3 @@ import {
   type AppApiErrorKind,
+  type BootstrapContext,
   type ResolvedStack,
@@ -16,4 +17,7 @@ import {
 import {
+  claimFakePlex,
+  FAKE_PLEX_ACCOUNT,
   fakeContainer,
   fakeJellyfinSetUp,
+  fakePlexTv,
   fakeRuntime,
@@ -264,3 +268,3 @@ describe("Seerr's first-run setup", () => {
 
-  it('fails in a stack with no Jellyfin to sign in through', async () => {
+  it('fails, asking nothing, in a Plex stack without your Plex token to sign in with', async () => {
     const { api, calls } = await seerrOf();
@@ -278,3 +282,3 @@ describe("Seerr's first-run setup", () => {
       message:
-        "Seerr at http://seerr:5055 (127.0.0.1) can't be set up: the stack runs no Jellyfin for it to sign in through",
+        "Seerr at http://seerr:5055 (127.0.0.1) can't be set up: the stack runs no Plex, or Mediaplane has no Plex token, for it to sign in with",
     });
@@ -569 +573,154 @@ describe("Seerr's first-run setup, through the engine's bootstrap step", () => {
 });
+
+describe("Seerr's first-run setup, with Plex", () => {
+  const TOKEN = FAKE_PLEX_ACCOUNT.token;
+  /** Another plex.tv account, which could sign in to Seerr first. */
+  const SOMEONE = { id: 7_000_099, token: 'someone-plex-token-9' };
+  const PLEX_STACK = STACK.replace(
+    'media_server: jellyfin',
+    'media_server: plex\nplex: { token: { file: secrets/plex-token } }',
+  );
+
+  /** The stack's fakes: a Plex your account claimed, Seerr as `seerr` says, a client of it. */
+  async function plexSeerrOf(seerr: Partial<FakeAppState['seerr']> = {}) {
+    const plexTv = await fakePlexTv();
+    plexTv.state.accounts.push({ ...SOMEONE });
+    const apis = await fakeStackApis(plexTv.state);
+    const plex = freshAppState();
+    claimFakePlex(plex.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
+    apis.apps.set('plex', plex);
+    const state = { ...freshAppState(), key: SEERR_KEY };
+    Object.assign(state.seerr, structuredClone(seerr));
+    apis.apps.set('seerr', state);
+    const api = createAppApi({
+      name: 'Seerr',
+      service: 'seerr',
+      port: 5055,
+      endpoint: { host: '127.0.0.1', port: apis.app.port },
+      key: { scheme: 'x-api-key', value: SEERR_KEY },
+      secrets: [SEERR_KEY, TOKEN],
+      retry: { deadlineMs: 0 },
+    });
+    const ctx: BootstrapContext = {
+      keys: { plex: { token: TOKEN } },
+      plexTv: plexTv.client,
+    };
+    return {
+      api,
+      state,
+      plexTv,
+      ctx,
+      calls: () => apis.app.requests.map(callOf),
+      stack: wiringStack(catalog, PLEX_STACK),
+    };
+  }
+
+  /** Seerr as its first sign-in with your plex.tv account left it: Plex not set yet. */
+  const SIGNED_IN = {
+    mediaServerType: 1,
+    plexUsers: [FAKE_PLEX_ACCOUNT.id],
+    plexTokens: { [FAKE_PLEX_ACCOUNT.id]: TOKEN },
+  };
+
+  it('signs in with your plex.tv token, which makes your account its admin, then signs out', async () => {
+    const { api, state, calls, ctx, stack } = await plexSeerrOf();
+    expect(await seerrBootstrap.open(api)).toBe(true);
+    expect(await seerrBootstrap.run(api, ADMIN, stack, ctx)).toBeUndefined();
+    expect(state.seerr).toMatchObject({
+      mediaServerType: 1,
+      plexUsers: [FAKE_PLEX_ACCOUNT.id],
+      sessions: [],
+    });
+    expect(await seerrBootstrap.open(api)).toBe(false);
+    expect(calls()).toEqual([
+      'GET /api/v1/settings/public',
+      'GET /api/v1/settings/public',
+      'POST /api/v1/auth/plex',
+      'POST /api/v1/auth/logout',
+      'GET /api/v1/settings/public',
+    ]);
+    // The shared admin's password never went to Seerr: your token did, once.
+    expect(JSON.stringify(state.seerr)).not.toContain(PASSWORD);
+  });
+
+  it("says why when Seerr can't check your token at plex.tv", async () => {
+    const { api, plexTv, stack } = await plexSeerrOf();
+    const refused = await thrown(
+      seerrBootstrap.run(api, ADMIN, stack, {
+        keys: { plex: { token: 'revoked-plex-token-0' } },
+        plexTv: plexTv.client,
+      }),
+    );
+    expect(refused).toMatchObject({
+      kind: 'rejected',
+      message:
+        "Seerr at http://seerr:5055 (127.0.0.1) couldn't sign in with your Plex token, which it checks at plex.tv: Seerr at http://seerr:5055 (127.0.0.1) failed (HTTP 500): Unable to authenticate. (POST /api/v1/auth/plex). Check that Seerr reaches plex.tv, then run apply again",
+    });
+  });
+
+  it("takes as its own a Seerr set up with your plex.tv account, its Plex unset or the stack's, asking plex.tv, never signing in", async () => {
+    for (const plex of [
+      { ip: '', port: 32400, useSsl: false, libraries: [] },
+      { ip: 'plex', port: 32400, useSsl: false, libraries: [] },
+    ]) {
+      const { api, calls, ctx, stack, plexTv } = await plexSeerrOf({
+        ...SIGNED_IN,
+        plex,
+      });
+      expect(await seerrBootstrap.run(api, ADMIN, stack, ctx)).toBeUndefined();
+      expect(calls()).not.toContain('POST /api/v1/auth/plex');
+      expect(plexTv.state.calls.at(-1)).toBe('GET /api/v2/user');
+    }
+  });
+
+  it('refuses a Seerr set up with another plex.tv account, or another Plex, as claimed', async () => {
+    for (const seerr of [
+      { ...SIGNED_IN, plexUsers: [SOMEONE.id] },
+      {
+        ...SIGNED_IN,
+        plex: { ip: 'plex', port: 32400, useSsl: true, libraries: [] },
+      },
+      {
+        ...SIGNED_IN,
+        plex: { ip: '198.51.100.7', port: 32400, useSsl: false, libraries: [] },
+      },
+    ]) {
+      const { api, ctx, stack, calls } = await plexSeerrOf(seerr);
+      expect(await thrown(seerrBootstrap.run(api, ADMIN, stack, ctx))).toMatchObject({
+        kind: 'auth',
+        unsure: false,
+        message:
+          'Seerr at http://seerr:5055 (127.0.0.1) was set up with another plex.tv account or another Plex (GET /api/v1/auth/me, GET /api/v1/settings/plex)',
+      });
+      // Your token never went to that Seerr.
+      expect(calls()).not.toContain('POST /api/v1/auth/plex');
+    }
+  });
+
+  it("refuses, as unsure, a set-up Seerr when plex.tv can't say whose your token is", async () => {
+    const { api, ctx, stack, plexTv } = await plexSeerrOf(SIGNED_IN);
+    plexTv.state.failing.push({ path: '/api/v2/user', status: 503 });
+    expect(await thrown(seerrBootstrap.run(api, ADMIN, stack, ctx))).toMatchObject({
+      kind: 'auth',
+      unsure: true,
+    });
+  });
+
+  it('refuses a Seerr someone signed in to first, with their own plex.tv account', async () => {
+    const { api, ctx, stack, state } = await plexSeerrOf({
+      plexClaimant: { plexId: SOMEONE.id, token: SOMEONE.token },
+    });
+    expect(await thrown(seerrBootstrap.run(api, ADMIN, stack, ctx))).toMatchObject({
+      kind: 'auth',
+      message:
+        'Seerr at http://seerr:5055 (127.0.0.1) was set up with another plex.tv account or another Plex (GET /api/v1/auth/me, GET /api/v1/settings/plex)',
+    });
+    expect(state.seerr.plexUsers).toEqual([SOMEONE.id]);
+  });
+
+  it('gives the remedies for a claimed Seerr on a Plex stack, starting afresh last', () => {
+    expect(seerrBootstrap.claimedHint?.(wiringStack(catalog, PLEX_STACK), 'x')).toBe(
+      'First: if the plex.tv account it was set up with is yours, run "mediaplane plex-login" and sign in as it, with its Plex unset or at plex:32400, with no TLS; then run apply again. Last, if you did not set it up: start it afresh, as the runbook says',
+    );
+  });
+});
```

**Change** `catalog/seerr/integration.test.ts`:

```diff
diff --git a/catalog/seerr/integration.test.ts b/catalog/seerr/integration.test.ts
index b9f5320..5e71940 100644
--- a/catalog/seerr/integration.test.ts
+++ b/catalog/seerr/integration.test.ts
@@ -8,3 +8,6 @@ import {
 import {
+  claimFakePlex,
+  FAKE_PLEX_ACCOUNT,
   fakeJellyfinSetUp,
+  fakePlexTv,
   fakeStackApis,
@@ -110,2 +113,134 @@ async function seerr() {
 
+describe("Seerr's media server, with Plex", () => {
+  const spec = resource('media_server_plex');
+  const TOKEN = FAKE_PLEX_ACCOUNT.token;
+  const PLEX_STACK = STACK.replace(
+    'media_server: jellyfin',
+    'media_server: plex\nplex: { token: { file: secrets/plex-token } }',
+  );
+
+  /**
+   * The stack's fakes: Plex your account claimed, with Movies and TV Shows; Seerr signed
+   * in to by your account, its first sign-in; and a client of Seerr, with its key.
+   */
+  async function plexSeerr() {
+    const plexTv = await fakePlexTv();
+    const apis = await fakeStackApis(plexTv.state);
+    const plex = freshAppState();
+    claimFakePlex(plex.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
+    for (const [key, title, type] of [
+      ['1', 'Movies', 'movie'],
+      ['2', 'TV Shows', 'show'],
+    ] as const) {
+      plex.plex.sections.push({
+        key,
+        title,
+        type,
+        agent: 'fake',
+        scanner: 'fake',
+        language: 'en-US',
+        locations: [],
+      });
+    }
+    apis.apps.set('plex', plex);
+    const state: FakeAppState = { ...freshAppState(), key: SEERR_KEY };
+    apis.apps.set('seerr', state);
+    const api = createAppApi({
+      name: 'Seerr',
+      service: 'seerr',
+      port: 5055,
+      endpoint: { host: '127.0.0.1', port: apis.app.port },
+      key: { scheme: 'x-api-key', value: SEERR_KEY },
+      secrets: [SEERR_KEY, TOKEN],
+      retry: { deadlineMs: 0 },
+    });
+    await seerrBootstrap.run(api, ADMIN, contextOf(PLEX_STACK).stack, {
+      keys: { plex: { token: TOKEN } },
+      plexTv: plexTv.client,
+    });
+    const calls = () =>
+      apis.app.requests.map((r: FakeRequest) => `${r.method} ${r.path}`);
+    return { api, state, calls, plex: plex.plex };
+  }
+
+  it("is wanted only with Plex, at Plex's service and port, with both libraries, and holds no secret", () => {
+    expect(spec).toMatchObject({
+      fields: ['hostname', 'port', 'libraries'],
+      secrets: [],
+      requires: ['plex.server', 'plex.library_movies', 'plex.library_tv'],
+    });
+    expect(wanted(spec, contextOf(PLEX_STACK))).toEqual({
+      name: 'Plex',
+      fields: { hostname: 'plex', port: 32400, libraries: 'Movies,TV Shows' },
+      secrets: {},
+    });
+    expect(spec.desired(contextOf())).toBeUndefined();
+    expect(resource('media_server').desired(contextOf(PLEX_STACK))).toBeUndefined();
+  });
+
+  it("points Seerr at the stack's Plex, then syncs and enables both libraries", async () => {
+    const { api, state, calls } = await plexSeerr();
+    const desired = wanted(spec, contextOf(PLEX_STACK));
+    // Its first sign-in leaves its Plex unset.
+    expect(await spec.observe(api, undefined, desired)).toBeUndefined();
+    const before = calls().length;
+    expect(await spec.create(api, desired)).toEqual({ id: null });
+    expect(calls().slice(before)).toEqual([
+      'POST /api/v1/settings/plex',
+      'POST /api/v1/settings/plex/library/sync',
+      'GET /api/v1/settings/plex/library',
+      'PUT /api/v1/settings/plex/library/1',
+      'PUT /api/v1/settings/plex/library/2',
+    ]);
+    expect(state.seerr.plex).toMatchObject({ ip: 'plex', port: 32400, useSsl: false });
+    expect(await spec.observe(api, undefined, desired)).toEqual({
+      id: null,
+      name: 'Plex',
+      fields: { hostname: 'plex', port: 32400, libraries: 'Movies,TV Shows' },
+    });
+  });
+
+  it("puts back the stack's Plex when Seerr's is held with TLS, and a library turned off", async () => {
+    const { api, state } = await plexSeerr();
+    const desired = wanted(spec, contextOf(PLEX_STACK));
+    await spec.create(api, desired);
+    state.seerr.plex.useSsl = true;
+    const [movies] = state.seerr.plex.libraries;
+    if (movies === undefined) throw new Error('no library synced');
+    movies.enabled = false;
+    const held = await spec.observe(api, undefined, desired);
+    expect(held?.fields).toEqual({
+      hostname: 'https://plex:32400',
+      port: 32400,
+      libraries: 'TV Shows',
+    });
+    if (held === undefined) throw new Error('Seerr holds a Plex');
+    await spec.update(api, desired, held);
+    expect(await spec.observe(api, undefined, desired)).toMatchObject({
+      fields: { hostname: 'plex', libraries: 'Movies,TV Shows' },
+    });
+  });
+
+  it('refuses a library Seerr finds no Plex library of, by name', async () => {
+    const { api, plex } = await plexSeerr();
+    const desired = wanted(spec, contextOf(PLEX_STACK));
+    await spec.create(api, desired);
+    const held = await spec.observe(api, undefined, desired);
+    if (held === undefined) throw new Error('Seerr holds a Plex');
+    // Renamed in Plex: Seerr syncs it under its new name.
+    const [movies] = plex.sections;
+    if (movies === undefined) throw new Error('no Plex library');
+    movies.title = 'Films';
+    expect(
+      await thrown(
+        spec.update(api, desired, { ...held, fields: { ...held.fields, libraries: '' } }),
+      ),
+    ).toMatchObject({
+      kind: 'rejected',
+      message:
+        'Seerr at http://seerr:5055 (127.0.0.1) finds no Plex library named Movies (POST /api/v1/settings/plex/library/sync)',
+    });
+  });
+});
+
 describe("Seerr's media server", () => {
@@ -560,2 +695,3 @@ describe("Seerr's setup", () => {
       'seerr.media_server',
+      'seerr.media_server_plex',
       'seerr.server_sonarr',
```

**Change** `packages/cli/src/credentials.test.ts`:

```diff
diff --git a/packages/cli/src/credentials.test.ts b/packages/cli/src/credentials.test.ts
index 7d96797..eaf3bcc 100644
--- a/packages/cli/src/credentials.test.ts
+++ b/packages/cli/src/credentials.test.ts
@@ -93,3 +93,3 @@ describe('mediaplane credentials', () => {
 
-  it("says Seerr's login arrives with Slice 7 on a Plex stack, as Plex's does", async () => {
+  it('says Plex and, on a Plex stack, Seerr take your own Plex account, Plex at its web path', async () => {
     const home = await makeHome({
@@ -103,5 +103,5 @@ describe('mediaplane credentials', () => {
     expect(term.stdout().split('\n').slice(4)).toEqual([
-      'Plex         http://127.0.0.1:32400  (its login arrives in Slice 7)',
+      'Plex         http://127.0.0.1:32400/web  (sign in with your own Plex account)',
       'qBittorrent  http://127.0.0.1:8080',
-      'Seerr        http://127.0.0.1:5055  (its login arrives in Slice 7)',
+      'Seerr        http://127.0.0.1:5055  (sign in with your own Plex account)',
       'Sonarr       http://127.0.0.1:8989',
@@ -155,3 +155,3 @@ describe('mediaplane credentials', () => {
 
-  it("gives Seerr's login as still to come in JSON on a Plex stack", async () => {
+  it("gives Seerr's login as your own Plex account in JSON on a Plex stack", async () => {
     const home = await makeHome({
@@ -169,4 +169,4 @@ describe('mediaplane credentials', () => {
       urls: ['http://127.0.0.1:5055'],
-      login: 'not-yet',
-      comingIn: 'Slice 7',
+      login: 'own',
+      account: 'Plex',
     });
```

**Change** `packages/cli/src/run.test.ts`:

```diff
diff --git a/packages/cli/src/run.test.ts b/packages/cli/src/run.test.ts
index 2490147..47978bc 100644
--- a/packages/cli/src/run.test.ts
+++ b/packages/cli/src/run.test.ts
@@ -1521,2 +1521,46 @@ apps:
 
+  it('signs Seerr in with your Plex account once Plex is claimed, links it to Plex, then leaves it as it is', async () => {
+    const { home, plex, docker } = await plexHome();
+    await writeFile(join(home, 'stack.yaml'), `${PLEX_STACK}  seerr: {}\n`);
+    const seerr = freshAppState();
+    seerr.seerr.configDir = join(home, 'appdata', 'seerr');
+    apis.apps.set('seerr', seerr);
+    const first = capture();
+    expect(await run(['apply', '--home', home, '--yes'], first.io, deps(docker))).toBe(0);
+    expect(first.stdout()).toContain(
+      '  done    first-run setup: set up plex, seerr; published plex, seerr\n',
+    );
+    // Seerr's setup ran after Plex's, unpublished until both were done.
+    expect(docker.calls.filter((call) => call.startsWith('up'))).toEqual([
+      'up unpublished plex seerr with plex.PLEX_CLAIM',
+      'up',
+    ]);
+    for (const line of [
+      'seerr.media_server_plex: created',
+      'seerr.server_sonarr: created',
+      'seerr.setup: updated initialized',
+    ]) {
+      expect(first.stdout()).toContain(`  done    wiring ${line}\n`);
+    }
+    expect(seerr.seerr).toMatchObject({
+      mediaServerType: 1,
+      plexUsers: [FAKE_PLEX_ACCOUNT.id],
+      sessions: [],
+      initialized: true,
+      plex: { ip: 'plex', port: 32400, useSsl: false },
+    });
+    expect(seerr.seerr.plex.libraries.map((l) => [l.name, l.enabled])).toEqual([
+      ['Movies', true],
+      ['TV Shows', true],
+    ]);
+    expect(plex.owner).toBe(FAKE_PLEX_ACCOUNT.id);
+    expect((await readSecretStore(home)).setUp).toEqual(['plex', 'seerr']);
+    const secrets = [...(await secretsIn(home)), ...plexSecrets()];
+    expectNoSecrets(first.stdout() + first.stderr(), secrets);
+    expectNoSecrets(await readFile(join(home, RESOURCES_PATH), 'utf8'), secrets);
+    const again = capture();
+    expect(await run(['plan', '--home', home], again.io, deps(docker))).toBe(0);
+    expect(again.stdout()).toBe('No changes.\n');
+  });
+
   it('starts nothing when plex.tv refuses your token, and says to sign in again', async () => {
```

**Change** `packages/engine/src/credentials.test.ts`:

```diff
diff --git a/packages/engine/src/credentials.test.ts b/packages/engine/src/credentials.test.ts
index 604c878..c8dbad7 100644
--- a/packages/engine/src/credentials.test.ts
+++ b/packages/engine/src/credentials.test.ts
@@ -21,3 +21,6 @@ apps:
 
-/** qBittorrent has the shared login, Sonarr's is to come, and Jellyfin says nothing. */
+/**
+ * qBittorrent has the shared login, Sonarr's is to come, and Jellyfin says nothing; Plex
+ * takes your own Plex account, at its web path.
+ */
 const LOGINS: Record<string, AppDefinition['login']> = {
@@ -25,2 +28,3 @@ const LOGINS: Record<string, AppDefinition['login']> = {
   sonarr: { comingIn: 'Slice 3b' },
+  plex: { own: 'Plex' },
 };
@@ -32,2 +36,3 @@ const CATALOG: Catalog = fixtureCatalog.map((app) => ({
   ports: app.id === 'sonarr' ? [...app.ports, EXTRA_PORT] : app.ports,
+  ...(app.id === 'plex' ? { webPath: '/web' } : {}),
 }));
@@ -128,2 +133,45 @@ describe('credentials', () => {
 
+  it('gives your own account as the login where the app takes one, and its web path', async () => {
+    const home = await homeWith({
+      stack: STACK.replace(
+        'media_server: jellyfin',
+        'media_server: plex\nplex: { token: { env: PLEX_TOKEN } }',
+      ),
+    });
+    const result = await loginFor(home, { env: { PLEX_TOKEN: 'fake-plex-token' } });
+    expect(result.ok && result.apps.find((a) => a.app === 'plex')).toEqual({
+      app: 'plex',
+      name: 'plex',
+      urls: ['http://127.0.0.1:32400/web'],
+      login: 'own',
+      account: 'Plex',
+    });
+  });
+
+  it('asks an app whose login depends on the stack, with the stack', async () => {
+    const seen: string[] = [];
+    const catalog: Catalog = CATALOG.map((app) =>
+      app.id === 'sonarr'
+        ? {
+            ...app,
+            login: (config) => {
+              seen.push(config.media_server);
+              return config.media_server === 'plex' ? { own: 'Plex' } : 'shared';
+            },
+          }
+        : app,
+    );
+    const result = await credentials({
+      home: await homeWith(),
+      catalog,
+      host: FIXTURE_HOST,
+      env: {},
+      runtime: fakeRuntime(),
+    });
+    expect(result.ok && result.apps.find((a) => a.app === 'sonarr')?.login).toBe(
+      'shared',
+    );
+    expect(seen).toEqual(['jellyfin']);
+  });
+
   it("names this host's addresses when the web UIs are on every interface", async () => {
```

**Change** `packages/engine/src/resolver/resolve.test.ts`:

```diff
diff --git a/packages/engine/src/resolver/resolve.test.ts b/packages/engine/src/resolver/resolve.test.ts
index d29d639..7c36977 100644
--- a/packages/engine/src/resolver/resolve.test.ts
+++ b/packages/engine/src/resolver/resolve.test.ts
@@ -82,45 +82,2 @@ describe('resolveStack: which apps run', () => {
 
-describe('resolveStack: apps not wired yet', () => {
-  it('drops the API, integration and setup of an app not wired in this stack yet, and says when its login comes', () => {
-    const wired: Partial<AppDefinition> = {
-      api: {
-        port: 'web',
-        ready: '/ready',
-        key: { secret: 'apiKey', scheme: 'x-api-key' },
-        check: '/check',
-      },
-      integration: { after: [], resources: [] },
-      login: 'shared',
-      notWiredYet: (config) =>
-        config.media_server === 'plex' ? { comingIn: 'Slice 7' } : undefined,
-    };
-    const catalog = fixtureCatalog.map((def) =>
-      def.id === 'sonarr' ? { ...def, ...wired } : def,
-    );
-    const resolveWith = (server: string) =>
-      resolveStack(
-        fixtureConfig(
-          `${BASE.replace('media_server: jellyfin', server)}apps:\n  sonarr: {}\n  qbittorrent: {}\n`,
-        ),
-        catalog,
-        FIXTURE_HOST,
-        '/opt/mediaplane',
-      );
-    const withJellyfin = app(resolveWith('media_server: jellyfin'), 'sonarr')?.def;
-    expect(withJellyfin?.api).toBeDefined();
-    expect(withJellyfin?.integration).toBeDefined();
-    expect(withJellyfin?.login).toBe('shared');
-    const withPlex = app(
-      resolveWith('media_server: plex\nplex: { token: { env: PLEX_TOKEN } }'),
-      'sonarr',
-    )?.def;
-    expect(withPlex?.api).toBeUndefined();
-    expect(withPlex?.integration).toBeUndefined();
-    expect(withPlex?.bootstrap).toBeUndefined();
-    expect(withPlex?.login).toEqual({ comingIn: 'Slice 7' });
-    // Everything else stays as the catalog has it.
-    expect(withPlex?.ports).toEqual(withJellyfin?.ports);
-  });
-});
-
 describe('resolveStack: options and checks', () => {
```

**Change** `packages/engine/src/testing/seerr.test.ts`:

```diff
diff --git a/packages/engine/src/testing/seerr.test.ts b/packages/engine/src/testing/seerr.test.ts
index 1542803..edd248e 100644
--- a/packages/engine/src/testing/seerr.test.ts
+++ b/packages/engine/src/testing/seerr.test.ts
@@ -4,2 +4,4 @@ import { describe, expect, it } from 'vitest';
 import { callFake } from './http';
+import { claimFakePlex } from './plex';
+import { FAKE_PLEX_ACCOUNT, fakePlexTv } from './plextv';
 import {
@@ -8,2 +10,3 @@ import {
   SEERR_NOT_CONFIGURED,
+  SEERR_PLEX,
   SET_UP_JELLYFIN,
@@ -98,2 +101,5 @@ describe("fakeStackApis' Seerr", () => {
       jellyfinUsername: 'admin',
+      plexId: null,
+      plexUsername: null,
+      email: 'user@example.com',
       permissions: 2,
@@ -450 +456,129 @@ describe("fakeStackApis' Seerr", () => {
 });
+
+describe("fakeStackApis' Seerr, with Plex", () => {
+  const TOKEN = FAKE_PLEX_ACCOUNT.token;
+  const SOMEONE = { id: 7_000_099, token: 'someone-plex-token-9' };
+
+  /** A stack's fakes: a Plex your account claimed, with two libraries, and Seerr fresh. */
+  async function plexStack() {
+    const plexTv = await fakePlexTv();
+    plexTv.state.accounts.push({ ...SOMEONE });
+    const apis = await fakeStackApis(plexTv.state);
+    const plex = freshAppState();
+    claimFakePlex(plex.plex, await plexTv.client.claimToken(TOKEN), plexTv.state);
+    plex.plex.friendlyName = 'Mediaplane';
+    for (const [key, title, type] of [
+      ['1', 'Movies', 'movie'],
+      ['2', 'TV Shows', 'show'],
+    ] as const) {
+      plex.plex.sections.push({
+        key,
+        title,
+        type,
+        agent: 'fake',
+        scanner: 'fake',
+        language: 'en-US',
+        locations: [],
+      });
+    }
+    apis.apps.set('plex', plex);
+    const seerr = { ...freshAppState(), key: SEERR_KEY };
+    apis.apps.set('seerr', seerr);
+    return { apis, plex, seerr, port: apis.app.port };
+  }
+
+  it('lets whoever signs in first with a plex.tv account set it up, as Seerr does', async () => {
+    const { port, seerr } = await plexStack();
+    const signIn = (authToken: string) =>
+      call(port, '/api/v1/auth/plex', { body: { authToken } });
+    // plex.tv refuses the token: Seerr can't tell whose it is.
+    expect(await signIn('revoked-plex-token-0')).toMatchObject({
+      status: 500,
+      body: { message: 'Unable to authenticate.' },
+    });
+    expect(await call(port, '/api/v1/auth/plex', { body: {} })).toMatchObject({
+      status: 400,
+    });
+    const first = await signIn(TOKEN);
+    expect(first).toMatchObject({ status: 200, body: { id: 1, permissions: 2 } });
+    expect(first.cookie).toMatch(/^connect\.sid=s%3Afake-session-1\.signed;/);
+    expect(seerr.seerr).toMatchObject({
+      mediaServerType: SEERR_PLEX,
+      plexUsers: [FAKE_PLEX_ACCOUNT.id],
+    });
+    expect((await call(port, '/api/v1/auth/me', { headers: keyed })).body).toMatchObject({
+      id: 1,
+      plexId: FAKE_PLEX_ACCOUNT.id,
+      jellyfinUsername: null,
+    });
+    // Its admin signs in again; another account is refused; Jellyfin's sign-in is off.
+    expect((await signIn(TOKEN)).status).toBe(200);
+    expect((await signIn(SOMEONE.token)).status).toBe(403);
+    expect(
+      (await call(port, '/api/v1/auth/jellyfin', { body: { username: 'admin' } })).body,
+    ).toEqual({ error: 'Jellyfin login is disabled' });
+  });
+
+  it("saves its Plex only where it reaches Plex with its admin's token, though it keeps what was sent", async () => {
+    const { port, seerr } = await plexStack();
+    await call(port, '/api/v1/auth/plex', { body: { authToken: TOKEN } });
+    const save = (body: unknown) =>
+      call(port, '/api/v1/settings/plex', { body, headers: keyed });
+    expect(await save({ ip: 'nowhere', port: 32400, useSsl: false })).toMatchObject({
+      status: 500,
+      body: { message: 'Unable to connect to Plex.' },
+    });
+    // Unsaved, but Seerr's settings hold it until it restarts (probed).
+    expect(
+      (await call(port, '/api/v1/settings/plex', { headers: keyed })).body,
+    ).toMatchObject({ ip: 'nowhere' });
+    expect(await save({ ip: 'plex', port: 32400, useSsl: false })).toMatchObject({
+      status: 200,
+      body: { ip: 'plex', machineId: 'fake-machine-identifier-0001', name: 'Mediaplane' },
+    });
+    expect(seerr.seerr.errors).toEqual(['Something went wrong testing Plex connection']);
+  });
+
+  it("syncs Plex's libraries, keeping what is enabled, and enables them one at a time", async () => {
+    const { port, seerr } = await plexStack();
+    await call(port, '/api/v1/auth/plex', { body: { authToken: TOKEN } });
+    const sync = () =>
+      call(port, '/api/v1/settings/plex/library/sync', {
+        method: 'POST',
+        headers: keyed,
+      });
+    // Not set yet: Seerr can't reach Plex.
+    expect((await sync()).status).toBe(500);
+    await call(port, '/api/v1/settings/plex', {
+      body: { ip: 'plex', port: 32400, useSsl: false },
+      headers: keyed,
+    });
+    expect((await sync()).body).toEqual([
+      { id: '1', name: 'Movies', enabled: false, type: 'movie' },
+      { id: '2', name: 'TV Shows', enabled: false, type: 'show' },
+    ]);
+    expect(
+      await call(port, '/api/v1/settings/plex/library/2', {
+        method: 'PUT',
+        body: { enabled: true },
+        headers: keyed,
+      }),
+    ).toMatchObject({ status: 200, body: { id: '2', enabled: true } });
+    expect((await sync()).body).toContainEqual({
+      id: '2',
+      name: 'TV Shows',
+      enabled: true,
+      type: 'show',
+    });
+    expect(seerr.seerr.plex.libraries).toHaveLength(2);
+  });
+
+  it('is set up by a plex.tv claimant who signs in first', async () => {
+    const { port, seerr } = await plexStack();
+    seerr.seerr.plexClaimant = { plexId: SOMEONE.id, token: SOMEONE.token };
+    expect(
+      (await call(port, '/api/v1/auth/plex', { body: { authToken: TOKEN } })).status,
+    ).toBe(403);
+    expect(seerr.seerr.plexUsers).toEqual([SOMEONE.id]);
+  });
+});
```

**Change** `scripts/docs/catalog-facts.test.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.test.ts b/scripts/docs/catalog-facts.test.ts
index ec9035a..e0b00c1 100644
--- a/scripts/docs/catalog-facts.test.ts
+++ b/scripts/docs/catalog-facts.test.ts
@@ -70,9 +70,2 @@ describe('renderFacts', () => {
 
-  it('says an API an app does not have yet with Plex is none there, until its slice', () => {
-    expect(renderFacts(app('seerr'))).toContain(
-      "- **API:** on its `web` port, which Mediaplane reaches over the stack's wiring network, with `apiKey` in the `X-Api-Key` header; with Plex, none until Slice 7\n",
-    );
-    expect(renderFacts(app('sonarr'))).not.toContain('with Plex');
-  });
-
   it('lists what Mediaplane manages in an app, by override key', () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run catalog/catalog.test.ts catalog/render.test.ts catalog/seerr/bootstrap.test.ts catalog/seerr/integration.test.ts packages/cli/src/credentials.test.ts packages/cli/src/run.test.ts packages/engine/src/credentials.test.ts packages/engine/src/resolver/resolve.test.ts packages/engine/src/testing/seerr.test.ts scripts/docs/catalog-facts.test.ts`
Expected: FAIL. `catalog/seerr/integration.test.ts` doesn't load (`Seerr has no resource media_server_plex`), and 21 tests fail in 7 more files, 388 pass: Seerr's Plex sign-in in `bootstrap.test.ts` (`can't be set up: the stack runs no Jellyfin for it to sign in through`), the fake Seerr's Plex endpoints in `seerr.test.ts` (`expected { status: 401, … } to match object { status: 500, … }`), the logins in `catalog.test.ts`, `render.test.ts` and both `credentials.test.ts`, and `run.test.ts`'s Seerr on a Plex stack.

- [ ] **Step 3: Write Seerr's Plex sign-in and link, the logins and the web path**

**Change** `catalog/plex/app.ts`:

```diff
diff --git a/catalog/plex/app.ts b/catalog/plex/app.ts
index d9edd46..04f2d54 100644
--- a/catalog/plex/app.ts
+++ b/catalog/plex/app.ts
@@ -62,3 +62,5 @@ export default defineApp({
   env: () => ({ VERSION: 'docker' }),
-  login: { comingIn: 'Slice 7' },
+  // Your own plex.tv account: never the shared admin (spec §6.1).
+  login: { own: 'Plex' },
+  webPath: '/web',
   experimental: false,
```

**Change** `catalog/seerr/app.ts`:

```diff
diff --git a/catalog/seerr/app.ts b/catalog/seerr/app.ts
index 7e542f3..6fb5747 100644
--- a/catalog/seerr/app.ts
+++ b/catalog/seerr/app.ts
@@ -42,5 +42,2 @@ export default defineApp({
   bootstrap: seerrBootstrap,
-  // With Plex, it signs in with your Plex account, which comes in Slice 7.
-  notWiredYet: (config) =>
-    config.media_server === 'jellyfin' ? undefined : { comingIn: 'Slice 7' },
   integration,
@@ -64,3 +61,4 @@ export default defineApp({
   extras: () => ({ init: true }),
-  login: 'shared',
+  // Through the media server: the shared admin is Jellyfin's; with Plex, your account.
+  login: (config) => (config.media_server === 'plex' ? { own: 'Plex' } : 'shared'),
   experimental: false,
```

**Change** `catalog/seerr/bootstrap.ts`:

```diff
diff --git a/catalog/seerr/bootstrap.ts b/catalog/seerr/bootstrap.ts
index e7e619a..05ab216 100644
--- a/catalog/seerr/bootstrap.ts
+++ b/catalog/seerr/bootstrap.ts
@@ -2,2 +2,3 @@ import {
   AppApiError,
+  PlexTvError,
   SetupWaiting,
@@ -7,2 +8,3 @@ import {
   type Bootstrap,
+  type BootstrapContext,
   type ResolvedStack,
@@ -11,2 +13,3 @@ import { z } from 'zod';
 import { atStackJellyfin, jellyfinSettings } from './jellyfin';
+import { atStackPlex, plexSettings } from './plex';
 
@@ -19,4 +22,11 @@ const SIGN_IN = '/api/v1/auth/jellyfin';
 
+/** The sign-in with a plex.tv account: on a Plex stack, Seerr's first one sets it up. */
+const PLEX_SIGN_IN = '/api/v1/auth/plex';
+
 const publicSettings = z.looseObject({ mediaServerType: z.number() });
-const me = z.looseObject({ jellyfinUsername: z.string().nullable().optional() });
+const me = z.looseObject({
+  jellyfinUsername: z.string().nullable().optional(),
+  plexId: z.number().nullable().optional(),
+  plexToken: z.string().nullable().optional(),
+});
 
@@ -86,7 +96,123 @@ async function ownSetup(
 /**
- * What to do about a Seerr set up with a login Mediaplane can't show is its own: make
- * that login the shared admin's, or the shared admin Seerr's admin, at the stack's
- * Jellyfin; and only last, start Seerr afresh.
+ * Refuse (`auth`) a Seerr on a Plex stack that is set up but not Mediaplane's: its admin
+ * (its first user) isn't your plex.tv account, or its Plex is set and isn't the stack's,
+ * without TLS. Your account is plex.tv's answer to your token, and Seerr's admin is the
+ * plex.tv account it signed in with, which only that account's token can make it: neither
+ * is an answer Seerr's admin can shape. It is asked with Seerr's key, never by signing in,
+ * which would hand your token to that Seerr. A question that goes unanswered (a timeout,
+ * a 5xx, no connection), Seerr's or plex.tv's, is refused as `unsure`; another answer that
+ * doesn't show Seerr is Mediaplane's, as not its own.
+ */
+async function ownPlexSetup(
+  api: AppApi,
+  ctx: BootstrapContext,
+  token: string,
+  plex: { host: string; port: number },
+): Promise<void> {
+  let held: z.infer<typeof me>;
+  let settings: z.infer<typeof plexSettings>;
+  let account: number;
+  try {
+    held = await api.get('/api/v1/auth/me', me);
+    settings = await api.get('/api/v1/settings/plex', plexSettings);
+    if (typeof held.plexToken === 'string') api.addSecret(held.plexToken);
+    account = await ctx.plexTv.accountId(token);
+  } catch (cause) {
+    if (cause instanceof PlexTvError) {
+      throw new AppApiError(
+        `${api.name} at ${api.where} is set up, and Mediaplane couldn't tell whether it is its own: ${cause.message}`,
+        cause.unsure ? { kind: 'auth', unsure: true } : { kind: 'rejected' },
+      );
+    }
+    if (!(cause instanceof AppApiError) || cause.kind === 'auth') throw cause;
+    if (UNANSWERED.has(cause.kind)) {
+      throw new AppApiError(
+        `${api.name} at ${api.where} is set up, and Mediaplane couldn't tell whether it is its own: ${cause.message}`,
+        { kind: 'auth', unsure: true },
+      );
+    }
+    throw new AppApiError(
+      `${api.name} at ${api.where} is set up, and its answers don't show that it is Mediaplane's: ${cause.message}`,
+      { kind: 'auth' },
+    );
+  }
+  // Mediaplane's own sign-in leaves Seerr's Plex unset: its wire step sets it.
+  const atPlex = settings.ip === '' || atStackPlex(settings, plex);
+  if (held.plexId !== account || !atPlex) {
+    throw new AppApiError(
+      `${api.name} at ${api.where} was set up with another plex.tv account or another Plex (GET /api/v1/auth/me, GET /api/v1/settings/plex)`,
+      { kind: 'auth' },
+    );
+  }
+}
+
+/**
+ * Seerr's first-run setup on a Plex stack (spec §6.1): its first sign-in, with your
+ * plex.tv token (`POST /api/v1/auth/plex`), which makes your account Seerr's admin and
+ * Plex its media server type; then signs out. Seerr asks plex.tv whose token it is: one
+ * it can't check (a 500) fails the setup. A Seerr set up already, or found set up once
+ * the sign-in fails, must be Mediaplane's (`ownPlexSetup`).
+ */
+async function runPlex(
+  api: AppApi,
+  stack: ResolvedStack,
+  ctx: BootstrapContext,
+): Promise<void> {
+  const plex = stackAddress(stack, 'plex');
+  const token = ctx.keys.plex?.token;
+  if (plex === undefined || token === undefined) {
+    throw new AppApiError(
+      `${api.name} at ${api.where} can't be set up: the stack runs no Plex, or Mediaplane has no Plex token, for it to sign in with`,
+      { kind: 'rejected' },
+    );
+  }
+  if (!(await openOrSetUp(api))) {
+    await ownPlexSetup(api, ctx, token, plex);
+    return;
+  }
+  let session: AppApi | undefined;
+  try {
+    session = await api.session(PLEX_SIGN_IN, { authToken: token }, 'connect.sid', [
+      token,
+    ]);
+  } catch (cause) {
+    if (!(cause instanceof AppApiError)) throw cause;
+    if (!(await openOrSetUp(api))) {
+      await ownPlexSetup(api, ctx, token, plex);
+      return;
+    }
+    if (cause.status === 500) {
+      throw new AppApiError(
+        `${api.name} at ${api.where} couldn't sign in with your Plex token, which it checks at plex.tv: ${cause.message}. Check that Seerr reaches plex.tv, then run apply again`,
+        { kind: 'rejected' },
+      );
+    }
+    throw cause;
+  }
+  if (session === undefined) {
+    throw new AppApiError(
+      `${api.name} at ${api.where} refused the sign-in with your Plex token (POST ${PLEX_SIGN_IN})`,
+      { kind: 'rejected' },
+    );
+  }
+  try {
+    await session.submit('POST', '/api/v1/auth/logout');
+  } catch (cause) {
+    if (!(cause instanceof AppApiError)) throw cause;
+  }
+}
+
+/**
+ * What to do about a Seerr set up with a login Mediaplane can't show is its own: on a
+ * Jellyfin stack, make that login the shared admin's, or the shared admin Seerr's admin,
+ * at the stack's Jellyfin; on a Plex stack, sign in to Plex as the account it was set up
+ * with. Only last, start Seerr afresh.
  */
 function claimedHint(stack: ResolvedStack): string {
+  if (stack.config.media_server === 'plex') {
+    const plex = stackAddress(stack, 'plex');
+    const at =
+      plex === undefined ? "the stack's Plex" : `${plex.host}:${String(plex.port)}`;
+    return `First: if the plex.tv account it was set up with is yours, run "mediaplane plex-login" and sign in as it, with its Plex unset or at ${at}, with no TLS; then run apply again. Last, if you did not set it up: start it afresh, as the runbook says`;
+  }
   const jellyfin = stackAddress(stack, 'jellyfin');
@@ -132,3 +258,7 @@ export const seerrBootstrap: Bootstrap = {
   claimedHint,
-  async run(api, admin, stack) {
+  async run(api, admin, stack, ctx) {
+    if (stack.config.media_server === 'plex') {
+      await runPlex(api, stack, ctx);
+      return undefined;
+    }
     const jellyfin = stackAddress(stack, 'jellyfin');
```

**Change** `catalog/seerr/integration.ts`:

```diff
diff --git a/catalog/seerr/integration.ts b/catalog/seerr/integration.ts
index 16a41b8..0f875e8 100644
--- a/catalog/seerr/integration.ts
+++ b/catalog/seerr/integration.ts
@@ -12,2 +12,3 @@ import { secretOf } from '../_shared/secret';
 import { LIBRARIES } from '../jellyfin/integration';
+import { LIBRARIES as PLEX_LIBRARIES } from '../plex/integration';
 import { ROOT_FOLDER as MOVIES } from '../radarr/integration';
@@ -15,2 +16,3 @@ import { ROOT_FOLDER as TV } from '../sonarr/integration';
 import { heldHost, jellyfinSettings as heldJellyfin } from './jellyfin';
+import { heldPlexHost, plexSettings as heldPlex } from './plex';
 
@@ -21,2 +23,5 @@ const WANTED = LIBRARIES.map((library) => library.name);
 
+/** The Plex libraries Seerr has enabled: those Mediaplane makes, by name, in order. */
+const WANTED_PLEX = PLEX_LIBRARIES.map((library) => library.name);
+
 /**
@@ -44,7 +49,10 @@ const jellyfinSettings = heldJellyfin.extend({ libraries: z.array(library) });
 
-/** Which of Mediaplane's libraries Seerr has enabled, as one list: the managed field. */
-function enabledOf(libraries: readonly z.infer<typeof library>[]): string {
-  return WANTED.filter((name) =>
-    libraries.some((held) => held.name === name && held.enabled),
-  ).join(',');
+/** Which of Mediaplane's libraries (`wanted`) Seerr has enabled, as one list. */
+function enabledOf(
+  libraries: readonly z.infer<typeof library>[],
+  wanted: readonly string[] = WANTED,
+): string {
+  return wanted
+    .filter((name) => libraries.some((held) => held.name === name && held.enabled))
+    .join(',');
 }
@@ -83,10 +91,19 @@ async function saveJellyfin(api: AppApi, desired: DesiredResource): Promise<void
 /**
- * Enable Mediaplane's libraries in Seerr: Seerr learns Jellyfin's libraries by syncing
- * them, which keeps those it has enabled, and enables them one at a time. One it finds
- * no library of the name is refused: the Jellyfin library may have been renamed.
+ * Enable Mediaplane's libraries in Seerr, of Jellyfin or of Plex: Seerr learns the media
+ * server's libraries by syncing them, which keeps those it has enabled, and enables them
+ * one at a time. One it finds no library of the name is refused: the library may have
+ * been renamed in the media server.
  */
-async function enableLibraries(api: AppApi): Promise<void> {
-  await api.submit('POST', `${SETTINGS}/jellyfin/library/sync`);
-  const synced = await api.get(`${SETTINGS}/jellyfin/library`, z.array(library));
-  for (const name of WANTED) {
+async function enableLibraries(
+  api: AppApi,
+  server: { path: 'jellyfin' | 'plex'; name: string; wanted: readonly string[] } = {
+    path: 'jellyfin',
+    name: 'Jellyfin',
+    wanted: WANTED,
+  },
+): Promise<void> {
+  const at = `${SETTINGS}/${server.path}/library`;
+  await api.submit('POST', `${at}/sync`);
+  const synced = await api.get(at, z.array(library));
+  for (const name of server.wanted) {
     const held = synced.find((l) => l.name === name);
@@ -94,3 +111,3 @@ async function enableLibraries(api: AppApi): Promise<void> {
       throw new AppApiError(
-        `${api.name} at ${api.where} finds no Jellyfin library named ${name} (POST ${SETTINGS}/jellyfin/library/sync)`,
+        `${api.name} at ${api.where} finds no ${server.name} library named ${name} (POST ${at}/sync)`,
         { kind: 'rejected' },
@@ -99,5 +116,3 @@ async function enableLibraries(api: AppApi): Promise<void> {
     if (!held.enabled) {
-      await api.put(`${SETTINGS}/jellyfin/library/${encodeURIComponent(held.id)}`, {
-        enabled: true,
-      });
+      await api.put(`${at}/${encodeURIComponent(held.id)}`, { enabled: true });
     }
@@ -165,2 +180,74 @@ const mediaServer: ResourceSpec = {
 
+const PLEX = { path: 'plex', name: 'Plex', wanted: WANTED_PLEX } as const;
+
+const plexSettings = heldPlex.extend({ libraries: z.array(library) });
+
+/**
+ * Point Seerr at the stack's Plex, without TLS: Seerr saves it only once it has reached
+ * Plex there with its admin's token (your plex.tv account's, from its first sign-in), and
+ * asked it who it is. No key goes in these settings: Seerr holds none of Mediaplane's.
+ */
+async function savePlex(api: AppApi, desired: DesiredResource): Promise<void> {
+  await api.submit('POST', `${SETTINGS}/plex`, {
+    ip: desired.fields.hostname,
+    port: desired.fields.port,
+    useSsl: false,
+  });
+}
+
+/**
+ * Seerr's media server on a Plex stack (spec §6.2): Plex, at its service and container
+ * port, without TLS, and its Movies and TV Shows libraries enabled. Seerr reaches Plex
+ * with the token its admin signed in with, your plex.tv account's, which Mediaplane gives
+ * it in its first sign-in (bootstrap.ts), not in these settings: the link holds no secret
+ * of Mediaplane's, so none is checked here. With TLS, `hostname` is observed as the URL
+ * Seerr calls, so it differs, and the update puts the stack's address back.
+ * - `libraries` lists which of Mediaplane's are enabled; a library you enable is yours.
+ * - It requires Plex's name and libraries, and Seerr comes after Plex.
+ */
+const mediaServerPlex: ResourceSpec = {
+  name: 'media_server_plex',
+  fields: ['hostname', 'port', 'libraries'],
+  secrets: [],
+  requires: ['plex.server', 'plex.library_movies', 'plex.library_tv'],
+  desired: ({ stack }) => {
+    const at = stackAddress(stack, 'plex');
+    if (at === undefined) return undefined;
+    return {
+      name: 'Plex',
+      fields: { hostname: at.host, port: at.port, libraries: WANTED_PLEX.join(',') },
+      secrets: {},
+    };
+  },
+  async observe(api) {
+    const held = await api.get(`${SETTINGS}/plex`, plexSettings);
+    return held.ip === ''
+      ? undefined
+      : {
+          id: null,
+          name: 'Plex',
+          fields: {
+            hostname: heldPlexHost(held),
+            port: held.port,
+            libraries: enabledOf(held.libraries, WANTED_PLEX),
+          },
+        };
+  },
+  async create(api, desired) {
+    await savePlex(api, desired);
+    await enableLibraries(api, PLEX);
+    return { id: null };
+  },
+  async update(api, desired, observed) {
+    const moved =
+      observed.fields.hostname !== desired.fields.hostname ||
+      observed.fields.port !== desired.fields.port;
+    if (moved) await savePlex(api, desired);
+    // Another Plex has other library ids, though the names match: sync them again.
+    if (moved || observed.fields.libraries !== desired.fields.libraries) {
+      await enableLibraries(api, PLEX);
+    }
+  },
+};
+
 /** Seerr's quality profile preferences, when the stack names none (spec §6.2). */
@@ -434,3 +521,8 @@ const setup: ResourceSpec = {
   secrets: [],
-  requires: ['seerr.media_server', 'seerr.server_sonarr', 'seerr.server_radarr'],
+  requires: [
+    'seerr.media_server',
+    'seerr.media_server_plex',
+    'seerr.server_sonarr',
+    'seerr.server_radarr',
+  ],
   desired: () => ({ name: 'setup', fields: { initialized: true }, secrets: {} }),
@@ -451,11 +543,17 @@ const setup: ResourceSpec = {
 /**
- * What Mediaplane wires in Seerr (spec §6.2): Jellyfin as its media server, with its
- * libraries; Sonarr and Radarr, each while the stack runs it; then its setup, finished.
- * Its first sign-in (bootstrap.ts) comes before, and makes its admin. It comes after
- * Jellyfin, Sonarr and Radarr, whose resources its own require, and after Prowlarr, as
- * spec §6.2 orders them.
+ * What Mediaplane wires in Seerr (spec §6.2): its media server, Jellyfin or Plex, with
+ * its libraries; Sonarr and Radarr, each while the stack runs it; then its setup,
+ * finished. Its first sign-in (bootstrap.ts) comes before, and makes its admin. It comes
+ * after the media server, Sonarr and Radarr, whose resources its own require, and after
+ * Prowlarr, as spec §6.2 orders them.
  */
 export default defineIntegration({
-  after: ['jellyfin', 'prowlarr', 'radarr', 'sonarr'],
-  resources: [mediaServer, seerrServer('sonarr'), seerrServer('radarr'), setup],
+  after: ['jellyfin', 'plex', 'prowlarr', 'radarr', 'sonarr'],
+  resources: [
+    mediaServer,
+    mediaServerPlex,
+    seerrServer('sonarr'),
+    seerrServer('radarr'),
+    setup,
+  ],
 });
```

**Create** `catalog/seerr/plex.ts`:

```ts
import { z } from 'zod';

/**
 * Seerr's Plex settings (`GET /api/v1/settings/plex`): where it reaches Plex, which it does
 * with the token its admin signed in with, never a key in these settings.
 */
export const plexSettings = z.looseObject({
  ip: z.string(),
  port: z.number(),
  useSsl: z.boolean(),
});

type Held = z.infer<typeof plexSettings>;

/**
 * Whether Seerr's Plex is the stack's, at `at`: Seerr reaches Plex at
 * `http(s)://<ip>:<port>` (its Plex client), with no URL base, so TLS is another address.
 */
export function atStackPlex(held: Held, at: { host: string; port: number }): boolean {
  return held.ip === at.host && held.port === at.port && !held.useSsl;
}

/**
 * Where Seerr reaches Plex, as one host to compare: its `ip`, or, with TLS, the URL Seerr
 * builds, which is never the stack's service.
 */
export function heldPlexHost(held: Held): string {
  return held.useSsl ? `https://${held.ip}:${String(held.port)}` : held.ip;
}
```

**Change** `packages/cli/src/credentials.ts`:

```diff
diff --git a/packages/cli/src/credentials.ts b/packages/cli/src/credentials.ts
index ce53e9b..7936134 100644
--- a/packages/cli/src/credentials.ts
+++ b/packages/cli/src/credentials.ts
@@ -52,4 +52,5 @@ function where(entry: AppLogin): string {
   const urls = entry.urls.length === 0 ? 'not published' : entry.urls.join(', ');
-  return entry.login === 'shared'
-    ? urls
+  if (entry.login === 'shared') return urls;
+  return entry.login === 'own'
+    ? `${urls}  (sign in with your own ${entry.account} account)`
     : `${urls}  (its login arrives in ${entry.comingIn})`;
```

**Change** `packages/engine/src/catalog/types.ts`:

```diff
diff --git a/packages/engine/src/catalog/types.ts b/packages/engine/src/catalog/types.ts
index ed01499..3b940d6 100644
--- a/packages/engine/src/catalog/types.ts
+++ b/packages/engine/src/catalog/types.ts
@@ -196,2 +196,9 @@ export interface Bootstrap {
 
+/**
+ * How you sign in to an app's web UI: with the shared admin login (`'shared'`), with your
+ * own account of the service it names (`{ own: 'Plex' }`: your plex.tv account), or with a
+ * login a later slice brings.
+ */
+export type AppLoginKind = 'shared' | { own: string } | { comingIn: string };
+
 export interface ServiceExtras {
@@ -227,9 +234,2 @@ export interface AppDefinition<Options = Record<string, unknown>> {
   bootstrap?: Bootstrap;
-  /**
-   * The slice that wires the app in a stack with `config`, while Mediaplane doesn't yet,
-   * else undefined: the resolver then leaves out its `api`, `integration` and
-   * `bootstrap`, so nothing calls it there, and its `login` says that slice. Seerr with
-   * Plex, until Slice 7.
-   */
-  notWiredYet?(config: StackConfig): { comingIn: string } | undefined;
   /** App-specific settings under apps.<id> in stack.yaml. */
@@ -246,7 +246,12 @@ export interface AppDefinition<Options = Record<string, unknown>> {
   /**
-   * How you sign in to its web UI: 'shared' once the shared admin login works there, or
-   * the slice that brings a login. Every app with a published web UI says, and
-   * `mediaplane credentials` lists them.
+   * How you sign in to its web UI (AppLoginKind), or, when that depends on the stack, how
+   * in a stack with `config`: Seerr signs you in with your Plex account on a Plex stack.
+   * Every app with a published web UI says, and `mediaplane credentials` lists them.
+   */
+  login?: AppLoginKind | ((config: StackConfig) => AppLoginKind);
+  /**
+   * Where its web UI is on its `web` port, when not at "/": Plex's is at "/web".
+   * `mediaplane credentials` gives it in the app's addresses.
    */
-  login?: 'shared' | { comingIn: string };
+  webPath?: string;
   experimental: boolean;
```

**Change** `packages/engine/src/credentials.ts`:

```diff
diff --git a/packages/engine/src/credentials.ts b/packages/engine/src/credentials.ts
index 1b4242b..7327692 100644
--- a/packages/engine/src/credentials.ts
+++ b/packages/engine/src/credentials.ts
@@ -38,5 +38,9 @@ export type AppLogin = {
   name: string;
-  /** Where its web UI is published: one URL per address. */
+  /** Where its web UI is published: one URL per address, with its web path. */
   urls: string[];
-} & ({ login: 'shared' } | { login: 'not-yet'; comingIn: string });
+} & (
+  | { login: 'shared' }
+  | { login: 'own'; account: string }
+  | { login: 'not-yet'; comingIn: string }
+);
 
@@ -107,11 +111,19 @@ function describeRef(ref: SecretRef): string {
 function appLogin(app: ResolvedApp, addresses: readonly string[]): AppLogin[] {
-  const { login, id, name } = app.def;
+  const { id, name } = app.def;
+  const login =
+    typeof app.def.login === 'function'
+      ? app.def.login(app.context.config)
+      : app.def.login;
   if (login === undefined) return [];
   // The web UI only: an app may publish other ports, such as a peer or an API port.
+  const path = app.def.webPath ?? '';
   const urls = app.ports
     .filter((port) => port.name === WEB_PORT)
-    .flatMap((port) => addresses.map((address) => `http://${address}:${port.host}`));
+    .flatMap((port) =>
+      addresses.map((address) => `http://${address}:${String(port.host)}${path}`),
+    );
+  if (login === 'shared') return [{ app: id, name, urls, login: 'shared' }];
   return [
-    login === 'shared'
-      ? { app: id, name, urls, login: 'shared' }
+    'own' in login
+      ? { app: id, name, urls, login: 'own', account: login.own }
       : { app: id, name, urls, login: 'not-yet', comingIn: login.comingIn },
```

**Change** `packages/engine/src/resolver/resolve.ts`:

```diff
diff --git a/packages/engine/src/resolver/resolve.ts b/packages/engine/src/resolver/resolve.ts
index 444ba9d..176c2e8 100644
--- a/packages/engine/src/resolver/resolve.ts
+++ b/packages/engine/src/resolver/resolve.ts
@@ -59,14 +59,2 @@ const DEFAULT_SETTINGS: AppSettings = { enabled: true, env: {} };
 
-/**
- * `def` as a stack with `config` runs it: without its API, integration and first-run
- * setup, and with its login still to come, where Mediaplane doesn't wire it yet
- * (`notWiredYet`).
- */
-function wiredIn(def: AppDefinition, config: StackConfig): AppDefinition {
-  const later = def.notWiredYet?.(config);
-  if (later === undefined) return def;
-  const { api: _api, integration: _integration, bootstrap: _bootstrap, ...rest } = def;
-  return { ...rest, login: later };
-}
-
 /** "download-client:torrent" satisfies "download-client". */
@@ -117,3 +105,3 @@ export function resolveStack(
     return {
-      def: wiredIn(def, config),
+      def,
       settings,
```

**Change** `packages/engine/src/testing/plex.ts`:

```diff
diff --git a/packages/engine/src/testing/plex.ts b/packages/engine/src/testing/plex.ts
index 4891aee..262121e 100644
--- a/packages/engine/src/testing/plex.ts
+++ b/packages/engine/src/testing/plex.ts
@@ -136,3 +136,7 @@ export function claimFakePlex(
 /** Whether the fake Plex takes `token`: its claim's account's, or its own. */
-function plexTakes(plex: FakePlex, token: unknown, plexTv: FakePlexTvState): boolean {
+export function plexTakes(
+  plex: FakePlex,
+  token: unknown,
+  plexTv: FakePlexTvState,
+): boolean {
   const account = plexTv.accounts.find((a) => a.token === token);
```

**Change** `packages/engine/src/testing/seerr.ts`:

```diff
diff --git a/packages/engine/src/testing/seerr.ts b/packages/engine/src/testing/seerr.ts
index 700c3e4..f72dc90 100644
--- a/packages/engine/src/testing/seerr.ts
+++ b/packages/engine/src/testing/seerr.ts
@@ -4,2 +4,4 @@ import type { FakeReply, FakeRequest } from './http';
 import { libraryId, makeApiKey } from './jellyfin';
+import { plexTakes } from './plex';
+import type { FakePlexTvState } from './plextv';
 import { PORTS } from './prowlarr';
@@ -7,3 +9,4 @@ import { freshAppState, type FakeAppState } from './wiring';
 
-/** Seerr's media-server types (its `MediaServerType`): Jellyfin is 2, none yet 4. */
+/** Seerr's media-server types (its `MediaServerType`): Plex 1, Jellyfin 2, none yet 4. */
+export const SEERR_PLEX = 1;
 export const SEERR_JELLYFIN = 2;
@@ -56,2 +59,24 @@ export interface FakeSeerr {
   };
+  /** Its users who signed in through Plex, by plex.tv account id: the first is its admin. */
+  plexUsers: number[];
+  /** The plex.tv token each Plex user last signed in with: what Seerr reaches Plex with. */
+  plexTokens: Record<number, string>;
+  /**
+   * Its Plex: where it is (`http(s)://<ip>:<port>`, no URL base), and its libraries; ip ''
+   * until set. `machineId` and `name` are what Plex said of itself when it was saved.
+   */
+  plex: {
+    ip: string;
+    port: number | string;
+    useSsl: boolean;
+    libraries: FakeSeerrLibrary[];
+    machineId?: string;
+    name?: string;
+    [setting: string]: unknown;
+  };
+  /**
+   * The plex.tv account that signs in first, through Plex, just before the next sign-in
+   * reaches a Seerr nobody has set up. Unset: nobody.
+   */
+  plexClaimant?: { plexId: number; token: string };
   /** Its Sonarr and Radarr servers. */
@@ -126,2 +151,5 @@ export function freshSeerr(): FakeSeerr {
     },
+    plexUsers: [],
+    plexTokens: {},
+    plex: { ip: '', port: 32400, useSsl: false, libraries: [] },
     sonarr: [],
@@ -209,2 +237,3 @@ export function fakeSeerr(
   peek: (service: string) => FakeAppState | undefined,
+  plexTv: FakePlexTvState,
 ): FakeReply {
@@ -217,3 +246,3 @@ export function fakeSeerr(
     ? failed
-    : answer(request, state, peek);
+    : answer(request, state, peek, plexTv);
   keepSettingsJson(seerr, state.key);
@@ -233,2 +262,3 @@ function answer(
   peek: (service: string) => FakeAppState | undefined,
+  plexTv: FakePlexTvState,
 ): FakeReply {
@@ -265,2 +295,10 @@ function answer(
   }
+  if (path === '/api/v1/auth/plex' && method === 'POST') {
+    if (seerr.plexClaimant !== undefined && seerr.plexUsers.length === 0) {
+      seerr.mediaServerType = SEERR_PLEX;
+      seerr.plexUsers = [seerr.plexClaimant.plexId];
+      seerr.plexTokens[seerr.plexClaimant.plexId] = seerr.plexClaimant.token;
+    }
+    return plexSignIn(body(), seerr, plexTv);
+  }
   const cookie = sessionCookie(request.headers.cookie);
@@ -275,3 +313,3 @@ function answer(
     (state.key === '' || request.headers['x-api-key'] === state.key) &&
-    seerr.users.length > 0;
+    (seerr.users.length > 0 || seerr.plexUsers.length > 0);
   if (!keyed && (cookie === undefined || !seerr.sessions.includes(cookie))) {
@@ -280,5 +318,13 @@ function answer(
   if (path === '/api/v1/auth/me' && method === 'GET') {
+    const plexId = seerr.plexUsers[0];
     return {
       status: 200,
-      body: { id: 1, jellyfinUsername: seerr.users[0], permissions: 2 },
+      body: {
+        id: 1,
+        jellyfinUsername: seerr.users[0] ?? null,
+        plexId: plexId ?? null,
+        plexUsername: plexId === undefined ? null : 'fake-user',
+        email: 'user@example.com',
+        permissions: 2,
+      },
     };
@@ -291,2 +337,3 @@ function answer(
     fakeSeerrJellyfin(request, path, body, seerr, peek('jellyfin')) ??
+    fakeSeerrPlex(request, path, body, seerr, peek('plex'), plexTv) ??
     fakeSeerrServers(request, path, body, seerr, peek) ?? { status: 404 }
@@ -295,2 +342,127 @@ function answer(
 
+/**
+ * `POST /api/v1/auth/plex` (Seerr 3.5's code, probed): Seerr asks plex.tv whose `authToken`
+ * it is. A token plex.tv refuses is a 500, "Unable to authenticate."; with no user yet,
+ * its account becomes Seerr's admin, and Plex its media server; after that, only that
+ * account signs in (anyone else is a 403 here: the fake knows no one else with access to
+ * Seerr's Plex). Each sign-in keeps the token, which is what Seerr reaches Plex with.
+ */
+function plexSignIn(
+  sent: Record<string, unknown>,
+  seerr: FakeSeerr,
+  plexTv: FakePlexTvState,
+): FakeReply {
+  if (typeof sent.authToken !== 'string' || sent.authToken === '') {
+    return invalid("body must have required property 'authToken'");
+  }
+  if (
+    seerr.mediaServerType !== SEERR_NOT_CONFIGURED &&
+    seerr.mediaServerType !== SEERR_PLEX
+  ) {
+    return { status: 500, body: { error: 'Plex login is disabled' } };
+  }
+  const account = plexTv.accounts.find((a) => a.token === sent.authToken);
+  if (account === undefined) {
+    seerr.errors.push('Something went wrong authenticating with Plex account');
+    return { status: 500, body: { message: 'Unable to authenticate.' } };
+  }
+  if (seerr.plexUsers.length === 0) {
+    seerr.plexUsers = [account.id];
+    seerr.mediaServerType = SEERR_PLEX;
+  } else if (seerr.plexUsers[0] !== account.id) {
+    return { status: 403, body: { message: 'Access denied.' } };
+  }
+  seerr.plexTokens[account.id] = sent.authToken;
+  seerr.signIns += 1;
+  const session = `s%3Afake-session-${String(seerr.signIns)}.signed`;
+  seerr.sessions.push(session);
+  return {
+    status: 200,
+    body: { id: 1, plexUsername: 'fake-user', permissions: 2, userType: 1 },
+    headers: {
+      'Set-Cookie': `connect.sid=${session}; Path=/; ${EXPIRES}; HttpOnly; SameSite=Lax`,
+    },
+  };
+}
+
+/**
+ * Whether Seerr reaches the stack's Plex at its settings, with its admin's token: its
+ * service, while it runs, at 32400, without TLS (Seerr's Plex has no URL base), and a
+ * token the fake Plex takes.
+ */
+function reachesPlex(
+  seerr: FakeSeerr,
+  plex: FakeAppState | undefined,
+  plexTv: FakePlexTvState,
+): plex is FakeAppState {
+  const admin = seerr.plexUsers[0];
+  return (
+    plex !== undefined &&
+    plex.up &&
+    seerr.plex.ip === 'plex' &&
+    seerr.plex.port === 32400 &&
+    !seerr.plex.useSsl &&
+    admin !== undefined &&
+    plexTakes(plex.plex, seerr.plexTokens[admin], plexTv)
+  );
+}
+
+/**
+ * Seerr's Plex settings and its libraries (Seerr 3.5's code, probed). A save takes what is
+ * sent into Seerr's settings first, then asks Plex, with its admin's token, who it is: one
+ * it can't reach is a 500, "Unable to connect to Plex.", and isn't saved, though Seerr's
+ * settings hold what was sent until it restarts (probed). Libraries are synced from Plex,
+ * keeping what is enabled, and enabled one at a time.
+ */
+function fakeSeerrPlex(
+  request: FakeRequest,
+  path: string,
+  body: () => Record<string, unknown>,
+  seerr: FakeSeerr,
+  plex: FakeAppState | undefined,
+  plexTv: FakePlexTvState,
+): FakeReply | undefined {
+  const { method } = request;
+  const settings = '/api/v1/settings/plex';
+  if (path === settings && method === 'GET') return { status: 200, body: seerr.plex };
+  if (path === settings && method === 'POST') {
+    Object.assign(seerr.plex, body());
+    if (!reachesPlex(seerr, plex, plexTv)) {
+      seerr.errors.push('Something went wrong testing Plex connection');
+      return { status: 500, body: { message: 'Unable to connect to Plex.' } };
+    }
+    seerr.plex.machineId = plex.plex.machineId;
+    seerr.plex.name = plex.plex.friendlyName;
+    return { status: 200, body: seerr.plex };
+  }
+  if (path === `${settings}/library` && method === 'GET') {
+    return { status: 200, body: seerr.plex.libraries };
+  }
+  if (path === `${settings}/library/sync` && method === 'POST') {
+    if (!reachesPlex(seerr, plex, plexTv)) {
+      seerr.errors.push('Something went wrong syncing Plex libraries');
+      return { status: 500, body: { message: 'UNKNOWN' } };
+    }
+    seerr.plex.libraries = plex.plex.sections.map((section) => ({
+      id: section.key,
+      name: section.title,
+      enabled: seerr.plex.libraries.find((l) => l.id === section.key)?.enabled ?? false,
+      type: section.type,
+    }));
+    return { status: 200, body: seerr.plex.libraries };
+  }
+  const library = /^\/api\/v1\/settings\/plex\/library\/([^/]+)$/.exec(path);
+  if (library !== null && method === 'PUT') {
+    const { enabled } = body();
+    if (typeof enabled !== 'boolean') return invalid('body/enabled must be boolean');
+    const held = seerr.plex.libraries.find((l) => l.id === library[1]);
+    if (held === undefined) {
+      return { status: 404, body: { message: 'Library does not exist.' } };
+    }
+    held.enabled = enabled;
+    return { status: 200, body: held };
+  }
+  return undefined;
+}
+
 /** Where Seerr reaches Jellyfin, as its settings or a first sign-in name it. */
```

**Change** `packages/engine/src/testing/wiring.ts`:

```diff
diff --git a/packages/engine/src/testing/wiring.ts b/packages/engine/src/testing/wiring.ts
index a2bc0d6..b2354c8 100644
--- a/packages/engine/src/testing/wiring.ts
+++ b/packages/engine/src/testing/wiring.ts
@@ -398,3 +398,5 @@ export async function fakeStackApis(plexTv: FakePlexTvState = freshPlexTv()): Pr
     if (service === 'jellyfin') return fakeJellyfin(request, state);
-    if (service === 'seerr') return fakeSeerr(request, state, (other) => apps.get(other));
+    if (service === 'seerr') {
+      return fakeSeerr(request, state, (other) => apps.get(other), plexTv);
+    }
     if (service === 'plex') return fakePlex(request, state.plex, plexTv);
```

**Change** `scripts/docs/catalog-facts.ts`:

```diff
diff --git a/scripts/docs/catalog-facts.ts b/scripts/docs/catalog-facts.ts
index 19f62bf..ffe4627 100644
--- a/scripts/docs/catalog-facts.ts
+++ b/scripts/docs/catalog-facts.ts
@@ -3,3 +3,2 @@ import {
   type AppDefinition,
-  parseConfig,
   type SecretSource,
@@ -67,11 +66,2 @@ function health(def: AppDefinition): string {
 
-/** A stack with Plex, whose media server is all `notWiredYet` is asked about. */
-const PLEX_STACK = (() => {
-  const result = parseConfig(
-    'version: 1\npaths: { data: /srv/data }\nmedia_server: plex\nplex: { token: { env: PLEX_TOKEN } }\n',
-  );
-  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join('\n'));
-  return result.config;
-})();
-
 function api(def: AppDefinition): string {
@@ -89,6 +79,3 @@ function api(def: AppDefinition): string {
           : 'in the `X-Api-Key` header';
-  // An app not wired yet with Plex (`notWiredYet`) has no API there, until its slice.
-  const later = def.notWiredYet?.(PLEX_STACK);
-  const unless = later === undefined ? '' : `; with Plex, none until ${later.comingIn}`;
-  return `on its ${code(port)} port, which Mediaplane reaches over the stack's wiring network, with ${code(key.secret)} ${carried}${unless}`;
+  return `on its ${code(port)} port, which Mediaplane reaches over the stack's wiring network, with ${code(key.secret)} ${carried}`;
 }
```

- [ ] **Step 4: Run them to see them pass, and regenerate the facts**

```bash
pnpm vitest run catalog/catalog.test.ts catalog/render.test.ts catalog/seerr/bootstrap.test.ts catalog/seerr/integration.test.ts packages/cli/src/credentials.test.ts packages/cli/src/run.test.ts packages/engine/src/credentials.test.ts packages/engine/src/resolver/resolve.test.ts packages/engine/src/testing/seerr.test.ts scripts/docs/catalog-facts.test.ts
pnpm docs:generate
```

Expected: PASS. `docs:generate` rewrites Seerr's API and what it manages in
`catalog/seerr/README.md`.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add packages catalog scripts
git commit -m "feat: Seerr signed in with your Plex account before it is published, and linked to Plex; logins of your own, and Plex's web path" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1865 tests pass in 88 files.

---

### Task 6: End-to-end: every PR without a token, and the nightly Plex job

Decision: the every-PR test runs Plex against a fake plex.tv, so Plex never claims
itself and must never be published; the deploy test runs `plex-login` from the image
(decision 20).
Decision: the deploy test passes whether plex.tv makes a PIN or can't be reached
(decision 20).
Decision: the nightly job, on `main` only (it checks its branch), with `PLEX_TOKEN`, both architectures, every
derived value masked, and every server it claimed removed whatever happened (decision 21).

**Files:**
- Create: `test/e2e/plex.e2e.test.ts`, `test/e2e/plex-account.ts`,
  `test/e2e/plex-cleanup.ts`, `.github/workflows/plex.yml`
- Modify: `test/e2e/deploy.e2e.test.ts`

**Interfaces:**
- **Consumes:** Tasks 1 to 5; `test/e2e/helpers.ts` (`makeHome`, `getJson`, `jsonBody`,
  `servarrFailure`, `wired`, `api`, `runTeardown`, `composeDown`, `expectWiringRemoved`).
- **Produces:** `test/e2e/plex-account.ts`: `PLEX_TOKEN_FILE`
  (`MEDIAPLANE_E2E_PLEX_TOKEN_FILE`), `plexToken()`, `mask(value)`,
  `noteServer(machineId)`, `notedServers()` (`MEDIAPLANE_E2E_PLEX_SERVERS`),
  `removeServers(token, machineIds)`; the e2e suite of 10 files.

- [ ] **Step 1: Write the end-to-end tests**

**Change** `test/e2e/deploy.e2e.test.ts`:

```diff
diff --git a/test/e2e/deploy.e2e.test.ts b/test/e2e/deploy.e2e.test.ts
index b8d9f31..fa0737d 100644
--- a/test/e2e/deploy.e2e.test.ts
+++ b/test/e2e/deploy.e2e.test.ts
@@ -485,2 +485,50 @@ describe('Mediaplane deployed with mediaplane.compose.yaml', () => {
 
+  it("reaches plex.tv for plex-login through its helper, on Docker's default bridge, through the proxy", async () => {
+    // A home of its own, inside Mediaplane's, with a Plex stack: plex-login reads plex.token.
+    const plexHome = join(home, 'plex-login');
+    await mkdir(plexHome);
+    await writeFile(
+      join(plexHome, 'stack.yaml'),
+      'version: 1\npaths: { data: /srv/data }\nmedia_server: plex\nplex: { token: { file: secrets/plex-token } }\n',
+    );
+    const result = await mediaplane(
+      'plex-login',
+      '--home',
+      plexHome,
+      '--timeout',
+      '4',
+      '--json',
+    );
+    // A real PIN from plex.tv, asked for and waited on by the helper: nobody signs in. A
+    // plex.tv that is down, or too busy, is said so, from inside the helper too: either
+    // way the path through the proxy and the default bridge was taken, and neither fails
+    // a pull request.
+    expect(result.code, result.stderr).toBe(1);
+    const said = (JSON.parse(result.stdout) as { error: { message: string } }).error
+      .message;
+    const waited =
+      'nobody signed in within 4 seconds; run plex-login again for a new link';
+    expect(
+      said === waited || said.startsWith("couldn't reach plex.tv: "),
+      `plex-login said: ${said}`,
+    ).toBe(true);
+    if (said === waited) {
+      expect(result.stderr).toMatch(
+        /https:\/\/app\.plex\.tv\/auth#\?clientID=mediaplane-[0-9a-f-]{36}&code=\w{25}&/,
+      );
+    }
+    expect(JSON.parse(result.stdout)).toMatchObject({
+      schema: 'mediaplane.error/v1',
+      ok: false,
+    });
+    // Each helper ran, and is gone: none is left, by its label.
+    const left = await nodeExec(
+      'docker',
+      ['ps', '--all', '--quiet', '--filter', 'label=io.mediaplane.helper=plex-tv'],
+      { cwd: '/' },
+    );
+    expect(left.stdout.trim()).toBe('');
+    await rm(plexHome, { recursive: true });
+  });
+
   it('refuses the Docker calls the engine never makes', async () => {
```

**Create** `test/e2e/plex.e2e.test.ts`:

```ts
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeExec,
  nodeProbe,
  plan,
  plexTvClient,
  readSecretStore,
  type ApplyOptions,
  type ApplyResult,
  type PlexTv,
  type Runtime,
} from '@mediaplane/engine';
import { FAKE_PLEX_ACCOUNT, fakePlexTv } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import {
  api,
  composeDown,
  expectWiringRemoved,
  getJson,
  jsonBody,
  makeHome,
  runTeardown,
  servarrFailure,
  wired,
} from './helpers';
import {
  mask,
  noteServer,
  notedServers,
  PLEX_TOKEN_FILE,
  plexToken,
  removeServers,
} from './plex-account';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-plex`;
/** Plex's web UI, on 127.0.0.1 once it is published. */
const PLEX = 32400;
/** Seerr's, once it is published. */
const SEERR = 5055;
/** Where Plex keeps its claim's token, in its appdata folder. */
const PREFERENCES =
  'appdata/plex/Library/Application Support/Plex Media Server/Preferences.xml';

/** A Plex stack in `home`: Plex named for this run, Sonarr, qBittorrent, and `more`. */
function plexStack(home: string, more = ''): string {
  return `version: 1
user: { uid: ${String(process.getuid?.() ?? 1000)}, gid: ${String(process.getgid?.() ?? 1000)} }
paths: { data: ${join(home, 'data')} }
network: { bind: localhost }
media_server: plex
plex: { token: { file: secrets/plex-token } }
apps:
  plex: { server_name: ${PROJECT} }
  sonarr: {}
  qbittorrent: { vpn: false }
${more}`;
}

/** Your token, saved where plex.token says, as plex-login saves it. */
async function saveToken(home: string, token: string): Promise<void> {
  await mkdir(join(home, 'secrets'), { recursive: true, mode: 0o700 });
  await writeFile(join(home, 'secrets', 'plex-token'), `${token}\n`, { mode: 0o600 });
}

/**
 * Plex's container now: whether its port is published, whether a PLEX_CLAIM is in its
 * environment (yes or no, never its value), and whether it says it is claimed, asked at
 * its address on the wiring network (from source, the host reaches it there).
 */
async function plexState(runtime: Runtime): Promise<string> {
  const container = (await runtime.containers()).find((c) => c.service === 'plex');
  if (container === undefined) return 'no container';
  const env = await nodeExec(
    'docker',
    ['inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', container.id],
    { cwd: '/' },
  );
  const claim = env.stdout.split('\n').some((line) => line.startsWith('PLEX_CLAIM='));
  const address = (await runtime.wiringAddresses([container.id]))[container.id] ?? '';
  const answer = await fetch(`http://${address}:${String(PLEX)}/identity`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  const { MediaContainer } = await jsonBody<{ MediaContainer?: { claimed?: unknown } }>(
    answer,
    "Plex's identity",
  );
  const shown = container.published
    .map((p) => `${p.address}:${String(p.port)}`)
    .join(' ');
  return `ports ${shown === '' ? 'none' : shown}, claim ${claim ? 'given' : 'none'}, ${MediaContainer?.claimed === true ? 'claimed' : 'unclaimed'}`;
}

/** That none of `secrets` is in `text`: a yes/no check, which never prints either. */
function expectNoSecret(what: string, text: string, secrets: readonly string[]): void {
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(text.includes(secret), `${what} holds a secret`).toBe(false);
  }
}

/**
 * What the run wrote: compose.yaml, resources.json and the change records, where no
 * secret may go; or with `env`, generated/.env too, which holds the stack's own keys but
 * never one of Plex's.
 */
async function writtenFiles(home: string, { env = false } = {}): Promise<string> {
  const files = [
    'generated/compose.yaml',
    ...(env ? ['generated/.env'] : []),
    'state/resources.json',
    ...(await readdir(join(home, 'state', 'history'))).map((n) => `state/history/${n}`),
  ];
  const texts = await Promise.all(
    files.map((file) => readFile(join(home, file), 'utf8').catch(() => '')),
  );
  return texts.join('\n');
}

describe('Plex that a claim token from plex.tv can not claim', () => {
  it('is never published, is given its claim token only on its unpublished first start, and the rest waits', async () => {
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
      await writeFile(join(home, 'stack.yaml'), plexStack(home));
      // Every PR runs without a plex.tv account: a fake plex.tv hands out a claim token
      // that the real plex.tv, which Plex's image trades it at, doesn't know.
      const fake = await fakePlexTv();
      await saveToken(home, FAKE_PLEX_ACCOUNT.token);
      const docker = createDockerRuntime({ home, project: PROJECT });
      const seen: string[] = [];
      const runtime: Runtime = {
        ...docker,
        up: async (seconds, values, unpublished = [], startEnv = {}) => {
          const result = await docker.up(seconds, values, unpublished, startEnv);
          seen.push(`after an up: ${await plexState(docker)}`);
          return result;
        },
      };
      const options: ApplyOptions = {
        home,
        catalog,
        host: detectHostFacts(),
        env: process.env,
        runtime,
        probe: nodeProbe,
        project: PROJECT,
        plexTv: fake.client,
        confirm: () => Promise.resolve(true),
      };

      // plan names Plex's setup, unpublished, and asks plex.tv nothing.
      expect((await plan(options)).bootstrap).toEqual([
        { app: 'plex', unpublished: true },
      ]);
      expect(fake.state.calls).toEqual([]);

      const first = await apply(options);
      expect(first.outcome).toBe('failed');
      expect(fake.state.claims.map((c) => c.account)).toEqual([FAKE_PLEX_ACCOUNT.id]);
      // Unpublished from its first start, and again in the publishing up: its setup is
      // still open, and its container keeps its claim token, so it isn't recreated.
      expect(seen).toEqual([
        'after an up: ports none, claim given, unclaimed',
        'after an up: ports none, claim given, unclaimed',
      ]);
      const failed = first.diagnostics.find((d) => d.code === 'apply.bootstrap-failed');
      expect(failed?.message).toContain(
        "didn't claim itself as it started, so it stays unpublished",
      );
      expect(first.actions.find((a) => a.step === 'wire')?.result).toBe('skipped');
      // The claim token is in Compose's environment only: no file, record or result.
      const claim = fake.state.claims[0]?.token ?? '';
      expectNoSecret('what apply wrote', await writtenFiles(home, { env: true }), [
        claim,
        FAKE_PLEX_ACCOUNT.token,
      ]);
      expectNoSecret("apply's result", JSON.stringify(first), [
        claim,
        FAKE_PLEX_ACCOUNT.token,
      ]);
      expect((await readSecretStore(home)).setUp).toBeUndefined();
    } catch (failure) {
      await removeAll().catch((also: unknown) => {
        console.error('teardown failed too:', also);
      });
      throw failure;
    }
    await removeAll();
  }, 900_000);
});

/**
 * What Plex's Preferences.xml in `home` holds: its machine identifier, and its own token,
 * once its claim gave it one; '' for either it doesn't hold yet.
 */
async function preferencesIn(
  home: string,
): Promise<{ machineId: string; serverToken: string }> {
  const prefs = await readFile(join(home, PREFERENCES), 'utf8').catch(() => '');
  return {
    machineId: /\sProcessedMachineIdentifier="([^"]+)"/.exec(prefs)?.[1] ?? '',
    serverToken: /\sPlexOnlineToken="([^"]+)"/.exec(prefs)?.[1] ?? '',
  };
}

/**
 * `client`, hiding each claim token it gets, which it keeps in `claims`, and, each time
 * it is asked whose a token is, as Plex's setup asks once Plex is claimed, noting Plex's
 * server in `home` for the cleanup and hiding Plex's own token.
 */
function noting(client: PlexTv, claims: string[], home: string): PlexTv {
  return {
    ...client,
    claimToken: async (token) => {
      const claim = await client.claimToken(token);
      mask(claim);
      claims.push(claim);
      return claim;
    },
    accountId: async (token) => {
      const { machineId, serverToken } = await preferencesIn(home);
      mask(serverToken);
      if (machineId !== '') await noteServer(machineId);
      return client.accountId(token);
    },
  };
}

interface Connection {
  id: number;
  name: string;
  implementation: string;
  fields: { name: string; value?: unknown }[];
}

interface Section {
  title: string;
  type: string;
  Location?: { path: string }[];
}

describe.skipIf(PLEX_TOKEN_FILE === undefined)(
  'Plex, claimed for the plex.tv test account (the nightly job)',
  () => {
    it('is claimed before it is published, named, given its libraries, and the arrs and Seerr linked to it', async () => {
      const token = await plexToken();
      const home = await makeHome();
      const machineIds: string[] = [];
      const removeAll = () =>
        runTeardown([
          async () => {
            const down = await composeDown(PROJECT);
            expect(down.code, down.stderr).toBe(0);
          },
          () => expectWiringRemoved(PROJECT),
          async () => {
            // Even when the run failed: an offline server left on the account would stay.
            const { machineId } = await preferencesIn(home);
            const ids = [
              ...new Set([...machineIds, machineId, ...(await notedServers())]),
            ].filter((id) => id !== '');
            await removeServers(token, ids);
          },
        ]);
      try {
        await writeFile(
          join(home, 'stack.yaml'),
          plexStack(home, '  radarr: {}\n  seerr: {}\n'),
        );
        await saveToken(home, token);
        const claims: string[] = [];
        const plexTv = noting(plexTvClient(), claims, home);
        const options: ApplyOptions = {
          home,
          catalog,
          host: detectHostFacts(),
          env: process.env,
          runtime: createDockerRuntime({ home, project: PROJECT }),
          probe: nodeProbe,
          project: PROJECT,
          plexTv,
          confirm: () => Promise.resolve(true),
        };
        expect((await plan(options)).bootstrap).toEqual([
          { app: 'plex', unpublished: true },
          { app: 'seerr', unpublished: true },
        ]);
        const first = await apply(options);
        // Plex's own token, which its claim gave it: hidden, and kept out of everything.
        const { machineId, serverToken } = await preferencesIn(home);
        mask(serverToken);
        machineIds.push(machineId);
        expect(first.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(first.outcome).toBe('success');
        expect(first.actions.find((a) => a.step === 'bootstrap')?.detail).toBe(
          'set up plex, seerr; published plex, seerr',
        );
        expect(serverToken !== '', 'Plex holds a token from its claim').toBe(true);
        // Whose plex.tv says Plex's own token is: the account's. Ids, never tokens, are
        // compared, and only a yes or no is shown.
        const owner = await plexTv.accountId(serverToken);
        expect(owner === (await plexTv.accountId(token)), "Plex is the account's").toBe(
          true,
        );

        // Published, claimed, named, and its libraries made.
        const identity = await getJson<{ MediaContainer: { claimed: boolean } }>(
          PLEX,
          '/identity',
          { Accept: 'application/json' },
        );
        expect(identity.MediaContainer.claimed).toBe(true);
        const plexHeaders = { Accept: 'application/json', 'X-Plex-Token': token };
        const root = await getJson<{ MediaContainer: { friendlyName: string } }>(
          PLEX,
          '/',
          plexHeaders,
        );
        expect(root.MediaContainer.friendlyName).toBe(PROJECT);
        const sections = await getJson<{ MediaContainer: { Directory?: Section[] } }>(
          PLEX,
          '/library/sections',
          plexHeaders,
        );
        expect(
          (sections.MediaContainer.Directory ?? []).map((s) => [
            s.title,
            s.type,
            (s.Location ?? []).map((l) => l.path),
          ]),
        ).toEqual([
          ['Movies', 'movie', ['/data/media/movies']],
          ['TV Shows', 'show', ['/data/media/tv']],
        ]);

        // Each arr tells Plex of its imports, with your token, and its own test passes.
        const store = await readSecretStore(home);
        const secrets = [
          token,
          serverToken,
          ...Object.values(store.apps).flatMap((keys) => Object.values(keys)),
          store.shared?.adminPassword ?? '',
        ];
        for (const arr of [
          { app: 'sonarr', port: 8989 },
          { app: 'radarr', port: 7878 },
        ]) {
          const key = { 'X-Api-Key': store.apps[arr.app]?.apiKey ?? '' };
          const held = (
            await getJson<Connection[]>(arr.port, '/api/v3/notification', key)
          ).find((c) => c.name === 'Plex (Mediaplane)');
          const setting = (name: string) =>
            held?.fields.find((f) => f.name === name)?.value;
          expect([held?.implementation, setting('host'), setting('port')]).toEqual([
            'PlexServer',
            'plex',
            PLEX,
          ]);
          expect(setting('authToken') === '********', `${arr.app} shows it masked`).toBe(
            true,
          );
          const tested = await api(arr.port, '/api/v3/notification/test', key, {
            method: 'POST',
            body: JSON.stringify(held),
            type: 'application/json',
          });
          expect(
            tested.status === 200 ? 'passes' : await servarrFailure(tested, secrets),
            `${arr.app}'s test of it`,
          ).toBe('passes');
        }

        // Seerr: its admin is your account, its Plex the stack's, both libraries enabled.
        const seerrKey = { 'X-Api-Key': store.apps.seerr?.apiKey ?? '' };
        const me = await getJson<{ plexId?: unknown }>(
          SEERR,
          '/api/v1/auth/me',
          seerrKey,
        );
        expect(
          me.plexId === (await plexTv.accountId(token)),
          "Seerr's admin is yours",
        ).toBe(true);
        const seerrPlex = await getJson<{
          ip: string;
          port: number;
          useSsl: boolean;
          libraries: { name: string; enabled: boolean }[];
        }>(SEERR, '/api/v1/settings/plex', seerrKey);
        expect([seerrPlex.ip, seerrPlex.port, seerrPlex.useSsl]).toEqual([
          'plex',
          PLEX,
          false,
        ]);
        expect(seerrPlex.libraries.map((l) => [l.name, l.enabled])).toEqual([
          ['Movies', true],
          ['TV Shows', true],
        ]);
        expect(
          wired(first.actions)
            .slice(-4)
            .map(([resource]) => resource),
        ).toEqual([
          'seerr.media_server_plex',
          'seerr.server_sonarr',
          'seerr.server_radarr',
          'seerr.setup',
        ]);

        expect(claims.length, 'one claim token, for the first start').toBe(1);
        const plexSecrets = [token, serverToken, ...claims];
        expectNoSecret('what apply wrote', await writtenFiles(home), [
          ...secrets,
          ...claims,
        ]);
        expectNoSecret('.env', await writtenFiles(home, { env: true }), plexSecrets);
        expectNoSecret("apply's result", JSON.stringify(first), [...secrets, ...claims]);

        // A second apply changes nothing, and asks plex.tv for no claim token.
        const again: ApplyResult = await apply({
          ...options,
          confirm: () => Promise.reject(new Error('nothing should need confirming')),
        });
        expect(
          again.plan.wiring
            .filter((w) => w.action !== 'unchanged')
            .map((w) => `${w.resource} ${w.action} ${(w.changes ?? []).join(',')}`),
          'wiring changed',
        ).toEqual([]);
        expect(again.outcome).toBe('no-changes');
      } catch (failure) {
        await removeAll().catch((also: unknown) => {
          console.error('teardown failed too:', also);
        });
        throw failure;
      }
      await removeAll();
    }, 1_800_000);
  },
);
```

- [ ] **Step 2: Run the Plex one to see it fail**

Run: `pnpm vitest run --config vitest.e2e.config.ts test/e2e/plex.e2e.test.ts`
Expected: FAIL. `plex.e2e.test.ts` doesn't load (`Cannot find module './plex-account'`), so no test runs. The deploy test's new `plex-login` test checks Task 2's command through the image; it has no RED of its own, since Task 2 built it.

- [ ] **Step 3: Write the test account's helpers, the cleanup and the nightly job**

**Create** `.github/workflows/plex.yml`:

```yaml
name: Plex (nightly)

# Plex can't be signed in from a pull request's CI: this job claims a real Plex with a
# plex.tv test account's token, kept as the PLEX_TOKEN secret (spec §8.1). It runs on main,
# on a schedule or by hand, by a maintainer, never for a pull request, so a fork's pull
# request never sees the secret. Without the secret it does nothing.
on:
  schedule:
    - cron: '23 3 * * *'
  workflow_dispatch:

permissions:
  contents: read

# One run at a time, never cancelled: a cancelled run could skip its cleanup. Its two jobs
# run side by side, each with a server of its own.
concurrency:
  group: plex-nightly
  cancel-in-progress: false

jobs:
  plex:
    name: Plex end to end (${{ matrix.arch }})
    # This repository's main only: a dispatch runs the chosen branch's copy of this file,
    # so the job checks the branch too. Only a maintainer can dispatch it.
    if: github.repository == 'cyclopsgd/Mediaplane' && github.ref == 'refs/heads/main'
    strategy:
      fail-fast: false
      matrix:
        include:
          - arch: amd64
            runner: ubuntu-24.04
          - arch: arm64
            runner: ubuntu-24.04-arm
    runs-on: ${{ matrix.runner }}
    timeout-minutes: 45
    # The secret is in the environment of the two steps that read it, and no other: not
    # of the install, whose packages' scripts run with the job's environment.
    steps:
      - name: Is there a plex.tv token?
        id: token
        env:
          PLEX_TOKEN: ${{ secrets.PLEX_TOKEN }}
        run: |
          if [ -z "$PLEX_TOKEN" ]; then
            echo "No PLEX_TOKEN secret, so there is nothing to test."
            echo "present=false" >> "$GITHUB_OUTPUT"
          else
            echo "present=true" >> "$GITHUB_OUTPUT"
          fi
      - if: steps.token.outputs.present == 'true'
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - if: steps.token.outputs.present == 'true'
        uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - if: steps.token.outputs.present == 'true'
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - if: steps.token.outputs.present == 'true'
        run: pnpm install --frozen-lockfile
      # The token goes to a file only this job can read, never onto a command line. The
      # test hides each value it makes from it (a claim token, Plex's own token) with
      # ::add-mask::, as GitHub hides only the secret itself.
      - name: Save the token for the test
        if: steps.token.outputs.present == 'true'
        env:
          PLEX_TOKEN: ${{ secrets.PLEX_TOKEN }}
        run: |
          umask 077
          dir="$(mktemp -d -p "$RUNNER_TEMP")"
          printf '%s\n' "$PLEX_TOKEN" > "$dir/token"
          echo "MEDIAPLANE_E2E_PLEX_TOKEN_FILE=$dir/token" >> "$GITHUB_ENV"
          echo "MEDIAPLANE_E2E_PLEX_SERVERS=$dir/servers" >> "$GITHUB_ENV"
      - name: Claim, wire and check a Plex stack
        if: steps.token.outputs.present == 'true'
        run: pnpm vitest run --config vitest.e2e.config.ts test/e2e/plex.e2e.test.ts
      # Even when the test failed, or was cancelled: every run claims a new server, and
      # one left on the account stays there, offline.
      - name: Remove the servers this run claimed from the test account
        if: always() && steps.token.outputs.present == 'true'
        run: pnpm exec tsx test/e2e/plex-cleanup.ts
```

**Create** `test/e2e/plex-account.ts`:

```ts
import { appendFile, readFile } from 'node:fs/promises';

/**
 * The plex.tv test account of the nightly Plex job: its token, in the file that
 * MEDIAPLANE_E2E_PLEX_TOKEN_FILE names (never on a command line, never printed), and a
 * file, MEDIAPLANE_E2E_PLEX_SERVERS, where the job notes each server it claims as soon as
 * it knows it, so that a step after a failed run can still remove them.
 */
export const PLEX_TOKEN_FILE = process.env.MEDIAPLANE_E2E_PLEX_TOKEN_FILE;
const SERVERS_FILE = process.env.MEDIAPLANE_E2E_PLEX_SERVERS;

/** The test account's token, from PLEX_TOKEN_FILE. */
export async function plexToken(): Promise<string> {
  if (PLEX_TOKEN_FILE === undefined) {
    throw new Error('MEDIAPLANE_E2E_PLEX_TOKEN_FILE is not set');
  }
  const token = (await readFile(PLEX_TOKEN_FILE, 'utf8')).trim();
  if (token === '') throw new Error('MEDIAPLANE_E2E_PLEX_TOKEN_FILE holds no token');
  return token;
}

/**
 * Have GitHub Actions hide `value` in the job's log from now on, as it hides the secret
 * itself, which it does not do for a value made from it: a claim token, a server's token.
 * Outside Actions, nothing.
 */
export function mask(value: string): void {
  if (process.env.GITHUB_ACTIONS === 'true' && value !== '') {
    process.stdout.write(`::add-mask::${value}\n`);
  }
}

/** Note a server the run claimed, by its machine identifier, for the cleanup. */
export async function noteServer(machineId: string): Promise<void> {
  if (SERVERS_FILE !== undefined) await appendFile(SERVERS_FILE, `${machineId}\n`);
}

/** The servers noted so far. */
export async function notedServers(): Promise<string[]> {
  if (SERVERS_FILE === undefined) return [];
  try {
    return (await readFile(SERVERS_FILE, 'utf8')).split('\n').filter((id) => id !== '');
  } catch {
    return [];
  }
}

const HEADERS = {
  Accept: 'application/json',
  'X-Plex-Product': 'Mediaplane',
  'X-Plex-Client-Identifier': 'mediaplane-e2e',
};

/**
 * Remove from the account the servers whose machine identifiers are `machineIds`, as
 * plex.tv's own web app does (probed): find each in the account's devices, then
 * `DELETE /devices/<id>.xml`. Removed already is fine. The machine identifiers removed,
 * and those the account didn't list; a refusal throws, with its status only.
 */
export async function removeServers(
  token: string,
  machineIds: readonly string[],
): Promise<{ removed: string[]; absent: string[] }> {
  if (machineIds.length === 0) return { removed: [], absent: [] };
  const listed = await fetch('https://plex.tv/api/v2/devices', {
    headers: { ...HEADERS, 'X-Plex-Token': token },
    signal: AbortSignal.timeout(30_000),
  });
  if (!listed.ok) {
    throw new Error(`plex.tv listed no devices: status ${String(listed.status)}`);
  }
  const devices = (await listed.json()) as {
    id: number;
    clientIdentifier: string;
    provides?: string | null;
    token?: string;
  }[];
  for (const device of devices) mask(device.token ?? '');
  const removed: string[] = [];
  for (const device of devices) {
    const server = (device.provides ?? '').split(',').includes('server');
    if (!server || !machineIds.includes(device.clientIdentifier)) continue;
    const gone = await fetch(`https://plex.tv/devices/${String(device.id)}.xml`, {
      method: 'DELETE',
      headers: { ...HEADERS, 'X-Plex-Token': token },
      signal: AbortSignal.timeout(30_000),
    });
    if (!gone.ok && gone.status !== 404) {
      throw new Error(`plex.tv kept a server: status ${String(gone.status)}`);
    }
    removed.push(device.clientIdentifier);
  }
  return { removed, absent: machineIds.filter((id) => !removed.includes(id)) };
}
```

**Create** `test/e2e/plex-cleanup.ts`:

```ts
// The nightly Plex job's last step, which runs whether or not the tests passed: remove
// from the test account every server the run noted, so that offline servers never pile
// up there. It prints counts only, never a token or a machine identifier.
import { notedServers, PLEX_TOKEN_FILE, plexToken, removeServers } from './plex-account';

if (PLEX_TOKEN_FILE === undefined) {
  console.log('No plex.tv token: nothing to remove.');
} else {
  const noted = await notedServers();
  const { removed, absent } = await removeServers(await plexToken(), noted);
  console.log(
    `Servers noted: ${String(noted.length)}; removed: ${String(removed.length)}; not on the account any more: ${String(absent.length)}.`,
  );
}
```

- [ ] **Step 4: Run them to see them pass, the nightly one too, and nothing left behind**

With nothing else running on Docker:

```bash
pnpm vitest run --config vitest.e2e.config.ts test/e2e/plex.e2e.test.ts test/e2e/deploy.e2e.test.ts
MEDIAPLANE_E2E_PLEX_TOKEN_FILE=<a 0600 file with the test account's token> MEDIAPLANE_E2E_PLEX_SERVERS=<a file for the servers it claims> pnpm vitest run --config vitest.e2e.config.ts test/e2e/plex.e2e.test.ts
docker ps -a --filter name=mediaplane-e2e- --format '{{.Names}}'
docker network ls --filter name=mediaplane-e2e- --format '{{.Name}}'
```

Expected: PASS. Without the token file, the nightly test is skipped; with it, it claims a
Plex for the test account, and removes it from the account as it tears down. The last two
print nothing, and the test account lists no server afterwards.

- [ ] **Step 5: The full check, and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add .github test/e2e
git commit -m "test(e2e): Plex never published while it can't claim itself, plex-login through its helper from the image, and the nightly Plex job" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: 1865 tests pass in 88 files (the e2e files aren't among them).

---

### Task 7: Docs

The §9 set for what Tasks 1 to 6 built (decision 24). Each block below is a hand-written
doc; the generated parts were regenerated in Tasks 2 to 5.

- [ ] **Step 1: See the docs still promise Slice 7**

Run: `grep -rnE "Slice 7|S7 \(Plex\)" README.md catalog/*/README.md deploy/README.md docs/architecture.md docs/security docs/runbooks | grep -vE "including Slice 7\.|and S7 \(Plex\)\.|before Slice 7 published"`
Expected: 20 lines, in the README, Plex's, Seerr's, Sonarr's and Radarr's READMEs, the deploy guide, the architecture, the threat model and the runbook, such as `README.md:516:- **Next:** S7 (Plex).`

- [ ] **Step 2: The runbook**

**Change** `docs/runbooks/wiring-failed.md`:

```diff
diff --git a/docs/runbooks/wiring-failed.md b/docs/runbooks/wiring-failed.md
index 785067b..2af6d9d 100644
--- a/docs/runbooks/wiring-failed.md
+++ b/docs/runbooks/wiring-failed.md
@@ -9,3 +9,6 @@ port is published, and the Movies and Shows libraries, and in Seerr, its first s
 through Jellyfin, before its port is published, its links to Jellyfin, Sonarr and
-Radarr, and its setup, finished. Slice 7 adds Plex.
+Radarr, and its setup, finished. On a Plex stack, Plex is claimed for your plex.tv
+account before its port is published, and gets its name and its Movies and TV Shows
+libraries; Sonarr and Radarr get their connection to Plex, and Seerr signs in with your
+Plex token, before its port is published, and links to Plex.
 
@@ -100,2 +103,16 @@ Radarr, and its setup, finished. Slice 7 adds Plex.
 
+- **`mediaplane apply` stops at the containers step** on a Plex stack, before anything
+  changes, with `Plex's first start needs a claim token from plex.tv, which Mediaplane
+couldn't get, so nothing was started` or `Plex can't be claimed: Mediaplane has no
+Plex token`. Plex starts unpublished, with a claim token of your plex.tv account that
+  `apply` fetches the moment before, and here it had none to give. A Plex that was
+  running is stopped, and the message says so (`Mediaplane stopped plex, which ran, but
+isn't shown to be yours`): its setup isn't done, so it isn't shown to be yours, and it
+  must not stay published, as one an `apply` before Slice 7 published unclaimed would.
+- **`mediaplane apply` stops at the first-run setup step** on a Plex stack, with Plex
+  unpublished: `didn't claim itself as it started`, `is claimed by another plex.tv
+account than yours`, `is claimed, and Mediaplane couldn't tell whether by your plex.tv
+account`, or `lets … in without a sign-in (allowedNetworks)`. Plex is published only
+  once plex.tv says the token its claim gave it is your account's, and it lets no
+  network in without a sign-in.
 - **`apply` stops at the same step** with a setup that reported success. Before
@@ -232,3 +249,11 @@ differ, and a `reason` when it is `unknown`.
      `ls -ld appdata appdata/seerr` show whether the user Mediaplane runs as can read it;
+   - for Plex, `docker port mediaplane-plex-1` likewise, and
+     `grep -c PlexOnlineToken "appdata/plex/Library/Application Support/Plex Media Server/Preferences.xml"`
+     prints `1` once Plex is claimed, `0` before (it counts, and prints no token); Plex's
+     log (check 3) says why a claim failed;
    - `mediaplane history <id>` shows the first-run setup step's result and error.
+6. **Whether your Plex token works:** `mediaplane plex-login` keeps a saved token that
+   plex.tv still takes, and says so, without opening a sign-in. Your plex.tv account's
+   devices (in Plex's web app, Settings, Authorized Devices) list each Plex claimed for
+   it, by the name Mediaplane gives it (`Mediaplane`, or `apps.plex.server_name`).
 
@@ -376,2 +401,98 @@ differ, and a `reason` when it is `unknown`.
   is Mediaplane's.
+- **`Plex can't be claimed: Mediaplane has no Plex token`.** The file `plex.token`
+  points at is missing. Run `mediaplane plex-login`, which signs you in to plex.tv and
+  saves your token there, then run `apply` again. Nothing was started, and a Plex that
+  ran is stopped (see Symptoms).
+- **`needs a claim token from plex.tv, which Mediaplane couldn't get`.** Nothing was
+  started, and a Plex that ran is stopped (see Symptoms); the next `apply` that gets a
+  claim token starts it again, unpublished. What follows the colon says why:
+  - `plex.tv refused the Plex token`: it was revoked (signed out of every device, or
+    the password changed), or it is not one. Run `mediaplane plex-login` to sign in
+    again; it replaces a token plex.tv refuses. Then run `apply` again.
+  - `plex.tv could not be reached`, `plex.tv did not answer within …` or `the plex.tv
+helper did not finish within …`: this host can't reach plex.tv. In the image, the
+    call goes from a short-lived helper on Docker's default `bridge` network: check that
+    containers there reach the internet (a firewall, or `"bridge": "none"` in Docker's
+    `daemon.json`, stops them), then run `apply` again.
+- **`didn't claim itself as it started, so it stays unpublished`.** Plex had its claim
+  token, but didn't trade it at plex.tv while `apply` waited: it couldn't reach plex.tv,
+  or the token, which lasts four minutes, ran out first. Plex's log (check 3) says which.
+  Run `apply` again: it fetches a new claim token, and starts Plex with it, unpublished.
+- **`is claimed, and Mediaplane couldn't tell whether by your plex.tv account`.** plex.tv
+  didn't answer (a timeout, an error of its own, no connection), or asked Mediaplane to
+  wait (HTTP 429). Run `apply` again first: Plex stays unpublished until plex.tv says it
+  is yours.
+- **`is claimed, and its Preferences.xml holds no token of its claim`.** Plex says it is
+  claimed, but its file doesn't hold the token its claim gave it, so nothing can tell
+  whose it is. Run `apply` again; if it says the same, follow the ways out of `is
+claimed by another plex.tv account than yours`, below, the safe ones first.
+- **`is claimed, and Mediaplane can't read appdata/plex/… (…) to tell by whose plex.tv
+account`.** First check who owns `appdata/plex` and the `Preferences.xml` in it
+  (`ls -ln`) against `user:` in `stack.yaml`: Plex writes the file 0600, as `user:`, so
+  Mediaplane must run as that user (in the image, `MEDIAPLANE_UID`). Give the folder
+  back to `user:`, or run Mediaplane as it, then run `apply` again.
+- **`plex.tv's answer doesn't say by whose account`.** plex.tv answered in a shape
+  Mediaplane doesn't understand. Run `apply` again; if it says the same, plex.tv may have
+  changed, and the ways out of `is claimed by another plex.tv account than yours`, below,
+  still apply.
+- **`is yours, but lets … in without a sign-in (allowedNetworks)`.** Plex is yours, but
+  its list of networks allowed without auth isn't empty. Mediaplane never sets it, and
+  anyone who reached Plex while it was unclaimed could have, so Plex stays unpublished,
+  on every `apply` until it is empty. Stop Plex (`docker stop mediaplane-plex-1`), remove
+  the value of `allowedNetworks` from
+  `appdata/plex/Library/Application Support/Plex Media Server/Preferences.xml`, then run
+  `apply`. Mediaplane checks this only before Plex is first published: one you set
+  afterwards, in Plex's settings, is left alone.
+- **`plex.tv refused your Plex token when asked whose it is`.** Run
+  `mediaplane plex-login` to sign in again, then run `apply` again.
+- **`is claimed by another plex.tv account than yours`**, or **`is claimed by no
+plex.tv account of yours`** (`apply.bootstrap-failed`). Plex holds a claim, and
+  plex.tv says the token its claim gave it is another account's, or refuses it (as it
+  does once the server is removed from its account). It stays unpublished, on every
+  `apply` until it is yours. It was claimed
+  before Mediaplane came to it: by someone who reached it while it was unclaimed, or by
+  you, with another account, by hand. Three ways out, the safe ones first:
+  - If that plex.tv account is yours too, run `mediaplane plex-login --force` and sign in
+    as it, then run `apply` again. Plex and everything it holds stay as they are.
+  - Or keep what Plex holds, and claim it for your account: stop it
+    (`docker stop mediaplane-plex-1`), and in
+    `appdata/plex/Library/Application Support/Plex Media Server/Preferences.xml`
+    remove every attribute whose name starts with `PlexOnline` (such as
+    `PlexOnlineToken="…"`), then run `apply`. It starts Plex unpublished with a claim
+    token of yours; Plex keeps its libraries and its machine identifier.
+  - Last, only if you don't need what it holds: stop it, remove `appdata/plex`, and
+    run `apply`. That loses Plex's libraries' metadata and its watch history, but none
+    of your media.
+- **`refused Mediaplane's API key (HTTP 401 or 403)`, for Plex.** Plex's key is your Plex
+  token, and Plex checks it with plex.tv: the token was revoked, or Plex was claimed
+  for another account since. Run `mediaplane plex-login`; if the error stays, see
+  `is claimed by another plex.tv account than yours` above.
+- **`Plex at http://plex:32400 … is still starting (GET /identity)`.** Plex answers
+  before it has started for good, and takes no change until then. Run `apply` again.
+- **`has a library named Movies that holds …, not movie`** (or TV Shows, not show).
+  Plex can't change what a library holds. Rename or remove that library in Plex, and the
+  next `apply` makes `Movies` (or `TV Shows`) again, on the stack's folder.
+- **`AuthToken: Authentication Token is invalid`, for `<arr>.connection_plex`.** The arr's
+  own test of its connection to Plex failed with the token it holds, and with yours:
+  Plex refuses your token too. Run `mediaplane plex-login`, then run `apply` again.
+- **`Host: Unable to connect to Plex Media Server`, for `<arr>.connection_plex`.** Sonarr
+  or Radarr can't reach Plex at `plex:32400`. Check that Plex is healthy
+  (`mediaplane status plex`), and that no override takes either off the stack's network.
+- **`At least one TV library is required`** (Sonarr) **or `At least one Movie library is
+required`** (Radarr), for `<arr>.connection_plex`. The arr's test needs a Plex library
+  of its kind, which `plex.library_tv` (or `library_movies`) makes first: it was removed
+  in Plex meanwhile. Run `apply` again, which makes it.
+- **`couldn't sign in with your Plex token, which it checks at plex.tv`**, for Seerr.
+  Seerr asks plex.tv whose your token is, and couldn't. Check that Seerr reaches the
+  internet (it does from the stack's own network), and that `mediaplane plex-login` keeps
+  your token, then run `apply` again. Seerr stays unpublished until then.
+- **`was set up with another plex.tv account or another Plex`**, for Seerr
+  (`apply.bootstrap-failed`). Seerr was set up already, and its admin (its first user)
+  isn't your plex.tv account, or its Plex isn't `plex:32400` without TLS. Mediaplane
+  asks it with Seerr's key, and never signs in to it, which would hand your token to
+  whoever set it up. Seerr stays unpublished. The safe way out first:
+  - If that plex.tv account is yours, run `mediaplane plex-login --force`, sign in as
+    it, and set Seerr's Plex to `plex`, port 32400, without TLS (or leave it unset),
+    then run `apply` again.
+  - Last, if you did not set Seerr up, start it afresh, as below.
 - **Seerr is set up, but Mediaplane can't show that it is its own**
@@ -611,6 +732,10 @@ Then run `mediaplane apply`. It plans again and does only what is left
   [T16](../security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup).
-- **Let `apply` sign Seerr in,** on a Jellyfin stack: don't finish Seerr's setup page by
-  hand. It goes through Jellyfin's admin, so keep that login the shared one.
-- **Keep `appdata/jellyfin` and `appdata/seerr` readable** by the user Mediaplane runs
-  as, so `plan` can tell whether their setup is open. Seerr's folder belongs to uid
+- **Let `apply` sign Seerr in:** don't finish Seerr's setup page by hand. On a Jellyfin
+  stack it goes through Jellyfin's admin, so keep that login the shared one; on a Plex
+  stack, it signs in with your Plex token.
+- **Let `apply` claim Plex.** Don't claim it by hand, nor give it `PLEX_CLAIM` in
+  `apps.plex.env`: `apply` fetches a claim token as Plex first starts. Run
+  `mediaplane plex-login` once, before the first `apply`.
+- **Keep `appdata/jellyfin`, `appdata/plex` and `appdata/seerr` readable** by the user
+  Mediaplane runs as, so `plan` can tell whether their setup is open. Seerr's folder belongs to uid
   1000, and its files are readable by all, as Seerr writes them. Until Mediaplane can
```

- [ ] **Step 3: The architecture, the threat model and the ADRs**

**Change** `docs/architecture.md`:

````diff
diff --git a/docs/architecture.md b/docs/architecture.md
index 8986e80..604ab93 100644
--- a/docs/architecture.md
+++ b/docs/architecture.md
@@ -3,3 +3,3 @@
 This page is a condensed version of the [M1 design](design/m1-engine-cli.md), §3 to §6,
-covering what is built so far (Slices 1 to 5). The design describes the whole of M1;
+covering what is built so far (Slices 1 to 7). The design describes the whole of M1;
 this page describes what exists.
@@ -15,5 +15,6 @@ You describe the stack you want in one file, `stack.yaml`. Mediaplane then works
   made in qBittorrent, a failure recorded in an app's status of a client, link or
-  connection, a sign-in in Jellyfin's activity log, and a line in Seerr's log for each of
-  its checks that fails (and one in the arr's, for a key the arr refuses). It never runs
-  an app's first-run setup, nor finishes Seerr's. The
+  connection, a sign-in in Jellyfin's activity log, a line in Seerr's log for each of
+  its checks that fails (and one in the arr's, for a key the arr refuses), and an arr
+  listed among Plex's devices, by the arr's first test of its connection to Plex. It
+  never runs an app's first-run setup, nor finishes Seerr's, and never calls plex.tv. The
   [threat model](security/threat-model.md#what-runs-and-who-can-reach-it) says more;
@@ -42,5 +43,10 @@ host (Docker)
 │
-└─ host helper        container
-     throwaway, during init,
-     plan, apply, vpn-check
+├─ host helper        container
+│    throwaway, during init,
+│    plan, apply, vpn-check
+│
+└─ plex.tv helper     container
+     throwaway, one plex.tv
+     call each, on Docker's
+     default bridge network
 ```
@@ -80,5 +86,13 @@ host (Docker)
   - never pulls an image, and is removed when it exits.
+- **The plex.tv helper.** plex.tv is the one outside service Mediaplane calls: for
+  `plex-login`, for Plex's claim token, and to ask whose a Plex or a Seerr is. Each call
+  runs a throwaway container of its own image, `mediaplane plex-tv`, on Docker's default
+  `bridge` network, which has a route out and reaches no other network
+  ([ADR 0012](adr/0012-reach-plex-tv-through-a-short-lived-helper.md)). The request,
+  your token in it, goes on its standard input, and the answer comes back as JSON on its
+  standard output. It has no mount and no capabilities, a read-only root, and never pulls
+  an image.
 - **Running from source** (`pnpm mediaplane`, for development), `MEDIAPLANE_IMAGE` is
-  unset. There is no container and no host helper: the CLI runs under Node on the host,
-  and looks at the host itself. It reaches the apps on the wiring network from the host,
+  unset. There is no container and no helper: the CLI runs under Node on the host, looks
+  at the host itself, and calls plex.tv itself. It reaches the apps on the wiring network from the host,
   which reaches every container on a Docker bridge network. That is checked on Docker
@@ -125,3 +139,5 @@ Each part, and where its code is:
 - **credentials** (`packages/engine/src/credentials.ts`): the shared admin login, and
-  where each app's web UI is.
+  where each app's web UI is, with its web path (Plex's is `/web`).
+- **plex.tv** (`packages/engine/src/plextv`): the client for plex.tv (its PIN sign-in, a
+  claim token, your account, its devices), and the helper that runs it in the image.
 - **http** (`packages/engine/src/http`): the client for the apps' APIs (see
@@ -136,6 +152,3 @@ Each part, and where its code is:
 
-Not built yet:
-
-- Plex, and the links to it (Slice 7); until then, a Plex stack's Seerr isn't wired;
-- drift detection, with Keep mine (Slice 8).
+Not built yet: drift detection, with Keep mine (Slice 8).
 
@@ -309,5 +322,6 @@ Shows and Movies libraries.
 Jellyfin's startup wizard answers whoever reaches it, and whoever finishes it owns the
-server. So does Seerr's setup: until its first sign-in, anyone who reaches it can sign
-in through a Jellyfin of their own, and be its admin. So `apply` publishes neither
-while it is open (see
+server. An unclaimed Plex lets whoever reaches it claim it for their own plex.tv
+account. So does Seerr's setup: until its first sign-in, anyone who reaches it can sign
+in through a Jellyfin or a Plex account of their own, and be its admin. So `apply`
+publishes none of them while it is open (see
 [T16](security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup)
@@ -360,4 +374,25 @@ up --wait again
   `bootstrap.network-via`.
+- **Plex** (spec §6.4). Its first start gets `PLEX_CLAIM`: a claim token of your plex.tv
+  account, which `apply` fetches with your Plex token (`plex.token`) the moment before,
+  through the plex.tv helper, since it lasts four minutes and works once. The extra file
+  on Compose's standard input sets it, as `"${MP_START_PLEX_PLEX_CLAIM}"`, which Compose
+  takes from its own environment, so it is in no file. The start step asks for it before
+  it changes anything; without one, it fails, and stops a Plex that runs, since it isn't
+  shown to be yours. The image trades it at plex.tv for a token of your account, which it
+  saves in `Preferences.xml`. The setup waits, as long as `apply` waits for an app, until
+  Plex says it is claimed, asking `/identity` without your token, then asks plex.tv
+  whose account the token in Plex's `Preferences.xml` is: it must be yours. That is
+  plex.tv's answer, which Plex's admin can't shape: they can change Plex's machine
+  identifier (probed), but not give Plex a token of your account. Only then does Plex
+  get your token, and the setup checks that it lets no network in without a sign-in
+  (`allowedNetworks`), which anyone could set while it was unclaimed. Plex is set up
+  when `Preferences.xml` holds a token and Mediaplane's record names it. Its setup makes
+  no key: Plex's key is your token.
+- **Seerr on a Plex stack** signs in with your Plex token (`POST /api/v1/auth/plex`),
+  which makes your plex.tv account its admin, and Plex its media server type; then it
+  signs out. A Seerr set up already is checked with its key: its admin's plex.tv account
+  must be the one plex.tv says your token is, and its Plex unset or the stack's, without
+  TLS. It is never signed in to, which would give your token to whoever set it up.
 - **In order.** The setups go in the order of the apps' integrations: Seerr comes after
-  Jellyfin. A setup that can't run yet waits: Seerr's, while Jellyfin refuses the shared
+  Jellyfin, or Plex. A setup that can't run yet waits: Seerr's, while Jellyfin refuses the shared
   admin's password, or after Jellyfin's own setup failed. The app stays as it was,
@@ -408,3 +443,5 @@ client and root folder; the indexers: Prowlarr's links to Sonarr and Radarr, and
 indexer proxy; the media server: Jellyfin's libraries, and Sonarr's and Radarr's
-connection to it; and the requests app: Seerr's links to Jellyfin, Sonarr and Radarr.
+connection to it, or on a Plex stack, Plex's name and libraries, and Sonarr's and
+Radarr's connection to it; and the requests app: Seerr's links to its media server,
+Sonarr and Radarr.
 
@@ -523,2 +560,37 @@ mediaplane (the stack)
 
+- **The media server, on a Plex stack:**
+
+  ```text
+  sonarr, radarr
+    │ "Plex (Mediaplane)":
+    │ your Plex token, update
+    │ the library on import
+    ▼
+  plex
+    named "Mediaplane"
+    Movies, TV Shows
+  ```
+
+  - Plex's name (`plex.server`) is `Mediaplane`, or `apps.plex.server_name`: a new Plex
+    shows its container's random hostname, which could be taken for another Plex of
+    yours. It is set with `PUT /:/prefs`, with your token.
+  - Its libraries (`plex.library_movies`, `plex.library_tv`) are `Movies` and `TV Shows`,
+    on `/data/media/movies` and `/data/media/tv`, with the agent and scanner Plex's web
+    UI gives a new one (`tv.plex.agents.movie` and `Plex Movie`,
+    `tv.plex.agents.series` and `Plex TV Series`), in English (`en-US`). A library is
+    known by name; one that holds another kind is refused, since Plex can't change it.
+  - Plex answers before it has started for good, and takes no change then (`400`, "the
+    server is still starting up"). So the wire step waits until `/identity` no longer
+    says `startState`.
+  - Sonarr's and Radarr's connections to Plex (`<arr>.connection_plex`) reach it at
+    `plex:32400`, without TLS or a URL base, with your Plex token, and have Plex update
+    its library on each import. They share their code with the Jellyfin connections
+    (`catalog/_shared/servarr-connection.ts`). The token is checked with the arr's own
+    test, never compared, and an arr's test needs a Plex library of its kind, so each
+    requires that library. A connection held with TLS or a URL base reads as moved, so
+    the token is never sent to an address read from the arr.
+  - Mediaplane never sets Plex's remote access, nor the networks it lets in without a
+    sign-in: Plex's defaults (off, none) stay. Its first-run setup checks the second is
+    empty before Plex is first published (above).
+
 - **The requests app:**
@@ -567,2 +639,6 @@ mediaplane (the stack)
     tests stop at the links, and Seerr's own test of each.
+  - On a Plex stack, its media server (`seerr.media_server_plex`) is Plex, at
+    `plex:32400` without TLS (Seerr's Plex has no URL base), with the Movies and TV Shows
+    libraries enabled. Seerr reaches Plex with its admin's token, yours, from its first
+    sign-in: the link holds no secret of Mediaplane's.
 
@@ -658,3 +734,2 @@ The [roadmap](plans/m1-roadmap.md) has the order:
 
-- Plex (Slice 7);
 - drift detection (Slice 8);
````

**Change** `docs/security/threat-model.md`:

````diff
diff --git a/docs/security/threat-model.md b/docs/security/threat-model.md
index b4efa61..03a0af6 100644
--- a/docs/security/threat-model.md
+++ b/docs/security/threat-model.md
@@ -2,3 +2,3 @@
 
-This is the threat model for Mediaplane as built today: M1, up to and including Slice 5.
+This is the threat model for Mediaplane as built today: M1, up to and including Slice 7.
 It makes spec §7 concrete. To report a vulnerability, see [SECURITY.md](../../SECURITY.md).
@@ -24,2 +24,5 @@ that power. None of them removes it.
 | Your secrets: VPN key, Plex token, passwords | `secrets/` (0700), or environment variables                           | They are your accounts                                     |
+| Your Plex token, in Sonarr, Radarr and Seerr | The arrs' Plex connections, and Seerr's database, in `appdata/`       | It opens your plex.tv account, and every Plex it reaches   |
+| Plex's own token, from its claim             | `appdata/plex`, in its `Preferences.xml` (0600)                       | It opens your plex.tv account, as this Plex                |
+| A claim token, as Plex first starts          | Memory, Compose's environment, and Plex's, while it is unpublished    | It claims a Plex for your account, once, for four minutes  |
 | App data                                     | `appdata/<app>/`                                                      | The apps' databases and settings, some holding credentials |
@@ -49,2 +52,6 @@ host helper: seconds, on the
 host network, read-only mounts
+
+plex.tv helper: seconds, on
+Docker's default bridge, no
+mounts ──► plex.tv
 ```
@@ -80,2 +87,15 @@ host network, read-only mounts
 
+- **The plex.tv helper.** Mediaplane's container has no route out, and plex.tv is the one
+  outside service Mediaplane calls: for `mediaplane plex-login`, for the claim token Plex
+  first starts with, and to ask whose a Plex or a Seerr is. So for each call it runs a
+  container of its own image, `mediaplane plex-tv`, on Docker's default `bridge` network
+  ([ADR 0012](../adr/0012-reach-plex-tv-through-a-short-lived-helper.md)). That network
+  has a route out, and Docker keeps it apart from every other network: from it, neither
+  the wiring network nor the stack's own reaches an app (probed). The helper has no
+  mount, no Docker socket and no other network, runs as Mediaplane's user, with no
+  capabilities, a read-only root and `no-new-privileges`, never pulls an image, and is
+  removed when it exits. Your Plex token reaches it on its standard input, never on a
+  command line or in its environment, and it calls only plex.tv's own address. It uses
+  the Docker API calls the host helper already makes, so the proxy allows nothing new for
+  it. Run from source, the CLI calls plex.tv itself, from the host.
 - **The appdata ownership helper.** During `apply`, when an app's `appdata/<app>` is not
@@ -98,10 +118,14 @@ host network, read-only mounts
 - **The first-run setup.** An app whose setup anyone who reaches it could finish starts
-  with no published port: Jellyfin, whose startup wizard is open, and Seerr, before its
-  first sign-in. `apply` gives Compose one more file, on its standard input, that takes
-  every port off them, those of `compose.override.yaml` too. Mediaplane finishes
-  Jellyfin's wizard over the wiring network, as the shared admin, makes Jellyfin's key
-  and keeps it; then it signs Seerr in through Jellyfin, as that admin, and signs out
-  again. Only then does it start them again with their ports published (see T16). That
-  uses the Docker API calls an `apply` that recreates an app already makes, so the proxy
-  allows nothing new for it. `plan` never runs it.
+  with no published port: Jellyfin, whose startup wizard is open; Plex, until it is
+  claimed; and Seerr, before its first sign-in. `apply` gives Compose one more file, on
+  its standard input, that takes every port off them, those of `compose.override.yaml`
+  too. Mediaplane finishes Jellyfin's wizard over the wiring network, as the shared
+  admin, makes Jellyfin's key and keeps it; then it signs Seerr in through Jellyfin, as
+  that admin, and signs out again. On a Plex stack, Plex's first start gets a claim token
+  of your plex.tv account in `PLEX_CLAIM`, which that same file passes; Mediaplane waits
+  until Plex has claimed itself, and asks plex.tv whether it is yours. Then it signs
+  Seerr in with your Plex token, and signs out again. Only then does it start them again
+  with their ports published (see T16). That uses the Docker API calls an `apply` that
+  recreates an app already makes, so the proxy allows nothing new for it. `plan` never
+  runs it, and never calls plex.tv.
 - **The wiring.** `plan` and `apply` call the apps' APIs over the wiring network: from
@@ -110,4 +134,5 @@ host network, read-only mounts
   in the environment (`NODE_USE_ENV_PROXY`) never sees a key. It carries the app's key in
-  a header (`X-Api-Key`, a Bearer token for qBittorrent, or Jellyfin's
-  `Authorization: MediaBrowser Token="…"`), never in the URL. Mediaplane signs in to
+  a header (`X-Api-Key`, a Bearer token for qBittorrent, Jellyfin's
+  `Authorization: MediaBrowser Token="…"`, or your Plex token in Plex's
+  `X-Plex-Token`), never in the URL. Mediaplane signs in to
   qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin with the shared login, to check it;
@@ -127,3 +152,6 @@ host network, read-only mounts
   that fails logs a line in Seerr's log, and a test with a key the arr refuses logs one
-  in the arr's, as a test from Seerr's web UI does.
+  in the arr's, as a test from Seerr's web UI does. It checks an arr's connection to Plex
+  with the arr's own test, which calls Plex with your token: the first such test lists
+  the arr among the devices of your Plex (Settings, Authorized Devices), as one from the
+  arr's web UI does.
 - **The Cloudflare solver.** Byparr, or FlareSolverr, runs a browser for Prowlarr on the
@@ -152,6 +180,5 @@ host network, read-only mounts
     on the stack's own Docker network.
-  - The apps whose API Mediaplane calls (Sonarr, Radarr, Prowlarr, Jellyfin, Seerr on a
-    Jellyfin stack, and qBittorrent, through Gluetun with a VPN) are on the stack's
-    wiring network too. It is
-    internal: it gives them no way out, which they have on their own network.
+  - The apps whose API Mediaplane calls (Sonarr, Radarr, Prowlarr, Jellyfin or Plex,
+    Seerr, and qBittorrent, through Gluetun with a VPN) are on the stack's wiring network
+    too. It is internal: it gives them no way out, which they have on their own network.
   - Before an app's first start, Mediaplane writes the files it reads when it starts:
@@ -199,3 +226,8 @@ Controls today:
   that). Jellyfin asks for a login from everywhere. So does Seerr, which publishes no
-  port until Mediaplane has signed it in through Jellyfin, as that admin.
+  port until Mediaplane has signed it in through Jellyfin, as that admin, or on a Plex
+  stack, with your Plex token. Plex publishes no port until it is claimed for your
+  plex.tv account, and then asks for a sign-in with a plex.tv account it knows from
+  everywhere: Mediaplane sets no network that may skip it (Plex's "List of IP addresses
+  and networks that are allowed without auth", empty by default), and publishes Plex
+  only while that list is empty (T16).
 - With `login_on_lan: false`, qBittorrent lets only your LAN subnet skip its login, and
@@ -211,5 +243,7 @@ What remains:
 - On a home network, `init` suggests `bind: lan`, which puts the web UIs on your LAN.
-- With Plex, until Slice 7, Seerr's setup is open to whoever reaches it first, through
-  a Jellyfin or a Plex account of their own. Complete it right after the first `apply`,
-  or keep `bind: localhost` until you have.
+- Mediaplane leaves Plex's remote access as Plex sets it: off, so Plex asks plex.tv for
+  no port on your router. Plex's relay is on by default: through it, plex.tv lets the
+  accounts that may use your Plex (yours, and those you share it with) reach it from
+  outside when nothing else can. Turn it off in Plex (Settings, Network, "Enable Relay")
+  if you don't want that.
 - With `login_on_lan: false`, anyone on a local address gets into Sonarr, Radarr and
@@ -282,2 +316,8 @@ What remains:
   Seerr's key or the shared admin login.
+- On a Plex stack, Sonarr and Radarr hold your Plex token, as their connection to Plex
+  needs, and Seerr holds it as its admin's, from its first sign-in. Plex's own token is
+  in its appdata. Each opens your plex.tv account: a compromised arr, Seerr or Plex can
+  reach every Plex your account reaches, those outside this stack too, and change your
+  account. Use a plex.tv account of its own for the stack if that matters to you, and
+  share your other servers with it as you need.
 - A link stays in Prowlarr when its arr leaves the stack, and keeps that arr's key,
@@ -355,2 +395,27 @@ Controls today:
   command line.
+- Your Plex token goes to Plex only in its `X-Plex-Token` header, over the wiring network,
+  and to Sonarr, Radarr and Seerr only in request bodies: the arrs' Plex connections,
+  which show it masked (`********`) afterwards and are tested masked, and Seerr's first
+  sign-in, whose session cookie stays in Mediaplane's memory for the one call that signs
+  out. It goes to plex.tv itself only through the plex.tv helper's standard input, or
+  from source, in the header plex.tv asks for. Mediaplane sends it only to the stack's own
+  address for Plex, never to a host read from an app, and only once plex.tv says Plex is
+  yours: Plex's setup asks Plex whether it is claimed without it. Of the secrets you
+  give, only an app's key (your Plex token) reaches a setup or a resource; the others,
+  such as the VPN key, are only redacted. `mediaplane plex-login` writes it
+  to `plex.token`'s file, 0600, inside a 0700 `secrets/`, never half-written, and prints
+  only a link to sign in with, never the token.
+- A claim token is fetched with your token by the `apply` that first starts Plex, the
+  moment before. It goes to Compose through its environment, which the extra file on
+  Compose's standard input names (`PLEX_CLAIM: "${…}"`), so it is in no file. Plex's
+  first container holds it in its environment, which `docker inspect` shows, while it is
+  unpublished: the image trades it at plex.tv within seconds, and a claim token works
+  once, for four minutes. The container that publishes Plex is made without it. It is
+  fetched before the start step changes anything: without one, the step fails, and stops
+  a Plex that runs.
+- Plex's own token, which its claim makes, is in Plex's `Preferences.xml`, which Plex
+  writes 0600. Mediaplane reads it there only to ask plex.tv whose account it is, once
+  Plex is claimed, through the plex.tv helper's standard input, and keeps nothing of it.
+- Every value that comes from plex.tv, and your Plex token, is replaced with `***` in
+  errors, and kept out of change records, `state/resources.json` and `plan`'s output.
 - Gluetun's control key reaches vpn-check's probe on its standard input, and the probe
@@ -591,2 +656,7 @@ What remains:
   host can.
+- The plex.tv helper has a route out, as any container on Docker's default bridge does,
+  for the second it runs. It runs Mediaplane's own code, for one call to plex.tv, and has
+  no network of the stack's ([ADR 0012](../adr/0012-reach-plex-tv-through-a-short-lived-helper.md)).
+  Its answer can hold a token (`plex-login`'s, or a claim token), which `docker logs`
+  shows while it runs, to whoever has Docker access.
 - Like any Docker network, the wiring network reaches the host at its gateway address,
@@ -675,2 +745,27 @@ Controls today:
   `bootstrap.network-via`. No app in the catalog does this today.
+- An unclaimed Plex lets whoever reaches it at an address claim it for a plex.tv account
+  of their own, with no sign-in (probed: Plex 1.43 answered `POST /myplex/claim` with
+  200). So Plex starts unpublished until it is claimed, and is published only once
+  plex.tv says the token Plex's claim gave it, in its `Preferences.xml`, is your
+  account's. That is plex.tv's answer, not Plex's. Plex's admin can change what Plex says
+  of itself, its machine identifier too (probed), so that can't decide; they can't give
+  Plex a token of your account without one. A Plex claimed by another account, or one plex.tv couldn't be asked about, stays
+  unpublished, and `apply` stops. One that doesn't claim itself while `apply` waits for
+  it (its claim token ran out, or it couldn't reach plex.tv) stays unpublished too.
+  When Mediaplane can't fetch a claim token at all, the start step fails before it
+  changes anything, and stops a Plex that runs, published or not, since it isn't shown
+  to be yours: one an `apply` before Slice 7 published unclaimed, say. Plex counts as set
+  up only when its `Preferences.xml` holds a token (`PlexOnlineToken`) and Mediaplane's
+  record names it.
+- Before Plex's setup is done, so before Plex is first published, Mediaplane asks it
+  whether it lets any network in without a sign-in (`allowedNetworks`), and keeps it
+  unpublished while it does, with what to do. Anyone who reached Plex while it was
+  unclaimed could have set that, and it survives the claim (probed). It is checked only
+  then: a network you allow later, on purpose, is left alone.
+- On a Plex stack, Seerr signs in with your Plex token, which makes your plex.tv account
+  its admin. A Seerr set up already is checked with its key, never by signing in, which
+  would give your token to whoever set it up: it is Mediaplane's only when its admin's
+  plex.tv account is the one plex.tv says your token is, and its Plex is unset or the
+  stack's, with no TLS. Only your account's token signs in as your account, so Seerr's
+  admin can't shape that either. Anything else stays unpublished.
 
@@ -678,4 +773,17 @@ What remains:
 
-- With Plex, Mediaplane doesn't set Seerr up until Slice 7: its setup is open on its
-  published port from its first start (see T2).
+- While Plex is unclaimed, for the seconds its claim takes, any container of the stack
+  can reach it on the stack's networks, and could claim it first, as for Jellyfin's
+  wizard below. Mediaplane then finds it claimed by another account, and it stays
+  unpublished. The runbook's ways out come first, and keep what Plex holds: sign in to
+  `plex-login` as that account, if it is yours, or take Plex's `PlexOnline` settings out
+  of its `Preferences.xml` so the next `apply` claims it again.
+- In those seconds, such a container could also change Plex's settings without claiming
+  it, through `PUT /:/prefs`, and they survive the claim. Mediaplane checks the one that
+  would open Plex without a sign-in, `allowedNetworks` (above). Others, such as remote
+  access, give no access without a sign-in, and are not checked: look over Plex's
+  Network settings after the first `apply`.
+- A Plex whose `Preferences.xml` keeps its token is taken as set up while Mediaplane's
+  record names it, and starts published. One whose token was removed by hand is claimed
+  again by the next `apply`, unpublished; run outside `apply`, it starts published and
+  unclaimed.
 - While the wizard is open, for the seconds Mediaplane takes, any container of the stack
@@ -722,5 +830,5 @@ What remains:
   override.
-- Run outside Mediaplane (the ejectable command, or a restart of a published Jellyfin or
-  Seerr whose appdata was emptied), the app starts published with its setup open: stop
-  it before emptying its appdata, and set it up with `apply`.
+- Run outside Mediaplane (the ejectable command, or a restart of a published Jellyfin,
+  Plex or Seerr whose appdata was emptied), the app starts published with its setup
+  open: stop it before emptying its appdata, and set it up with `apply`.
 - Seerr's appdata reset outside `apply`, and the app claimed on the LAN before the next
````

**Create** `docs/adr/0012-reach-plex-tv-through-a-short-lived-helper.md`:

```markdown
# 0012. Reach plex.tv through a short-lived helper

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

Plex is the one app that needs an outside service for its setup. Three things call
plex.tv:

- **`mediaplane plex-login`** signs you in with plex.tv's PIN flow and saves your token.
- **Plex's claim.** `apply` fetches a claim token with your token as Plex first starts.
- **Two ownership checks:** whose account a claimed Plex's own token is, and whether
  Seerr's admin is your plex.tv account.

Mediaplane's container has no route out, by the owner's decision
([ADR 0011](0011-a-private-wiring-network.md)): it is on two internal networks, the
socket proxy's and the stack's wiring network. That ADR left plex.tv to "a short-lived
helper", and the socket proxy's allow-list must not grow for it
([ADR 0008](0008-docker-socket-proxy-on-by-default.md)).

The options for where the call runs, and how your token reaches it:

- **The host helper, on the host network.** It exists already. But a container on the
  host network reaches every Docker network on the host, the stack's wiring network
  included (probed), so a helper there could call the apps.
- **The stack's own default network.** It has a route out, but every app is on it, and
  it doesn't exist before the stack first starts.
- **Docker's default bridge network.** It has a route out, and Docker keeps it apart from
  every other bridge network: a container on it reached neither an internal network's
  container nor one on another bridge network (probed).

And for the token:

- **In the helper's environment.** Anyone who can run `docker inspect` reads it, for as
  long as the container exists.
- **In a file, mounted.** It needs a host mount, and a file written with the token.
- **On its standard input.** It stays off every command line, out of the container's
  settings, and in no file.

## Decision

- **Each plex.tv call is one run of the plex.tv helper:** a throwaway container of
  Mediaplane's own image, running `mediaplane plex-tv`, on Docker's default `bridge`
  network. It runs as Mediaplane's user, with no capabilities, a read-only root,
  `no-new-privileges` and no mount, never pulls, is removed when it exits (`--rm`), and
  is labelled `io.mediaplane.helper=plex-tv`. It never gets the Docker socket, the wiring
  network, or any host folder.
- **The request goes on its standard input, the answer comes back on its standard
  output,** as one line of JSON each. The helper takes only the four calls Mediaplane
  makes (a PIN, the wait for its sign-in, a claim token, and the account a token is of),
  each to plex.tv's own address, which it fixes: a request can't name another host.
- **It needs no new Docker API call.** `docker run --interactive` uses `create`,
  `attach`, `start` and `wait`, which the allow-list already has for the host helper.
  The end-to-end test runs `plex-login` from the image, through the proxy.
- **Run from source, the CLI calls plex.tv itself.** The host has its own route out, and
  ADR 0011 keeps only Mediaplane's container offline, as vpn-check's own egress check does
  from source. It uses an HTTPS agent of its own, so a proxy from the environment never
  sees your token.
- **`plan` never calls plex.tv.** A claim token is used once, and lasts four minutes, so
  only the `apply` that starts Plex can fetch one. Plex checks your token with plex.tv
  itself when `plan` checks Plex's key.

## Consequences

- **Docker's default bridge network must exist.** It does unless the daemon is set up
  without it (`"bridge": "none"`); then the helper fails, saying the network was not
  found.
- **Each call starts a container,** a second or so in the image. `plex-login` waits for
  your sign-in in one run, asking plex.tv every two seconds. A run may take as long as
  the client's own tries, with a minute more; one that runs out of time counts as
  plex.tv not answering.
- **The helper's answer can hold a token:** `plex-login`'s, and a claim token. It is in
  the helper's output, which `docker logs` can show while the container runs, for a
  moment; `--rm` removes it with the container.
- **The helper still has a route out,** as any container on the default bridge does. It
  runs Mediaplane's own code, for one call; a compromised Mediaplane can create any
  container anyway (ADR 0008).
- **plex.tv must be reachable** from the default bridge, for `plex-login` and for Plex's
  first start. `apply` stops before it starts anything when it can't get a claim token.
```

**Change** `docs/adr/0011-a-private-wiring-network.md`:

```diff
diff --git a/docs/adr/0011-a-private-wiring-network.md b/docs/adr/0011-a-private-wiring-network.md
index 4bc4afc..8679494 100644
--- a/docs/adr/0011-a-private-wiring-network.md
+++ b/docs/adr/0011-a-private-wiring-network.md
@@ -76,3 +76,4 @@ network with containers that have one. The owner chose how to reach the apps on
   [threat model](../security/threat-model.md). It needs no internet in M1 except
-  plex.tv, in Slice 7, which a short-lived helper will reach for it. The apps' own
+  plex.tv, which a short-lived helper on Docker's default bridge network reaches for it
+  ([ADR 0012](0012-reach-plex-tv-through-a-short-lived-helper.md)). The apps' own
   internet traffic is unchanged.
```

**Change** `docs/adr/0006-seerr-as-the-requests-app.md`:

```diff
diff --git a/docs/adr/0006-seerr-as-the-requests-app.md b/docs/adr/0006-seerr-as-the-requests-app.md
index dfc9eab..21a1fa0 100644
--- a/docs/adr/0006-seerr-as-the-requests-app.md
+++ b/docs/adr/0006-seerr-as-the-requests-app.md
@@ -41,3 +41,5 @@ Seerr, version 3.5 or later, is M1's requests app (spec §2.1, §6.1, §6.5):
   Slice 7 with Plex) starts with that first sign-in. Until then, Seerr's setup page is
-  open to whoever reaches it first (see [Seerr's README](../../catalog/seerr/README.md)).
+  open to whoever reaches it first, so `apply` signs Seerr in before it publishes it,
+  through Jellyfin or with your Plex token (see
+  [Seerr's README](../../catalog/seerr/README.md)).
 - **A fixed uid.** Seerr's image runs as uid 1000, so Mediaplane gives its appdata folder
```

- [ ] **Step 4: The READMEs and the deploy guide**

**Change** `README.md`:

```diff
diff --git a/README.md b/README.md
index a1b5bcb..1c607e4 100644
--- a/README.md
+++ b/README.md
@@ -24,9 +24,12 @@ Compose and wires the apps together for you.**
 >   entry says what voids that), and links Seerr to Jellyfin, with both libraries, and to
->   Sonarr and Radarr, with a quality profile, ready for requests. `mediaplane vpn-check`
->   confirms that qBittorrent reaches the internet only through the VPN. Mediaplane runs
->   in its own hardened container, behind a Docker socket proxy, and reaches the apps
->   over a private network with no route out.
-> - **Next:** Plex. Until that lands, a Plex stack still needs setting up by hand, Seerr
->   included: its setup is open to anyone who can reach it until you complete it, so
->   complete it first.
+>   Sonarr and Radarr, with a quality profile, ready for requests. With Plex instead,
+>   `mediaplane plex-login` signs you in to plex.tv and saves your Plex token; `apply`
+>   claims Plex for your account before its web UI is published, names it, gives it
+>   its Movies and TV Shows libraries, connects Sonarr and Radarr to it, and signs Seerr
+>   in with your Plex account before Seerr is published, linked to Plex (when `apply`
+>   runs the stack; the same threat model entry says what voids that).
+>   `mediaplane vpn-check` confirms that qBittorrent reaches the internet only through
+>   the VPN. Mediaplane runs in its own hardened container, behind a Docker socket
+>   proxy, and reaches the apps over a private network with no route out.
+> - **Next:** drift detection: `plan` will report what was changed by hand.
 > - **Who can reach them:** `mediaplane init` asks whether to publish the web UIs on
@@ -75,3 +78,4 @@ Mediaplane does that part for you:
 | Sign Seerr in through Jellyfin before it is published, and link it                | Done         |
-| Wire Plex, and Seerr with Plex                                                    | Planned      |
+| Sign in to Plex (`plex-login`), and claim Plex before it is published             | Done         |
+| Plex's libraries and links, and Seerr signed in with your Plex account            | Done         |
 | Detect manual changes and offer Re-apply or "Keep mine"                           | Planned      |
@@ -118,4 +122,5 @@ the changes and touches nothing in your stack, apart from small marks that check
 or a password can leave in an app: a category in qBittorrent, a failure in an app's own
-status of a client, link or connection, a sign-in in Jellyfin's activity log, and a line
-in Seerr's log (and an arr's) for a check of Seerr's that fails. The
+status of a client, link or connection, a sign-in in Jellyfin's activity log, a line in
+Seerr's log (and an arr's) for a check of Seerr's that fails, and an arr listed among
+Plex's devices by its first test of its connection to Plex. The
 [threat model](docs/security/threat-model.md#what-runs-and-who-can-reach-it) says more.
@@ -141,8 +146,9 @@ mediaplane apply
   ├─ pulls images, starts the apps
-  │  (Jellyfin and Seerr with no
-  │  port, until they are set up)
+  │  (Jellyfin or Plex, and Seerr,
+  │  with no port, until they are
+  │  set up)
   ├─ waits until every app is healthy
-  ├─ sets Jellyfin up, signs Seerr
-  │  in through it, then publishes
-  │  them
+  ├─ sets Jellyfin up, or has Plex
+  │  claimed for you; signs Seerr
+  │  in; then publishes them
   ├─ wires the apps through their
@@ -155,4 +161,2 @@ mediaplane apply
 
-Next, `apply` will wire Plex through the same APIs (Slice 7).
-
 A few principles hold throughout:
@@ -339,4 +343,5 @@ It changes nothing in your stack, apart from small marks that checking a key or
 password can leave in an app: a category in qBittorrent, a failure in an app's own
-status of a client, link or connection, a sign-in in Jellyfin's activity log, and a line
-in Seerr's log (and an arr's) for a check of Seerr's that fails. The
+status of a client, link or connection, a sign-in in Jellyfin's activity log, a line in
+Seerr's log (and an arr's) for a check of Seerr's that fails, and an arr listed among
+Plex's devices by its first test of its connection to Plex. The
 [threat model](docs/security/threat-model.md#what-runs-and-who-can-reach-it) says more.
@@ -424,5 +429,6 @@ The pipeline decides what the stack is, and Mediaplane does the stateful part. T
 that covers generating the keys, deploying, setting Jellyfin up and taking the key it
-makes, signing Seerr in through it, setting the shared login in the apps, linking Sonarr
-and Radarr to qBittorrent and Jellyfin, Prowlarr to them, and Seerr to all three, and
-checking. Plex and change detection are what is being built next.
+makes, or claiming Plex for your account, signing Seerr in, setting the shared login in
+the apps, linking Sonarr and Radarr to qBittorrent and the media server, Prowlarr to
+them, and Seerr to all three, and checking. Change detection is what is being built
+next.
 
@@ -448,3 +454,5 @@ and keep. What it adds is everything around the file:
   [what voids them](docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup));
-- next, Plex.
+- or Plex, claimed for your plex.tv account by `apply` before its web UI is published,
+  with its libraries and the same links, and Seerr signed in with your Plex account
+  (when `apply` runs the stack; the same threat model entry says what voids that).
 
@@ -457,4 +465,4 @@ the apps to each other, with `plan` and `apply` and a history of what it did, an
 the rest of each app's settings to you. Today it sets the shared login, sets Jellyfin
-and Seerr up, links Sonarr and Radarr to qBittorrent and Jellyfin, Prowlarr to them, and
-Seerr to all three; Plex comes in Slice 7.
+(or Plex) and Seerr up, links Sonarr and Radarr to qBittorrent and the media server,
+Prowlarr to them, and Seerr to all three.
 
@@ -514,5 +522,5 @@ M1 is built in slices. The [M1 roadmap](docs/plans/m1-roadmap.md) shows where it
   test and `vpn-check`), S3b (the wiring framework), S3c (the download path), S4
-  (indexers), S5 (Jellyfin) and S6 (requests).
-- **Next:** S7 (Plex).
-- **After that:** S8 and S9: drift detection, and the release.
+  (indexers), S5 (Jellyfin), S6 (requests) and S7 (Plex).
+- **Next:** S8 (drift detection).
+- **After that:** S9: the release.
 
```

**Change** `catalog/plex/README.md`:

````diff
diff --git a/catalog/plex/README.md b/catalog/plex/README.md
index eab45f4..74a995e 100644
--- a/catalog/plex/README.md
+++ b/catalog/plex/README.md
@@ -28,3 +28,74 @@ LinuxServer.io image, unmodified, when `media_server` is `plex`.
 - **It runs Plex** whenever `media_server` is `plex`, listed under `apps` or not, with
-  your data folder at `/data`. It publishes its web UI as `network.bind` says.
+  your data folder at `/data`. It publishes its web UI as `network.bind` says, at
+  `/web`, once Plex is claimed for your account.
+- **Your token.** Run `mediaplane plex-login` before the first `apply`: it signs you in
+  to plex.tv with a link you open in a browser, and saves your Plex token where
+  `plex.token` says (`secrets/plex-token`, which `init` writes). It never prints the
+  token. A saved token plex.tv still takes is kept, unless you add `--force`.
+- **It claims Plex for your account before its web UI is published.** An unclaimed Plex
+  lets whoever reaches it claim it for their own plex.tv account, with no sign-in. So on
+  its first start, Plex has no published port:
+
+  ```text
+  apply
+    │ asks plex.tv for a claim
+    │ token, with your token
+    ▼
+  up: Plex, no port,
+  PLEX_CLAIM set
+    │ the image trades it at
+    │ plex.tv, and saves a
+    │ token of your account
+    ▼
+  first-run setup
+    │ waits until Plex is
+    │ claimed; asks plex.tv
+    │ whether it is yours
+    ▼
+  up again: Plex
+    published, no PLEX_CLAIM
+  ```
+
+  The claim token lasts four minutes and works once, so `apply` fetches it the moment
+  before Plex starts, and passes it through Compose's environment: it is never in
+  `compose.yaml`, `.env` or any record. In the image, plex.tv is reached through a
+  short-lived helper on Docker's default bridge network
+  ([ADR 0012](../../docs/adr/0012-reach-plex-tv-through-a-short-lived-helper.md)).
+  `plan` lists Plex under `First-run setup:`, and never calls plex.tv.
+
+- **It publishes Plex only once plex.tv says it is yours:** plex.tv, asked with the token
+  Plex's claim gave it (in its `Preferences.xml`), answers with your account. Plex's
+  admin can change what Plex says of itself, its machine identifier too, but can't make
+  it hold a token of your account. A Plex claimed by another account stays unpublished,
+  and so does one plex.tv couldn't be asked about, or one that didn't claim itself while
+  `apply` waited. When `apply` can't get a claim token at all, it changes nothing, and
+  stops a Plex that runs, since it isn't shown to be yours. Before Plex is first
+  published, it must let no network in without a sign-in (`allowedNetworks` empty):
+  anyone could set that while it was unclaimed. Plex counts as set up when its `Preferences.xml` holds a token
+  (`PlexOnlineToken`) and Mediaplane's record does (`setUp` in `state/secrets.json`).
+  This holds when `apply` runs the stack; the threat model lists what voids it:
+  [T16](../../docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup).
+  The [runbook](../../docs/runbooks/wiring-failed.md) has the ways out, the ones that
+  keep what Plex holds first.
+- **Its key is your Plex token,** which Plex checks with plex.tv. Mediaplane sends it in
+  Plex's `X-Plex-Token` header, over the wiring network.
+- **Its name** (`plex.server`): `Mediaplane`, or `apps.plex.server_name`, so it isn't
+  taken for another Plex of yours. A new Plex shows its container's random hostname.
+- **Its libraries** (`plex.library_movies`, `plex.library_tv`): `Movies` on
+  `/data/media/movies` and `TV Shows` on `/data/media/tv`, the folders Radarr and Sonarr
+  fill, with the agent and scanner Plex's web UI gives a new library, in English. Their
+  other settings are yours.
+- **Sonarr's and Radarr's connections to it:** each arr gets `Plex (Mediaplane)`, which
+  has Plex update its library on each import, with your token (see
+  [Sonarr's README](../sonarr/README.md)). The first test of each lists the arr among
+  Plex's devices (Settings, Authorized Devices), as one from the arr's web UI does.
+- **Seerr signs in with your Plex account.** With Seerr in the stack, once Plex is
+  claimed, `apply` signs Seerr in with your token before Seerr is published, and links
+  it to Plex (see [Seerr's README](../seerr/README.md)).
+- **Its login is your own plex.tv account,** never the shared admin.
+  `mediaplane credentials` says so, with Plex's address.
+- **Remote access** stays as Plex sets it: off. So does the list of networks that may
+  skip Plex's sign-in: empty. Plex's relay is on by default; the
+  [threat model](../../docs/security/threat-model.md#t2-someone-on-the-lan-reaches-an-app)
+  says what it allows.
 - **Listing Jellyfin as well** is an error, unless Jellyfin says `enabled: false`.
@@ -32,4 +103,2 @@ LinuxServer.io image, unmodified, when `media_server` is `plex`.
   pinned image does.
-- **Your token.** `plan` checks that `plex.token` points at a secret that exists, but the
-  token is not used yet.
 
@@ -37,8 +106,3 @@ LinuxServer.io image, unmodified, when `media_server` is `plex`.
 
-- **Slice 7:**
-  - `mediaplane plex-login`, which signs in through plex.tv and saves your token;
-  - claiming the server with it on first start;
-  - the Movies and TV Shows libraries;
-  - the connections from Sonarr and Radarr;
-  - with Seerr in the stack, its sign-in with your token, and its link to Plex.
+- **Slice 8:** drift detection and Keep mine for what it manages here.
 
@@ -48,7 +112,9 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 
-- **In `stack.yaml`,** under `apps.plex`, you can set `port`, `version` and `env`. The
-  media server that `media_server` names can't be turned off with `enabled: false`:
-  change `media_server` instead. A different `version` is an untested combination, and
-  `plan` warns about it. See the
+- **In `stack.yaml`,** under `apps.plex`, you can set `port`, `version`, `env` and
+  `server_name`. The media server that `media_server` names can't be turned off with
+  `enabled: false`: change `media_server` instead. A different `version` is an untested
+  combination, and `plan` warns about it. See the
   [`stack.yaml` reference](../../docs/reference/stack-yaml.md).
+- **What Mediaplane manages** (its name, and its libraries' names, kinds and folders) is
+  put back by the next `apply` when changed in Plex. Keep mine comes in Slice 8.
 - **Anything else** goes in `compose.override.yaml` in the Mediaplane home. For example,
@@ -65,13 +131,13 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 
-- **Plex starts unclaimed.** Until Slice 7 claims it for you, you can claim it yourself.
-  Get a claim token at `https://plex.tv/claim`. It expires within four minutes, so save it
-  to `secrets/plex-claim` in the home and run `mediaplane apply` straight away, with:
-
-  ```yaml
-  apps:
-    plex:
-      env:
-        PLEX_CLAIM: { file: secrets/plex-claim }
-  ```
-
-  Remove the line afterwards. `plan` shows Plex being recreated when you do.
+- **Your token is in several places.** Sonarr, Radarr and Seerr hold it, and Plex holds
+  a token of your account: each opens your plex.tv account, and every Plex it reaches.
+  Use a plex.tv account of its own for the stack if that matters to you. The
+  [threat model](../../docs/security/threat-model.md#t4-an-app-is-compromised) says more.
+- **A new token from `plex-login` reaches the arrs only once the old one is refused.**
+  Sonarr and Radarr keep the token they hold while Plex takes it, and get yours at the
+  next `apply` when Plex refuses theirs. Seerr keeps the token it signed in with, and
+  Mediaplane can't give it another yet (Slice 8).
+- **A Plex claimed outside `apply`,** with another account, stays unpublished: see the
+  [runbook](../../docs/runbooks/wiring-failed.md).
+- **The first `apply` needs plex.tv,** from Docker's default bridge network in the image:
+  for the claim token, and for Plex itself to trade it.
````

**Change** `catalog/seerr/README.md`:

```diff
diff --git a/catalog/seerr/README.md b/catalog/seerr/README.md
index ae6a8b9..dcf3942 100644
--- a/catalog/seerr/README.md
+++ b/catalog/seerr/README.md
@@ -28,3 +28,3 @@ Radarr. Mediaplane runs the upstream image, unmodified (see
 
-With Jellyfin as the media server (with Plex, see Not built yet):
+With Jellyfin as the media server (with Plex, see below):
 
@@ -76,2 +76,19 @@ With Jellyfin as the media server (with Plex, see Not built yet):
   changed, and `apply` puts it back. Seerr is wired after Prowlarr, when the stack has it.
+- **With Plex as the media server,** the same, but:
+  - **Its first sign-in** is with your Plex token (`POST /api/v1/auth/plex`), once Plex
+    is claimed for your account, before Seerr's web UI is published. That makes your
+    plex.tv account Seerr's admin, and Plex its media server. It signs out again at
+    once. A Seerr set up already is checked with its key, and never signed in to, which
+    would give your token to whoever set it up: it is Mediaplane's only when its admin's
+    plex.tv account is the one plex.tv says your token is, and its Plex is unset or
+    `plex:32400`, without TLS. Otherwise it stays unpublished, and the
+    [runbook](../../docs/runbooks/wiring-failed.md) has the ways out.
+  - **Its login** is your own plex.tv account: on Seerr's sign-in page, choose Plex.
+    Seerr makes a user for anyone else who signs in with a plex.tv account that your
+    Plex is shared with, as it always does.
+  - **Its media server** (`seerr.media_server_plex`): Plex, at `plex:32400` without TLS,
+    with the Movies and TV Shows libraries enabled. Seerr reaches Plex with its admin's
+    token, yours, which it keeps from its first sign-in: the link holds no key of
+    Mediaplane's. Plex with TLS, set in Seerr, counts as Plex moved, and `apply` puts it
+    back. A library you enable in Seerr stays yours.
 - **Its setup, finished** (`seerr.setup`): once its links are in place, Mediaplane sends
@@ -89,6 +106,4 @@ With Jellyfin as the media server (with Plex, see Not built yet):
 
-- **Slice 7:** with Plex, its first sign-in with your Plex account, and its link to Plex.
-  Until then, on a Plex stack, Mediaplane doesn't call Seerr at all, and
-  `mediaplane credentials` says its login arrives in Slice 7.
-- **Slice 8:** drift detection and Keep mine for what it manages here.
+- **Slice 8:** drift detection and Keep mine for what it manages here, and a way to give
+  Seerr a new Plex token: it keeps the one it signed in with.
 
@@ -105,3 +120,3 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 - **What Mediaplane manages** (the fields above) is put back by the next `apply` when
-  changed in Seerr: its Jellyfin, its libraries, and each server's host, port, profile,
+  changed in Seerr: its Jellyfin or Plex, its libraries, and each server's host, port, profile,
   root folder and default. Keep mine comes in Slice 8.
@@ -111,5 +126,2 @@ See the [roadmap](../../docs/plans/m1-roadmap.md).
 
-- **Setup is open with Plex.** Until Slice 7, on a Plex stack, Seerr's setup page is open
-  to whoever reaches it first. Finish it yourself as soon as `apply` is done, or keep
-  `network.bind: localhost` until you have.
 - **A request needs the internet.** Seerr looks up films and series on TMDB, an outside
```

**Change** `catalog/sonarr/README.md`:

```diff
diff --git a/catalog/sonarr/README.md b/catalog/sonarr/README.md
index 169c9b8..2c36fb0 100644
--- a/catalog/sonarr/README.md
+++ b/catalog/sonarr/README.md
@@ -83,3 +83,19 @@ LinuxServer.io image, unmodified.
     web UI does, and a later pass resets it.
-- **Seerr's link to it.** With Seerr in the stack and Jellyfin as the media server,
+- **Its connection to Plex** (`sonarr.connection_plex`), with Plex as the media server.
+  Once Plex is claimed and has its TV Shows library, `apply` adds `Plex (Mediaplane)`, a
+  Plex Media Server connection, to Sonarr:
+  - its host is `plex`, at Plex's own port, without TLS, and it has Plex update its
+    library ("Update Library");
+  - it is made with the same events as Jellyfin's: an episode imported, upgraded or
+    renamed, or a series or an episode's file deleted. Which events it has after
+    that is yours;
+  - its token is your Plex token, which Sonarr shows masked. `plan` and `apply` check it
+    with Sonarr's own test of the connection, as for Jellyfin's, never by comparing it.
+    Sonarr's test needs a TV library in Plex, so the connection comes after it. The
+    first test lists Sonarr among Plex's devices (Settings, Authorized Devices), as a test
+    from Sonarr's web UI does;
+  - Mediaplane sends your token only to `plex` at its port: a connection held with TLS
+    or a URL base counts as moved, and `apply` puts it back. The same now holds for the
+    connection to Jellyfin.
+- **Seerr's link to it.** With Seerr in the stack,
   `apply` adds `Sonarr (Mediaplane)` to Seerr (`seerr.server_sonarr`, see
@@ -95,5 +111,4 @@ LinuxServer.io image, unmodified.
 
-The rest of the wiring arrives in Slice 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
-
-- **Slice 7:** the same connection for Plex, and Seerr's link to it with Plex.
+- **Slice 8:** drift detection and Keep mine for what it manages here. See the
+  [roadmap](../../docs/plans/m1-roadmap.md).
 
```

**Change** `catalog/radarr/README.md`:

```diff
diff --git a/catalog/radarr/README.md b/catalog/radarr/README.md
index 4ac0eb0..837bb37 100644
--- a/catalog/radarr/README.md
+++ b/catalog/radarr/README.md
@@ -82,3 +82,19 @@ LinuxServer.io image, unmodified.
     web UI does, and a later pass resets it.
-- **Seerr's link to it.** With Seerr in the stack and Jellyfin as the media server,
+- **Its connection to Plex** (`radarr.connection_plex`), with Plex as the media server.
+  Once Plex is claimed and has its Movies library, `apply` adds `Plex (Mediaplane)`, a
+  Plex Media Server connection, to Radarr:
+  - its host is `plex`, at Plex's own port, without TLS, and it has Plex update its
+    library ("Update Library");
+  - it is made with the same events as Jellyfin's: a film imported, upgraded or
+    renamed, or a film or its file deleted. Which events it has after
+    that is yours;
+  - its token is your Plex token, which Radarr shows masked. `plan` and `apply` check it
+    with Radarr's own test of the connection, as for Jellyfin's, never by comparing it.
+    Radarr's test needs a Movie library in Plex, so the connection comes after it. The
+    first test lists Radarr among Plex's devices (Settings, Authorized Devices), as a test
+    from Radarr's web UI does;
+  - Mediaplane sends your token only to `plex` at its port: a connection held with TLS
+    or a URL base counts as moved, and `apply` puts it back. The same now holds for the
+    connection to Jellyfin.
+- **Seerr's link to it.** With Seerr in the stack,
   `apply` adds `Radarr (Mediaplane)` to Seerr (`seerr.server_radarr`, see
@@ -94,5 +110,4 @@ LinuxServer.io image, unmodified.
 
-The rest of the wiring arrives in Slice 7 (see the [roadmap](../../docs/plans/m1-roadmap.md)):
-
-- **Slice 7:** the same connection for Plex, and Seerr's link to it with Plex.
+- **Slice 8:** drift detection and Keep mine for what it manages here. See the
+  [roadmap](../../docs/plans/m1-roadmap.md).
 
```

**Change** `deploy/README.md`:

````diff
diff --git a/deploy/README.md b/deploy/README.md
index 425e408..0bd2fa6 100644
--- a/deploy/README.md
+++ b/deploy/README.md
@@ -13,14 +13,13 @@ never touch Mediaplane itself.
 
-> Mediaplane is pre-alpha. Sonarr and Radarr are linked to qBittorrent and Jellyfin,
-> Prowlarr to them, and Seerr to all three; Plex is not wired yet (Slice 7). On a home
-> network, `init` suggests publishing the web UIs on your LAN. When `apply` runs the
-> stack, Jellyfin's startup wizard and Seerr's setup are not published while they are
-> open: Mediaplane finishes them first. The threat model says what voids that:
+> Mediaplane is pre-alpha. Sonarr and Radarr are linked to qBittorrent and the media
+> server, Jellyfin or Plex, Prowlarr to them, and Seerr to all three. On a home network,
+> `init` suggests publishing the web UIs on your LAN. When `apply` runs the stack,
+> Jellyfin's startup wizard, an unclaimed Plex and Seerr's setup are not published while
+> they are open: Mediaplane finishes them first. The threat model says what voids that:
 > [T16](../docs/security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup).
-> With Plex, until Slice 7, Seerr's setup is open to anyone on your LAN until you
-> complete it, so complete it first.
 >
 > qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin have the shared admin login, and
-> Seerr through Jellyfin: `mediaplane credentials` shows it. To keep the web UIs on this
-> machine only, answer `localhost` when `init` asks (see [First run](#first-run)).
+> Seerr through Jellyfin: `mediaplane credentials` shows it. With Plex, you sign in to
+> Plex and Seerr with your own plex.tv account. To keep the web UIs on this machine only,
+> answer `localhost` when `init` asks (see [First run](#first-run)).
 
@@ -104,2 +103,3 @@ It adds `-t` only on a terminal, so it works in scripts too.
 mediaplane init         # asks a few questions, then writes /opt/mediaplane/stack.yaml
+mediaplane plex-login   # with Plex: signs you in to plex.tv, saves your token
 mediaplane plan         # checks the host and shows what apply would do
@@ -145,4 +145,9 @@ nothing. Without a terminal it asks nothing: pass the flags in the
 
-  With Plex, until Slice 7, Seerr's setup is open to anyone on your LAN until you
-  complete it. Complete it right after the first `apply`.
+- **Your Plex token.** With `media_server: plex`, run `mediaplane plex-login` before the
+  first `apply`. It prints a link: open it in a browser, on any device, and sign in to
+  Plex. It then saves your token where `plex.token` says (`secrets/plex-token`), readable
+  by you only, and never prints it. It waits as long as the link lasts, 30 minutes, or
+  `--timeout` seconds. A saved token that plex.tv still takes is kept, unless you add
+  `--force`; one plex.tv refuses is replaced. `apply` claims Plex for that account
+  before its web UI is published, and signs Seerr in with it.
 
@@ -157,3 +162,4 @@ nothing. Without a terminal it asks nothing: pass the flags in the
   through their API once they run, and sets it again whenever it changes; Seerr follows
-  Jellyfin.
+  Jellyfin. With Plex, you sign in to Plex, and Seerr, with your own plex.tv account
+  instead: `mediaplane credentials` says so.
   - Removing your own `admin.password` brings back the password Mediaplane generated
@@ -198,5 +204,8 @@ host
 ├─ mediaplane       your stack's apps
-└─ host helper      seconds, during
-                    init, plan, apply
-                    and vpn-check
+├─ host helper      seconds, during
+│                   init, plan, apply
+│                   and vpn-check
+└─ plex.tv helper   seconds, with
+                    Plex: plex-login,
+                    apply
 ```
@@ -217,2 +226,10 @@ host
 
+- **The plex.tv helper.** Mediaplane's container has no route out, so for each call to
+  plex.tv (`plex-login`, and with Plex, the claim token and the checks of whose a Plex or
+  a Seerr is, in `apply`) it starts a throwaway container of its own image on Docker's
+  default `bridge` network, which has a route out and reaches none of the stack's
+  networks. Your token goes on its standard input, never on a command line. It has no
+  mount, runs as Mediaplane's user, with no capabilities and a read-only root, never
+  pulls an image, and is removed when it exits
+  ([ADR 0012](../docs/adr/0012-reach-plex-tv-through-a-short-lived-helper.md)).
 - **Mediaplane's networks** are internal: the proxy's, and the stack's wiring network
@@ -337,2 +354,21 @@ Each item is a message you may see, then what to do.
 
+- `the plex.tv helper failed: … network bridge not found`, or
+  `the plex.tv helper did not finish within …`
+
+  The plex.tv helper runs on Docker's default `bridge` network. Check that Docker has
+  it (`docker network ls`; `"bridge": "none"` in `daemon.json` removes it), and that
+  containers on it reach the internet.
+
+- `nobody signed in within …; run plex-login again for a new link`, or
+  `the link ran out before you signed in`
+
+  From `mediaplane plex-login`. Run it again, and open the new link: each lasts 30
+  minutes, and works once.
+
+- `plex.token is read from the environment variable …, where plex-login can't save it`
+
+  `plex-login` saves your token in a file. Set
+  `plex: { token: { file: secrets/plex-token } }` in `stack.yaml`, or put a token there
+  yourself.
+
 - `the host helper did not finish within 60 s`
````

- [ ] **Step 5: The spec and the roadmap**

**Change** `docs/design/m1-engine-cli.md`:

```diff
diff --git a/docs/design/m1-engine-cli.md b/docs/design/m1-engine-cli.md
index 33d21c1..d84a34e 100644
--- a/docs/design/m1-engine-cli.md
+++ b/docs/design/m1-engine-cli.md
@@ -542,3 +542,3 @@ in `compose.override.yaml` is therefore wired automatically.
 | `init` | Write a starter `stack.yaml` and a `secrets/` layout. On a TTY it asks interactive prompts (media server, data path, VPN provider and its WireGuard address, LAN or localhost, the LAN subnet and whether the LAN must sign in (both only with LAN), the admin user name, and whether to generate its password); otherwise it takes flags. It checks every flag it can before the first prompt, including the format of `--vpn-addresses` (on a terminal, only the refusal of `--vpn-addresses` without `--vpn-provider`, and whether `--lan-subnet` fits this host, wait for the provider and bind answers), and asks again after a bad answer. It never overwrites an existing file. It also checks the home first, creates the data folder, adds a note before each question, and takes the WireGuard key on a hidden prompt (§11, Slice 3b) |
-| `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (a key or password check can leave a mark in an app: §11, Slices 3c, 4, 5 and 6); in the image it joins the wiring network, its only lasting change to Docker (§11, Slice 3b) |
+| `plan` | Show what `apply` would change, including drift. Makes no changes to the stack (a key or password check can leave a mark in an app: §11, Slices 3c, 4, 5, 6 and 7; it never calls plex.tv); in the image it joins the wiring network, its only lasting change to Docker (§11, Slice 3b) |
 | `apply` | Converge on `stack.yaml` (§5) |
@@ -549,3 +549,3 @@ in `compose.override.yaml` is therefore wired automatically.
 | `credentials [app]` | Show the shared admin login and per-app URLs (never printed in `--json` unless `--reveal` is given) |
-| `plex-login` | Run the plex.tv PIN flow and save the token to `secrets/plex-token` |
+| `plex-login` | Run the plex.tv PIN flow and save the token where `plex.token` names a file (`secrets/plex-token`), through a short-lived helper in the image (§11, Slice 7) |
 | `vpn-check` | Check that qBittorrent reaches the internet only through the VPN: its network, Gluetun's state and the route into the tunnel, then its egress IP against the host's (`--no-egress` skips that) |
@@ -1581 +1581,152 @@ These keep the spec's intent. They are grouped by the slice whose plan made them
   Jellyfin's (§7.2(2)).
+
+### Slice 7: Plex (2026-10-16)
+
+- **plex.tv, from the image, through a short-lived helper** (§3, §7.2, ADR 0012).
+  Mediaplane's container has no route out (ADR 0011), and the proxy's allow-list stays
+  as it is. Each plex.tv call is one `docker run --rm --interactive` of Mediaplane's own
+  image, `mediaplane plex-tv`, on Docker's default `bridge` network: it has a route
+  out, and reaches neither the wiring network nor the stack's own (probed), where the
+  host network reaches both (probed). It has no mount, no socket, no capability, a
+  read-only root, `no-new-privileges`, Mediaplane's user, `--pull never`, and the label
+  `io.mediaplane.helper=plex-tv`. Its request, with any token in it, is one line of JSON
+  on its standard input (`mediaplane.plex-tv/v1`), never on a command line or in its
+  environment, and its answer one line on its standard output. It takes four strict
+  requests (a PIN, the wait for its sign-in, a claim token, and the account a token is
+  of), and fixes the address: plex.tv's own. Each run may take as long as the client's
+  three tries and the waits between them, with a minute more for the container (170 s);
+  a helper that runs out of time is plex.tv unanswered (`unreachable`, so unsure), as the
+  client would have said. `docker run -i` uses `create`, `attach`, `start` and `wait`,
+  which the allow-list has for the host helper. Run from source, the CLI calls plex.tv itself: ADR 0011 keeps only the
+  container offline. The client has an HTTPS agent of its own, reads at most 1 MiB,
+  tries a GET twice more after 5 and 15 seconds when plex.tv didn't answer, failed
+  (5xx) or asked it to wait (429), never a POST, and its messages name the method and
+  path only, never a query or a value.
+- **`mediaplane plex-login`** (§5.2, §6.1). It asks plex.tv for a strong PIN (25
+  characters, 30 minutes, probed), prints a link to `app.plex.tv/auth` with it, and asks
+  every two seconds until someone signs in, the PIN runs out, or `--timeout` seconds
+  (1 to 1800) pass. The PIN belongs to a client id made for that sign-in
+  (`mediaplane-<uuid>`), which only can read it (probed: another id gets 404), and to the
+  product `Mediaplane`; the account's other calls use the fixed id `mediaplane`, which
+  adds no device (probed). The token is the account's long-lived one, which the PIN
+  gives (§10). It is saved, 0600, never half-written, where `plex.token` names a file;
+  `secrets/` is made 0700. A saved token plex.tv takes is kept unless `--force`; one it
+  refuses (401) is replaced. A `plex.token` read from the environment is refused: there
+  is nowhere to save it. It prints the link, never the token, and with `--json`,
+  `mediaplane.plex-login/v1`, with the link on stderr.
+- **Plex is claimed before it is published** (§5 step 9, §6.1, §6.4). An unclaimed Plex
+  answers anyone who reaches it at an address, and `POST /myplex/claim` claims it for
+  the caller's account with no sign-in (probed: 200). So Plex has a `bootstrap`, keyless
+  as Seerr's (its key is your token), and starts unpublished.
+  - **The claim token** is fetched by the start step, just before `up`, with your token
+    (`GET /api/claim/token.json`), and only for an app the plan starts unpublished whose
+    setup isn't done (`Bootstrap.firstStart`). It lasts four minutes and works once. It
+    reaches Plex as `PLEX_CLAIM`, in the extra Compose file on standard input, as
+    `"${MP_START_PLEX_PLEX_CLAIM}"`, which Compose takes from its environment (Compose
+    2.38.2 and 5.5.1, probed); the publishing `up` doesn't pass it. It is redacted in
+    `up`'s errors. It is fetched before the start step changes anything (before
+    Mediaplane leaves the wiring network, and before the VPN's guests are stopped). With
+    no token, or no claim token, the step fails, and stops a running app it was for: a
+    Plex whose setup isn't done isn't shown to be yours, and must not stay published, as
+    one an `apply` before this slice published unclaimed would.
+  - **The setup** waits, as long as `apply` waits for an app (`AppApi.until`), until
+    `/identity`, asked without your token (`until`'s `anonymous`, as `open` and the
+    re-check before publishing ask it), says `claimed`: the image starts Plex once for its config, unclaimed,
+    and the container can be healthy then (probed). Then plex.tv is asked whose account
+    (`GET /api/v2/user`) the token in Plex's `Preferences.xml` (`PlexOnlineToken`) is,
+    which plex.tv answers with the server's owner (probed), and whose your token is. Not
+    the same is claimed (`auth`). Plex's admin can set its machine identifier
+    (`PUT /:/prefs?MachineIdentifier=…`, probed), so that can't decide, nor can anything
+    else Plex says; Plex can hold a token of your account only through a claim token of
+    yours. Plex's token refused (401, as once the server is removed from its account,
+    probed) is claimed too; plex.tv unanswered (a timeout, a 5xx, a 429, no connection)
+    is `unsure`, as is a claimed Plex whose file holds no token; your token refused, or
+    the file unreadable, is `rejected`. All keep Plex unpublished, as any failure of a
+    keyless setup does. Only then does Plex get your token: the setup reads its
+    preferences (`GET /:/prefs`), and refuses (`rejected`) a Plex whose
+    `allowedNetworks` isn't empty, which anyone could set over `PUT /:/prefs` while it was
+    unclaimed, and which survives the claim (probed). It is checked in the setup only,
+    so a value set later, on purpose, stays.
+    One that never says `claimed` stays unpublished, and the next `apply` fetches a new
+    claim token.
+  - **Done** is `Preferences.xml` holding `PlexOnlineToken`, and `setUp` naming Plex.
+  - **Claimed by another account:** the remedies are, in order, `plex-login` as that
+    account if it is yours; removing Plex's `PlexOnline*` attributes, which the next
+    `apply` claims again with your account, keeping Plex's libraries and machine
+    identifier (probed); and, last, starting it afresh (`Bootstrap.claimedHint`).
+- **Plex's resources** (§6.2):
+  - `plex.server`: `name`, Plex's `FriendlyName` (`PUT /:/prefs`, probed), `Mediaplane`
+    or `apps.plex.server_name` (a new option, 1 to 64 characters), so it isn't taken for
+    another Plex of yours: a new Plex shows its container's random hostname (probed).
+  - `plex.library_movies` and `plex.library_tv`: `Movies` on `/data/media/movies` and
+    `TV Shows` on `/data/media/tv` (`name`, `type`, `location`), with the agent and
+    scanner Plex's web UI gives (`tv.plex.agents.movie` and `Plex Movie`,
+    `tv.plex.agents.series` and `Plex TV Series`) and `en-US`, which Plex needs (400
+    without, probed). Known by name; one of the other kind is refused, as Plex can't
+    change it (400, probed). An update sends the agent it holds, which Plex needs, and
+    replaces the locations.
+  - Plex takes no change until it has started (`/identity` without `startState`): it
+    answers 400 "the server is still starting up" before (found by the nightly test).
+    So an app's API may say when it has started (`ApiSpec.started`), and the wire step
+    waits for that.
+  - **Never set:** remote access (`PublishServerOnPlexOnlineKey`, off by default) and
+    the networks allowed without auth (`allowedNetworks`, none by default): Plex's
+    defaults stay (probed), the second checked empty by the setup. Its relay
+    (`RelayEnabled`, on) is left to you.
+- **Sonarr's and Radarr's connections to Plex** (§6.2): `<arr>.connection_plex`, `Plex
+  (Mediaplane)`, a `PlexServer` connection at `plex:32400`, without TLS or a URL base,
+  with `updateLibrary` and the Jellyfin connection's events, and `authToken`: your Plex
+  token, a secret the arr shows masked, checked with the arr's own test, never compared.
+  The test takes your token or Plex's own (probed), and needs a Plex library of the
+  arr's kind ("At least one TV library is required", found by the nightly test), so
+  each requires that library. Both connections now share `servarrMediaServer`
+  (`catalog/_shared/servarr-connection.ts`). The address held is observed with TLS and
+  the URL base, so a connection held with either reads as moved, and the update sends
+  `useSsl: false` and `urlBase: ''`: the key goes only to the stack's address. That is
+  new for the Jellyfin connection too.
+- **Seerr on a Plex stack** (§6.1, §6.2). `notWiredYet` is gone.
+  - **Its setup** signs in with your token (`POST /api/v1/auth/plex`, probed on Seerr
+    3.5), once Plex's setup is done (Seerr comes after Plex), which makes your plex.tv
+    account its admin, then signs out. Seerr checks the token at plex.tv, and answers
+    500 when it can't, which fails the setup. A Seerr found set up is Mediaplane's only
+    when its admin's `plexId` (`GET /api/v1/auth/me`) is your account's id, which
+    plex.tv gives for your token (`GET /api/v2/user`), and its Plex is unset or the
+    stack's without TLS (`GET /api/v1/settings/plex`), asked with its key: it is never
+    signed in to, which would hand your token to whoever set it up. Only that account's
+    token makes it Seerr's admin, so Seerr's admin can't shape the answer. Questions
+    fail closed, as on a Jellyfin stack.
+  - `seerr.media_server_plex` (a resource of its own, since a resource's name can't
+    change with the stack): Plex at `plex:32400`, without TLS (Seerr's Plex has no URL
+    base, probed), with Movies and TV Shows enabled. Seerr reaches Plex with its admin's
+    token, so the link holds no secret of Mediaplane's. With TLS, `hostname` is the URL
+    Seerr calls, so it differs and is put back. It requires `plex.server` and both
+    libraries.
+- **Logins** (§6.1): an app's `login` is `'shared'`, `{ own: 'Plex' }` (your plex.tv
+  account), or `{ comingIn: … }`, or a function of the stack: Plex's is your own, and
+  Seerr's is Plex's on a Plex stack. `mediaplane credentials` says "sign in with your
+  own Plex account". An app may have a web path (`webPath`): Plex's is `/web`.
+- **`plan`'s marks** (§5.2): an arr's first test of its connection to Plex lists the arr
+  among Plex's devices (probed), as a test from its web UI does. `plan` never calls
+  plex.tv, never claims Plex and never signs Seerr in: a claim token works once.
+- **Secrets** (§6.3, §7): your Plex token is a user secret, read once per run
+  (`userSecrets`), redacted everywhere, and sent only in Plex's `X-Plex-Token` header,
+  once Plex is shown to be yours,
+  (a new key scheme, `x-plex-token`), in request bodies to the arrs and Seerr, and to
+  plex.tv. Claim tokens, plex.tv's answers and Seerr's cookie are redacted too. None is
+  in `compose.yaml`, `.env`, a record, `resources.json` or the output. Every secret you
+  give is redacted, but only those an app's API takes as its key (`api.key.secret`)
+  reach setups and resources as keys (`stackKeys`): the VPN key never does.
+- **Tests** (§8). The every-PR end-to-end test runs Plex against a fake plex.tv, whose
+  claim token Plex's image sends to the real plex.tv, which refuses it (no account is
+  involved), and checks that Plex, unclaimable, is never published. The deploy test
+  runs `plex-login` through its helper from the image: one PIN from the real plex.tv,
+  or, when plex.tv is down, its "couldn't reach plex.tv", so an outage fails no pull
+  request. A real claim needs a real account's token, which fork PRs must never get.
+  The nightly job (`.github/workflows/plex.yml`), on `main` (on a schedule, or by hand,
+  by a maintainer; the job checks the branch), with the `PLEX_TOKEN` secret, does
+  nothing without it, masks each value it derives (`::add-mask::`), runs on amd64 and
+  arm64, claims a Plex with the real plex.tv, and removes every server it noted from
+  the account in a last step that runs whatever happened (`DELETE
+  /devices/<id>.xml`, probed).
+- **No new Docker API call:** the helper uses the host helper's, and Plex's setup is the
+  same unpublished `up` and recreate as Jellyfin's (§7.2(2)).
```

**Change** `docs/plans/m1-roadmap.md`:

```diff
diff --git a/docs/plans/m1-roadmap.md b/docs/plans/m1-roadmap.md
index c360c92..ba920d5 100644
--- a/docs/plans/m1-roadmap.md
+++ b/docs/plans/m1-roadmap.md
@@ -24,2 +24,3 @@ Detailed plans so far:
 - Slice 6: [`m1-s6-requests.md`](m1-s6-requests.md) (done).
+- Slice 7: [`m1-s7-plex.md`](m1-s7-plex.md) (done).
 
@@ -27,5 +28,5 @@ Where M1 stands (the README shows the same):
 
-- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5 and S6.
-- **Next:** S7 (Plex).
-- **After that:** S8 and S9.
+- **Merged:** S1, S2a, S2b, S2c, S3a, S3d, S3b, S3c, S4, S5, S6 and S7.
+- **Next:** S8 (drift detection).
+- **After that:** S9.
 
@@ -187,3 +188,5 @@ item, and extended one, and its final review an S8 item and four S9 items. Slice
 (2026-10-16) added an S7 item and changed one, added five S8 items and changed one, and
-added an S9 item and changed one, and its final review an S8 item and an S9 item. Each
+added an S9 item and changed one, and its final review an S8 item and an S9 item. Slice 7
+(2026-10-16) marked the S7 items done, and added five S8 items and three S9 items, and
+its conflict check an S9 item. Each
 slice plan must address the items for that slice.
@@ -418,2 +421,6 @@ password, which are S3c's (and listed again below).
   threat model.
+  - **Done in S7:** each plex.tv call is a throwaway container of Mediaplane's image on
+    Docker's default bridge network, which reaches none of the stack's networks, with
+    the request on its standard input (ADR 0012, threat model T14). The proxy allows
+    nothing new.
 - **A login of your own for Plex, and for Seerr on Plex.** Plex's login is always
@@ -426,2 +433,4 @@ password, which are S3c's (and listed again below).
   Slice 7: remove that once Seerr's Plex sign-in is built.
+  - **Done in S7:** `login` may be `{ own: 'Plex' }`, or a function of the stack; Plex's
+    is your own, and Seerr's is too on a Plex stack. `notWiredYet` is gone.
 - **Seerr's Plex sign-in is open too** (S6, from Seerr 3.5's code). Before its first
@@ -430,4 +439,7 @@ password, which are S3c's (and listed again below).
   published, as S6 made the Jellyfin one, and give Seerr's resources a Plex media server.
+  - **Done in S7:** Seerr signs in with your token before it is published, and
+    `seerr.media_server_plex` links it to Plex.
 - **Plex's web UI is at `/web`.** `credentials` prints `http://<address>:<port>`
   for every app, so give the catalog a per-app web path.
+  - **Done in S7:** `webPath`, which `credentials` adds.
 
@@ -435,2 +447,20 @@ password, which are S3c's (and listed again below).
 
+- **Seerr keeps the Plex token it signed in with** (S7). After `plex-login` saves a new
+  token, Seerr still holds the old one, which it uses to reach Plex, and Mediaplane can't
+  check it with Seerr's key. When the old one is revoked, Seerr's libraries stop
+  syncing. Decide how drift finds it, and whether Mediaplane signs Seerr in again (which
+  needs the setup's care: never to a Seerr that isn't Mediaplane's).
+- **The arrs keep a Plex token while Plex takes it** (S7): a new token from `plex-login`
+  reaches them only once the old one is refused. Decide whether drift moves them to it.
+- **Plex's libraries are known by name** (S7), as Jellyfin's are: one renamed by hand
+  is left, and the next `apply` makes `Movies` or `TV Shows` again on the same folder.
+  Decide whether drift reports the renamed one. A folder added by hand is put back:
+  Keep mine must cover `location`.
+- **Plex's devices grow** (S7): each arr's first test of its connection to Plex lists
+  it among Plex's devices, and a Plex made anew lists them again. Decide whether drift
+  reports old ones.
+- **A Plex claimed by another account stays unpublished on every `apply`** (S7), with
+  its remedies in the error. Decide whether drift reports a Plex whose `PlexOnline`
+  settings were removed by hand while it runs, which then looks unclaimed to it.
+
 - Override field names are case-sensitive, so the managed-field comparison must
@@ -568,2 +598,17 @@ password, which are S3c's (and listed again below).
 
+- **The nightly Plex job** (S7) needs the repo secret `PLEX_TOKEN`, a token of a plex.tv
+  account kept for tests (owner). Until it is set, the job does nothing. It claims a
+  server each night on each architecture, and removes it in its last step; a run killed
+  before that step leaves one on the account, which the next run doesn't remove. Decide
+  whether a weekly sweep removes every server of the test account.
+- **Keep `PLEX_TOKEN` in a GitHub environment limited to `main`** (S7, owner): the
+  nightly job checks its branch, but only an environment stops a branch's own copy of
+  the workflow from reading the secret, for whoever can push a branch.
+- **A 429 from plex.tv counts as "couldn't tell"** (S7): it is retried after 5 and 15
+  seconds, and still fails closed, but its error says to run `apply` again rather than
+  that plex.tv refused. Revisit if plex.tv's limits bite.
+- **Docker's default bridge network** (S7): the plex.tv helper needs it. A daemon set up
+  with `"bridge": "none"` fails the helper. Decide whether `plan` checks for it on a Plex
+  stack.
+
 - **Repo setup (owner):** enable GitHub private vulnerability reporting, which
```

- [ ] **Step 6: Check the docs rules, and commit**

```bash
grep -rnE "Slice 7|S7 \(Plex\)" README.md catalog/*/README.md deploy/README.md docs/architecture.md docs/security docs/runbooks | grep -vE "including Slice 7\.|and S7 \(Plex\)\.|before Slice 7 published"
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check
git add README.md catalog deploy/README.md docs
git commit -m "docs: Plex, plex-login and the plex.tv helper, in the threat model, ADR 0012, the runbook, the READMEs, the spec and the roadmap" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `grep` prints nothing. The check passes (1865 tests pass in 88 files). Every `text` block in the changed
docs is at most 40 columns wide.

## Slice 7 completion checklist

- [ ] On this aarch64 machine, with the module loaded (`test -d /sys/module/wireguard ||
  sudo modprobe wireguard`), this passes:
  `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm docs:check && pnpm test:e2e`.
  Coverage stays at or above 90% on lines, functions, branches and statements. When this
  plan was replayed: 98.44% of statements, 93.5% of branches, 98.25% of functions and 99.46% of lines, with 1865 tests in 88 files.
- [ ] `pnpm test:e2e` passes with Compose 2.38.2 as the host plugin too, and leaves no
  `mediaplane-e2e-*` container or network, no new volume, and no `mediaplane-e2e-*`
  folder. When this plan was replayed, alone on the dev box, warm, without the plex.tv
  token (so the nightly test was skipped):
  - with Compose 5.5.1, 10 files and 25 tests (one skipped: the nightly test) in 797 s
    (Slice 6's suite took 669 s; the Plex file alone takes under four minutes);
  - with Compose 2.38.2, the same in 893 s (Slice 6's: 719 s).

  CI's e2e job allows 60 minutes, so `ci.yml` keeps its timeout.
- [ ] The nightly test passes with the test account's token, once (Task 6, Step 4), and
  the account lists no server afterwards. When this plan was replayed: 2 tests in 188 s, one server claimed and removed.
- [ ] The socket proxy's allow-list is unchanged: `git diff e83f86f --
  deploy/mediaplane.compose.yaml deploy/deploy.test.ts` prints nothing (decision 23).
  `e83f86f` is `main` after S6.
- [ ] Plex is never published while it can be claimed: the every-PR Plex e2e finds no port
  while it is unclaimed, after `apply` fails at its setup; the unit tests keep it
  unpublished when another account claimed it, when it says a machine identifier of a
  Plex of yours, when plex.tv refuses its token or can't be asked, and when its file
  holds no token or can't be read, and when it lets a network in without a sign-in. A
  Plex that runs published and unclaimed is stopped when no claim token can be had (the
  CLI test), and the start step changes nothing else first. Seerr on a Plex stack is
  never published while its sign-in is open, nor when its admin isn't your account.
- [ ] Plex never gets your token before plex.tv says it is yours: the step-level test of
  Plex's setup finds no `/identity` request with `X-Plex-Token`, and only `/:/prefs`,
  after the ownership check, with it.
- [ ] No secret shows: the tests that check it pass (your Plex token, claim tokens and
  Plex's own token in neither `compose.yaml`, `.env`, `state/`, a change record nor the
  CLI's output; `plex-login` never prints the token; the helper's and the client's
  messages never hold a token; the nightly test masks each value it makes).
- [ ] `plan` never calls plex.tv, never claims Plex, never signs Seerr in: the CLI test's
  `plan` of a new Plex stack makes no plex.tv call. Its marks in the apps are the five the
  spec, the threat model and the architecture name.
- [ ] No committed file contains a real path, user name, host name, address, token or
  plex.tv id: `git grep -n -i -e cyclopsgd -e '/home/' -- ':!docs/plans'` prints nothing
  but the project's own names (its GitHub repo and schema URL, its GHCR image, the nightly
  job's repository guard) and the tests' fake `/srv/data/home` paths.
- [ ] Every commit ends with the single `Co-Authored-By` line, and none has a
  `Claude-Session` line: `git log --format=%B e83f86f.. | grep -c Claude-Session` prints
  `0`.
- [ ] Every task is committed, and `git status` is clean.
- [ ] Nothing has been pushed. Report to the controller:
  - the (check) decisions, for the controller and the owner to confirm or reverse, in
    particular 2 (the claim token in Plex's unpublished container's environment, as §6.1
    says), 3 (ownership by plex.tv's answer for Plex's own token), 6 (the helper on the
    default bridge), 9 (a 429 counts as "couldn't tell"), 14 (Plex's relay left on, as
    Plex sets it), 16 (the Jellyfin connection now reads TLS or a URL base as moved too),
    18 (`seerr.media_server_plex`), 20 (the every-PR e2e) and 21 (the nightly job on
    both architectures);
  - for the owner: set the `PLEX_TOKEN` secret, a token of a plex.tv account kept for
    tests, never your own, in a GitHub environment limited to `main` (until then the
    nightly job does nothing); the first
    nightly run on `main` confirms it on Docker 28 and Compose 2.38.2, on amd64 and
    arm64;
  - for the owner's manual-steps list: run `mediaplane plex-login` once, before the first
    `apply` of a Plex stack; a Plex claimed by hand with another account stays
    unpublished until you follow the runbook; Seerr keeps the token it signed in with
    after a new `plex-login`.
