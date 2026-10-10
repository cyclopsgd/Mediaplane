# Runbook: the VPN is down

qBittorrent has no network of its own: it uses Gluetun's. So when the VPN is down,
qBittorrent can't reach the internet, and Gluetun's firewall keeps it from leaking
(fail-closed). `vpn-check` says that nothing leaks only when its checks show it: see
below. This page finds out why the VPN is down, and gets it back. A leak is a different
failure, and worse: see [A leak](#a-leak).

## Symptoms

- **`mediaplane vpn-check`** ends with `VPN down` and exits 1. Each line says what it
  checked. Its mark is `ok`, `warn` for a warning, `DOWN` for what failed, or `LEAK`:

  ```console
  $ mediaplane vpn-check
    ok    qBittorrent uses Gluetun's network, and has none of its own
    ok    Gluetun is running and healthy
    ok    Gluetun's control server says the VPN is running
    ok    Gluetun's control server refuses requests without Mediaplane's key
    ok    qBittorrent's traffic is routed into the tunnel (tun0)
    DOWN  qBittorrent's traffic got no answer from https://1.1.1.1/cdn-cgi/trace: curl: (28) Connection timed out after 10002 milliseconds
          hint: the VPN is down, and nothing gets out (fail-closed); see docs/runbooks/vpn-down.md

  VPN down: qBittorrent can't reach the internet, and nothing leaks (fail-closed). See docs/runbooks/vpn-down.md.
  ```

  The last line says that nothing leaks only when the checks show it, with qBittorrent
  in Gluetun's network: Gluetun is stopped (exited, dead or created, or without a
  container), or nothing answered while qBittorrent's route went into the tunnel, or
  there was no route at all. Otherwise it says
  `VPN down: the checks marked DOWN say what failed. See docs/runbooks/vpn-down.md.`

  "Nothing leaks" is an inference, not a measurement. A route into the tunnel can't get
  out around the VPN, whatever the service does. A service that accepts the connection
  but stalls the TLS handshake reads as no answer, so a working tunnel can read as down.

  A `LEAK` is the result to act on first. But a `down` that doesn't say "nothing leaks"
  has not been shown to be safe. A leak can read as `down` in these cases:
  - the `route` line shows a way out that is not the tunnel, and nothing answered. Only
    Gluetun's firewall stands in the way then, and nothing measured it: the service may
    be one this network can't reach at all, or one that stalls the TLS handshake. Such a
    `down` never says "nothing leaks". Nor does one whose `route` line says Mediaplane
    could not read the route;
  - the `network` line says qBittorrent uses the network of a container that isn't a
    running part of this stack, and that container may have a way out;
  - you ran `--no-egress`, which asks no one: a route outside the tunnel is then `down`,
    not `LEAK`.

  If you can't tell, stop qBittorrent, as in [A leak](#a-leak), until `vpn-check` passes.

- **`mediaplane status`** shows `gluetun` as `unhealthy` or `starting`, or not running.
  Gluetun's own health check usually notices a dead tunnel within a few minutes, and
  restarts the VPN.
- **qBittorrent** finds no peers, and its downloads stall. Its web UI still answers.
- **`mediaplane apply`** fails at the containers step, naming `gluetun` as unhealthy, and
  qBittorrent doesn't start. See [an app won't start](app-wont-start.md).

## Checks

1. **What vpn-check found:** `mediaplane vpn-check`, or `mediaplane vpn-check --json`.
   - Each check has an id: `network`, `gluetun`, `control`, `control-key`, `route` and
     `egress`. The text output doesn't show ids: `--json` does, and the Fix list below
     names each check by what its line says.
   - `--no-egress` runs every check but the last, and asks no outside service.
   - The JSON is `mediaplane.vpn-check/v1`. Its `ok` says that the check ran, and
     `verdict` (`pass`, `down` or `leak`) says what it found. The exit code is 0 only for
     a `pass`.
   - `failClosed` is true only when qBittorrent was shown to be in Gluetun's network, and
     either Gluetun is stopped, or nothing answered while the route went into the tunnel
     or nowhere.
   - The two addresses were compared, and differed, when the check with the id `egress`
     has the status `ok`. Equal addresses give `leak`. `egress.vpn` and `egress.host` hold
     what each side saw.
   - It measures IPv4 only. The route it asks about is the one to `1.1.1.1`, and the
     default service is reached by an IPv4 address. IPv6 is not checked.
