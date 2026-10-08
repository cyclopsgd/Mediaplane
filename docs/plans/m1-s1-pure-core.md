# M1 Slice 1: Pure core implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm/TypeScript monorepo where `mediaplane plan` reads a `stack.yaml`, validates it against a pinned app catalog, and shows exactly which Docker Compose file it would write. It gives actionable errors and needs no Docker.

**Architecture:** Three workspace packages.

- `@mediaplane/engine` holds the pure logic: config, resolver, renderer and file planner.
- `@mediaplane/catalog` holds the app definitions, built with the engine's `defineApp`. The engine never imports the catalog; the CLI injects it.
- `@mediaplane/cli` is a thin Commander wrapper around the engine.

The data flows like this:

1. **Config:** `stack.yaml` is parsed with `yaml` and validated with Zod into a `StackConfig`.
2. **Resolver:** `StackConfig`, the catalog and the `HostFacts` become a `ResolvedStack`. The resolver works out which apps are enabled, their options, ports, images and bind addresses.
3. **Renderer:** `ResolvedStack` becomes a `ComposeFile` object, which is turned into deterministic YAML.
4. **File planner:** the YAML is diffed against `generated/compose.yaml` on disk.

**Tech Stack:**

- **Language and runtime:** Node 24, pnpm 10.15.0 workspaces, TypeScript (strict, `noEmit`, `moduleResolution: bundler`).
- **Libraries:** Zod 4, `yaml` 2, `diff` (jsdiff), Commander.
- **Tooling:** Vitest with v8 coverage, ESLint (typescript-eslint strict-type-checked), Prettier, and tsx to run the CLI from source.

**Spec:** [`docs/design/m1-engine-cli.md`](../design/m1-engine-cli.md). Slice context: [`docs/plans/m1-roadmap.md`](m1-roadmap.md).

## Global Constraints

- **Runtime and tooling:** Node `>=24` (`.nvmrc` = `24`); `packageManager` is `pnpm@10.15.0`; ESM only (`"type": "module"`).
- **Licence:** GPL-3.0, from the repo's `LICENSE`. There are no per-file headers.
- **The repo will become public, so git history is permanent.**
  - Never commit real secrets.
  - Fake values only: `0` repeated (`'0'.repeat(32)`), `qbt_` followed by 28 zeros, or strings starting `fake-`.
- **Neutral framing.** Docs, fixtures, test names and examples describe a self-hosted media platform for the user's own library. They contain no piracy-flavoured language.
- **Catalog images** are pinned by exact tag **and** multi-arch index digest (`sha256:` + 64 hex). Every M1 app's `arch` includes `amd64` and `arm64`.
- **No inline secrets in `stack.yaml`.** Secret fields accept only `{ file: … }` or `{ env: … }` (ADR 0009).
- **The generated `compose.yaml` contains no secret values.** It only contains `${MP_<APP>_<SECRET>}` references (for example `${MP_SONARR_API_KEY}`).
- **Determinism.**
  - Identical input gives byte-identical output.
  - Never sort with `localeCompare`; use `compare` from `packages/engine/src/util/sort.ts`.
  - Services are ordered by app id, and environment keys are sorted.
- **CLI.** Every command supports `--json`, and JSON output carries `"schema": "mediaplane.<command>/v1"`. `plan` exits `0` for no changes, `2` when changes are pending, and `1` on errors.
- **Formatting:** Prettier with `printWidth: 90` and `singleQuote: true`.
- **Docs locations:** design docs in `docs/design/`, plans in `docs/plans/`, ADRs in `docs/adr/NNNN-kebab-title.md`.
- **Commits:** Conventional Commits.
- **Do not push, and do not change GitHub settings.** The repo owner pushes.
- **Before every commit, run** `pnpm format && pnpm lint && pnpm typecheck && pnpm test`. The pre-commit hook then scans staged changes with gitleaks.

## File structure (end of Slice 1)

```
.
├── package.json, pnpm-workspace.yaml, pnpm-lock.yaml
├── tsconfig.base.json, tsconfig.json, eslint.config.js, vitest.config.ts
├── .prettierrc.json, .prettierignore, .editorconfig, .gitattributes, .gitignore, .nvmrc
├── .gitleaks.toml, .githooks/pre-commit
├── .github/workflows/ci.yml
├── LICENSE, README.md, CONTRIBUTING.md, SECURITY.md
├── docs/adr/0000-template.md, 0001-…, 0002-…, 0005-…, 0009-…
├── packages/engine/
│   ├── package.json
│   └── src/
│       ├── index.ts                 public API (re-exports)
│       ├── diagnostics.ts           Diagnostic type + constructors
│       ├── util/did-you-mean.ts     edit distance + suggestion
│       ├── util/sort.ts             locale-independent compare, unique
│       ├── util/fs.ts               readIfExists
│       ├── config/schema.ts         Zod schema for stack.yaml v1
│       ├── config/load.ts           read + parse + validate → diagnostics
│       ├── config/secrets.ts        secret references: list, read, check
│       ├── catalog/types.ts         AppDefinition contract + defineApp
│       ├── host/facts.ts            HostFacts + detection (arch, private IPv4)
│       ├── resolver/resolve.ts      StackConfig + Catalog + HostFacts → ResolvedStack
│       ├── render/compose.ts        ResolvedStack → ComposeFile
│       ├── render/yaml.ts           ComposeFile → YAML text
│       ├── render/__golden__/       reviewed golden outputs
│       ├── plan/files.ts            diff rendered files against disk
│       ├── plan/plan.ts             plan(): the whole pipeline
│       └── testing/fixtures.ts      fixture catalog, host and config helpers (tests only)
├── catalog/
│   ├── package.json, index.ts, catalog.test.ts, render.test.ts
│   ├── _shared/servarr.ts
│   └── byparr/ flaresolverr/ gluetun/ jellyfin/ plex/ prowlarr/ qbittorrent/ radarr/ seerr/ sonarr/   (each: app.ts)
└── packages/cli/
    ├── package.json
    └── src/ version.ts, run.ts, output.ts, main.ts (+ tests)
```

Tests sit next to the file they test, as `*.test.ts`.

---

### Task 1: Repository scaffold, checks and secret scanning

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `.editorconfig`, `.gitattributes`, `.gitignore`
- Create: `packages/cli/package.json`, `packages/cli/src/version.ts`
- Test: `packages/cli/src/version.test.ts`
- Create: `.gitleaks.toml`, `.githooks/pre-commit`, `.github/workflows/ci.yml`
- Create: `LICENSE`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/adr/0000-template.md`, `docs/adr/0001-dont-fork-upstream-apps.md`, `docs/adr/0005-typescript-on-node.md`

**Interfaces:**
- Produces:
  - **Root scripts:** `lint`, `format`, `typecheck`, `test`, `test:coverage`.
  - **Workspace globs:** `packages/*` and `catalog`.
  - **CLI version:** `export const VERSION: string` in `packages/cli/src/version.ts`.

- [ ] **Step 1: Create the root configuration files**

`package.json`:

```json
{
  "name": "mediaplane",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.15.0",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "prepare": "git config core.hooksPath .githooks || true",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
  - catalog
onlyBuiltDependencies:
  - esbuild
```

`.nvmrc`:

```
24
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

`tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "include": ["packages/*/src/**/*.ts", "catalog/**/*.ts", "vitest.config.ts"],
  "exclude": ["**/node_modules", "**/coverage"]
}
```

`eslint.config.js`:

```js
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/node_modules/', '**/coverage/', '**/dist/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
);
```

`.prettierrc.json`:

```json
{
  "printWidth": 90,
  "singleQuote": true
}
```

`.prettierignore`:

```
pnpm-lock.yaml
coverage/
**/__golden__/
docs/design/
docs/plans/
LICENSE
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'catalog/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/{resolver,render,plan}/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
```

`.editorconfig`:

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

`.gitattributes`:

```
* text=auto eol=lf
```

`.gitignore`:

```
node_modules/
coverage/
dist/
*.log
.DS_Store

