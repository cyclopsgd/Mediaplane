# Try Mediaplane from source

This page shows how to run the CLI straight from a checkout, with Node and pnpm, against
the Docker on this machine: a way to try `main`, or to work on Mediaplane. For everyday
use, install a release, as the [README](../README.md#install) shows. To run `main` in its
container instead, install it [from a checkout](../deploy/README.md#from-a-checkout).

Start from a clone of the repository:

```bash
git clone https://github.com/cyclopsgd/Mediaplane.git
cd Mediaplane
```

`mediaplane plan` checks a real host and shows exactly what `apply` would do:

- the Compose file it would write;
- the containers it would create, recreate, start, restart or remove (`restart` is for
  qBittorrent when Gluetun starts again on its own);
- the secrets it would generate;
- the first-run setups it would finish, under `First-run setup:`: Jellyfin's, and
  Seerr's first sign-in through it, or with Plex, Plex's claim, and Seerr's first
  sign-in with your Plex token, each with no port published until it is done, when
  `apply` runs the stack
  ([what voids that](security/threat-model.md#t16-someone-else-finishes-an-apps-first-run-setup));
- the wiring it would do in the apps, under `Wiring:`, such as setting the admin login or
  adding a download client. qBittorrent's login and settings show as `adopt` on a first
  `apply`: its file from before its first start set them already, as Jellyfin's
  first-run setup sets its admin.

It changes nothing in your stack, apart from small marks that checking a key or a
password can leave in an app: a failure in an app's own status of a client, link or
connection, a sign-in in Jellyfin's activity log, a line in Seerr's log (and an arr's)
for a check of Seerr's that fails, and an arr listed among Plex's devices by its first
test of its connection to Plex. The
[threat model](security/threat-model.md#what-runs-and-who-can-reach-it) says more.
You need Docker (Engine 24 or newer, with the Compose plugin 2.24 or newer), Node 24 and
pnpm.

```bash
corepack enable && pnpm install
mkdir -p .mediaplane-dev/data .mediaplane-dev/secrets
printf 'fake-wireguard-key\n' > .mediaplane-dev/secrets/wg.key
cat > .mediaplane-dev/stack.yaml <<EOF
version: 1
user: { uid: $(id -u), gid: $(id -g) }
paths: { data: $PWD/.mediaplane-dev/data }
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
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane plan --home .mediaplane-dev
```

The `user:` line makes the apps run as you, so they can write to the data folder you
just created. `MEDIAPLANE_COMPOSE_PROJECT` gives this trial its own Compose project,
`mediaplane-dev`, so a real `mediaplane` stack on the same host is never touched.
`plan` exits with `0` when nothing would change, `2` when it would change something
(including when an app is still waiting for its health check), and `1` on errors. Add
`--json` for machine-readable output: its `wiring` lists each resource with its `action`
(`create`, `update`, `adopt`, `unchanged`, `after-start`, `unknown` or `remove`), the
`changes` that differ, and a `reason` when it is `unknown`. The
[`--json` reference](reference/json.md) lists every field of every command's.

To actually start the stack, use a stack without the VPN. A fake WireGuard key can't
connect, so Gluetun would never become healthy. Change the qBittorrent line to
`qbittorrent: { vpn: false }`, delete the `vpn:` line, then run:

```bash
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane apply --home .mediaplane-dev --yes
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane status --home .mediaplane-dev
pnpm --silent mediaplane credentials --home .mediaplane-dev
```

This starts real containers on this machine, with the web UIs on `localhost`. The last
command shows the admin login, which qBittorrent, Sonarr, Radarr, Prowlarr and Jellyfin
use, and Seerr through Jellyfin, and each app's address.

The first `apply` downloads several GB of images, so it can take a while. To remove the
containers, run `docker compose -p mediaplane-dev down`, then
`sudo rm -rf .mediaplane-dev`. Seerr's folder belongs to uid 1000, which is why `sudo`
is needed.

To see drift, change something Mediaplane manages in an app's web UI, such as the
category of the download client `qBittorrent (Mediaplane)` in Sonarr (Settings,
Download Clients), and see what `drift` says:

```bash
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane drift --home .mediaplane-dev
```

`drift` shows what Mediaplane set and what Sonarr holds now, and exits `2`. You choose
what happens next:

- `apply` puts the category back. It shows the drift in its plan and asks first, unless
  you pass `--yes`.
- `keep` keeps Sonarr's category instead, as one line under `overrides:` in
  `stack.yaml`. qBittorrent then needs a category of that name, which the next `apply`
  makes. `drift` is clear once it has:

```bash
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane keep sonarr.download_client.category --home .mediaplane-dev
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane apply --home .mediaplane-dev
MEDIAPLANE_COMPOSE_PROJECT=mediaplane-dev pnpm --silent mediaplane drift --home .mediaplane-dev
```

The [drift runbook](runbooks/drift-reported.md) says more.

To try Plex instead, set `media_server: plex` and add
`plex: { token: { file: secrets/plex-token } }`, then sign in to plex.tv once, before
the first `apply`:

```bash
pnpm --silent mediaplane plex-login --home .mediaplane-dev
```

It prints a link: open it in a browser and sign in to Plex. It then saves your Plex token
in `secrets/plex-token`, readable by you only, and never prints it. A saved token that
plex.tv still takes is kept, unless you add `--force`. One plex.tv refuses (HTTP 401) is
replaced. When plex.tv can't say whether it works (no answer, a 403, a 429, or an error of
its own), it keeps the saved token, says so, and `--force` signs in anyway. A token file
or `secrets/` folder it can't read stops it before it asks for a link. "Couldn't reach
plex.tv" means plex.tv didn't answer at all. `apply` then claims Plex for that account
before its web UI is published.
