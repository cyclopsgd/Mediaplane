# Contributing to Mediaplane

## Setup

You need Node 24 (see `.nvmrc`), pnpm through Corepack, and Docker. The secret-scan hook
uses Docker, and so do the end-to-end tests (`pnpm test:e2e`).

```bash
corepack enable
pnpm install        # also points git at the repo's hooks in .githooks/
```

To run Mediaplane itself from the checkout, against this machine's Docker, see
[Try Mediaplane from source](docs/try-from-source.md).

## Everyday commands

- `pnpm test`: unit tests (Vitest).
- `pnpm test:coverage`: unit tests with coverage thresholds.
- `pnpm test:e2e`: end-to-end tests against real Docker.
- `pnpm lint`: ESLint and the Prettier check.
- `pnpm format`: rewrite files with Prettier.
- `pnpm typecheck`: type-check the whole repo.
- `pnpm docs:generate`: rewrite the generated docs in `docs/reference/` and the apps'
  READMEs. CI runs `pnpm docs:check`, which also fails on a link in the docs that leads
  nowhere.

After changing `packages/engine/src/config/schema.ts`, a command or option in
`packages/cli/src/run.ts`, a `--json` document in `packages/cli/src/contract.ts`, or an
app in `catalog/`, run `pnpm docs:generate` and commit what it writes. CI fails while the
generated docs are stale.

A field added to what a command prints with `--json` must be added to its document in
`packages/cli/src/contract.ts` too, with what it means: until it is, `pnpm typecheck`
fails (`contract.test.ts`), and so do the CLI tests that print it (`run.test.ts` checks
every document it prints). Within v1 a document only gains fields and values; a field
that changes meaning needs a v2.

The unit tests use in-memory fakes for Docker and the host. The apps' APIs are fake
HTTP servers on 127.0.0.1 (`fakeHttpApp` in `@mediaplane/engine/testing`, §8.1(2) of the
spec), which the CLI's tests reach through `CliDeps.wiring`; no unit test reaches a real
app. One client test spawns a Node process, to check that no proxy sees a key.

The spawned-CLI tests in `packages/cli/src/main.test.ts` and `pnpm test:e2e` use the
real Docker, under their own Compose project names, so they never touch a real stack.
The end-to-end suite passes its own project names (starting `mediaplane-e2e-`) straight
to the engine; the spawned-CLI tests set `MEDIAPLANE_COMPOSE_PROJECT`.
`MEDIAPLANE_COMPOSE_PROJECT` is for tests and dev; the generated header's eject command
always names the default `mediaplane` project.

The apply end-to-end test pulls the full app stack the first time, about 7 GB, and
starts it, so allow several minutes. The test files run one at a time because they
share host ports. CI pulls every image the suite runs before it starts
(`scripts/ci/pull-images.ts`), retrying a temporary registry error for longer than
`apply` does, so a registry's bad minute doesn't fail the job. After each file,
`test/e2e/setup.ts` removes whatever its tests left in Docker, by this run's names
(`mediaplane-e2e-<pid>`), and fails the file naming it: a test that times out never
reaches its own teardown. The harness's own unit tests are `test/e2e/*.unit.test.ts`,
which `pnpm test` runs.

The playbook test (`test/e2e/playbook.e2e.test.ts`) drives Mediaplane's container as a
playbook would ([Deploying with automation](docs/automation.md)): no terminal, only exit
codes and `--json` documents, each checked against its published JSON Schema in
`docs/reference/json/`.

The VPN kill-switch test (`test/e2e/vpn.e2e.test.ts`) runs a WireGuard server in a
container, which needs the host's `wireguard` kernel module: run
`sudo modprobe wireguard` once after each boot. CI does this in its end-to-end job. The
test fails, and never skips, without it. The download-path test
(`test/e2e/download.e2e.test.ts`), which shows Sonarr and Radarr reaching qBittorrent
through Gluetun, runs a WireGuard server too, so it needs the module as well.

The Jellyfin test (`test/e2e/jellyfin.e2e.test.ts`) shows Jellyfin set up before its
port is published, its libraries, and Sonarr's and Radarr's connections to it, each put
back after a change by hand. It needs no outside account.

