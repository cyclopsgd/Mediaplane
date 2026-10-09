# 0004. Converge forward: apply has no automatic rollback

- **Status:** Accepted
- **Date:** 2026-10-09

## Context

`apply` takes several steps in order:

1. generate keys;
2. write files;
3. pull images;
4. fix appdata ownership;
5. start the containers;
6. verify;
7. later, wire the apps together.

Any of them can fail: a registry is unreachable, an app never becomes healthy. Undoing
a half-applied stack would mean stopping containers that were running, restoring old
files and forgetting keys. That is riskier than the failure itself, and the old state
may not even have been working.

## Decision

`apply` converges forward:

- **Every step is idempotent.** After a step fails, the later steps are marked
  `skipped`, and the change record is still written with the outcome `failed`.
- **The fix is to run `apply` again.** It plans afresh and does only what is left.
- **Nothing is rolled back automatically.**

The order keeps failures cheap:

- **Images are pulled before anything is stopped.** A network failure leaves the
  running stack untouched.
- **Files are written atomically.** The previous `compose.yaml` is kept as
  `compose.prev.yaml`.
- **Keys are saved before any container starts.**
- **A lock stops two applies from running at once.**

## Consequences

- **A failed apply can leave the stack partly updated,** for example with new files but
  old containers. `plan` shows exactly what is left, and the change record shows which
  steps ran.
- **An app that is not healthy yet counts as left to do.** When the start step fails
  because an app never became healthy, its container is already current, so nothing
  else would show up. `plan` lists it as "Not healthy yet" and counts the plan as
  changed, so running `apply` again waits for the apps again instead of reporting no
  changes.
- **Rollback stays manual for now.** Snapshot-based rollback is reserved for version
  updates in M3, the one case where going forward can be worse, because of database
  migrations.
