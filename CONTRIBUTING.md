# Contributing to Mediaplane

## Setup

You need Node 24 (see `.nvmrc`), pnpm through Corepack, and Docker. The secret-scan hook
uses Docker, and so do the end-to-end tests (`pnpm test:e2e`).

```bash
corepack enable
pnpm install        # also points git at the repo's hooks in .githooks/
```

## Everyday commands

| Command              | What it does                         |
| -------------------- | ------------------------------------ |
| `pnpm test`          | Unit tests (Vitest)                  |
| `pnpm test:coverage` | Unit tests with coverage thresholds  |
| `pnpm test:e2e`      | End-to-end tests against real Docker |
| `pnpm lint`          | ESLint and the Prettier check        |
| `pnpm format`        | Rewrite files with Prettier          |
| `pnpm typecheck`     | Type-check the whole repo            |

The unit tests use in-memory fakes for Docker and the host. The spawned-CLI tests in
`packages/cli/src/main.test.ts` and `pnpm test:e2e` use the real Docker, under their own
Compose project names, so they never touch a real stack. The end-to-end suite passes its
own project names (starting `mediaplane-e2e-`) straight to the engine; the spawned-CLI
tests set `MEDIAPLANE_COMPOSE_PROJECT`.

Before committing, run `pnpm format && pnpm lint && pnpm typecheck && pnpm test`.

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
