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