2. **Gluetun's state:** `mediaplane status gluetun`.
3. **Gluetun's log,** on the host: `docker compose -p mediaplane logs --tail 100 gluetun`.
   Look for WireGuard errors, `healthcheck`, and `restarting VPN`.
4. **When each started,** on the host:
   `docker ps --filter name=mediaplane-gluetun --filter name=mediaplane-qbittorrent`.
5. **Your VPN account:** whether the key is still valid, and the provider's status page.

The commands on this page name the default project, `mediaplane`. With another project,
such as `mediaplane-dev`, the containers are `mediaplane-dev-qbittorrent-1` and so on.
The hints `vpn-check` prints already name yours.

## Fix

Go by the first line marked `DOWN`.

Run the `docker` commands below on the host. The socket proxy refuses `restart`, `pause`
and `unpause` from inside Mediaplane's container.

- **`network`: qBittorrent started before Gluetun last did.** Gluetun was restarted on
  its own, by hand or after a crash, so it has a new network, and qBittorrent kept the
  old one, which has nothing but loopback. `mediaplane apply` doesn't fix this: Compose
  restarts qBittorrent only when it recreates Gluetun. Restart qBittorrent, on the host:

  ```bash
  docker restart mediaplane-qbittorrent-1
  ```

- **`network`: qBittorrent uses the network of a container that isn't a running part of
  this stack.** Usually the Gluetun it joined has gone. Docker keeps that container's ID,
  so a restart can't rejoin the Gluetun running now: it fails, and leaves qBittorrent
  stopped. Run `mediaplane apply`: it recreates qBittorrent in Gluetun's current network.
  If `compose.override.yaml` gives `qbittorrent` a `network_mode`, take it out first.
- **`network`: Mediaplane can't read the start times.** It can't tell whether qBittorrent
  holds Gluetun's current network. Restart qBittorrent, as in the first case, then run
  `mediaplane vpn-check` again. If it stays, open an issue on the project's GitHub page
  with the output of `mediaplane vpn-check --json`. That output holds your addresses:
  take them out first if you'd rather not share them.
- **`gluetun`: Gluetun is exited, dead or created, or has no container.** Run
  `mediaplane apply`, which starts it. Then restart qBittorrent as above: it kept the
  network Gluetun had before.
- **`gluetun`: Gluetun is paused or restarting.** A restart usually ends by itself: wait
  a minute, and run `mediaplane vpn-check` again. A restart loop doesn't end: if it stays,
  read Gluetun's log. A pause is a `docker pause` by hand: undo it with
  `docker unpause mediaplane-gluetun-1`.
