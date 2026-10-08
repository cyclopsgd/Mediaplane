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
