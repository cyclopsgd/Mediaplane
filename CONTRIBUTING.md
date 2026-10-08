# Contributing to Mediaplane

## Setup

You need Node 24 (see `.nvmrc`), pnpm through Corepack, and Docker. The secret-scan hook
uses Docker, and so will the end-to-end tests later.

```bash
corepack enable
pnpm install        # also points git at the repo's hooks in .githooks/
```

## Everyday commands

| Command              | What it does                        |
| -------------------- | ----------------------------------- |
| `pnpm test`          | Unit tests (Vitest)                 |
| `pnpm test:coverage` | Unit tests with coverage thresholds |
| `pnpm lint`          | ESLint and the Prettier check       |
| `pnpm format`        | Rewrite files with Prettier         |
| `pnpm typecheck`     | Type-check the whole repo           |

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
  have one, and Docker otherwise. CI scans the full history on every push.

## Design decisions

Significant decisions get an Architecture Decision Record in `docs/adr/`. Copy
`0000-template.md` and take the next free number.