The Plex test (`test/e2e/plex.e2e.test.ts`) runs a real Plex against a fake plex.tv, so
it needs no account either. Plex's image sends the fake claim token to the real plex.tv,
which refuses it, so Plex never claims itself, and the test checks that it is never
published. The deploy test runs `mediaplane plex-login` from the image, through its
helper and the proxy: it asks the real plex.tv for one PIN, which needs no account, and
passes when plex.tv is down too.

A real claim needs a real account's token, which a pull request from a fork must never
get. So the same file's last test runs only in the nightly Plex job
(`.github/workflows/plex.yml`), and is skipped without a token:

- it runs on `main` only, on a schedule or by hand, never for a pull request, and does
  nothing without the `PLEX_TOKEN` secret;
- it names `environment: plex`, a GitHub environment that can hold the secret and
  limit it to `main`;
- it claims a real Plex with the test account, wires the stack, checks each link, and
  checks that the Plex it publishes holds no `PLEX_CLAIM`;
- it hides each value it makes from the token (`::add-mask::`), as GitHub hides only
  the secret itself;
- its two architectures run one at a time, sharing the test account, and each removes
  only the servers it noted, in a last step that runs whatever happened.

Set `PLEX_TOKEN` as a secret of the `plex` environment, limited to `main`, to the token
of a **test** plex.tv account, kept for this job, never your own. To
run that test locally, put such a token in a file only you can read, and point
`MEDIAPLANE_E2E_PLEX_TOKEN_FILE` at it. The test removes the server it claimed from the
account when it ends, passed or not.

The indexers test (`test/e2e/indexers.e2e.test.ts`) serves made-up indexers of its own,
from a container outside the stack, so it never touches a real one. It needs the
internet all the same, and so does the apply test (`test/e2e/apply.e2e.test.ts`), which
makes Prowlarr's proxy too. They are the two tests that run Prowlarr: Byparr's health
check loads a web page, and Prowlarr tests its new proxy by having Byparr fetch a page
of Prowlarr's own service (`prowlarr.servarr.com`).

Before committing, run
`pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm docs:check`.

### The image

`pnpm bundle` writes the CLI as one file, `dist/mediaplane.mjs`, which is what the image
runs. To build the image, and to test it end to end (each test builds its own copy):

```bash
docker build --tag mediaplane:local .
pnpm vitest run --config vitest.e2e.config.ts test/e2e/image.e2e.test.ts test/e2e/deploy.e2e.test.ts
```

The deploy test starts `deploy/mediaplane.compose.yaml` under its own names and applies a
small stack from inside the container.

CI runs these jobs:

- lint, type-check and unit tests, then `pnpm audit` of the CLI's production
  dependencies, which fails on a critical advisory (they are bundled into one file, where
  the image scan can't see them);
- the end-to-end tests, natively on amd64 and on arm64 runners;
- an image build on each of the two, scanned with Trivy (its Alpine packages and its Go
  binaries), which fails on a critical vulnerability that has a fix;
- a Trivy scan of every image the catalog pins, which reports a critical vulnerability
  that has a fix, and does not fail on it (only the app's maker can fix it): to fail on
  it, change `CATALOG_SCAN: report` to `fail` on the `catalog-images` job in
  `.github/workflows/ci.yml`;
- gitleaks, over the full history.

Apart from these, the nightly Plex job (above) runs on `main` only.

A change to docs only skips the end-to-end and image jobs. Branch protection should
require only the last job, `All checks passed`, because the per-architecture checks
never appear on a docs-only push.

The Docker API calls the engine may make are listed in `deploy/deploy.test.ts`. A change
that needs a new one must add it there, to the proxy's allow-list, and to ADR 0008.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `test:`, `refactor:`, `chore:` and `ci:`. release-please makes the versions and
`CHANGELOG.md` from them: before 1.0, a `fix:` raises the patch number, and a `feat:` or a
breaking change (`feat!:`) the minor one. [Releasing](docs/releasing.md) has the rest.

## Pins

Every image is pinned by tag and digest, and every Action by commit SHA with its
version in a comment; `scripts/supply-chain.test.ts` checks both. Once the Renovate app
is installed (an owner's step), Renovate keeps them current (`renovate.json`). A pinned
image goes in a file Renovate reads: a catalog `app.ts`, the `Dockerfile`,
`deploy/mediaplane.compose.yaml`, a workflow, the pre-commit hook, a script in
`scripts/ci/` or an end-to-end test. A bump of an app's pin changes its README's facts:
run `pnpm docs:generate` on its branch.

## Never commit real secrets

This repository is public. Anything in git history is permanent.

- Never commit real API keys, tokens, VPN keys or passwords, or your own `stack.yaml`.
- Test fixtures use obviously fake values: zeros (`000…`), `qbt_000…`, or strings
  starting with `fake-`. `.gitleaks.toml` allows exactly these.
- The pre-commit hook runs gitleaks on staged changes. It uses a local `gitleaks` if you
  have one, and Docker otherwise. CI scans the full history on every push to `main` and
  on every pull request.

## Adding an app

An app is one folder in `catalog/`, and nothing else in the engine changes. Step by step:

1. **Check that it fits.** Mediaplane runs the app's own upstream image, unmodified
   ([ADR 0001](docs/adr/0001-dont-fork-upstream-apps.md)), configured through its
   environment, its files and its API. The image must run on amd64 and arm64.
2. **Write `catalog/<id>/app.ts`** with `defineApp({ … })`. `<id>` is the name
   `stack.yaml` lists it by. Start from an app like it: `catalog/byparr/app.ts` for one
   Mediaplane only runs, `catalog/sonarr/app.ts` for one it wires. Each field is
   described in `packages/engine/src/catalog/types.ts`:
   - `image`: its repository, an exact tag and the multi-arch digest, which
     `docker buildx imagetools inspect <repo>:<tag>` shows;
   - `ports`: name the web UI's `web`, as `mediaplane credentials` looks for it, and give
     a port the LAN needs no access to `publish: false`;
   - `volumes`, `runAs` (how the image picks its user), `health` (a check that passes
     once the app answers), `secrets` and `credentials` (its keys, and how it is given
     them), `provides` and `requires`, and `login`.
3. **Add it to `catalog/index.ts`,** in order of id.
4. **Write `catalog/<id>/README.md`:** what the app is for, then the two lines
   `<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts. Do not edit. -->` and
   `<!-- END GENERATED -->`, where `pnpm docs:generate` writes its facts; then what
   Mediaplane does in it, how to change that, and its known issues.
5. **To wire it,** give it an `api` (its port, a path that answers once it is ready, its
   key and how a request carries it) and an `integration.ts`: the apps it comes `after`,
   and its resources, each with its managed fields and secrets, and how to read it, check
   its secrets, create, update and remove it. `catalog/_shared/servarr*.ts` is the model
   for Servarr apps, and `catalog/qbittorrent/` for one with a form API. A first-run
   setup that anyone could finish goes in `bootstrap`, which runs before the app is
   published (spec §6.4); files the app reads at its first start go in `configFiles`; and
   where it keeps its own keys, for a rebuilt host to recover them, in `keyFiles`.
6. **Test it.** Unit tests reach a fake of its API (`fakeHttpApp` in
   `@mediaplane/engine/testing`), made no kinder than the app: ask the real app first,
   and give the fake the same answers. `catalog/catalog.test.ts` checks every app's
   definition by itself: its pin, its architectures, its ports, its resources' names.
   Then add the app to an end-to-end test that applies it against real Docker, which CI
   runs on both architectures.
7. **Run `pnpm docs:generate`.** The `stack.yaml` reference, its JSON Schema and the
   app's README facts now name it.
8. **Keep its pin current.** `renovate.json` is set up so that Renovate's catalog manager
   reads every `catalog/*/app.ts`; it takes effect once the Renovate app is installed (an
   owner's step). A tag that isn't a plain version, such as linuxserver.io's
   `-ls<revision>`, needs a versioning rule in `renovate.json`, which
   `scripts/supply-chain.test.ts` checks.
9. **Run the full check** (above), and `pnpm test:e2e`.

## Design decisions

Significant decisions get an Architecture Decision Record in `docs/adr/`. Copy
`0000-template.md` and take the next free number.