# Local Mediaplane homes used while developing. Never commit real stacks or secrets.
/.mediaplane-dev/
/stack.yaml
/secrets/
```

- [ ] **Step 2: Create the CLI package skeleton**

`packages/cli/package.json`:

```json
{
  "name": "@mediaplane/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
```

- [ ] **Step 3: Install the dev tooling**

Run:

```bash
pnpm add -Dw typescript @types/node@24 vitest @vitest/coverage-v8 eslint @eslint/js typescript-eslint prettier tsx
```

Expected: `pnpm-lock.yaml` and `node_modules/` are created. `package.json` gains a `devDependencies` block. The output must not report any "Ignored build scripts" warning for esbuild, because `onlyBuiltDependencies` allows it.

- [ ] **Step 4: Write the failing test**

`packages/cli/src/version.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

describe('VERSION', () => {
  it('matches the CLI package version', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm vitest run packages/cli/src/version.test.ts`
Expected: FAIL, because `./version` cannot be resolved.

- [ ] **Step 6: Write the minimal implementation**

`packages/cli/src/version.ts`:

```ts
/** Kept in step with packages/cli/package.json (release tooling bumps both). */
export const VERSION = '0.0.0';
```

- [ ] **Step 7: Run it to verify it passes**

Run: `pnpm vitest run packages/cli/src/version.test.ts`
Expected: PASS (1 test).

- [ ] **Step 8: Add secret scanning**

`.gitleaks.toml`:

```toml
title = "Mediaplane gitleaks config"

[extend]
useDefault = true

[[allowlists]]
description = "Obviously fake values used in tests, fixtures and docs"
regexes = ['''0{32}''', '''qbt_0{28}''', '''fake-[a-z0-9-]+''']
```

`.githooks/pre-commit`:

```sh
#!/usr/bin/env sh
# Scan staged changes for secrets before every commit.
# Uses a local gitleaks if installed, otherwise the pinned gitleaks container.
set -e
IMAGE='ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f'
ROOT="$(git rev-parse --show-toplevel)"

if command -v gitleaks >/dev/null 2>&1; then
  exec gitleaks git "$ROOT" --pre-commit --staged --redact --verbose --config "$ROOT/.gitleaks.toml"
elif command -v docker >/dev/null 2>&1; then
  exec docker run --rm --user "$(id -u):$(id -g)" -v "$ROOT:/repo" "$IMAGE" \
    git /repo --pre-commit --staged --redact --verbose --config /repo/.gitleaks.toml
else
  echo "pre-commit: neither gitleaks nor docker found; secret scan SKIPPED" >&2
fi
```

Run:

```bash
chmod +x .githooks/pre-commit
pnpm install
git config core.hooksPath
```

Expected: the last command prints `.githooks`. The `prepare` script set it during `pnpm install`.

- [ ] **Step 9: Prove the hook blocks a secret**

Generate a realistic-looking GitHub token at runtime. A literal one must never appear in any file, this plan included.

```bash
printf 'token = ghp_%s\n' "$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 36)" > leak-test.txt
git add leak-test.txt
git commit -m "test: this commit must be blocked"; echo "exit=$?"
```

Expected:
- gitleaks prints a `github-pat` finding with the value redacted;
- the command shows `exit=1`;
- `git log` shows no new commit.

Clean up:

```bash
git rm --cached -q leak-test.txt && rm leak-test.txt
git status --short
```

Expected: `leak-test.txt` no longer appears.

- [ ] **Step 10: Add CI**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    name: Lint, type-check and test
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:coverage

  secrets:
    name: Secret scan (gitleaks, full history)
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
      - name: gitleaks
        run: >-
          docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/repo"
          ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
          git /repo --config /repo/.gitleaks.toml --redact --verbose
```

- [ ] **Step 11: Add the licence, project docs and the first ADRs**

Run:

```bash
curl -fsSL https://www.gnu.org/licenses/gpl-3.0.txt -o LICENSE && head -3 LICENSE
```

Expected: the output includes `GNU GENERAL PUBLIC LICENSE` and `Version 3, 29 June 2007`.

`README.md`:

````markdown
# Mediaplane

> **Status: pre-alpha.** Milestone 1 (engine and CLI) is in progress. Nothing here is usable yet.

Mediaplane is an open-source control plane for a self-hosted media stack. You describe the
stack you want in one file, `stack.yaml`, and Mediaplane will:

- deploy it as a plain Docker Compose project that you can read, manage with other tools,
  or keep running without Mediaplane;
- generate every API key and password up front, so you never copy one between apps;
- wire the apps together through their own APIs: download clients, indexer sync, root
  folders, and the media-server and request-app connections;
- keep watching, and tell you when something was changed by hand, without overwriting it.

It runs as a single container on an existing Linux host (amd64 or arm64), with Jellyfin or
Plex as the media server.

## Design

- [M1 design: engine and CLI](docs/design/m1-engine-cli.md)
- [Architecture decision records](docs/adr/)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security issue, see
[SECURITY.md](SECURITY.md).

## Licence

[GPL-3.0](LICENSE)
````

`CONTRIBUTING.md`:

````markdown
# Contributing to Mediaplane

## Setup

You need Node 24 (see `.nvmrc`), pnpm through Corepack, and Docker. The secret-scan hook
uses Docker, and so will the end-to-end tests later.

```bash
corepack enable
pnpm install        # also points git at the repo's hooks in .githooks/
```

## Everyday commands

| Command              | What it does                            |
| -------------------- | --------------------------------------- |
| `pnpm test`          | Unit tests (Vitest)                     |
| `pnpm test:coverage` | Unit tests with coverage thresholds     |
| `pnpm lint`          | ESLint and the Prettier check           |
| `pnpm format`        | Rewrite files with Prettier             |
| `pnpm typecheck`     | Type-check the whole repo               |

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
````

`SECURITY.md`:

```markdown
# Security policy

## Supported versions

Mediaplane is pre-1.0. Only the latest release receives security fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability reporting.
Open the repository's **Security** tab and choose **Report a vulnerability**. Please do
not open a public issue.

## Scope

Mediaplane controls Docker on its host, which is equivalent to root access. These are in
scope:

- anything that lets someone drive Mediaplane without authorisation;
- anything that lets someone read its secrets;
- anything that makes it act outside its own Compose project.

Vulnerabilities in the upstream apps that Mediaplane deploys, such as Sonarr or Jellyfin,
should be reported to those projects.
```

`docs/adr/0000-template.md`:

```markdown
# NNNN. Title in the imperative

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context

What forces are at play, and what problem does this decision solve?

## Decision

What we decided, stated plainly.

## Consequences

What becomes easier or harder, including the downsides.
```

`docs/adr/0001-dont-fork-upstream-apps.md`:

```markdown
# 0001. Don't fork upstream apps

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Mediaplane exists to make a self-hosted media stack easy to set up and keep wired
together. Forking Sonarr, Radarr, Prowlarr, Jellyfin and the others would let us change
their behaviour. But it would also make us responsible for merging roughly ten
fast-moving codebases forever. Everything we need is reachable from outside the apps:

- pre-set API keys, through env vars and config files;
- connections between apps, through their REST APIs;
- read-back for drift detection, also through their APIs.

## Decision

Mediaplane deploys **unmodified upstream images**. It configures them only through
documented environment variables, the config files they read, and their REST APIs.

## Consequences

- Upstream fixes and security patches reach users as soon as a pinned version is bumped.
- Users can follow upstream documentation, because each app behaves as it does upstream.
- We are limited to what upstream exposes. For example, Jellyfin's API key cannot be
  chosen, so Mediaplane creates it after first-run setup.
- Upstream API changes can break the wiring. Tested-set pinning and the end-to-end tests
  on every version bump guard against that.
```

`docs/adr/0005-typescript-on-node.md`:

```markdown
# 0005. TypeScript on Node

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Mediaplane needs an engine and a CLI now, and a web panel in M2. The maintainer works
mostly in TypeScript. The main alternative was Go, which offers a single static binary
and Docker's own Compose libraries.

## Decision

Write Mediaplane in TypeScript on Node 24 LTS, as a pnpm workspace:

- **Zod** validates `stack.yaml` and generates its JSON Schema.
- **Vitest** runs the tests.
- **The Docker Compose CLI** is driven as a subprocess instead of being embedded as a
  library.

## Consequences

- One language covers the engine, the CLI and the M2 web UI.
- The `stack.yaml` reference and JSON Schema come straight from the Zod schema, so they
  cannot drift from the code.
- Compose behaviour comes from the real CLI. Only the runtime module talks to it, and the
  Compose version is pinned in the image.
- The image carries a Node runtime, so it is larger than a Go binary would be.
```

- [ ] **Step 12: Run every check**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm test`
Expected: Prettier rewrites any files it needs to, then ESLint, Prettier's check and `tsc` all pass. Vitest reports 1 passed.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: scaffold workspace, checks, secret scanning and project docs"
```

Expected: the hook prints `no leaks found`, and the commit is created.

---

### Task 2: Diagnostics and suggestion helpers

**Files:**
- Create: `packages/engine/package.json`, `packages/engine/src/index.ts`, `packages/engine/src/diagnostics.ts`, `packages/engine/src/util/did-you-mean.ts`, `packages/engine/src/util/sort.ts`
- Test: `packages/engine/src/diagnostics.test.ts`, `packages/engine/src/util/did-you-mean.test.ts`, `packages/engine/src/util/sort.test.ts`

**Interfaces:**
- Produces, in `diagnostics.ts` (all re-exported from `@mediaplane/engine`):
  - `type Severity = 'error' | 'warning'`
  - `interface Diagnostic { severity; code: string; message: string; path?: string; hint?: string }`
  - `error(code, message, extra?: { path?; hint? }): Diagnostic`
  - `warning(code, message, extra?): Diagnostic`
  - `hasErrors(diagnostics): boolean`
  - `withHint(hint: string | undefined): { hint?: string }`
- Produces, internal to the engine (not re-exported):
  - `util/did-you-mean.ts`: `editDistance(a, b): number` and `didYouMean(input, candidates): string | undefined`
  - `util/sort.ts`: `compare(a: string, b: string): number` and `unique<T>(values): T[]`

- [ ] **Step 1: Create the engine package**

`packages/engine/package.json`:

```json
{
  "name": "@mediaplane/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

Run: `pnpm install`
Expected: pnpm lists 3 workspace projects. The root, `packages/cli` and `packages/engine` make three; `catalog` comes in Task 6.

- [ ] **Step 2: Write the failing tests**

`packages/engine/src/diagnostics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { error, hasErrors, warning, withHint } from './diagnostics';

describe('diagnostics', () => {
  it('builds errors and warnings with an optional path and hint', () => {
    expect(error('a.b', 'broken', { path: 'apps.x', hint: 'fix it' })).toEqual({
      severity: 'error',
      code: 'a.b',
      message: 'broken',
      path: 'apps.x',
      hint: 'fix it',
    });
    expect(warning('c.d', 'careful')).toEqual({
      severity: 'warning',
      code: 'c.d',
      message: 'careful',
    });
  });

  it('detects whether any diagnostic is an error', () => {
    expect(hasErrors([warning('w', 'w')])).toBe(false);
    expect(hasErrors([warning('w', 'w'), error('e', 'e')])).toBe(true);
  });

  it('adds a hint only when there is one', () => {
    expect(withHint(undefined)).toEqual({});
    expect(withHint('try this')).toEqual({ hint: 'try this' });
  });
});
```

`packages/engine/src/util/did-you-mean.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { didYouMean, editDistance } from './did-you-mean';

describe('editDistance', () => {
  it.each([
    ['', '', 0],
    ['a', '', 1],
    ['sonar', 'sonarr', 1],
    ['kitten', 'sitting', 3],
  ])('%s → %s is %i', (a, b, distance) => {
    expect(editDistance(a, b)).toBe(distance);
  });
});

describe('didYouMean', () => {
  it('suggests a close match', () => {
    expect(didYouMean('sonar', ['sonarr', 'radarr'])).toBe('sonarr');
  });
  it('ignores case', () => {
    expect(didYouMean('Radar', ['sonarr', 'radarr'])).toBe('radarr');
  });
  it('prefers the closest candidate', () => {
    expect(didYouMean('plez', ['please', 'plex'])).toBe('plex');
  });
  it('returns undefined when nothing is close', () => {
    expect(didYouMean('kodi', ['sonarr', 'radarr'])).toBeUndefined();
  });
});
```

`packages/engine/src/util/sort.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { compare, unique } from './sort';

describe('compare', () => {
  it('orders by UTF-16 code unit, whatever the locale', () => {
    expect(['b', 'B', 'a', 'A'].sort(compare)).toEqual(['A', 'B', 'a', 'b']);
  });
});

describe('unique', () => {
  it('keeps the first occurrence of each value, in order', () => {
    expect(unique(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src`
Expected: FAIL. The three files cannot resolve `./diagnostics`, `./did-you-mean` and `./sort`.

- [ ] **Step 4: Write the implementation**

`packages/engine/src/diagnostics.ts`:

```ts
export type Severity = 'error' | 'warning';

/** A problem found while loading, resolving or planning, written for the user. */
export interface Diagnostic {
  severity: Severity;
  /** Stable machine-readable identifier, e.g. "config.unknown-key". */
  code: string;
  message: string;
  /** Dotted path into stack.yaml, e.g. "apps.qbittorrent.vpn". */
  path?: string;
  /** What the user can do about it. */
  hint?: string;
}

type Extra = Partial<Pick<Diagnostic, 'path' | 'hint'>>;

export function error(code: string, message: string, extra: Extra = {}): Diagnostic {
  return { severity: 'error', code, message, ...extra };
}

export function warning(code: string, message: string, extra: Extra = {}): Diagnostic {
  return { severity: 'warning', code, message, ...extra };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

/** Spread into a diagnostic's extras: `{ path, ...withHint(maybeHint) }`. */
export function withHint(hint: string | undefined): { hint?: string } {
  return hint === undefined ? {} : { hint };
}
```

`packages/engine/src/util/did-you-mean.ts`:

```ts
/** Levenshtein distance (single-row dynamic programming; inputs are short). */
export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] ?? 0;
      const left = row[j - 1] ?? 0;
      row[j] = a[i - 1] === b[j - 1] ? diagonal : 1 + Math.min(diagonal, above, left);
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
}

/** The closest candidate within an edit distance of 2 (case-insensitive), if any. */
export function didYouMean(input: string, candidates: readonly string[]): string | undefined {
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(input.toLowerCase(), candidate.toLowerCase());
    if (distance <= 2 && (best === undefined || distance < best.distance)) {
      best = { candidate, distance };
    }
  }
  return best?.candidate;
}
```

`packages/engine/src/util/sort.ts`:

```ts
/** Locale-independent string ordering, so output is identical on every machine. */
export function compare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
```

`packages/engine/src/index.ts`:

```ts
export * from './diagnostics';
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src`
Expected: PASS (all tests in the 3 files).

- [ ] **Step 6: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): add diagnostics and suggestion helpers"
```

---

### Task 3: The `stack.yaml` schema and loader

**Files:**
- Create: `packages/engine/src/config/schema.ts`, `packages/engine/src/config/load.ts`, `packages/engine/src/util/fs.ts`, `docs/adr/0009-no-secrets-in-stack-yaml.md`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/config/load.test.ts`

**Interfaces:**
- Consumes: `error`, `Diagnostic` (Task 2); `didYouMean` (Task 2).
- Produces:
  - **`config/schema.ts`:**
    - `ENV_NAME: RegExp`
    - `secretRefSchema`
    - `type SecretRef = { file: string } | { env: string }`
    - `appSettingsSchema`
    - `type AppSettings = { enabled: boolean; port?: number; version?: string; env: Record<string, string>; [option: string]: unknown }`
    - `stackConfigSchema`
    - `type StackConfig`
    - `STACK_KEYS: string[]`
  - **`config/load.ts`:**
    - `type LoadResult = { ok: true; config: StackConfig } | { ok: false; diagnostics: Diagnostic[] }`
    - `parseConfig(source: string): LoadResult`
    - `loadConfigFile(path: string): Promise<LoadResult>`
  - **`util/fs.ts`:** `readIfExists(path): Promise<string | undefined>`

`StackConfig` (the Zod output type) has this shape:

```ts
{
  version: 1;
  timezone: string;                                   // default 'Etc/UTC'
  user: { uid: number; gid: number };                 // default 1000/1000
  paths: { data: string };                            // absolute
  network: { bind: 'lan' | 'localhost' | 'all'; lan_subnet?: string };
  security: { login_on_lan: boolean };                // default true
  admin: { username: string; password?: SecretRef };  // default 'admin'
  media_server: 'jellyfin' | 'plex';
  plex?: { token: SecretRef };
  vpn?: { provider: string; private_key: SecretRef; addresses?: string };
  apps: Record<string, AppSettings>;
  overrides: Record<string, string | number | boolean>;
  managed_by: 'mediaplane' | 'external';
}
```

- [ ] **Step 1: Install the dependencies**

Run: `pnpm --filter @mediaplane/engine add zod@^4 yaml@^2`
Expected: both are added to `packages/engine/package.json` as `dependencies`.

- [ ] **Step 2: Write the failing tests**

`packages/engine/src/config/load.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../diagnostics';
import { loadConfigFile, parseConfig } from './load';

const MINIMAL = `version: 1
paths: { data: /srv/data }
media_server: jellyfin
`;

/** The example from docs/design/m1-engine-cli.md §4.2, without comments. */
const SPEC_EXAMPLE = `version: 1
timezone: Europe/London
user: { uid: 1000, gid: 1000 }
paths: { data: /srv/data }
network: { bind: lan, lan_subnet: 192.168.1.0/24 }
security: { login_on_lan: true }
admin: { username: admin }
media_server: jellyfin
plex: { token: { file: secrets/plex-token } }
vpn:
  provider: mullvad
  private_key: { file: secrets/wg.key }
  addresses: 10.64.0.2/32
apps:
  sonarr: {}
  radarr: { port: 7879 }
  prowlarr: {}
  qbittorrent: { vpn: true }
  seerr: {}
  byparr: {}
overrides:
  sonarr.download_client.category: television
`;

function diagnosticsOf(source: string): Diagnostic[] {
  const result = parseConfig(source);
  if (result.ok) throw new Error('expected parseConfig to fail');
  return result.diagnostics;
}

describe('parseConfig', () => {
  it('fills in defaults for a minimal file', () => {
    expect(parseConfig(MINIMAL)).toEqual({
      ok: true,
      config: {
        version: 1,
        timezone: 'Etc/UTC',
        user: { uid: 1000, gid: 1000 },
        paths: { data: '/srv/data' },
        network: { bind: 'lan' },
        security: { login_on_lan: true },
        admin: { username: 'admin' },
        media_server: 'jellyfin',
        apps: {},
        overrides: {},
        managed_by: 'mediaplane',
      },
    });
  });

  it('accepts the design-spec example', () => {
    expect(parseConfig(SPEC_EXAMPLE).ok).toBe(true);
  });

  it('keeps app-specific options for the resolver to validate', () => {
    const result = parseConfig(`${MINIMAL}apps:\n  qbittorrent: { vpn: false, port: 8200 }\n`);
    if (!result.ok) throw new Error('expected success');
    expect(result.config.apps.qbittorrent).toEqual({
      enabled: true,
      env: {},
      port: 8200,
      vpn: false,
    });
  });

  it('rejects inline secrets with an explanation', () => {
    const [diagnostic] = diagnosticsOf(
      `${MINIMAL}vpn: { provider: mullvad, private_key: "fake-inline-key" }\n`,
    );
    expect(diagnostic).toMatchObject({
      severity: 'error',
      code: 'config.invalid',
      path: 'vpn.private_key',
    });
    expect(diagnostic?.message).toContain('inline secrets are not allowed');
  });

  it('suggests the closest key for an unknown top-level key', () => {
    const [diagnostic] = diagnosticsOf(`${MINIMAL}tmezone: Europe/London\n`);
    expect(diagnostic).toMatchObject({
      code: 'config.unknown-key',
      path: 'tmezone',
      hint: 'did you mean "timezone"?',
    });
  });

  it('reports unknown nested keys with their full path', () => {
    const [diagnostic] = diagnosticsOf(
      MINIMAL.replace('paths: { data: /srv/data }', 'paths: { data: /srv/data, media: /x }'),
    );
    expect(diagnostic).toMatchObject({ code: 'config.unknown-key', path: 'paths.media' });
  });

  it('requires a Plex token when the media server is Plex', () => {
    const [diagnostic] = diagnosticsOf(MINIMAL.replace('jellyfin', 'plex'));
    expect(diagnostic).toMatchObject({ code: 'config.invalid', path: 'plex' });
  });

  it('rejects relative data paths and malformed subnets', () => {
    const paths = diagnosticsOf(
      `${MINIMAL.replace('/srv/data', 'srv/data')}network: { lan_subnet: 192.168.1.0 }\n`,
    ).map((d) => d.path);
    expect(paths).toEqual(['paths.data', 'network.lan_subnet']);
  });

  it('reports YAML syntax errors with their position', () => {
    const [diagnostic] = diagnosticsOf('version: 1\npaths: { data: /srv/data\n');
    expect(diagnostic?.code).toBe('config.yaml-syntax');
    expect(diagnostic?.message).toMatch(/line \d+/);
  });

  it('rejects duplicate keys', () => {
    const [diagnostic] = diagnosticsOf(`${MINIMAL}apps:\n  sonarr: {}\n  sonarr: {}\n`);
    expect(diagnostic?.code).toBe('config.yaml-syntax');
  });
});

describe('loadConfigFile', () => {
  it('explains a missing file', async () => {
    expect(await loadConfigFile('/nonexistent/mediaplane/stack.yaml')).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'config.missing' }],
    });
  });

  it('reads and parses a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mediaplane-config-'));
    await writeFile(join(dir, 'stack.yaml'), MINIMAL);
    expect((await loadConfigFile(join(dir, 'stack.yaml'))).ok).toBe(true);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/config`
Expected: FAIL, because `./load` cannot be resolved.

- [ ] **Step 4: Write the implementation**

`packages/engine/src/config/schema.ts`:

```ts
import { z } from 'zod';

export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IPV4_CIDR = /^(?:\d{1,3}\.){3}\d{1,3}\/(?:\d|[12]\d|3[0-2])$/;
const OVERRIDE_KEY = /^[a-z0-9-]+(?:\.[a-z0-9_]+)+$/;

const INLINE_SECRET =
  'inline secrets are not allowed in stack.yaml; use { file: secrets/<name> } or { env: VAR_NAME }';

/** A pointer to a secret, never the secret itself (ADR 0009). */
export const secretRefSchema = z.union(
  [
    z.strictObject({ file: z.string().min(1) }),
    z.strictObject({ env: z.string().regex(ENV_NAME) }),
  ],
  {
    error: (issue) =>
      typeof issue.input === 'string' ? INLINE_SECRET : 'expected { file: … } or { env: … }',
  },
);
export type SecretRef = z.infer<typeof secretRefSchema>;

/** Settings every app accepts. App-specific options pass through for the resolver. */
export const appSettingsSchema = z.looseObject({
  enabled: z.boolean().default(true),
  port: z.int().min(1).max(65535).optional(),
  version: z.string().min(1).optional(),
  env: z.record(z.string().regex(ENV_NAME), z.string()).default({}),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

const stackShape = {
  version: z.literal(1),
  timezone: z.string().min(1).default('Etc/UTC'),
  user: z
    .strictObject({ uid: z.int().min(0), gid: z.int().min(0) })
    .default({ uid: 1000, gid: 1000 }),
  paths: z.strictObject({
    data: z.string().regex(/^\//, 'must be an absolute path (start with /)'),
  }),
  network: z
    .strictObject({
      bind: z.enum(['lan', 'localhost', 'all']).default('lan'),
      lan_subnet: z
        .string()
        .regex(IPV4_CIDR, 'must be an IPv4 CIDR such as 192.168.1.0/24')
        .optional(),
    })
    .default({ bind: 'lan' }),
  security: z
    .strictObject({ login_on_lan: z.boolean().default(true) })
    .default({ login_on_lan: true }),
  admin: z
    .strictObject({
      username: z.string().min(1).default('admin'),
      password: secretRefSchema.optional(),
    })
    .default({ username: 'admin' }),
  media_server: z.enum(['jellyfin', 'plex']),
  plex: z.strictObject({ token: secretRefSchema }).optional(),
  vpn: z
    .strictObject({
      provider: z.string().min(1),
      private_key: secretRefSchema,
      addresses: z.string().min(1).optional(),
    })
    .optional(),
  apps: z.record(z.string(), appSettingsSchema).default({}),
  overrides: z
    .record(z.string().regex(OVERRIDE_KEY), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  managed_by: z.enum(['mediaplane', 'external']).default('mediaplane'),
};

/** Top-level keys of stack.yaml, for "did you mean" hints. */
export const STACK_KEYS = Object.keys(stackShape);

export const stackConfigSchema = z.strictObject(stackShape).superRefine((config, ctx) => {
  if (config.media_server === 'plex' && config.plex === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['plex'],
      message: 'media_server is "plex" but plex.token is not set',
    });
  }
});
export type StackConfig = z.infer<typeof stackConfigSchema>;
```

`packages/engine/src/util/fs.ts`:

```ts
import { readFile } from 'node:fs/promises';

/** The file's contents, or undefined if it does not exist. Other errors are thrown. */
export async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
      return undefined;
    }
    throw cause;
  }
}
```

`packages/engine/src/config/load.ts`:

```ts
import { parseDocument } from 'yaml';
import type { ZodError } from 'zod';
import { error, withHint, type Diagnostic } from '../diagnostics';
import { didYouMean } from '../util/did-you-mean';
import { readIfExists } from '../util/fs';
import { STACK_KEYS, stackConfigSchema, type StackConfig } from './schema';

export type LoadResult =
  | { ok: true; config: StackConfig }
  | { ok: false; diagnostics: Diagnostic[] };

type Issue = ZodError['issues'][number];

export async function loadConfigFile(path: string): Promise<LoadResult> {
  const source = await readIfExists(path);
  if (source === undefined) {
    return {
      ok: false,
      diagnostics: [
        error('config.missing', `no stack.yaml at ${path}`, {
          hint: 'create one; the format is described in docs/design/m1-engine-cli.md §4.2',
        }),
      ],
    };
  }
  return parseConfig(source);
}

export function parseConfig(source: string): LoadResult {
  const doc = parseDocument(source, { prettyErrors: true });
  if (doc.errors.length > 0) {
    return {
      ok: false,
      diagnostics: doc.errors.map((e) => error('config.yaml-syntax', e.message)),
    };
  }
  const result = stackConfigSchema.safeParse(doc.toJS() as unknown);
  if (result.success) return { ok: true, config: result.data };
  return { ok: false, diagnostics: result.error.issues.flatMap(toDiagnostics) };
}

function toDiagnostics(issue: Issue): Diagnostic[] {
  const path = issue.path.map(String).join('.');
  if (issue.code === 'unrecognized_keys') {
    return issue.keys.map((key) => {
      const keyPath = path === '' ? key : `${path}.${key}`;
      const suggestion = path === '' ? didYouMean(key, STACK_KEYS) : undefined;
      return error('config.unknown-key', `unknown key "${keyPath}"`, {
        path: keyPath,
        ...withHint(suggestion === undefined ? undefined : `did you mean "${suggestion}"?`),
      });
    });
  }
  if (path === '') return [error('config.invalid', issue.message)];
  return [error('config.invalid', `${path}: ${issue.message}`, { path })];
}
```

`packages/engine/src/index.ts`:

```ts
export * from './diagnostics';
export * from './config/schema';
export * from './config/load';
```

`docs/adr/0009-no-secrets-in-stack-yaml.md`:

```markdown
# 0009. No secrets in stack.yaml

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

`stack.yaml` is the desired state of the whole stack. Users will want to keep it in git,
paste it into issues, and later have automation such as Ansible template it. If it held
secrets inline (VPN keys, a Plex token, passwords), every one of those would leak them.

## Decision

Every secret field in `stack.yaml` is a **reference**: `{ file: secrets/<name> }`
(relative to the Mediaplane home) or `{ env: VAR_NAME }`. A plain string where a secret
belongs is a validation error that explains the reference forms. Secrets that Mediaplane
generates itself live in `state/secrets.json` with mode 0600, never in `stack.yaml`.

## Consequences

- `stack.yaml` is safe to commit, share and template.
- The M2 wizard must write `secrets/` files for the user, and the docs must explain them.
- Hand-editing has one more level of indirection.
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/config`
Expected: PASS (all tests in `load.test.ts`).

- [ ] **Step 6: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): add stack.yaml schema and loader"
```

---

### Task 4: Secret references

**Files:**
- Create: `packages/engine/src/config/secrets.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/config/secrets.test.ts`

**Interfaces:**
- Consumes: `StackConfig`, `SecretRef` and `parseConfig` (Task 3); `error`, `Diagnostic` (Task 2).
- Produces:
  - `secretRefs(config): { path: string; ref: SecretRef }[]`, in the fixed order `admin.password`, `plex.token`, `vpn.private_key`.
  - `readSecret(ref, home, env): Promise<string | undefined>`, which trims the value and treats empty as absent.
  - `checkSecretRefs(config, home, env): Promise<Diagnostic[]>`, which returns `secret.missing` diagnostics.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/config/secrets.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from './load';
import type { StackConfig } from './schema';
import { checkSecretRefs, readSecret, secretRefs } from './secrets';

async function homeWith(files: Record<string, string>): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-secrets-'));
  await mkdir(join(home, 'secrets'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(home, 'secrets', name), content);
  }
  return home;
}

function configWith(extra: string): StackConfig {
  const result = parseConfig(
    `version: 1\npaths: { data: /srv/data }\nmedia_server: jellyfin\n${extra}`,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.config;
}

describe('readSecret', () => {
  it('reads and trims a file relative to the home directory', async () => {
    const home = await homeWith({ 'wg.key': 'fake-key\n' });
    expect(await readSecret({ file: 'secrets/wg.key' }, home, {})).toBe('fake-key');
  });

  it('reads absolute paths as they are', async () => {
    const home = await homeWith({ 'wg.key': 'fake-key' });
    const file = join(home, 'secrets', 'wg.key');
    expect(await readSecret({ file }, '/elsewhere', {})).toBe('fake-key');
  });

  it('treats missing and empty files as absent', async () => {
    const home = await homeWith({ empty: '  \n' });
    expect(await readSecret({ file: 'secrets/nope' }, home, {})).toBeUndefined();
    expect(await readSecret({ file: 'secrets/empty' }, home, {})).toBeUndefined();
  });

  it('reads environment variables', async () => {
    const env = { VPN_KEY: ' fake-env-key ' };
    expect(await readSecret({ env: 'VPN_KEY' }, '/', env)).toBe('fake-env-key');
    expect(await readSecret({ env: 'VPN_KEY' }, '/', {})).toBeUndefined();
  });
});

describe('secretRefs and checkSecretRefs', () => {
  const config = configWith(
    'admin: { password: { env: ADMIN_PASSWORD } }\n' +
      'vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }\n',
  );

  it('finds every secret reference, in a fixed order', () => {
    expect(secretRefs(config).map((r) => r.path)).toEqual([
      'admin.password',
      'vpn.private_key',
    ]);
  });

  it('reports each missing secret with its stack.yaml path', async () => {
    expect(await checkSecretRefs(config, await homeWith({}), {})).toEqual([
      expect.objectContaining({ code: 'secret.missing', path: 'admin.password' }),
      expect.objectContaining({ code: 'secret.missing', path: 'vpn.private_key' }),
    ]);
  });

  it('is quiet when every secret resolves', async () => {
    const home = await homeWith({ 'wg.key': 'fake-key' });
    expect(
      await checkSecretRefs(config, home, { ADMIN_PASSWORD: 'fake-password' }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/config/secrets.test.ts`
Expected: FAIL, because `./secrets` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/config/secrets.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { error, type Diagnostic } from '../diagnostics';
import type { SecretRef, StackConfig } from './schema';

/** Every secret reference in stack.yaml, with its dotted path. */
export function secretRefs(config: StackConfig): { path: string; ref: SecretRef }[] {
  const refs: { path: string; ref: SecretRef }[] = [];
  if (config.admin.password) refs.push({ path: 'admin.password', ref: config.admin.password });
  if (config.plex) refs.push({ path: 'plex.token', ref: config.plex.token });
  if (config.vpn) refs.push({ path: 'vpn.private_key', ref: config.vpn.private_key });
  return refs;
}

/** The secret's trimmed value, or undefined if it is missing, empty or unreadable. */
export async function readSecret(
  ref: SecretRef,
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const raw =
    'env' in ref
      ? env[ref.env]
      : await readQuietly(isAbsolute(ref.file) ? ref.file : join(home, ref.file));
  const value = raw?.trim();
  return value === undefined || value === '' ? undefined : value;
}

export async function checkSecretRefs(
  config: StackConfig,
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  for (const { path, ref } of secretRefs(config)) {
    if ((await readSecret(ref, home, env)) !== undefined) continue;
    const where = 'env' in ref ? `environment variable ${ref.env}` : `file ${ref.file}`;
    diagnostics.push(
      error('secret.missing', `${path}: ${where} is missing, empty or unreadable`, { path }),
    );
  }
  return diagnostics;
}

async function readQuietly(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}
```

`packages/engine/src/index.ts`:

```ts
export * from './diagnostics';
export * from './config/schema';
export * from './config/load';
export * from './config/secrets';
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/config`
Expected: PASS (both test files).

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): resolve and check secret references"
```

---

### Task 5: The catalog contract and host facts

**Files:**
- Create: `packages/engine/src/catalog/types.ts`, `packages/engine/src/host/facts.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/catalog/types.test.ts`, `packages/engine/src/host/facts.test.ts`

**Interfaces:**
- Consumes: `StackConfig`, `AppSettings` (Task 3); `Diagnostic` (Task 2); `compare` (Task 2).
- Produces, in `catalog/types.ts`:
  - **Types:** `Arch`, `Category`, `ImagePin`, `PortSpec`, `SecretSource`, `CredentialStep`, `HealthCheck`, `AppContext<Options>`, `ServiceExtras`, `AppDefinition<Options>`, `Catalog`.
  - **Function:** `defineApp<Options>(def): def`.
  - **Hook signatures** on `AppDefinition<Options>`, all optional methods:
    - `implies(options): string[]`
    - `networkVia(options): string | undefined`
    - `env(ctx: AppContext<Options>): Record<string, string>`
    - `extras(ctx): ServiceExtras`
    - `validate(ctx): Diagnostic[]`
  - **`AppContext<Options>`:** `{ config: StackConfig; settings: AppSettings; options: Options; lanSubnets: string[] }`.
- Produces, in `host/facts.ts`:
  - `interface HostFacts { arch: Arch; privateAddresses: { address: string; cidr: string }[] }`
  - `toArch`, `isPrivateIPv4`, `networkOf`, `privateAddresses`, and `detectHostFacts(): HostFacts`

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/catalog/types.test.ts`:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { defineApp, type AppDefinition, type Catalog } from './types';

const base = {
  name: 'Example',
  category: 'download',
  image: {
    repo: 'registry.test/example',
    tag: '1.0.0',
    digest: `sha256:${'0'.repeat(64)}`,
  },
  arch: ['amd64', 'arm64'],
  ports: [],
  volumes: {},
  runAs: 'image-default',
  provides: [],
  requires: [],
  secrets: {},
  credentials: [],
  health: 'none',
  experimental: false,
} satisfies Omit<AppDefinition, 'id'>;

describe('defineApp', () => {
  it('returns the definition unchanged', () => {
    const definition = { id: 'example', ...base };
    expect(defineApp(definition)).toBe(definition);
  });

  it('types hook arguments from the options schema, and fits in a Catalog', () => {
    const definition = defineApp({
      id: 'example',
      ...base,
      options: z.strictObject({ vpn: z.boolean().default(true) }),
      implies: (options) => (options.vpn ? ['gluetun'] : []),
    });
    expectTypeOf(definition.implies).toEqualTypeOf<
      ((options: { vpn: boolean }) => string[]) | undefined
    >();
    const catalog: Catalog = [definition];
    expect(catalog).toHaveLength(1);
  });
});
```

`packages/engine/src/host/facts.test.ts`:

```ts
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { isPrivateIPv4, networkOf, privateAddresses, toArch } from './facts';

function nic(
  address: string,
  cidr: string,
  extra: Partial<NetworkInterfaceInfo> = {},
): NetworkInterfaceInfo {
  return {
    address,
    cidr,
    family: 'IPv4',
    internal: false,
    netmask: '255.255.255.0',
    mac: '00:00:00:00:00:00',
    ...extra,
  } as NetworkInterfaceInfo;
}

describe('toArch', () => {
  it('maps Node architectures to image architectures', () => {
    expect(toArch('x64')).toBe('amd64');
    expect(toArch('arm64')).toBe('arm64');
    expect(toArch('ia32')).toBeUndefined();
  });
});

describe('isPrivateIPv4', () => {
  it.each([
    ['10.1.2.3', true],
    ['172.15.0.1', false],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.1.10', true],
    ['192.169.1.10', false],
    ['100.64.0.1', false],
    ['8.8.8.8', false],
  ])('%s → %s', (address, expected) => {
    expect(isPrivateIPv4(address)).toBe(expected);
  });
});

describe('networkOf', () => {
  it.each([
    ['192.168.1.10/24', '192.168.1.0/24'],
    ['10.1.2.3/8', '10.0.0.0/8'],
    ['172.20.5.9/12', '172.16.0.0/12'],
    ['10.0.0.5/32', '10.0.0.5/32'],
    ['1.2.3.4/0', '0.0.0.0/0'],
  ])('%s → %s', (cidr, expected) => {
    expect(networkOf(cidr)).toBe(expected);
  });
});

describe('privateAddresses', () => {
  it('keeps private IPv4 addresses on physical interfaces only, sorted', () => {
    expect(
      privateAddresses({
        lo: [nic('127.0.0.1', '127.0.0.1/8', { internal: true })],
        eth0: [
          nic('192.168.1.10', '192.168.1.10/24'),
          nic('fe80::1', 'fe80::1/64', { family: 'IPv6' }),
        ],
        wlan0: [nic('10.0.0.5', '10.0.0.5/24')],
        docker0: [nic('172.17.0.1', '172.17.0.1/16')],
        'br-1a2b3c': [nic('172.18.0.1', '172.18.0.1/16')],
        tailscale0: [nic('100.101.102.103', '100.101.102.103/32')],
        wg0: [nic('10.8.0.2', '10.8.0.2/24')],
        ens5: [nic('203.0.113.7', '203.0.113.7/24')],
      }),
    ).toEqual([
      { address: '10.0.0.5', cidr: '10.0.0.5/24' },
      { address: '192.168.1.10', cidr: '192.168.1.10/24' },
    ]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/catalog packages/engine/src/host`
Expected: FAIL, because `./types` and `./facts` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/catalog/types.ts`:

```ts
import type { z } from 'zod';
import type { AppSettings, StackConfig } from '../config/schema';
import type { Diagnostic } from '../diagnostics';

export type Arch = 'amd64' | 'arm64';
export type Category = 'network' | 'download' | 'indexer' | 'pvr' | 'media-server' | 'requests';

export interface ImagePin {
  repo: string;
  /** Exact upstream tag, never "latest". */
  tag: string;
  /** Multi-arch index digest: "sha256:" + 64 hex characters. */
  digest: string;
}

export interface PortSpec {
  name: string;
  container: number;
  protocol?: 'tcp' | 'udp';
  /** false = reachable only inside the stack. Default true. */
  publish?: boolean;
  /** Host and container port must be equal; this env var sets the container port. */
  hostEqualsContainer?: { env: string };
}

/** Where a secret's value comes from. */
export type SecretSource =
  | { generate: 'hex32' | 'qbt' }
  | { createdBy: 'app' }
  | { userProvided: 'vpn.private_key' | 'plex.token' };

/** How secrets and first-run setup reach the app, in order. */
export type CredentialStep =
  | { step: 'env'; var: string; secret: string }
  | { step: 'config-file'; path: string }
  | { step: 'bootstrap-api'; action: string };

export interface HealthCheck {
  /** Compose healthcheck test. Write a literal $ as $$ (Compose interpolates). */
  test: string[];
  startPeriod?: string;
}

/** What an app's hooks can see once the stack is resolved. */
export interface AppContext<Options = Record<string, unknown>> {
  config: StackConfig;
  settings: AppSettings;
  options: Options;
  /** LAN subnets from stack.yaml or host detection. May be empty. */
  lanSubnets: string[];
}

export interface ServiceExtras {
  cap_add?: string[];
  devices?: string[];
  init?: boolean;
}

export interface AppDefinition<Options = Record<string, unknown>> {
  id: string;
  name: string;
  category: Category;
  image: ImagePin;
  arch: Arch[];
  ports: PortSpec[];
  /** Container mount points for the app's config dir and the shared data root. */
  volumes: { appdata?: string; data?: string };
  runAs: 'puid-env' | 'user-directive' | 'image-default' | `fixed:${number}`;
  /** Capabilities, e.g. "download-client:torrent" (also satisfies "download-client"). */
  provides: string[];
  requires: { capability: string; min: number }[];
  /** Capabilities that no other enabled app may also provide. */
  exclusive?: string[];
  secrets: Record<string, SecretSource>;
  credentials: CredentialStep[];
  /** 'image' uses the image's own HEALTHCHECK. 'none' has no health check. */
  health: HealthCheck | 'image' | 'none';
  /** App-specific settings under apps.<id> in stack.yaml. */
  options?: z.ZodType<Options>;
  /** Apps this one needs, given its options (e.g. qBittorrent with a VPN needs Gluetun). */
  implies?(options: Options): string[];
  /** Run inside another app's network namespace. */
  networkVia?(options: Options): string | undefined;
  env?(ctx: AppContext<Options>): Record<string, string>;
  extras?(ctx: AppContext<Options>): ServiceExtras;
  validate?(ctx: AppContext<Options>): Diagnostic[];
  experimental: boolean;
}

export type Catalog = readonly AppDefinition[];

/** Identity function that gives catalog entries full type inference. */
export function defineApp<Options = Record<string, unknown>>(
  definition: AppDefinition<Options>,
): AppDefinition<Options> {
  return definition;
}
```

Hooks are declared as **methods**, not function properties. Method parameters are checked bivariantly, so an `AppDefinition<{ vpn: boolean }>` is assignable to `Catalog`. Do not "fix" them into arrow-typed properties.

`packages/engine/src/host/facts.ts`:

```ts
import { arch, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import type { Arch } from '../catalog/types';
import { compare } from '../util/sort';

export interface HostFacts {
  arch: Arch;
  /** Private (RFC 1918) IPv4 addresses on physical interfaces, sorted. */
  privateAddresses: { address: string; cidr: string }[];
}

/** Interfaces created by container, VM and VPN software. Never "the LAN". */
const VIRTUAL_INTERFACE_PREFIXES = [
  'docker',
  'br-',
  'veth',
  'virbr',
  'cni',
  'flannel',
  'podman',
  'lxc',
  'lxd',
  'tailscale',
  'wg',
  'tun',
];

export function toArch(nodeArch: string): Arch | undefined {
  if (nodeArch === 'x64') return 'amd64';
  if (nodeArch === 'arm64') return 'arm64';
  return undefined;
}

export function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  if (a === 10) return true;
  if (a === 172) return b !== undefined && b >= 16 && b <= 31;
  return a === 192 && b === 168;
}

/** "192.168.1.10/24" → "192.168.1.0/24". */
export function networkOf(cidr: string): string {
  const [address = '', prefixText = '32'] = cidr.split('/');
  const prefix = Number(prefixText);
  const value = address
    .split('.')
    .reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (value & mask) >>> 0;
  const octets = [24, 16, 8, 0].map((shift) => (network >>> shift) & 255);
  return `${octets.join('.')}/${prefix}`;
}

export function privateAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): HostFacts['privateAddresses'] {
  const found: HostFacts['privateAddresses'] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    for (const info of infos ?? []) {
      if (
        info.family === 'IPv4' &&
        !info.internal &&
        info.cidr !== null &&
        isPrivateIPv4(info.address)
      ) {
        found.push({ address: info.address, cidr: info.cidr });
      }
    }
  }
  return found.sort((x, y) => compare(x.address, y.address));
}

/** Facts about the machine this process runs on. (S2 adds container-aware detection.) */
export function detectHostFacts(): HostFacts {
  const hostArch = toArch(arch());
  if (hostArch === undefined) {
    throw new Error(
      `unsupported CPU architecture "${arch()}": Mediaplane supports amd64 and arm64`,
    );
  }
  return { arch: hostArch, privateAddresses: privateAddresses(networkInterfaces()) };
}
```

`packages/engine/src/index.ts`:

```ts
export * from './diagnostics';
export * from './config/schema';
export * from './config/load';
export * from './config/secrets';
export * from './catalog/types';
export * from './host/facts';
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/catalog packages/engine/src/host && pnpm typecheck`
Expected: PASS, and `tsc` reports no errors. `expectTypeOf` is checked by `tsc`, so a wrong inferred type fails the type-check.

- [ ] **Step 5: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): add catalog contract and host detection"
```

---

### Task 6: The M1 app catalog

**Files:**
- Create: `catalog/package.json`, `catalog/index.ts`, `catalog/_shared/servarr.ts`
- Create: `catalog/{byparr,flaresolverr,gluetun,jellyfin,plex,prowlarr,qbittorrent,radarr,seerr,sonarr}/app.ts`
- Test: `catalog/catalog.test.ts`

**Interfaces:**
- Consumes: `defineApp`, `error`, `warning` and the `AppContext` type, from `@mediaplane/engine` (Tasks 2 and 5).
- Produces:
  - `catalog: Catalog`, exported from `@mediaplane/catalog` and sorted by id;
  - `servarrEnv(prefix: string, ctx: AppContext): Record<string, string>`.

These pins were resolved on 2026-10-08 with `docker buildx imagetools inspect` (the multi-arch index digest). Copy them exactly:

| App | Image | Tag | Digest |
|---|---|---|---|
| byparr | `ghcr.io/thephaseless/byparr` | `3.0.4` | `sha256:874f719518f617d03a60e03411fc5d090647e1a877041e81f8dc965927c7deb6` |
| flaresolverr | `ghcr.io/flaresolverr/flaresolverr` | `v3.5.2` | `sha256:c80ae007ce2ccdcd217a12426e4f039ef763ff90738c808d38810c3e59323767` |
| gluetun | `qmcgaw/gluetun` | `v3.41.3` | `sha256:fa19cc76b2af13d57a8d3dc3066f2ada061b1c761b8aecf989b3877c0486e027` |
| jellyfin | `lscr.io/linuxserver/jellyfin` | `12.2ubu2604-ls53` | `sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b` |
| plex | `lscr.io/linuxserver/plex` | `1.43.4.10903-e5521bd8c-ls327` | `sha256:06e07af2851e6a822e89062b148435495dd794d6d5aaf36247dee05fb3dcc4b8` |
| prowlarr | `lscr.io/linuxserver/prowlarr` | `2.6.5.5623-ls163` | `sha256:f9151e5bc1025c6d0a630d503210cdcb6bb55a7cc098562609d96a408d838902` |
| qbittorrent | `lscr.io/linuxserver/qbittorrent` | `5.2.4_v2.0.15-ls479` | `sha256:b522f9f4b769f8f36d49d22d5eb6a92e9aa18904c6a1830b1439df511ec21983` |
| radarr | `lscr.io/linuxserver/radarr` | `6.4.4.10685-ls319` | `sha256:7dfd049e79c00b16fbc29c3f5d96a9e7b9e73a23930b4c5b3c4541d60b366814` |
| seerr | `ghcr.io/seerr-team/seerr` | `v3.5.0` | `sha256:27602401178d54f1964442287b9f23f67a3fa2252645ee8065839ea1c3f69e45` |
| sonarr | `lscr.io/linuxserver/sonarr` | `4.0.20.3014-ls326` | `sha256:f247545d23ba8b233d6604575347e48a623fe6ad75dda02348bf81917f3b5c06` |

Health-check commands are verified against real containers in S2 (see the roadmap's verification list).

- [ ] **Step 1: Create the package and install its dependencies**

`catalog/package.json`:

```json
{
  "name": "@mediaplane/catalog",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./index.ts"
  }
}
```

Run: `pnpm --filter @mediaplane/catalog add zod@^4 "@mediaplane/engine@workspace:*"`
Expected: `catalog/package.json` gains `zod` and `"@mediaplane/engine": "workspace:*"`.

- [ ] **Step 2: Write the failing test**

`catalog/catalog.test.ts`:

```ts
import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { catalog } from './index';

const appFolders = (await readdir(new URL('.', import.meta.url), { withFileTypes: true }))
  .filter((e) => e.isDirectory() && !e.name.startsWith('_') && e.name !== 'node_modules')
  .map((e) => e.name)
  .sort();

const NO_OPTIONS = z.strictObject({});

describe('catalog', () => {
  it('registers every app folder exactly once, sorted by id', () => {
    expect(catalog.map((app) => app.id)).toEqual(appFolders);
  });

  describe.each(catalog.map((app) => [app.id, app] as const))('%s', (_id, app) => {
    it('is pinned by exact tag and multi-arch digest', () => {
      expect(app.image.tag).not.toBe('latest');
      expect(app.image.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('supports amd64 and arm64', () => {
      expect(app.arch).toEqual(expect.arrayContaining(['amd64', 'arm64']));
    });

    it('has unique port names', () => {
      const names = app.ports.map((port) => port.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('only injects secrets it declares', () => {
      for (const step of app.credentials) {
        if (step.step === 'env') expect(Object.keys(app.secrets)).toContain(step.secret);
      }
    });

    it('accepts empty options and implies only catalog apps', () => {
      const options = (app.options ?? NO_OPTIONS).parse({});
      for (const implied of app.implies?.(options) ?? []) {
        expect(catalog.map((other) => other.id)).toContain(implied);
      }
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run catalog`
Expected: FAIL, because `./index` cannot be resolved.

- [ ] **Step 4: Write the shared Servarr helper**

`catalog/_shared/servarr.ts`:

```ts
import type { AppContext } from '@mediaplane/engine';

/**
 * Auth env vars shared by Sonarr, Radarr and Prowlarr (design §6.1).
 * Values are case-sensitive. AUTH__ENABLED is deliberately never set (legacy flag).
 */
export function servarrEnv(prefix: string, ctx: AppContext): Record<string, string> {
  const loginOnLan = ctx.config.security.login_on_lan;
  const env: Record<string, string> = {
    [`${prefix}__AUTH__METHOD`]: 'Forms',
    [`${prefix}__AUTH__REQUIRED`]: loginOnLan ? 'Enabled' : 'DisabledForLocalAddresses',
  };
  if (!loginOnLan && ctx.lanSubnets.length > 0) {
    env[`${prefix}__SERVER__TRUSTEDNETWORKS`] = ctx.lanSubnets.join(',');
  }
  return env;
}
```

- [ ] **Step 5: Write the ten app definitions**

`catalog/byparr/app.ts`:

```ts
import { defineApp } from '@mediaplane/engine';

export default defineApp({
  id: 'byparr',
  name: 'Byparr',
  category: 'indexer',
  image: {
    repo: 'ghcr.io/thephaseless/byparr',
    tag: '3.0.4',
    digest: 'sha256:874f719518f617d03a60e03411fc5d090647e1a877041e81f8dc965927c7deb6',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'api', container: 8191, publish: false }],
  volumes: {},
  runAs: 'image-default',
  provides: ['cloudflare-solver'],
  requires: [],
  exclusive: ['cloudflare-solver'],
  secrets: {},
  credentials: [],
  health: 'none',
  experimental: false,
});
```

`catalog/flaresolverr/app.ts`:

```ts
import { defineApp } from '@mediaplane/engine';

export default defineApp({
  id: 'flaresolverr',
  name: 'FlareSolverr',
  category: 'indexer',
  image: {
    repo: 'ghcr.io/flaresolverr/flaresolverr',
    tag: 'v3.5.2',
    digest: 'sha256:c80ae007ce2ccdcd217a12426e4f039ef763ff90738c808d38810c3e59323767',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'api', container: 8191, publish: false }],
  volumes: {},
  runAs: 'image-default',
  provides: ['cloudflare-solver'],
  requires: [],
  exclusive: ['cloudflare-solver'],
  secrets: {},
  credentials: [],
  health: 'none',
  env: () => ({ LOG_LEVEL: 'info' }),
  experimental: false,
});
```

`catalog/gluetun/app.ts`:

```ts
import { defineApp, error } from '@mediaplane/engine';

export default defineApp({
  id: 'gluetun',
  name: 'Gluetun',
  category: 'network',
  image: {
    repo: 'qmcgaw/gluetun',
    tag: 'v3.41.3',
    digest: 'sha256:fa19cc76b2af13d57a8d3dc3066f2ada061b1c761b8aecf989b3877c0486e027',
  },
  arch: ['amd64', 'arm64'],
  ports: [],
  volumes: { appdata: '/gluetun' },
  runAs: 'image-default',
  provides: ['vpn'],
  requires: [],
  secrets: { wireguardKey: { userProvided: 'vpn.private_key' } },
  credentials: [{ step: 'env', var: 'WIREGUARD_PRIVATE_KEY', secret: 'wireguardKey' }],
  health: 'image',
  env: (ctx) => ({
    VPN_SERVICE_PROVIDER: ctx.config.vpn?.provider ?? '',
    VPN_TYPE: 'wireguard',
    ...(ctx.config.vpn?.addresses === undefined
      ? {}
      : { WIREGUARD_ADDRESSES: ctx.config.vpn.addresses }),
    ...(ctx.lanSubnets.length === 0
      ? {}
      : { FIREWALL_OUTBOUND_SUBNETS: ctx.lanSubnets.join(',') }),
  }),
  extras: () => ({ cap_add: ['NET_ADMIN'], devices: ['/dev/net/tun:/dev/net/tun'] }),
  validate: (ctx) =>
    ctx.config.vpn
      ? []
      : [
          error('vpn.missing', 'Gluetun is enabled but stack.yaml has no vpn: block', {
            path: 'vpn',
            hint: 'add vpn: { provider: …, private_key: { file: secrets/wg.key } }, or set apps.qbittorrent.vpn: false',
          }),
        ],
  experimental: false,
});
```

`catalog/jellyfin/app.ts`:

```ts
import { defineApp } from '@mediaplane/engine';

export default defineApp({
  id: 'jellyfin',
  name: 'Jellyfin',
  category: 'media-server',
  image: {
    repo: 'lscr.io/linuxserver/jellyfin',
    tag: '12.2ubu2604-ls53',
    digest: 'sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 8096 }],
  volumes: { appdata: '/config', data: '/data' },
  runAs: 'puid-env',
  provides: ['media-server'],
  requires: [],
  exclusive: ['media-server'],
  secrets: { apiKey: { createdBy: 'app' } },
  credentials: [
    { step: 'bootstrap-api', action: 'startup-wizard' },
    { step: 'bootstrap-api', action: 'create-api-key' },
  ],
  health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:8096/health'], startPeriod: '120s' },
  experimental: false,
});
```

`catalog/plex/app.ts`:

```ts
import { defineApp } from '@mediaplane/engine';

export default defineApp({
  id: 'plex',
  name: 'Plex',
  category: 'media-server',
  image: {
    repo: 'lscr.io/linuxserver/plex',
    tag: '1.43.4.10903-e5521bd8c-ls327',
    digest: 'sha256:06e07af2851e6a822e89062b148435495dd794d6d5aaf36247dee05fb3dcc4b8',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 32400 }],
  volumes: { appdata: '/config', data: '/data' },
  runAs: 'puid-env',
  provides: ['media-server'],
  requires: [],
  exclusive: ['media-server'],
  secrets: { token: { userProvided: 'plex.token' } },
  credentials: [{ step: 'bootstrap-api', action: 'claim-server' }],
  health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:32400/identity'], startPeriod: '120s' },
  env: () => ({ VERSION: 'docker' }),
  experimental: false,
});
```

`catalog/prowlarr/app.ts`:

```ts
import { defineApp } from '@mediaplane/engine';
import { servarrEnv } from '../_shared/servarr';

export default defineApp({
  id: 'prowlarr',
  name: 'Prowlarr',
  category: 'indexer',
  image: {
    repo: 'lscr.io/linuxserver/prowlarr',
    tag: '2.6.5.5623-ls163',
    digest: 'sha256:f9151e5bc1025c6d0a630d503210cdcb6bb55a7cc098562609d96a408d838902',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 9696 }],
  volumes: { appdata: '/config' },
  runAs: 'puid-env',
  provides: ['indexer-manager'],
  requires: [],
  secrets: { apiKey: { generate: 'hex32' } },
  credentials: [
    { step: 'env', var: 'PROWLARR__AUTH__APIKEY', secret: 'apiKey' },
    { step: 'config-file', path: 'config.xml' },
    { step: 'bootstrap-api', action: 'create-admin' },
  ],
  health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:9696/ping'] },
  implies: () => ['byparr'],
  env: (ctx) => servarrEnv('PROWLARR', ctx),
  experimental: false,
});
```

`catalog/qbittorrent/app.ts`:

```ts
import { defineApp, warning } from '@mediaplane/engine';
import { z } from 'zod';

export default defineApp({
  id: 'qbittorrent',
  name: 'qBittorrent',
  category: 'download',
  image: {
    repo: 'lscr.io/linuxserver/qbittorrent',
    tag: '5.2.4_v2.0.15-ls479',
    digest: 'sha256:b522f9f4b769f8f36d49d22d5eb6a92e9aa18904c6a1830b1439df511ec21983',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 8080, hostEqualsContainer: { env: 'WEBUI_PORT' } }],
  volumes: { appdata: '/config', data: '/data' },
  runAs: 'puid-env',
  provides: ['download-client:torrent'],
  requires: [],
  secrets: { apiKey: { generate: 'qbt' } },
  credentials: [{ step: 'config-file', path: 'qBittorrent/qBittorrent.conf' }],
  health: {
    test: ['CMD-SHELL', 'curl -fsS "http://localhost:$${WEBUI_PORT}/" > /dev/null'],
  },
  options: z.strictObject({ vpn: z.boolean().default(true) }),
  implies: (options) => (options.vpn ? ['gluetun'] : []),
  networkVia: (options) => (options.vpn ? 'gluetun' : undefined),
  validate: (ctx) =>
    ctx.options.vpn
      ? []
      : [
          warning(
            'qbittorrent.no-vpn',
            'qBittorrent is running without a VPN (apps.qbittorrent.vpn: false)',
            {
              path: 'apps.qbittorrent.vpn',
              hint: 'peers will see your real IP address; add a vpn: block and remove vpn: false',
            },
          ),
        ],
  experimental: false,
});
```

`catalog/radarr/app.ts`:

```ts
import { defineApp } from '@mediaplane/engine';
import { servarrEnv } from '../_shared/servarr';

export default defineApp({
  id: 'radarr',
  name: 'Radarr',
  category: 'pvr',
  image: {
    repo: 'lscr.io/linuxserver/radarr',
    tag: '6.4.4.10685-ls319',
    digest: 'sha256:7dfd049e79c00b16fbc29c3f5d96a9e7b9e73a23930b4c5b3c4541d60b366814',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 7878 }],
  volumes: { appdata: '/config', data: '/data' },
  runAs: 'puid-env',
  provides: ['pvr:movies'],
  requires: [{ capability: 'download-client', min: 1 }],
  secrets: { apiKey: { generate: 'hex32' } },
  credentials: [
    { step: 'env', var: 'RADARR__AUTH__APIKEY', secret: 'apiKey' },
    { step: 'config-file', path: 'config.xml' },
    { step: 'bootstrap-api', action: 'create-admin' },
  ],
  health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:7878/ping'] },
  env: (ctx) => servarrEnv('RADARR', ctx),
  experimental: false,
});
```

`catalog/seerr/app.ts`:

```ts
import { defineApp } from '@mediaplane/engine';
import { z } from 'zod';

export default defineApp({
  id: 'seerr',
  name: 'Seerr',
  category: 'requests',
  image: {
    repo: 'ghcr.io/seerr-team/seerr',
    tag: 'v3.5.0',
    digest: 'sha256:27602401178d54f1964442287b9f23f67a3fa2252645ee8065839ea1c3f69e45',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 5055 }],
  volumes: { appdata: '/app/config' },
  runAs: 'fixed:1000',
  provides: ['requests'],
  requires: [
    { capability: 'media-server', min: 1 },
    { capability: 'pvr', min: 1 },
  ],
  secrets: { apiKey: { generate: 'hex32' } },
  credentials: [
    { step: 'env', var: 'API_KEY', secret: 'apiKey' },
    { step: 'bootstrap-api', action: 'first-sign-in' },
  ],
  health: {
    test: ['CMD-SHELL', 'wget -qO- http://localhost:5055/api/v1/status > /dev/null || exit 1'],
  },
  options: z.strictObject({
    sonarr_profile: z.string().min(1).optional(),
    radarr_profile: z.string().min(1).optional(),
  }),
  env: () => ({ LOG_LEVEL: 'info' }),
  extras: () => ({ init: true }),
  experimental: false,
});
```

`catalog/sonarr/app.ts`:

```ts
import { defineApp } from '@mediaplane/engine';
import { servarrEnv } from '../_shared/servarr';

export default defineApp({
  id: 'sonarr',
  name: 'Sonarr',
  category: 'pvr',
  image: {
    repo: 'lscr.io/linuxserver/sonarr',
    tag: '4.0.20.3014-ls326',
    digest: 'sha256:f247545d23ba8b233d6604575347e48a623fe6ad75dda02348bf81917f3b5c06',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 8989 }],
  volumes: { appdata: '/config', data: '/data' },
  runAs: 'puid-env',
  provides: ['pvr:tv'],
  requires: [{ capability: 'download-client', min: 1 }],
  secrets: { apiKey: { generate: 'hex32' } },
  credentials: [
    { step: 'env', var: 'SONARR__AUTH__APIKEY', secret: 'apiKey' },
    { step: 'config-file', path: 'config.xml' },
    { step: 'bootstrap-api', action: 'create-admin' },
  ],
  health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:8989/ping'] },
  env: (ctx) => servarrEnv('SONARR', ctx),
  experimental: false,
});
```

`catalog/index.ts`:

```ts
import type { Catalog } from '@mediaplane/engine';
import byparr from './byparr/app';
import flaresolverr from './flaresolverr/app';
import gluetun from './gluetun/app';
import jellyfin from './jellyfin/app';
import plex from './plex/app';
import prowlarr from './prowlarr/app';
import qbittorrent from './qbittorrent/app';
import radarr from './radarr/app';
import seerr from './seerr/app';
import sonarr from './sonarr/app';

/** Every app Mediaplane can deploy, sorted by id. */
export const catalog: Catalog = [
  byparr,
  flaresolverr,
  gluetun,
  jellyfin,
  plex,
  prowlarr,
  qbittorrent,
  radarr,
  seerr,
  sonarr,
];
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm vitest run catalog && pnpm typecheck`
Expected: PASS. That is 1 test for registration, plus 5 per app for 10 apps (51 tests in all), and no type errors.

- [ ] **Step 7: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(catalog): add pinned definitions for the M1 apps"
```

---

### Task 7: The resolver

**Files:**
- Create: `packages/engine/src/resolver/resolve.ts`, `packages/engine/src/testing/fixtures.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/resolver/resolve.test.ts`

**Interfaces:**
- Consumes:
  - from Task 3: `StackConfig`, `AppSettings`, `parseConfig`;
  - from Task 5: `AppDefinition`, `AppContext`, `Catalog`, `HostFacts`, `networkOf`;
  - from Task 2: `error`, `warning`, `withHint`, `hasErrors`, `didYouMean`, `compare`, `unique`.
- Produces:
  - **`PublishedPort`:** `{ app: string; name: string; host: number; container: number; protocol: 'tcp' | 'udp' }`
  - **`ResolvedApp`:** `{ def; settings; context; image: string; networkVia: string | undefined; ports: PublishedPort[]; containerPorts: Record<string, number> }`
  - **`ResolvedStack`:** `{ config; home: string; apps: ResolvedApp[]; bindAddresses: string[]; lanSubnets: string[] }`. The apps are sorted by id.
  - **`ResolveResult`:** `{ stack: ResolvedStack | undefined; diagnostics: Diagnostic[] }`. `stack` is undefined whenever there are errors.
  - **Functions:** `resolveStack(config, catalog, host, home): ResolveResult` and `provides(def, capability): boolean`.
  - **Test-only, in `testing/fixtures.ts`:** `FAKE_DIGEST`, `FIXTURE_HOST`, `fixtureApp()`, `fixtureCatalog`, `fixtureConfig()`. These are not exported from `index.ts`.

The diagnostic codes are part of the contract, because tests and the later CLI JSON rely on them:

| Code | Meaning |
|---|---|
| `app.unknown` | Listed app not in the catalog |
| `app.media-server-conflict` | A media server other than the chosen one is listed |
| `app.media-server-disabled` | The chosen media server has `enabled: false` |
| `app.unknown-option` | Option key not in the app's schema |
| `app.invalid-option` | Option value fails the app's schema |
| `app.unsupported-arch` | No image for the host architecture |
| `app.env-reserved` | `apps.<id>.env` tries to set a credential env var |
| `app.missing-capability` | A `requires` entry is unmet; the hint names the providers |
| `app.conflict` | Two enabled apps provide an exclusive capability |
| `app.network-via-missing` | The namespace host app is not enabled |
| `app.port-not-published` | `port:` was set on an app with no published port |
| `app.untested-version` (warning) | `version:` differs from the pinned tag |
| `port.conflict` | Two apps want the same host port |
| `network.no-lan-address` | `bind: lan` on a host with no private IPv4 address |
| `network.bind-all` (warning) | `bind: all` |

- [ ] **Step 1: Write the test fixtures**

`packages/engine/src/testing/fixtures.ts`:

```ts
import { z } from 'zod';
import type { AppDefinition, Catalog } from '../catalog/types';
import { parseConfig } from '../config/load';
import type { StackConfig } from '../config/schema';
import { error } from '../diagnostics';
import type { HostFacts } from '../host/facts';

/**
 * A small, stable catalog for engine tests. It is deliberately NOT the real catalog,
 * so version bumps in catalog/ never change engine golden files.
 */

export const FAKE_DIGEST = `sha256:${'0'.repeat(64)}`;

export const FIXTURE_HOST: HostFacts = {
  arch: 'amd64',
  privateAddresses: [{ address: '192.168.1.10', cidr: '192.168.1.10/24' }],
};

export function fixtureApp<Options = Record<string, unknown>>(
  definition: Partial<AppDefinition<Options>> & { id: string },
): AppDefinition<Options> {
  return {
    name: definition.id,
    category: 'pvr',
    image: { repo: `registry.test/${definition.id}`, tag: '1.0.0', digest: FAKE_DIGEST },
    arch: ['amd64', 'arm64'],
    ports: [],
    volumes: { appdata: '/config' },
    runAs: 'puid-env',
    provides: [],
    requires: [],
    secrets: {},
    credentials: [],
    health: 'none',
    experimental: false,
    ...definition,
  };
}

export const fixtureCatalog: Catalog = [
  fixtureApp({
    id: 'byparr',
    category: 'indexer',
    provides: ['cloudflare-solver'],
    exclusive: ['cloudflare-solver'],
    volumes: {},
    runAs: 'user-directive',
  }),
  fixtureApp({
    id: 'flaresolverr',
    category: 'indexer',
    arch: ['amd64'],
    provides: ['cloudflare-solver'],
    exclusive: ['cloudflare-solver'],
    volumes: {},
    runAs: 'image-default',
  }),
  fixtureApp({
    id: 'gluetun',
    category: 'network',
    provides: ['vpn'],
    runAs: 'image-default',
    health: 'image',
    extras: () => ({ cap_add: ['NET_ADMIN'] }),
    validate: (ctx) => (ctx.config.vpn ? [] : [error('vpn.missing', 'no vpn: block')]),
  }),
  fixtureApp({
    id: 'jellyfin',
    category: 'media-server',
    provides: ['media-server'],
    exclusive: ['media-server'],
    ports: [{ name: 'web', container: 8096 }],
  }),
  fixtureApp({
    id: 'plex',
    category: 'media-server',
    provides: ['media-server'],
    exclusive: ['media-server'],
    ports: [{ name: 'web', container: 32400 }],
  }),
  fixtureApp({
    id: 'prowlarr',
    category: 'indexer',
    ports: [{ name: 'web', container: 9696 }],
    implies: () => ['byparr'],
  }),
  fixtureApp({
    id: 'qbittorrent',
    category: 'download',
    provides: ['download-client:torrent'],
    ports: [
      { name: 'web', container: 8080, hostEqualsContainer: { env: 'WEBUI_PORT' } },
      { name: 'peer', container: 6881, publish: false },
    ],
    options: z.strictObject({ vpn: z.boolean().default(true) }),
    implies: (options) => (options.vpn ? ['gluetun'] : []),
    networkVia: (options) => (options.vpn ? 'gluetun' : undefined),
  }),
  fixtureApp({
    id: 'sonarr',
    ports: [{ name: 'web', container: 8989 }],
    volumes: { appdata: '/config', data: '/data' },
    provides: ['pvr:tv'],
    requires: [{ capability: 'download-client', min: 1 }],
    secrets: { apiKey: { generate: 'hex32' } },
    credentials: [{ step: 'env', var: 'SONARR__AUTH__APIKEY', secret: 'apiKey' }],
    health: { test: ['CMD', 'true'] },
    env: () => ({ STATIC: 'a$b' }),
  }),
];

/** Parse stack.yaml text that the test knows is valid. */
export function fixtureConfig(source: string): StackConfig {
  const result = parseConfig(source);
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join('\n'));
  return result.config;
}
```

- [ ] **Step 2: Write the failing tests**

`packages/engine/src/resolver/resolve.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { HostFacts } from '../host/facts';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { resolveStack, type ResolveResult } from './resolve';

const BASE = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
`;

function resolve(
  apps: string,
  { base = BASE, host = FIXTURE_HOST }: { base?: string; host?: HostFacts } = {},
): ResolveResult {
  const config = fixtureConfig(`${base}apps:\n${apps}`);
  return resolveStack(config, fixtureCatalog, host, '/opt/mediaplane');
}
const ids = (result: ResolveResult) => result.stack?.apps.map((app) => app.def.id);
const codes = (result: ResolveResult) => result.diagnostics.map((d) => d.code);
const app = (result: ResolveResult, id: string) =>
  result.stack?.apps.find((a) => a.def.id === id);

describe('resolveStack: which apps run', () => {
  it('adds the media server and implied apps, sorted by id', () => {
    const result = resolve('  sonarr: {}\n  qbittorrent: {}\n  prowlarr: {}\n');
    expect(result.diagnostics).toEqual([]);
    expect(ids(result)).toEqual([
      'byparr',
      'gluetun',
      'jellyfin',
      'prowlarr',
      'qbittorrent',
      'sonarr',
    ]);
  });

  it('does not add an implied app the user disabled', () => {
    expect(ids(resolve('  prowlarr: {}\n  byparr: { enabled: false }\n'))).toEqual([
      'jellyfin',
      'prowlarr',
    ]);
  });

  it('does not add an implied app when another app already provides its exclusive capability', () => {
    expect(ids(resolve('  prowlarr: {}\n  flaresolverr: {}\n'))).toEqual([
      'flaresolverr',
      'jellyfin',
      'prowlarr',
    ]);
  });

  it('rejects unknown apps with a suggestion', () => {
    const result = resolve('  sonar: {}\n');
    expect(result.stack).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'app.unknown',
        path: 'apps.sonar',
        hint: 'did you mean "sonarr"?',
      }),
    );
  });

  it('rejects a second media server', () => {
    expect(codes(resolve('  plex: {}\n'))).toContain('app.media-server-conflict');
  });

  it('rejects disabling the chosen media server', () => {
    expect(codes(resolve('  jellyfin: { enabled: false }\n'))).toContain(
      'app.media-server-disabled',
    );
  });
});

describe('resolveStack: options and checks', () => {
  it('validates app-specific options', () => {
    expect(resolve('  qbittorrent: { vnp: true }\n').diagnostics).toContainEqual(
      expect.objectContaining({ code: 'app.unknown-option', path: 'apps.qbittorrent.vnp' }),
    );
    expect(resolve('  qbittorrent: { vpn: "yes" }\n').diagnostics).toContainEqual(
      expect.objectContaining({ code: 'app.invalid-option', path: 'apps.qbittorrent.vpn' }),
    );
  });

  it('runs app validation hooks', () => {
    const noVpn = BASE.replace(/^vpn:.*\n/m, '');
    expect(codes(resolve('  qbittorrent: {}\n', { base: noVpn }))).toContain('vpn.missing');
  });

  it('rejects apps without an image for the host architecture', () => {
    const result = resolve('  flaresolverr: {}\n', {
      host: { ...FIXTURE_HOST, arch: 'arm64' },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'app.unsupported-arch', path: 'apps.flaresolverr' }),
    );
  });

  it('requires capabilities and names the apps that provide them', () => {
    expect(resolve('  sonarr: {}\n').diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'app.missing-capability',
        hint: 'enable one of: qbittorrent',
      }),
    );
  });

  it('rejects two providers of an exclusive capability', () => {
    expect(codes(resolve('  byparr: {}\n  flaresolverr: {}\n'))).toContain('app.conflict');
  });

  it('rejects a network-namespace host that is disabled', () => {
    expect(codes(resolve('  qbittorrent: {}\n  gluetun: { enabled: false }\n'))).toContain(
      'app.network-via-missing',
    );
  });

  it('protects env vars that carry Mediaplane secrets', () => {
    const result = resolve(
      '  qbittorrent: {}\n  sonarr: { env: { SONARR__AUTH__APIKEY: x } }\n',
    );
    expect(codes(result)).toContain('app.env-reserved');
  });
});

describe('resolveStack: ports and images', () => {
  it('publishes the primary port on the requested host port', () => {
    const result = resolve('  qbittorrent: {}\n  sonarr: { port: 9000 }\n');
    expect(app(result, 'sonarr')?.ports).toEqual([
      { app: 'sonarr', name: 'web', host: 9000, container: 8989, protocol: 'tcp' },
    ]);
  });

  it('moves the container port too when host and container must match', () => {
    const qbittorrent = app(resolve('  qbittorrent: { port: 8200 }\n'), 'qbittorrent');
    expect(qbittorrent?.ports).toEqual([
      { app: 'qbittorrent', name: 'web', host: 8200, container: 8200, protocol: 'tcp' },
    ]);
    expect(qbittorrent?.containerPorts).toEqual({ web: 8200, peer: 6881 });
    expect(qbittorrent?.networkVia).toBe('gluetun');
  });

  it('rejects two apps on the same host port', () => {
    expect(resolve('  qbittorrent: {}\n  sonarr: { port: 8096 }\n').diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'port.conflict',
        hint: 'set apps.sonarr.port to a free port',
      }),
    );
  });

  it('rejects a port for an app with nothing to publish', () => {
    expect(codes(resolve('  byparr: { port: 9999 }\n'))).toContain('app.port-not-published');
  });

  it('pins images by digest unless the version is overridden', () => {
    const result = resolve('  qbittorrent: {}\n  sonarr: { version: 2.0.0 }\n');
    expect(app(result, 'jellyfin')?.image).toBe(
      `registry.test/jellyfin:1.0.0@sha256:${'0'.repeat(64)}`,
    );
    expect(app(result, 'sonarr')?.image).toBe('registry.test/sonarr:2.0.0');
    expect(codes(result)).toEqual(['app.untested-version']);
  });
});

describe('resolveStack: binding', () => {
  const lan = BASE.replace('bind: localhost', 'bind: lan');

  it('binds to localhost', () => {
    expect(resolve('  qbittorrent: {}\n').stack?.bindAddresses).toEqual(['127.0.0.1']);
  });

  it('binds to every private address on the LAN and derives the subnets', () => {
    const host: HostFacts = {
      arch: 'amd64',
      privateAddresses: [
        { address: '10.0.0.5', cidr: '10.0.0.5/24' },
        { address: '192.168.1.10', cidr: '192.168.1.10/24' },
      ],
    };
    const stack = resolve('  qbittorrent: {}\n', { base: lan, host }).stack;
    expect(stack?.bindAddresses).toEqual(['10.0.0.5', '192.168.1.10']);
    expect(stack?.lanSubnets).toEqual(['10.0.0.0/24', '192.168.1.0/24']);
  });

  it('prefers an explicit lan_subnet', () => {
    const base = lan.replace('bind: lan', 'bind: lan, lan_subnet: 192.168.0.0/16');
    expect(resolve('  qbittorrent: {}\n', { base }).stack?.lanSubnets).toEqual([
      '192.168.0.0/16',
    ]);
  });

  it('refuses "lan" on a host with no private address', () => {
    const result = resolve('  qbittorrent: {}\n', {
      base: lan,
      host: { arch: 'amd64', privateAddresses: [] },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'network.no-lan-address', path: 'network.bind' }),
    );
  });

  it('warns when binding to every interface', () => {
    const result = resolve('  qbittorrent: {}\n', {
      base: BASE.replace('bind: localhost', 'bind: all'),
    });
    expect(result.stack?.bindAddresses).toEqual(['0.0.0.0']);
    expect(codes(result)).toEqual(['network.bind-all']);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/resolver`
Expected: FAIL, because `./resolve` cannot be resolved.

- [ ] **Step 4: Write the implementation**

`packages/engine/src/resolver/resolve.ts`:

```ts
import { z } from 'zod';
import type { AppContext, AppDefinition, Catalog } from '../catalog/types';
import type { AppSettings, StackConfig } from '../config/schema';
import { error, hasErrors, warning, withHint, type Diagnostic } from '../diagnostics';
import { networkOf, type HostFacts } from '../host/facts';
import { didYouMean } from '../util/did-you-mean';
import { compare, unique } from '../util/sort';

export interface PublishedPort {
  app: string;
  name: string;
  host: number;
  container: number;
  protocol: 'tcp' | 'udp';
}

export interface ResolvedApp {
  def: AppDefinition;
  settings: AppSettings;
  context: AppContext;
  /** repo:tag@digest, or repo:version when the user overrides the version. */
  image: string;
  /** The app whose network namespace this one shares, if any. */
  networkVia: string | undefined;
  /** Ports published for this app, on its own service or on networkVia's. */
  ports: PublishedPort[];
  /** Port name → container port, after overrides. */
  containerPorts: Record<string, number>;
}

export interface ResolvedStack {
  config: StackConfig;
  /** Absolute Mediaplane home directory. */
  home: string;
  /** Enabled apps, sorted by id. */
  apps: ResolvedApp[];
  bindAddresses: string[];
  lanSubnets: string[];
}

export interface ResolveResult {
  /** Undefined whenever any diagnostic is an error. */
  stack: ResolvedStack | undefined;
  diagnostics: Diagnostic[];
}

interface EnabledApp {
  def: AppDefinition;
  options: Record<string, unknown>;
}

const NO_OPTIONS = z.strictObject({});
const DEFAULT_SETTINGS: AppSettings = { enabled: true, env: {} };

/** "download-client:torrent" satisfies "download-client". */
export function provides(def: AppDefinition, capability: string): boolean {
  return def.provides.some((p) => p === capability || p.startsWith(`${capability}:`));
}

export function resolveStack(
  config: StackConfig,
  catalog: Catalog,
  host: HostFacts,
  home: string,
): ResolveResult {
  const byId = new Map(catalog.map((def) => [def.id, def]));
  const diagnostics = checkListedApps(config, byId);
  const lanSubnets =
    config.network.lan_subnet === undefined
      ? unique(host.privateAddresses.map((a) => networkOf(a.cidr)))
      : [config.network.lan_subnet];

  const enabled = enableApps(requestedApps(config, byId), config, byId, diagnostics);
  const apps = enabled.map(({ def, options }): ResolvedApp => {
    const settings = config.apps[def.id] ?? DEFAULT_SETTINGS;
    const context: AppContext = { config, settings, options, lanSubnets };
    diagnostics.push(...checkApp(def, settings, context, host));
    return {
      def,
      settings,
      context,
      image: imageRef(def, settings, diagnostics),
      networkVia: def.networkVia?.(options),
      ...resolvePorts(def, settings, diagnostics),
    };
  });

  diagnostics.push(
    ...checkCapabilities(
      apps.map((a) => a.def),
      catalog,
    ),
    ...checkNetworkVia(apps),
    ...checkPortConflicts(apps),
  );
  const bind = bindAddresses(config, host);
  diagnostics.push(...bind.diagnostics);

  if (hasErrors(diagnostics)) return { stack: undefined, diagnostics };
  return {
    stack: { config, home, apps, bindAddresses: bind.addresses, lanSubnets },
    diagnostics,
  };
}

function checkListedApps(
  config: StackConfig,
  byId: ReadonlyMap<string, AppDefinition>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ids = [...byId.keys()];
  for (const [id, settings] of Object.entries(config.apps)) {
    const def = byId.get(id);
    if (def === undefined) {
      const suggestion = didYouMean(id, ids);
      diagnostics.push(
        error('app.unknown', `unknown app "${id}"`, {
          path: `apps.${id}`,
          ...withHint(suggestion === undefined ? undefined : `did you mean "${suggestion}"?`),
        }),
      );
    } else if (
      def.category === 'media-server' &&
      id !== config.media_server &&
      settings.enabled
    ) {
      diagnostics.push(
        error(
          'app.media-server-conflict',
          `apps.${id} is listed, but media_server is "${config.media_server}"`,
          {
            path: `apps.${id}`,
            hint: `Mediaplane runs one media server: change media_server or remove apps.${id}`,
          },
        ),
      );
    }
  }
  if (config.apps[config.media_server]?.enabled === false) {
    diagnostics.push(
      error(
        'app.media-server-disabled',
        `media_server is "${config.media_server}" but apps.${config.media_server}.enabled is false`,
        { path: `apps.${config.media_server}.enabled` },
      ),
    );
  }
  return diagnostics;
}

/** The chosen media server plus every listed, enabled, known app. */
function requestedApps(
  config: StackConfig,
  byId: ReadonlyMap<string, AppDefinition>,
): string[] {
  const requested = new Set<string>([config.media_server]);
  for (const [id, settings] of Object.entries(config.apps)) {
    const def = byId.get(id);
    if (def === undefined || !settings.enabled) continue;
    if (def.category === 'media-server' && id !== config.media_server) continue;
    requested.add(id);
  }
  return [...requested].sort(compare);
}

/** Requested apps plus everything they imply, with options parsed. */
function enableApps(
  requested: readonly string[],
  config: StackConfig,
  byId: ReadonlyMap<string, AppDefinition>,
  diagnostics: Diagnostic[],
): EnabledApp[] {
  const enabled = new Map<string, EnabledApp>();
  const pending = [...requested];
  for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
    const def = byId.get(id);
    if (def === undefined || enabled.has(id)) continue;
    const options = parseOptions(def, config.apps[id] ?? DEFAULT_SETTINGS, diagnostics);
    if (options === undefined) continue;
    enabled.set(id, { def, options });
    for (const implied of def.implies?.(options) ?? []) {
      const impliedDef = byId.get(implied);
      if (impliedDef === undefined || config.apps[implied]?.enabled === false) continue;
      const others = unique([...requested, ...enabled.keys()])
        .filter((other) => other !== implied)
        .map((other) => byId.get(other))
        .filter((other): other is AppDefinition => other !== undefined);
      const taken = (impliedDef.exclusive ?? []).some((capability) =>
        others.some((other) => provides(other, capability)),
      );
      if (!taken) pending.push(implied);
    }
  }
  return [...enabled.values()].sort((a, b) => compare(a.def.id, b.def.id));
}

function parseOptions(
  def: AppDefinition,
  settings: AppSettings,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  const { enabled, port, version, env, ...raw } = settings;
  const schema: z.ZodType<Record<string, unknown>> = def.options ?? NO_OPTIONS;
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const path = ['apps', def.id, ...issue.path.map(String)].join('.');
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        diagnostics.push(
          error('app.unknown-option', `unknown option "${path}.${key}"`, {
            path: `${path}.${key}`,
          }),
        );
      }
    } else {
      diagnostics.push(error('app.invalid-option', `${path}: ${issue.message}`, { path }));
    }
  }
  return undefined;
}

function checkApp(
  def: AppDefinition,
  settings: AppSettings,
  context: AppContext,
  host: HostFacts,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!def.arch.includes(host.arch)) {
    diagnostics.push(
      error('app.unsupported-arch', `${def.name} has no ${host.arch} image`, {
        path: `apps.${def.id}`,
        hint: 'disable it, or run Mediaplane on a supported host',
      }),
    );
  }
  const reserved = new Set(
    def.credentials.flatMap((step) => (step.step === 'env' ? [step.var] : [])),
  );
  for (const key of Object.keys(settings.env)) {
    if (reserved.has(key)) {
      diagnostics.push(
        error(
          'app.env-reserved',
          `apps.${def.id}.env.${key} carries a Mediaplane-managed secret and cannot be overridden`,
          { path: `apps.${def.id}.env.${key}` },
        ),
      );
    }
  }
  diagnostics.push(...(def.validate?.(context) ?? []));
  return diagnostics;
}

function imageRef(def: AppDefinition, settings: AppSettings, diagnostics: Diagnostic[]): string {
  const { repo, tag, digest } = def.image;
  if (settings.version === undefined || settings.version === tag) {
    return `${repo}:${tag}@${digest}`;
  }
  diagnostics.push(
    warning(
      'app.untested-version',
      `${def.name} ${settings.version} is an untested combination; this Mediaplane release tests ${tag}`,
      { path: `apps.${def.id}.version` },
    ),
  );
  return `${repo}:${settings.version}`;
}

function resolvePorts(
  def: AppDefinition,
  settings: AppSettings,
  diagnostics: Diagnostic[],
): { ports: PublishedPort[]; containerPorts: Record<string, number> } {
  const published = def.ports.filter((spec) => spec.publish !== false);
  if (settings.port !== undefined && published.length === 0) {
    diagnostics.push(
      error(
        'app.port-not-published',
        `${def.name} publishes no port, so apps.${def.id}.port cannot be used`,
        { path: `apps.${def.id}.port` },
      ),
    );
  }
  const ports: PublishedPort[] = [];
  const containerPorts: Record<string, number> = {};
  for (const spec of def.ports) {
    const isPrimary = spec === published[0];
    const host = isPrimary && settings.port !== undefined ? settings.port : spec.container;
    const container = spec.hostEqualsContainer ? host : spec.container;
    containerPorts[spec.name] = container;
    if (spec.publish !== false) {
      ports.push({
        app: def.id,
        name: spec.name,
        host,
        container,
        protocol: spec.protocol ?? 'tcp',
      });
    }
  }
  return { ports, containerPorts };
}

function checkCapabilities(enabled: readonly AppDefinition[], catalog: Catalog): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const def of enabled) {
    for (const requirement of def.requires) {
      const count = enabled.filter((other) => provides(other, requirement.capability)).length;
      if (count >= requirement.min) continue;
      const candidates = catalog
        .filter((other) => provides(other, requirement.capability))
        .map((other) => other.id);
      diagnostics.push(
        error(
          'app.missing-capability',
          `${def.name} needs a ${requirement.capability}, but none is enabled`,
          {
            path: `apps.${def.id}`,
            ...withHint(
              candidates.length > 0 ? `enable one of: ${candidates.join(', ')}` : undefined,
            ),
          },
        ),
      );
    }
  }
  const exclusive = unique(enabled.flatMap((def) => def.exclusive ?? [])).sort(compare);
  for (const capability of exclusive) {
    const providers = enabled.filter((def) => provides(def, capability));
    if (providers.length > 1) {
      diagnostics.push(
        error(
          'app.conflict',
          `${providers.map((p) => p.name).join(' and ')} each provide ${capability}; enable only one`,
        ),
      );
    }
  }
  return diagnostics;
}

function checkNetworkVia(apps: readonly ResolvedApp[]): Diagnostic[] {
  const ids = new Set(apps.map((app) => app.def.id));
  return apps.flatMap((app) =>
    app.networkVia === undefined || ids.has(app.networkVia)
      ? []
      : [
          error(
            'app.network-via-missing',
            `${app.def.name} runs inside ${app.networkVia}'s network, but ${app.networkVia} is not enabled`,
            { path: `apps.${app.networkVia}.enabled` },
          ),
        ],
  );
}

function checkPortConflicts(apps: readonly ResolvedApp[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const owners = new Map<string, string>();
  for (const app of apps) {
    for (const port of app.ports) {
      const key = `${port.protocol}/${port.host}`;
      const owner = owners.get(key);
      if (owner === undefined) {
        owners.set(key, app.def.id);
        continue;
      }
      diagnostics.push(
        error(
          'port.conflict',
          `port ${port.host}/${port.protocol} is used by both ${owner} and ${app.def.id}`,
          {
            path: `apps.${app.def.id}.port`,
            hint: `set apps.${app.def.id}.port to a free port`,
          },
        ),
      );
    }
  }
  return diagnostics;
}

function bindAddresses(
  config: StackConfig,
  host: HostFacts,
): { addresses: string[]; diagnostics: Diagnostic[] } {
  switch (config.network.bind) {
    case 'localhost':
      return { addresses: ['127.0.0.1'], diagnostics: [] };
    case 'all':
      return {
        addresses: ['0.0.0.0'],
        diagnostics: [
          warning(
            'network.bind-all',
            'network.bind is "all": app web UIs are published on every host interface',
            {
              path: 'network.bind',
              hint: 'on an internet-facing host this exposes the stack publicly; prefer "lan", or "localhost" with Tailscale',
            },
          ),
        ],
      };
    case 'lan': {
      const addresses = host.privateAddresses.map((a) => a.address).sort(compare);
      if (addresses.length > 0) return { addresses, diagnostics: [] };
      return {
        addresses: [],
        diagnostics: [
          error(
            'network.no-lan-address',
            'network.bind is "lan", but this host has no private (RFC 1918) IPv4 address',
            {
              path: 'network.bind',
              hint: 'use bind: localhost and reach the stack through Tailscale or an SSH tunnel',
            },
          ),
        ],
      };
    }
  }
}
```

`packages/engine/src/index.ts`:

```ts
export * from './diagnostics';
export * from './config/schema';
export * from './config/load';
export * from './config/secrets';
export * from './catalog/types';
export * from './host/facts';
export * from './resolver/resolve';
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run packages/engine/src/resolver`
Expected: PASS (all tests in `resolve.test.ts`).

- [ ] **Step 6: Check coverage for the resolver**

Run: `pnpm vitest run packages/engine/src/resolver --coverage --coverage.include='packages/engine/src/resolver/**' --coverage.thresholds.lines=90 --coverage.thresholds.branches=90`
Expected: `resolve.ts` meets 90% lines and branches. If a branch is uncovered, add a test for that behaviour to `resolve.test.ts` (one `it` per behaviour). Do not lower the threshold.

- [ ] **Step 7: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): resolve stack.yaml against the catalog"
```

---

### Task 8: The Compose renderer

**Files:**
- Create: `packages/engine/src/render/compose.ts`, `packages/engine/src/render/yaml.ts`, `docs/adr/0002-compose-native-control-plane.md`
- Create (generated, then reviewed): `packages/engine/src/render/__golden__/jellyfin-vpn-lan.compose.yaml`, `packages/engine/src/render/__golden__/plex-no-vpn-localhost.compose.yaml`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/render/compose.test.ts`, `packages/engine/src/render/yaml.test.ts`

**Interfaces:**
- Consumes: `ResolvedStack`, `ResolvedApp`, `PublishedPort`, `resolveStack` (Task 7); the fixtures (Task 7); `compare` (Task 2).
- Produces:
  - **Types:**
    - `ComposeHealthcheck`
    - `ComposeService`, a subset of the Compose spec with keys emitted in this order: `image`, `restart`, `user`, `init`, `cap_add`, `devices`, `network_mode`, `depends_on`, `environment`, `volumes`, `ports`, `labels`, `healthcheck`
    - `ComposeFile` (`{ name: string; services: Record<string, ComposeService> }`)
  - **Constants:** `PROJECT_NAME = 'mediaplane'`
  - **Functions:**
    - `secretEnvName(appId, secret): string`, e.g. `MP_SONARR_API_KEY`
    - `literal(value): string`, which escapes `$` as `$$`
    - `renderCompose(stack: ResolvedStack): ComposeFile`
  - **From `render/yaml.ts`:** `COMPOSE_HEADER` and `composeToYaml(compose: ComposeFile): string`.

- [ ] **Step 1: Write the failing tests**

`packages/engine/src/render/compose.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { HostFacts } from '../host/facts';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { FIXTURE_HOST, fixtureCatalog, fixtureConfig } from '../testing/fixtures';
import { literal, renderCompose, secretEnvName } from './compose';
import { composeToYaml } from './yaml';

function stackOf(source: string, host: HostFacts = FIXTURE_HOST): ResolvedStack {
  const result = resolveStack(fixtureConfig(source), fixtureCatalog, host, '/opt/mediaplane');
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics, null, 2));
  return result.stack;
}

const JELLYFIN_VPN_LAN = `version: 1
timezone: Europe/London
paths: { data: /srv/data }
network: { bind: lan }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: { env: { EXTRA: x } }
  qbittorrent: {}
`;

const PLEX_NO_VPN_LOCALHOST = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: plex
plex: { token: { env: PLEX_TOKEN } }
apps:
  qbittorrent: { vpn: false, port: 8200 }
  sonarr: {}
  prowlarr: {}
`;

describe('golden files', () => {
  it('renders the Jellyfin + VPN + LAN stack', async () => {
    await expect(composeToYaml(renderCompose(stackOf(JELLYFIN_VPN_LAN)))).toMatchFileSnapshot(
      './__golden__/jellyfin-vpn-lan.compose.yaml',
    );
  });

  it('renders the Plex + no VPN + localhost stack', async () => {
    await expect(
      composeToYaml(renderCompose(stackOf(PLEX_NO_VPN_LOCALHOST))),
    ).toMatchFileSnapshot('./__golden__/plex-no-vpn-localhost.compose.yaml');
  });

  it('renders identical output for identical input', () => {
    const render = () => composeToYaml(renderCompose(stackOf(JELLYFIN_VPN_LAN)));
    expect(render()).toBe(render());
  });
});

describe('renderCompose', () => {
  const compose = renderCompose(stackOf(JELLYFIN_VPN_LAN));

  it('runs qBittorrent inside Gluetun and publishes its UI on Gluetun', () => {
    expect(compose.services.qbittorrent).toMatchObject({
      network_mode: 'service:gluetun',
      depends_on: { gluetun: { condition: 'service_healthy', restart: true } },
    });
    expect(compose.services.qbittorrent?.ports).toBeUndefined();
    expect(compose.services.gluetun?.ports).toEqual(['192.168.1.10:8080:8080']);
  });

  it('never publishes ports marked publish: false', () => {
    expect(JSON.stringify(compose)).not.toContain('6881');
  });

  it('references secrets instead of embedding them', () => {
    expect(compose.services.sonarr?.environment?.SONARR__AUTH__APIKEY).toBe(
      '${MP_SONARR_API_KEY}',
    );
  });

  it('escapes literal dollars and includes user env', () => {
    expect(compose.services.sonarr?.environment).toMatchObject({
      STATIC: 'a$$b',
      EXTRA: 'x',
    });
  });

  it('sets PUID/PGID only for images that use them', () => {
    expect(compose.services.sonarr?.environment).toMatchObject({
      PUID: '1000',
      PGID: '1000',
      TZ: 'Europe/London',
    });
    expect(compose.services.gluetun?.environment).toEqual({ TZ: 'Europe/London' });
  });

  it('sorts environment keys', () => {
    const keys = Object.keys(compose.services.sonarr?.environment ?? {});
    expect(keys).toEqual([...keys].sort());
  });

  it('mounts the app config dir and the shared data root', () => {
    expect(compose.services.sonarr?.volumes).toEqual([
      '/opt/mediaplane/appdata/sonarr:/config',
      '/srv/data:/data',
    ]);
  });

  it('renders health checks with defaults, and omits "image" and "none"', () => {
    expect(compose.services.sonarr?.healthcheck).toEqual({
      test: ['CMD', 'true'],
      interval: '30s',
      timeout: '10s',
      retries: 5,
      start_period: '60s',
    });
    expect(compose.services.gluetun?.healthcheck).toBeUndefined();
    expect(compose.services.jellyfin?.healthcheck).toBeUndefined();
  });

  it('labels every service as managed by Mediaplane', () => {
    expect(compose.services.jellyfin?.labels).toEqual({
      'io.mediaplane.app': 'jellyfin',
      'io.mediaplane.managed': 'true',
    });
  });

  it('publishes on every bind address', () => {
    const twoNics: HostFacts = {
      arch: 'amd64',
      privateAddresses: [
        { address: '10.0.0.5', cidr: '10.0.0.5/24' },
        { address: '192.168.1.10', cidr: '192.168.1.10/24' },
      ],
    };
    expect(renderCompose(stackOf(JELLYFIN_VPN_LAN, twoNics)).services.jellyfin?.ports).toEqual(
      ['10.0.0.5:8096:8096', '192.168.1.10:8096:8096'],
    );
  });

  it('matches host and container port when the app requires it', () => {
    const plex = renderCompose(stackOf(PLEX_NO_VPN_LOCALHOST));
    expect(plex.services.qbittorrent).toMatchObject({
      ports: ['127.0.0.1:8200:8200'],
      environment: { WEBUI_PORT: '8200' },
    });
    expect(plex.services.qbittorrent?.network_mode).toBeUndefined();
  });

  it('renders a user directive for user-directive apps', () => {
    expect(renderCompose(stackOf(PLEX_NO_VPN_LOCALHOST)).services.byparr?.user).toBe(
      '1000:1000',
    );
  });

  it('renders extras such as capabilities', () => {
    expect(compose.services.gluetun?.cap_add).toEqual(['NET_ADMIN']);
  });
});

describe('secretEnvName', () => {
  it.each([
    ['sonarr', 'apiKey', 'MP_SONARR_API_KEY'],
    ['gluetun', 'wireguardKey', 'MP_GLUETUN_WIREGUARD_KEY'],
    ['my-app', 'token', 'MP_MY_APP_TOKEN'],
  ])('%s/%s → %s', (app, secret, expected) => {
    expect(secretEnvName(app, secret)).toBe(expected);
  });
});

describe('literal', () => {
  it('doubles every dollar sign', () => {
    expect(literal('a$b$$c')).toBe('a$$b$$$$c');
  });
});
```

`packages/engine/src/render/yaml.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { ComposeFile } from './compose';
import { composeToYaml } from './yaml';

const compose: ComposeFile = {
  name: 'mediaplane',
  services: {
    web: {
      image: 'registry.test/web:1',
      restart: 'unless-stopped',
      user: '1000:1000',
      environment: { COUNT: '1000', PASS: 'a$$b' },
      ports: ['127.0.0.1:8080:8080'],
      labels: { 'io.mediaplane.app': 'web' },
    },
  },
};
const yaml = composeToYaml(compose);

describe('composeToYaml', () => {
  it('starts with the do-not-edit header', () => {
    expect(yaml.startsWith('# Generated by Mediaplane — DO NOT EDIT.')).toBe(true);
  });

  it('double-quotes every port mapping and the user directive', () => {
    expect(yaml).toContain('- "127.0.0.1:8080:8080"');
    expect(yaml).toContain('user: "1000:1000"');
  });

  it('keeps numeric-looking strings as strings', () => {
    expect(yaml).toContain('COUNT: "1000"');
  });

  it('keeps escaped dollars for Compose', () => {
    expect(yaml).toContain('PASS: a$$b');
  });

  it('round-trips to the same data', () => {
    expect(parse(yaml)).toEqual(compose);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/render`
Expected: FAIL, because `./compose` and `./yaml` cannot be resolved.

- [ ] **Step 3: Write the implementation**

`packages/engine/src/render/compose.ts`:

```ts
import type { PublishedPort, ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { compare } from '../util/sort';

export interface ComposeHealthcheck {
  test: string[];
  interval: string;
  timeout: string;
  retries: number;
  start_period: string;
}

/** The subset of the Compose spec Mediaplane emits. Key order here is output order. */
export interface ComposeService {
  image: string;
  restart: 'unless-stopped';
  user?: string;
  init?: boolean;
  cap_add?: string[];
  devices?: string[];
  network_mode?: string;
  depends_on?: Record<string, { condition: 'service_healthy'; restart: boolean }>;
  environment?: Record<string, string>;
  volumes?: string[];
  ports?: string[];
  labels: Record<string, string>;
  healthcheck?: ComposeHealthcheck;
}

export interface ComposeFile {
  name: string;
  services: Record<string, ComposeService>;
}

export const PROJECT_NAME = 'mediaplane';

/** Name of the .env variable carrying an app's secret, e.g. MP_SONARR_API_KEY. */
export function secretEnvName(appId: string, secret: string): string {
  const snake = secret.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return `MP_${appId}_${snake}`.replace(/-/g, '_').toUpperCase();
}

/** Escape a literal value so Compose does not interpolate it. */
export function literal(value: string): string {
  return value.replaceAll('$', () => '$$');
}

export function renderCompose(stack: ResolvedStack): ComposeFile {
  // Ports of an app that shares another app's network namespace are published there.
  const portsByService = new Map<string, string[]>();
  for (const app of stack.apps) {
    const target = app.networkVia ?? app.def.id;
    const ports = portsByService.get(target) ?? [];
    for (const port of app.ports) {
      for (const address of stack.bindAddresses) ports.push(portMapping(address, port));
    }
    portsByService.set(target, ports);
  }
  const services: Record<string, ComposeService> = {};
  for (const app of stack.apps) {
    services[app.def.id] = renderService(app, stack, portsByService.get(app.def.id) ?? []);
  }
  return { name: PROJECT_NAME, services };
}

function portMapping(address: string, port: PublishedPort): string {
  const suffix = port.protocol === 'udp' ? '/udp' : '';
  return `${address}:${port.host}:${port.container}${suffix}`;
}

function renderService(
  app: ResolvedApp,
  stack: ResolvedStack,
  ports: string[],
): ComposeService {
  const { def, context, networkVia } = app;
  const extras = def.extras?.(context) ?? {};
  const environment = renderEnvironment(app, stack);
  const volumes = renderVolumes(app, stack);
  const { uid, gid } = stack.config.user;
  return {
    image: app.image,
    restart: 'unless-stopped',
    ...(def.runAs === 'user-directive' ? { user: `${uid}:${gid}` } : {}),
    ...(extras.init === undefined ? {} : { init: extras.init }),
    ...(extras.cap_add === undefined ? {} : { cap_add: extras.cap_add }),
    ...(extras.devices === undefined ? {} : { devices: extras.devices }),
    ...(networkVia === undefined
      ? {}
      : {
          network_mode: `service:${networkVia}`,
          depends_on: {
            [networkVia]: { condition: 'service_healthy' as const, restart: true },
          },
        }),
    ...(Object.keys(environment).length === 0 ? {} : { environment }),
    ...(volumes.length === 0 ? {} : { volumes }),
    ...(ports.length === 0 ? {} : { ports }),
    labels: { 'io.mediaplane.app': def.id, 'io.mediaplane.managed': 'true' },
    ...(typeof def.health === 'object'
      ? { healthcheck: healthcheck(def.health.test, def.health.startPeriod) }
      : {}),
  };
}

function healthcheck(test: string[], startPeriod = '60s'): ComposeHealthcheck {
  return { test, interval: '30s', timeout: '10s', retries: 5, start_period: startPeriod };
}

function renderEnvironment(app: ResolvedApp, stack: ResolvedStack): Record<string, string> {
  const { def, context, settings } = app;
  const env: Record<string, string> = { TZ: literal(stack.config.timezone) };
  if (def.runAs === 'puid-env') {
    env.PUID = String(stack.config.user.uid);
    env.PGID = String(stack.config.user.gid);
  }
  for (const [key, value] of Object.entries(def.env?.(context) ?? {})) {
    env[key] = literal(value);
  }
  for (const port of def.ports) {
    if (port.hostEqualsContainer) {
      env[port.hostEqualsContainer.env] = String(
        app.containerPorts[port.name] ?? port.container,
      );
    }
  }
  for (const step of def.credentials) {
    if (step.step === 'env') env[step.var] = `\${${secretEnvName(def.id, step.secret)}}`;
  }
  for (const [key, value] of Object.entries(settings.env)) env[key] = literal(value);
  return Object.fromEntries(Object.entries(env).sort(([a], [b]) => compare(a, b)));
}

function renderVolumes(app: ResolvedApp, stack: ResolvedStack): string[] {
  const { appdata, data } = app.def.volumes;
  const volumes: string[] = [];
  if (appdata !== undefined) {
    volumes.push(literal(`${stack.home}/appdata/${app.def.id}:${appdata}`));
  }
  if (data !== undefined) volumes.push(literal(`${stack.config.paths.data}:${data}`));
  return volumes;
}
```

`packages/engine/src/render/yaml.ts`:

```ts
import { Document, isScalar, isSeq, Scalar, visit } from 'yaml';
import type { ComposeFile } from './compose';

/** Each line starts with a space so it renders as "# …". */
export const COMPOSE_HEADER = [
  ' Generated by Mediaplane — DO NOT EDIT. This file is rewritten on every apply.',
  ' Put your own changes in compose.override.yaml next to stack.yaml.',
].join('\n');

export function composeToYaml(compose: ComposeFile): string {
  const doc = new Document(compose);
  // Quote "a:b" values: YAML 1.1 parsers read unquoted "80:80" as a base-60 number.
  visit(doc, {
    Pair(_key, pair) {
      if (!isScalar(pair.key)) return;
      if (pair.key.value === 'ports' && isSeq(pair.value)) {
        for (const item of pair.value.items) {
          if (isScalar(item)) item.type = Scalar.QUOTE_DOUBLE;
        }
      }
      if (pair.key.value === 'user' && isScalar(pair.value)) {
        pair.value.type = Scalar.QUOTE_DOUBLE;
      }
    },
  });
  doc.commentBefore = COMPOSE_HEADER;
  return doc.toString({ lineWidth: 0 });
}
```

`packages/engine/src/index.ts`:

```ts
export * from './diagnostics';
export * from './config/schema';
export * from './config/load';
export * from './config/secrets';
export * from './catalog/types';
export * from './host/facts';
export * from './resolver/resolve';
export * from './render/compose';
export * from './render/yaml';
```

- [ ] **Step 4: Run the tests to generate the golden files**

Run: `pnpm vitest run packages/engine/src/render`
Expected: PASS. On this first run outside CI, Vitest writes the two missing `__golden__/*.compose.yaml` files. In CI, where `CI=true`, a missing golden file fails the test instead, so the golden files must be committed.

- [ ] **Step 5: Review the golden files by hand**

Open `packages/engine/src/render/__golden__/jellyfin-vpn-lan.compose.yaml`. It must match the following, apart from the presence of a blank line after the header comment:

```yaml
# Generated by Mediaplane — DO NOT EDIT. This file is rewritten on every apply.
# Put your own changes in compose.override.yaml next to stack.yaml.

name: mediaplane
services:
  gluetun:
    image: registry.test/gluetun:1.0.0@sha256:0000000000000000000000000000000000000000000000000000000000000000
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
    environment:
      TZ: Europe/London
    volumes:
      - /opt/mediaplane/appdata/gluetun:/config
    ports:
      - "192.168.1.10:8080:8080"
    labels:
      io.mediaplane.app: gluetun
      io.mediaplane.managed: "true"
  jellyfin:
    image: registry.test/jellyfin:1.0.0@sha256:0000000000000000000000000000000000000000000000000000000000000000
    restart: unless-stopped
    environment:
      PGID: "1000"
      PUID: "1000"
      TZ: Europe/London
    volumes:
      - /opt/mediaplane/appdata/jellyfin:/config
    ports:
      - "192.168.1.10:8096:8096"
    labels:
      io.mediaplane.app: jellyfin
      io.mediaplane.managed: "true"
  qbittorrent:
    image: registry.test/qbittorrent:1.0.0@sha256:0000000000000000000000000000000000000000000000000000000000000000
    restart: unless-stopped
    network_mode: service:gluetun
    depends_on:
      gluetun:
        condition: service_healthy
        restart: true
    environment:
      PGID: "1000"
      PUID: "1000"
      TZ: Europe/London
      WEBUI_PORT: "8080"
    volumes:
      - /opt/mediaplane/appdata/qbittorrent:/config
    labels:
      io.mediaplane.app: qbittorrent
      io.mediaplane.managed: "true"
  sonarr:
    image: registry.test/sonarr:1.0.0@sha256:0000000000000000000000000000000000000000000000000000000000000000
    restart: unless-stopped
    environment:
      EXTRA: x
      PGID: "1000"
      PUID: "1000"
      SONARR__AUTH__APIKEY: ${MP_SONARR_API_KEY}
      STATIC: a$$b
      TZ: Europe/London
    volumes:
      - /opt/mediaplane/appdata/sonarr:/config
      - /srv/data:/data
    ports:
      - "192.168.1.10:8989:8989"
    labels:
      io.mediaplane.app: sonarr
      io.mediaplane.managed: "true"
    healthcheck:
      test:
        - CMD
        - "true"
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s
```

Check `plex-no-vpn-localhost.compose.yaml` against these points:

- the services are `byparr`, `plex`, `prowlarr`, `qbittorrent` and `sonarr`;
- `byparr` has `user: "1000:1000"` and no `volumes`;
- `qbittorrent` has `ports: ["127.0.0.1:8200:8200"]`, `WEBUI_PORT: "8200"`, and no `network_mode`;
- every port starts with `127.0.0.1:`;
- `TZ: Etc/UTC` is set everywhere.

If either file differs in substance, the renderer is wrong. Fix the code and delete the golden file so it regenerates; never hand-edit a golden file to make the test pass.

- [ ] **Step 6: Write the ADR**

`docs/adr/0002-compose-native-control-plane.md`:

```markdown
# 0002. Compose-native control plane

- **Status:** Accepted
- **Date:** 2026-10-08

## Context

Mediaplane needs to create and update a set of containers. We considered three options:

1. Render a Docker Compose project and drive the `docker compose` CLI.
2. Call the Docker Engine API directly, the way Runtipi and CasaOS do.
3. Build on an existing tool's wiring code, such as LavX/arrstack or Configarr.

The project's principles include no lock-in, and the user keeps control through documented
override points.

## Decision

Mediaplane renders `stack.yaml` into a **plain Compose project** in `generated/`
(`compose.yaml` and `.env`) and applies it with the `docker compose` CLI. The user's own
`compose.override.yaml` is merged by Compose itself.

## Consequences

- **Ejectable.** The generated project runs with `docker compose up -d` without
  Mediaplane, and Portainer and other tools can manage it.
- **Container-level overrides are free.** They use Compose's own merge, with no custom
  override language.
- **Compose handles health-gated startup.** That includes
  `depends_on: service_healthy` and `network_mode: service:gluetun`, so Mediaplane doesn't
  reimplement it.
- **We depend on the Compose CLI's behaviour and output.** Only the runtime module (S2)
  talks to it, and the Compose version is pinned in the image.
- **Paths must be identical inside and outside the container.** The host's Docker daemon
  interprets bind-mount paths, so `MEDIAPLANE_HOME` must be mounted at the same absolute
  path in both places.
```

- [ ] **Step 7: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): render the Compose project"
```

---

### Task 9: Check that the real catalog renders a correct stack

**Files:**
- Test: `catalog/render.test.ts`

**Interfaces:**
- Consumes: `parseConfig` (Task 3), `resolveStack` and `HostFacts` (Tasks 5 and 7), `renderCompose` and `composeToYaml` (Task 8), and `catalog` (Task 6).
- Produces: nothing new. These tests pin the behaviour of the **real** catalog. When one fails, a catalog entry is wrong: fix the entry, not the test.

- [ ] **Step 1: Write the tests**

`catalog/render.test.ts`:

```ts
import {
  composeToYaml,
  parseConfig,
  renderCompose,
  resolveStack,
  type Diagnostic,
  type HostFacts,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { catalog } from './index';

const HOST: HostFacts = {
  arch: 'arm64',
  privateAddresses: [{ address: '192.168.1.10', cidr: '192.168.1.10/24' }],
};

/** docs/design/m1-engine-cli.md §4.2, trimmed to what Slice 1 understands. */
const SPEC_EXAMPLE = `version: 1
timezone: Europe/London
paths: { data: /srv/data }
network: { bind: lan }
media_server: jellyfin
vpn:
  provider: mullvad
  private_key: { file: secrets/wg.key }
apps:
  sonarr: {}
  radarr: { port: 7879 }
  prowlarr: {}
  qbittorrent: {}
  seerr: {}
`;

function resolve(source: string, host: HostFacts = HOST) {
  const parsed = parseConfig(source);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return resolveStack(parsed.config, catalog, host, '/opt/mediaplane');
}

function render(source: string, host: HostFacts = HOST) {
  const result = resolve(source, host);
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return { compose: renderCompose(result.stack), diagnostics: result.diagnostics };
}

const codes = (diagnostics: Diagnostic[]) => diagnostics.map((d) => d.code);

describe('the real catalog', () => {
  it.each(['amd64', 'arm64'] as const)('resolves the design-spec example on %s', (arch) => {
    const { compose, diagnostics } = render(SPEC_EXAMPLE, { ...HOST, arch });
    expect(diagnostics).toEqual([]);
    expect(Object.keys(compose.services)).toEqual([
      'byparr',
      'gluetun',
      'jellyfin',
      'prowlarr',
      'qbittorrent',
      'radarr',
      'seerr',
      'sonarr',
    ]);
  });

  it('puts qBittorrent inside Gluetun and publishes its UI on Gluetun', () => {
    const { compose } = render(SPEC_EXAMPLE);
    expect(compose.services.qbittorrent?.network_mode).toBe('service:gluetun');
    expect(compose.services.qbittorrent?.depends_on).toEqual({
      gluetun: { condition: 'service_healthy', restart: true },
    });
    expect(compose.services.qbittorrent?.ports).toBeUndefined();
    expect(compose.services.gluetun?.ports).toEqual(['192.168.1.10:8080:8080']);
    expect(compose.services.gluetun).toMatchObject({
      cap_add: ['NET_ADMIN'],
      devices: ['/dev/net/tun:/dev/net/tun'],
    });
  });

  it('publishes a port override on the host side only', () => {
    expect(render(SPEC_EXAMPLE).compose.services.radarr?.ports).toEqual([
      '192.168.1.10:7879:7878',
    ]);
  });

  it('never publishes the Cloudflare solver', () => {
    expect(render(SPEC_EXAMPLE).compose.services.byparr?.ports).toBeUndefined();
  });

  it('pins every image by digest', () => {
    for (const service of Object.values(render(SPEC_EXAMPLE).compose.services)) {
      expect(service.image).toMatch(/:[^@]+@sha256:[0-9a-f]{64}$/);
    }
  });

  it('keeps secrets out of compose.yaml', () => {
    const yaml = composeToYaml(render(SPEC_EXAMPLE).compose);
    for (const reference of [
      '${MP_SONARR_API_KEY}',
      '${MP_RADARR_API_KEY}',
      '${MP_PROWLARR_API_KEY}',
      '${MP_SEERR_API_KEY}',
      '${MP_GLUETUN_WIREGUARD_KEY}',
    ]) {
      expect(yaml).toContain(reference);
    }
    expect(yaml).not.toContain('secrets/wg.key');
  });

  it('requires login on the LAN by default', () => {
    const env = render(SPEC_EXAMPLE).compose.services.sonarr?.environment;
    expect(env).toMatchObject({ SONARR__AUTH__METHOD: 'Forms', SONARR__AUTH__REQUIRED: 'Enabled' });
    expect(env).not.toHaveProperty('SONARR__SERVER__TRUSTEDNETWORKS');
  });

  it('trusts only the LAN subnet when login on the LAN is turned off', () => {
    const source = SPEC_EXAMPLE.replace(
      'network: { bind: lan }',
      'network: { bind: lan }\nsecurity: { login_on_lan: false }',
    );
    expect(render(source).compose.services.radarr?.environment).toMatchObject({
      RADARR__AUTH__REQUIRED: 'DisabledForLocalAddresses',
      RADARR__SERVER__TRUSTEDNETWORKS: '192.168.1.0/24',
    });
  });

  it('lets the LAN reach apps inside the VPN namespace', () => {
    expect(render(SPEC_EXAMPLE).compose.services.gluetun?.environment).toMatchObject({
      VPN_SERVICE_PROVIDER: 'mullvad',
      VPN_TYPE: 'wireguard',
      FIREWALL_OUTBOUND_SUBNETS: '192.168.1.0/24',
    });
  });

  it('runs Seerr with init and its own fixed user', () => {
    const seerr = render(SPEC_EXAMPLE).compose.services.seerr;
    expect(seerr?.init).toBe(true);
    expect(seerr?.environment).not.toHaveProperty('PUID');
    expect(seerr?.user).toBeUndefined();
  });

  it('warns, and publishes qBittorrent directly, when the VPN is off', () => {
    const source = SPEC_EXAMPLE.replace(/vpn:\n(?: {2}.*\n)+/, '').replace(
      '  qbittorrent: {}',
      '  qbittorrent: { vpn: false }',
    );
    const { compose, diagnostics } = render(source);
    expect(codes(diagnostics)).toEqual(['qbittorrent.no-vpn']);
    expect(compose.services.gluetun).toBeUndefined();
    expect(compose.services.qbittorrent?.ports).toEqual(['192.168.1.10:8080:8080']);
  });

  it('fails without a vpn: block while the VPN is on', () => {
    const source = SPEC_EXAMPLE.replace(/vpn:\n(?: {2}.*\n)+/, '');
    expect(codes(resolve(source).diagnostics)).toContain('vpn.missing');
  });

  it('uses FlareSolverr instead of Byparr when it is listed', () => {
    const { compose } = render(`${SPEC_EXAMPLE}  flaresolverr: {}\n`);
    expect(compose.services.flaresolverr).toBeDefined();
    expect(compose.services.byparr).toBeUndefined();
  });

  it('supports Plex as the media server', () => {
    const source = SPEC_EXAMPLE.replace(
      'media_server: jellyfin',
      'media_server: plex\nplex: { token: { env: PLEX_TOKEN } }',
    );
    const { compose } = render(source);
    expect(compose.services.plex?.environment).toMatchObject({ VERSION: 'docker' });
    expect(compose.services.jellyfin).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run catalog/render.test.ts`
Expected: PASS. If a test fails, read the failure and correct the catalog entry it points to. For example, a missing `FIREWALL_OUTBOUND_SUBNETS` means `gluetun/app.ts`'s `env` is wrong.

- [ ] **Step 3: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "test(catalog): check the real catalog renders a correct stack"
```

---

### Task 10: The file-level plan

**Files:**
- Create: `packages/engine/src/plan/files.ts`, `packages/engine/src/plan/plan.ts`
- Modify: `packages/engine/src/index.ts`
- Test: `packages/engine/src/plan/files.test.ts`, `packages/engine/src/plan/plan.test.ts`

**Interfaces:**
- Consumes: `loadConfigFile` (Task 3), `checkSecretRefs` (Task 4), `Catalog` and `HostFacts` (Task 5), `resolveStack` (Task 7), `renderCompose` and `composeToYaml` (Task 8), `readIfExists` (Task 3), and the fixtures (Task 7).
- Produces:
  - **Types:**
    - `RenderedFile`: `{ path: string; content: string }`
    - `FileChange`: `{ path: string; status: 'create' | 'update' | 'unchanged'; diff: string; content: string }`
    - `PlanOptions`: `{ home: string; catalog: Catalog; host: HostFacts; env: NodeJS.ProcessEnv }`
    - `PlanResult`: `{ ok: boolean; changed: boolean; files: FileChange[]; diagnostics: Diagnostic[] }`
  - **Functions:**
    - `diffFiles(home, files: RenderedFile[]): Promise<FileChange[]>`
    - `plan(options: PlanOptions): Promise<PlanResult>`
  - **Constant:** `COMPOSE_PATH = 'generated/compose.yaml'`

- [ ] **Step 1: Install jsdiff**

Run: `pnpm --filter @mediaplane/engine add diff`
Expected: `diff` is added to the engine's `dependencies`. Recent versions bundle their own type definitions. If `pnpm typecheck` later reports missing types for `diff`, also run `pnpm --filter @mediaplane/engine add -D @types/diff`.

- [ ] **Step 2: Write the failing tests**

`packages/engine/src/plan/files.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffFiles } from './files';

describe('diffFiles', () => {
  it('marks files as new, changed or unchanged, with a unified diff', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-files-'));
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, 'generated', 'same.yaml'), 'a: 1\n');
    await writeFile(join(home, 'generated', 'old.yaml'), 'a: 1\n');

    const changes = await diffFiles(home, [
      { path: 'generated/new.yaml', content: 'a: 1\n' },
      { path: 'generated/old.yaml', content: 'a: 2\n' },
      { path: 'generated/same.yaml', content: 'a: 1\n' },
    ]);

    expect(changes.map((c) => [c.path, c.status])).toEqual([
      ['generated/new.yaml', 'create'],
      ['generated/old.yaml', 'update'],
      ['generated/same.yaml', 'unchanged'],
    ]);
    expect(changes[0]?.diff).toContain('+a: 1');
    expect(changes[1]?.diff).toContain('-a: 1');
    expect(changes[1]?.diff).toContain('+a: 2');
    expect(changes[2]?.diff).toBe('');
    expect(changes[1]?.content).toBe('a: 2\n');
  });
});
```

`packages/engine/src/plan/plan.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_HOST, fixtureCatalog } from '../testing/fixtures';
import { COMPOSE_PATH, plan } from './plan';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
  sonarr: {}
`;

async function makeHome({ stack = STACK, withSecret = true } = {}): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-plan-'));
  await writeFile(join(home, 'stack.yaml'), stack);
  if (withSecret) {
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  }
  return home;
}

const planFor = (home: string) =>
  plan({ home, catalog: fixtureCatalog, host: FIXTURE_HOST, env: {} });

describe('plan', () => {
  it('plans to create compose.yaml in a fresh home', async () => {
    const result = await planFor(await makeHome());
    expect(result).toMatchObject({ ok: true, changed: true, diagnostics: [] });
    expect(result.files).toEqual([
      expect.objectContaining({ path: COMPOSE_PATH, status: 'create' }),
    ]);
    expect(result.files[0]?.content).toContain('name: mediaplane');
  });

  it('reports no changes when compose.yaml is already current', async () => {
    const home = await makeHome();
    const first = await planFor(home);
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, COMPOSE_PATH), first.files[0]?.content ?? '');
    expect(await planFor(home)).toMatchObject({
      ok: true,
      changed: false,
      files: [{ status: 'unchanged' }],
    });
  });

  it('fails with the config error when stack.yaml is missing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-plan-'));
    expect(await planFor(home)).toMatchObject({
      ok: false,
      changed: false,
      files: [],
      diagnostics: [{ code: 'config.missing' }],
    });
  });

  it('fails when a referenced secret is missing', async () => {
    expect(await planFor(await makeHome({ withSecret: false }))).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'secret.missing', path: 'vpn.private_key' })],
    });
  });

  it('fails when the stack does not resolve', async () => {
    const stack = STACK.replace('  qbittorrent: {}\n', '');
    expect(await planFor(await makeHome({ stack }))).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'app.missing-capability' })],
    });
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run packages/engine/src/plan`
Expected: FAIL, because `./files` and `./plan` cannot be resolved.

- [ ] **Step 4: Write the implementation**

`packages/engine/src/plan/files.ts`:

```ts
import { join } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { readIfExists } from '../util/fs';

