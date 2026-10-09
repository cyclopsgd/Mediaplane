# Runbook: an app won't start

## Symptoms

- **`mediaplane apply` stops at the containers step:**

  ```console
  Starting containers and waiting until every app is healthy…
    failed  containers
    skipped verify
  error: these apps did not start healthy: sonarr (unhealthy). Compose said: …
    hint: run "mediaplane status" to see each app, fix the cause, then run apply again

  Apply failed: 4 done, 1 failed, 1 skipped. Run apply again to retry. Change record: 20261009T120000Z-0a1b2c3d
  ```

- **`mediaplane status`** shows the app as `exited` or `restarting`, or its HEALTH as
  `unhealthy` or `starting`.
- **`mediaplane plan`** exits 2, and lists the app under `Not healthy yet:`, or under
  `Containers:` as `start` when it is not running.
- **`apply` fails earlier,** at `images` or at `appdata ownership`. In `--json` output,
  their codes are `apply.pull-failed` and `apply.ownership-failed`.

## Checks

1. **Which app, and in what state:** `mediaplane status`, or `mediaplane status --json`.
2. **What apply did:** `mediaplane history` lists the change records, and
   `mediaplane history <id>` shows each step and its error.
3. **Its log,** on the host: `docker compose -p mediaplane logs --tail 100 <app>`. Run the
   `docker` commands on the host, not in the Mediaplane container: the socket proxy
   refuses logs.
4. **Its health check's last answers,** on the host:
   `docker inspect --format '{{json .State.Health}}' mediaplane-<app>-1`.
5. **Whether `plan` sees a problem:** run `mediaplane plan` and read every error and
   warning.
6. **Whether it sits behind Gluetun.** qBittorrent starts only once Gluetun is healthy, so
   look at Gluetun first.

## Fix

- **Gluetun never becomes healthy.** Its health check needs a working tunnel. With a
  wrong or fake key, Gluetun is marked unhealthy within about half a minute, and `apply`
  fails then, naming `gluetun`. qBittorrent does not start. Check `secrets/wg.key`,
  `vpn.provider` and `vpn.addresses`, and read Gluetun's log for the VPN's own error (see
  [Gluetun's README](../../catalog/gluetun/README.md)).
- **The port is taken.** `plan` says the port "is already in use on this host"
  (`preflight.port-in-use`). Stop whatever holds it, or set `apps.<app>.port`.
- **The app can't write its folders.** The data folder must be writable by `stack.yaml`'s
  `user:`.
  - `plan` checks the data folder itself (`preflight.data-not-writable`), but not the
    folders inside it.
  - `init` sets `user:` to the user it runs as: in the container that is
    `MEDIAPLANE_UID`, or 1000 when run as root.
  - LinuxServer.io images fix their own `appdata` folder. Seerr's gets 1000:1000 from
    apply's ownership step.
- **A slow start.** With the health checks Mediaplane sets, failed checks don't count
  during an app's start period: 60 seconds, or 120 for Jellyfin and Plex. After that,
  five failed checks in a row, 30 seconds apart, mark the app unhealthy, and `apply`
  fails. `apply` never waits more than 10 minutes in all. Wait until `mediaplane status`
  shows the app healthy, then run `apply` again.
- **The image could not be pulled** (`apply.pull-failed`). Nothing was stopped, so the
  old stack still runs. Check the network and the registry, then run `apply` again.
- **`compose.override.yaml` broke it.** `plan` reports `compose.invalid` when Compose
  rejects the file. Otherwise, take the change out and run `apply` again.
- **A `version:` you chose.** It is an untested combination, and `plan` warns about it.
  Remove it to go back to the tested image.

Then run `mediaplane apply`. It plans again and does only what is left
([ADR 0004](../adr/0004-converge-forward-apply.md)).

## Prevention

- **Run `mediaplane plan` first,** and fix every error it reports.
- **Keep the tested versions:** leave out `version:`.
- **Leave room on the disk.** `plan` warns below 10 GiB free, and stops below 2 GiB.
- **Never edit `generated/compose.yaml`;** put changes in `compose.override.yaml`.