- **`gluetun`: running but unhealthy, or `egress`: no answer through the tunnel.** The
  tunnel doesn't carry traffic. Read Gluetun's log, then check, in this order:
  - **the key:** the file `vpn.private_key` points to (`secrets/wg.key` in the starter)
    holds the private key from your provider's WireGuard file, and the provider still
    knows it. A new key needs `mediaplane apply`, which recreates Gluetun and restarts
    qBittorrent;
  - **the address:** `vpn.addresses` is the `Address` line of that file, such as
    `10.64.0.2/32`. `plan` refuses one that is not an address with a prefix;
  - **the provider:** `vpn.provider` is the provider's name as Gluetun spells it;
  - **the server:** Gluetun's server choice goes in `apps.gluetun.env`, such as
    `SERVER_COUNTRIES: Netherlands`. Try another, then `mediaplane apply`.

  See [Gluetun's README](../../catalog/gluetun/README.md) and Gluetun's own wiki for each
  provider's settings.

- **`control`: Gluetun says the VPN is `stopped` or `crashed`.** Gluetun gave up on the
  tunnel. Its log says why. Fix the cause as above, then `mediaplane apply`.
- **`route`: traffic is not routed into the tunnel.** Gluetun is usually between two
  attempts, with no tunnel. Wait a minute, and run `mediaplane vpn-check` again. If it
  stays, read Gluetun's log. If the line says Mediaplane could not read the route, the
  probe's `ip` command failed in qBittorrent's image: look for an `image` under
  `qbittorrent` in `compose.override.yaml`.

Warnings (marked `warn`) don't fail the check, but say something is off:

- **`network`: qBittorrent is not running.** It sends nothing while it is stopped, so
  there is nothing to check on its side. `mediaplane apply` starts it; then run
  `mediaplane vpn-check` again.
- **`control-key`: the control server answers without a key.** Gluetun started before
  Mediaplane wrote its key file, and reads the file only when it starts. Restart Gluetun,
  then qBittorrent, as in Gluetun's README under "Set up before Slice 3a".
- **`control`: the control server refused Mediaplane's key.** Gluetun's
  `auth/config.toml` holds another key than `state/secrets.json`. See the same section.
- **`control`: the control server did not answer, or answered something else.** Gluetun
  is often between two tunnels. Wait a minute, and run `mediaplane vpn-check` again. The
  `route` and `egress` checks still judge the path. If it stays, read Gluetun's log.
- **`egress`: this host could not ask the IP-echo service.** The check passes on the
  rest. The host can't reach `https://1.1.1.1/cdn-cgi/trace`: set
  `MEDIAPLANE_VPN_CHECK_URL` to another service that answers with your address, or use
  `--no-egress`. In Mediaplane's container, pass the variable to the command:
  `docker exec -it -e MEDIAPLANE_VPN_CHECK_URL=<url> mediaplane mediaplane vpn-check`.
  Run from source, the host side isn't measured either, and it says so, behind a Node
  proxy setting (`NODE_USE_ENV_PROXY`, or `--use-env-proxy` in `NODE_OPTIONS` or on
  `node`'s command line), or when `DOCKER_HOST` names a Docker that may be on another
  host (anything but a `unix://` socket).
- **`egress`: the service answered without an address, or its answer could not be read.**
  The two addresses were not compared. Set `MEDIAPLANE_VPN_CHECK_URL` to a service that
  answers with `ip=<address>`, or with just the address, or unset it.
- **`egress`: one IPv4 and one IPv6 address.** The service answered the two sides over
  different protocols, so the addresses prove nothing. Name the service by its IP
  address in `MEDIAPLANE_VPN_CHECK_URL`, as the default does, or unset it.

Then run `mediaplane vpn-check` again. It ends with `Passed` when qBittorrent reaches
the internet only through the VPN.

## A leak

`vpn-check` ends with `LEAK` and exits 1: qBittorrent's traffic doesn't go through the
VPN, so peers see this host's own address. Stop qBittorrent first, on the host:

```bash
docker stop mediaplane-qbittorrent-1
```

Then go by the line marked `LEAK`:

- **`network`: qBittorrent runs without the VPN.** `stack.yaml` says
  `apps.qbittorrent.vpn: false`. Add a `vpn:` block, remove that line, and run
  `mediaplane apply`.
- **`network`: qBittorrent has a network of its own, or uses another app's.** Something
  gave it one: look for `network_mode` or `networks` under `qbittorrent` in
  `compose.override.yaml`, and take them out. Then `mediaplane apply`, which recreates it
  behind Gluetun.
- **`route`: traffic is routed outside the tunnel, and still got an answer.** Gluetun's
  routing no longer sends qBittorrent's traffic into the tunnel. Restart Gluetun, then
  qBittorrent (`docker restart mediaplane-gluetun-1`, then
  `docker restart mediaplane-qbittorrent-1`), and read Gluetun's log.
- **`egress`: qBittorrent leaves from this host's own address.** Check that the
  IP-echo service is on the internet, not on your network: `MEDIAPLANE_VPN_CHECK_URL`
  must name one that both sides reach over the internet. If it is, treat it as a leak:
  keep qBittorrent stopped, and read Gluetun's log.

Run `mediaplane vpn-check` again before you start qBittorrent.

## Prevention

- **Run `mediaplane vpn-check`** after an `apply` that changes Gluetun, and from time to
  time. It exits 1 on a leak or a VPN that is down, so a cron job can alert on it.
- **Restart qBittorrent whenever you restart Gluetun** by hand.
- **Leave qBittorrent's network alone** in `compose.override.yaml`: anything about its
  network goes on `gluetun`.
- **Keep your VPN key current** with your provider.