export interface RenderedFile {
  /** Relative to the Mediaplane home, e.g. "generated/compose.yaml". */
  path: string;
  content: string;
}

export interface FileChange {
  path: string;
  status: 'create' | 'update' | 'unchanged';
  /** Unified diff from the current file; empty when unchanged. */
  diff: string;
  /** The content apply will write. */
  content: string;
}

export async function diffFiles(
  home: string,
  files: readonly RenderedFile[],
): Promise<FileChange[]> {
  return Promise.all(
    files.map(async (file): Promise<FileChange> => {
      const current = await readIfExists(join(home, file.path));
      if (current === file.content) {
        return { path: file.path, status: 'unchanged', diff: '', content: file.content };
      }
      const diff = createTwoFilesPatch(
        `a/${file.path}`,
        `b/${file.path}`,
        current ?? '',
        file.content,
        undefined,
        undefined,
        { context: 3 },
      );
      return {
        path: file.path,
        status: current === undefined ? 'create' : 'update',
        diff,
        content: file.content,
      };
    }),
  );
}
```

`packages/engine/src/plan/plan.ts`:

```ts
import { join, resolve } from 'node:path';
import type { Catalog } from '../catalog/types';
import { loadConfigFile } from '../config/load';
import { checkSecretRefs } from '../config/secrets';
import { hasErrors, type Diagnostic } from '../diagnostics';
import type { HostFacts } from '../host/facts';
import { renderCompose } from '../render/compose';
import { composeToYaml } from '../render/yaml';
import { resolveStack } from '../resolver/resolve';
import { diffFiles, type FileChange } from './files';

