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

The unit tests use in-memory fakes for Docker and the host. The spawned-CLI tests in
`packages/cli/src/main.test.ts` and `pnpm test:e2e` use the real Docker, under their own
Compose project names, so they never touch a real stack. The end-to-end suite passes its
own project names (starting `mediaplane-e2e-`) straight to the engine; the spawned-CLI
tests set `MEDIAPLANE_COMPOSE_PROJECT`. `MEDIAPLANE_COMPOSE_PROJECT` is for tests and
dev; the generated header's eject command always names the default `mediaplane`
project.

The apply end-to-end test pulls the full app stack the first time, about 7 GB, and
starts it, so allow several minutes. The test files run one at a time because they
share host ports.

The VPN kill-switch test (`test/e2e/vpn.e2e.test.ts`) runs a WireGuard server in a
container, which needs the host's `wireguard` kernel module: run
`sudo modprobe wireguard` once after each boot. CI does this in its end-to-end job. The
test fails, and never skips, without it.

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

A change to docs only skips the end-to-end and image jobs. Branch protection should
require only the last job, `All checks passed`, because the per-architecture checks
never appear on a docs-only push.

The Docker API calls the engine may make are listed in `deploy/deploy.test.ts`. A change
that needs a new one must add it there, to the proxy's allow-list, and to ADR 0008.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `test:`, `refactor:`, `chore:` and `ci:`. Release notes are generated from them.

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
