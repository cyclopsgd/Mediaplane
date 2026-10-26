# Contributing to Mediaplane

## Setup

You need Node 24 (see `.nvmrc`), pnpm through Corepack, and Docker. The secret-scan hook
uses Docker, and so do the end-to-end tests (`pnpm test:e2e`).

```bash
corepack enable
pnpm install        # also points git at the repo's hooks in .githooks/
```

## Everyday commands

| Command              | What it does                                                                |
| -------------------- | --------------------------------------------------------------------------- |
| `pnpm test`          | Unit tests (Vitest)                                                         |
| `pnpm test:coverage` | Unit tests with coverage thresholds                                         |
| `pnpm test:e2e`      | End-to-end tests against real Docker                                        |
| `pnpm lint`          | ESLint and the Prettier check                                               |
| `pnpm format`        | Rewrite files with Prettier                                                 |
| `pnpm typecheck`     | Type-check the whole repo                                                   |
| `pnpm docs:generate` | Rewrite the generated docs in `docs/reference/` (CI runs `pnpm docs:check`) |

After changing `packages/engine/src/config/schema.ts`, a command or option in
`packages/cli/src/run.ts`, or an app in `catalog/`, run `pnpm docs:generate` and commit
what it writes. CI fails while the generated docs are stale.

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
share host ports.

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

This repository is public, or will be. Anything in git history is permanent.

- Never commit real API keys, tokens, VPN keys or passwords, or your own `stack.yaml`.
- Test fixtures use obviously fake values: zeros (`000…`), `qbt_000…`, or strings
  starting with `fake-`. `.gitleaks.toml` allows exactly these.
- The pre-commit hook runs gitleaks on staged changes. It uses a local `gitleaks` if you
  have one, and Docker otherwise. CI scans the full history on every push to `main` and
  on every pull request.

## Design decisions

Significant decisions get an Architecture Decision Record in `docs/adr/`. Copy
`0000-template.md` and take the next free number.