export const COMPOSE_PATH = 'generated/compose.yaml';

export interface PlanOptions {
  home: string;
  catalog: Catalog;
  host: HostFacts;
  env: NodeJS.ProcessEnv;
}

export interface PlanResult {
  /** False when any diagnostic is an error; files is then empty. */
  ok: boolean;
  changed: boolean;
  files: FileChange[];
  diagnostics: Diagnostic[];
}

/** Everything apply would do, without doing it. (Slice 1: generated files only.) */
export async function plan(options: PlanOptions): Promise<PlanResult> {
  const home = resolve(options.home);
  const loaded = await loadConfigFile(join(home, 'stack.yaml'));
  if (!loaded.ok) return failed(loaded.diagnostics);

  const diagnostics = await checkSecretRefs(loaded.config, home, options.env);
  const resolved = resolveStack(loaded.config, options.catalog, options.host, home);
  diagnostics.push(...resolved.diagnostics);
  if (resolved.stack === undefined || hasErrors(diagnostics)) return failed(diagnostics);

  const compose = composeToYaml(renderCompose(resolved.stack));
  const files = await diffFiles(home, [{ path: COMPOSE_PATH, content: compose }]);
  return {
    ok: true,
    changed: files.some((file) => file.status !== 'unchanged'),
    files,
    diagnostics,
  };
}

