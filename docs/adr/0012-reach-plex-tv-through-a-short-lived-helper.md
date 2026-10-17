# 0012. Reach plex.tv through a short-lived helper

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

Plex is the one app that needs an outside service for its setup. Three things call
plex.tv:

- **`mediaplane plex-login`** signs you in with plex.tv's PIN flow and saves your token.
- **Plex's claim.** `apply` fetches a claim token with your token as Plex first starts.
- **Two ownership checks:** whose account a claimed Plex's own token is, and whether
  Seerr's admin is your plex.tv account.

Mediaplane's container has no route out, by the owner's decision
([ADR 0011](0011-a-private-wiring-network.md)): it is on two internal networks, the
socket proxy's and the stack's wiring network. That ADR left plex.tv to "a short-lived
helper", and the socket proxy's allow-list must not grow for it
([ADR 0008](0008-docker-socket-proxy-on-by-default.md)).

The options for where the call runs, and how your token reaches it:

- **The host helper, on the host network.** It exists already. But a container on the
  host network reaches every Docker network on the host, the stack's wiring network
  included (probed), so a helper there could call the apps.
- **The stack's own default network.** It has a route out, but every app is on it, and
  it doesn't exist before the stack first starts.
- **Docker's default bridge network.** It has a route out, and Docker keeps it apart from
  every other bridge network: a container on it reached neither an internal network's
  container nor one on another bridge network (probed).

And for the token:

- **In the helper's environment.** Anyone who can run `docker inspect` reads it, for as
  long as the container exists.
- **In a file, mounted.** It needs a host mount, and a file written with the token.
- **On its standard input.** It stays off every command line, out of the container's
  settings, and in no file.

## Decision

- **Each plex.tv call is one run of the plex.tv helper:** a throwaway container of
  Mediaplane's own image, running `mediaplane plex-tv`, on Docker's default `bridge`
  network. It runs as Mediaplane's user, with no capabilities, a read-only root,
  `no-new-privileges` and no mount, never pulls, is removed when it exits (`--rm`), and
  is labelled `io.mediaplane.helper=plex-tv`. It never gets the Docker socket, the wiring
  network, or any host folder.
- **The request goes on its standard input, the answer comes back on its standard
  output,** as one line of JSON each. The helper takes only the four calls Mediaplane
  makes (a PIN, the wait for its sign-in, a claim token, and the account a token is of),
  each to plex.tv's own address, which it fixes: a request can't name another host.
- **It needs no new Docker API call.** `docker run --interactive` uses `create`,
  `attach`, `start` and `wait`, which the allow-list already has for the host helper.
  The end-to-end test runs `plex-login` from the image, through the proxy.
- **Run from source, the CLI calls plex.tv itself.** The host has its own route out, and
  ADR 0011 keeps only Mediaplane's container offline, as vpn-check's own egress check does
  from source. It uses an HTTPS agent of its own, so a proxy from the environment never
  sees your token.
- **`plan` never calls plex.tv.** A claim token is used once, and lasts four minutes, so
  only the `apply` that starts Plex can fetch one. Plex checks your token with plex.tv
  itself when `plan` checks Plex's key.

## Consequences

- **Docker's default bridge network must exist.** It does unless the daemon is set up
  without it (`"bridge": "none"`); then the helper fails, saying the network was not
  found.
- **Each call starts a container,** a second or so in the image. `plex-login` waits for
  your sign-in in one run, asking plex.tv every two seconds. A run may take as long as
  the client's own tries, with a minute more; one that runs out of time counts as
  plex.tv not answering.
- **Only plex.tv's own refusal is a refusal.** A 401 says plex.tv refused the token. A
  403, a 429, a 5xx or no answer is "couldn't tell", and so is a helper that fails or
  runs out of time, or Docker failing on the way: it keeps Plex, and Seerr on a Plex
  stack, unpublished, and says to run `apply` again rather than to sign in again. A
  helper answer Mediaplane doesn't understand is a protocol error, not "couldn't tell":
  Plex's and Seerr's checks refuse it (`rejected`), and they stay unpublished too.
- **The helper's answer can hold a token:** `plex-login`'s, and a claim token. It is in
  the helper's output, which `docker logs` can show while the container runs, for a
  moment; `--rm` removes it with the container.
- **The helper still has a route out,** as any container on the default bridge does, and
  from that bridge it can reach the host's published ports, the LAN, and other
  containers on the default bridge. That is harmless while its code is Mediaplane's own
  and plex.tv's address is fixed in it, as it is: a request can't name another host. A
  compromised Mediaplane can create any container anyway (ADR 0008).
- **plex.tv must be reachable** from the default bridge, for `plex-login` and for Plex's
  first start. `apply` stops before it starts anything when it can't get a claim token,
  and first stops a running Plex that isn't yet shown to be yours.