function failed(diagnostics: Diagnostic[]): PlanResult {
  return { ok: false, changed: false, files: [], diagnostics };
}
```

`packages/engine/src/index.ts`:

```ts
export * from './diagnostics';
export * from './config/schema';
export * from './config/load';
export * from './config/secrets';
export * from './catalog/types';
export * from './host/facts';
export * from './resolver/resolve';
export * from './render/compose';
export * from './render/yaml';
export * from './plan/files';
export * from './plan/plan';
```

- [ ] **Step 5: Run them to verify they pass, with coverage**

Run: `pnpm vitest run packages/engine/src/plan && pnpm test:coverage`
Expected: PASS. Coverage of `resolver/`, `render/` and `plan/` meets the 90% thresholds. If it doesn't, add tests for the uncovered behaviour; do not lower the thresholds.

- [ ] **Step 6: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(engine): plan generated files"
```

---

### Task 11: The CLI `mediaplane plan` command

**Files:**
- Create: `packages/cli/src/run.ts`, `packages/cli/src/output.ts`, `packages/cli/src/main.ts`
- Modify: `packages/cli/package.json` (dependencies), `package.json` (the `mediaplane` script), `README.md` (a "Try it" section)
- Test: `packages/cli/src/run.test.ts`, `packages/cli/src/main.test.ts`

**Interfaces:**
- Consumes: `plan`, `PlanResult`, `Diagnostic` and `detectHostFacts` from `@mediaplane/engine`; `catalog` from `@mediaplane/catalog`; `VERSION` (Task 1).
- Produces:
  - `interface Io { stdout(text: string): void; stderr(text: string): void; env: NodeJS.ProcessEnv }`
  - `run(argv: readonly string[], io: Io): Promise<number>`, which takes user arguments without the node/script prefix and returns the exit code
  - `DEFAULT_HOME = '/opt/mediaplane'`
  - `PLAN_JSON_SCHEMA = 'mediaplane.plan/v1'`
  - `formatDiagnostic(d): string`
  - `printPlan(result, { json }, io): void`
- The JSON output of `plan --json` looks like this:

  ```json
  {
    "schema": "mediaplane.plan/v1",
    "ok": true,
    "changed": true,
    "files": [{ "path": "generated/compose.yaml", "status": "create", "diff": "…" }],
    "diagnostics": []
  }
  ```

  File `content` is left out of the JSON.

- [ ] **Step 1: Install the dependencies**

Run: `pnpm --filter @mediaplane/cli add commander "@mediaplane/engine@workspace:*" "@mediaplane/catalog@workspace:*"`
Expected: `packages/cli/package.json` gains the three dependencies.

- [ ] **Step 2: Write the failing tests**

`packages/cli/src/run.test.ts`:

```ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import { detectHostFacts, plan } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { run, type Io } from './run';
import { VERSION } from './version';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  qbittorrent: {}
`;

async function makeHome(stack = STACK): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-cli-'));
  await mkdir(join(home, 'secrets'));
  await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  await writeFile(join(home, 'stack.yaml'), stack);
  return home;
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

describe('mediaplane plan', () => {
  it('exits 2 and lists compose.yaml as new in a fresh home', async () => {
    const term = capture();
    expect(await run(['plan', '--home', await makeHome()], term.io)).toBe(2);
    expect(term.stdout()).toContain('+ generated/compose.yaml');
    expect(term.stdout()).toContain('Plan: 1 file(s) to write.');
  });

  it('prints versioned JSON without file contents', async () => {
    const term = capture();
    expect(await run(['plan', '--home', await makeHome(), '--json'], term.io)).toBe(2);
    const json = JSON.parse(term.stdout()) as {
      schema: string;
      ok: boolean;
      changed: boolean;
      files: Record<string, unknown>[];
    };
    expect(json).toMatchObject({ schema: 'mediaplane.plan/v1', ok: true, changed: true });
    expect(json.files[0]).toMatchObject({ path: 'generated/compose.yaml', status: 'create' });
    expect(json.files[0]).not.toHaveProperty('content');
  });

  it('exits 0 when nothing would change', async () => {
    const home = await makeHome();
    const current = await plan({ home, catalog, host: detectHostFacts(), env: {} });
    await mkdir(join(home, 'generated'));
    await writeFile(join(home, 'generated', 'compose.yaml'), current.files[0]?.content ?? '');
    const term = capture();
    expect(await run(['plan', '--home', home], term.io)).toBe(0);
    expect(term.stdout()).toContain('No changes.');
  });

  it('exits 1 with actionable errors on stderr', async () => {
    const term = capture();
    const home = await makeHome(STACK.replace('sonarr: {}', 'sonar: {}'));
    expect(await run(['plan', '--home', home], term.io)).toBe(1);
    expect(term.stderr()).toContain('error: unknown app "sonar"');
    expect(term.stderr()).toContain('hint: did you mean "sonarr"?');
  });

  it('reads the home directory from MEDIAPLANE_HOME', async () => {
    const term = capture({ MEDIAPLANE_HOME: await makeHome() });
    expect(await run(['plan'], term.io)).toBe(2);
  });

  it('prints its version', async () => {
    const term = capture();
    expect(await run(['--version'], term.io)).toBe(0);
    expect(term.stdout().trim()).toBe(VERSION);
  });
});
```

`packages/cli/src/main.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

describe('main', () => {
  it('runs as a real process and exits with the command status', () => {
    const main = fileURLToPath(new URL('./main.ts', import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', main, '--version'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run packages/cli`
Expected: FAIL, because `./run` cannot be resolved and `main.ts` does not exist (non-zero status).

- [ ] **Step 4: Write the implementation**

`packages/cli/src/output.ts`:

```ts
import type { Diagnostic, PlanResult } from '@mediaplane/engine';
import type { Io } from './run';

export const PLAN_JSON_SCHEMA = 'mediaplane.plan/v1';

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const hint = diagnostic.hint === undefined ? '' : `\n  hint: ${diagnostic.hint}`;
  return `${diagnostic.severity}: ${diagnostic.message}${hint}\n`;
}

export function printPlan(result: PlanResult, options: { json: boolean }, io: Io): void {
  if (options.json) {
    const files = result.files.map(({ content, ...file }) => file);
    io.stdout(`${JSON.stringify({ schema: PLAN_JSON_SCHEMA, ...result, files }, null, 2)}\n`);
    return;
  }
  for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
  if (!result.ok) {
    io.stderr('\nPlan failed. Fix the errors above and run it again.\n');
    return;
  }
  const changes = result.files.filter((file) => file.status !== 'unchanged');
  for (const file of changes) {
    io.stdout(`${file.status === 'create' ? '+' : '~'} ${file.path}\n${file.diff}\n`);
  }
  io.stdout(changes.length === 0 ? 'No changes.\n' : `Plan: ${changes.length} file(s) to write.\n`);
  io.stdout('Note: this version plans generated files only; containers and app wiring come later.\n');
}
```

`packages/cli/src/run.ts`:

```ts
import { catalog } from '@mediaplane/catalog';
import { detectHostFacts, plan } from '@mediaplane/engine';
import { Command, CommanderError } from 'commander';
import { printPlan } from './output';
import { VERSION } from './version';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
}

export const DEFAULT_HOME = '/opt/mediaplane';

/** Run the CLI with user arguments (no node/script prefix) and return the exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  let exitCode = 0;
  const program = new Command('mediaplane')
    .description('Deploy and wire a self-hosted media stack from one stack.yaml')
    .version(VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        io.stdout(text);
      },
      writeErr: (text) => {
        io.stderr(text);
      },
    });

  program
    .command('plan')
    .description('Show what apply would change, without changing anything')
    .option('--home <dir>', 'Mediaplane home directory', io.env.MEDIAPLANE_HOME ?? DEFAULT_HOME)
    .option('--json', 'print machine-readable JSON')
    .action(async (options: { home: string; json?: boolean }) => {
      const result = await plan({
        home: options.home,
        catalog,
        host: detectHostFacts(),
        env: io.env,
      });
      printPlan(result, { json: options.json === true }, io);
      exitCode = result.ok ? (result.changed ? 2 : 0) : 1;
    });

  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return cause.exitCode;
    throw cause;
  }
  return exitCode;
}
```

`packages/cli/src/main.ts`:

```ts
import { run } from './run';

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  env: process.env,
});
```

Add the `mediaplane` script to the root `package.json` `scripts`, keeping the existing scripts:

```json
"mediaplane": "tsx packages/cli/src/main.ts"
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run packages/cli`
Expected: PASS (the 6 `run` tests, the 1 `main` test, and the 1 `version` test).

- [ ] **Step 6: Try it by hand**

```bash
mkdir -p .mediaplane-dev/secrets
printf 'fake-wireguard-key\n' > .mediaplane-dev/secrets/wg.key
cat > .mediaplane-dev/stack.yaml <<'EOF'
version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: {}
  seerr: {}
EOF
pnpm --silent mediaplane plan --home .mediaplane-dev; echo "exit=$?"
pnpm --silent mediaplane plan --home .mediaplane-dev --json | head -5
```

Expected:
- **The first command** prints `+ generated/compose.yaml`, then a diff that creates the services `byparr`, `gluetun`, `jellyfin`, `prowlarr`, `qbittorrent`, `radarr`, `seerr` and `sonarr`, with every port on `127.0.0.1`. It then prints `Plan: 1 file(s) to write.`, then `exit=2`.
- **The second command** starts with `"schema": "mediaplane.plan/v1"`.

`.mediaplane-dev/` is gitignored; confirm it with `git status --short`, which must not list it.

- [ ] **Step 7: Document it in the README**

Add this section to `README.md`, directly after the paragraph that ends "with Jellyfin or Plex as the media server.":

````markdown
## Try it (from source)

Slice 1 can already validate a stack and show the Compose project it would write. Nothing
is deployed yet.

```bash
corepack enable && pnpm install
mkdir -p .mediaplane-dev/secrets
printf 'fake-wireguard-key\n' > .mediaplane-dev/secrets/wg.key
cat > .mediaplane-dev/stack.yaml <<'EOF'
version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: {}
  seerr: {}
EOF
pnpm --silent mediaplane plan --home .mediaplane-dev
```

`plan` exits with `0` when nothing would change, `2` when it would write files, and `1`
on errors. Add `--json` for machine-readable output.
````

- [ ] **Step 8: Run every check and commit**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat(cli): add mediaplane plan"
```

---

## Slice 1 completion checklist

- [ ] `pnpm format && pnpm lint && pnpm typecheck && pnpm test:coverage` passes, and coverage of `resolver/`, `render/` and `plan/` is at least 90%.
- [ ] Every task is committed, `git status` is clean, and `.mediaplane-dev/` is untracked.
- [ ] `git log --oneline` shows the 11 task commits after the planning commits.
- [ ] Nothing has been pushed. Report to the owner that Slice 1 is ready to push and that the S2 plan can be written.
