#!/bin/sh
# Mediaplane's installer (deploy/README.md): from a checkout, run ./deploy/install.sh as
# your normal user. It checks Docker, builds the image, makes the home, writes
# deploy/.env, starts Mediaplane's container and installs the `mediaplane` command. It
# uses sudo only where it must: to create the home under /opt and to install the command
# in /usr/local/bin. Run it again after `git pull` to update; it keeps your deploy/.env
# and never touches your stack.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
home=${MEDIAPLANE_HOME:-/opt/mediaplane}
image=${MEDIAPLANE_IMAGE:-mediaplane:local}
# For the tests only: where the command goes, what runs as root, and the Docker socket.
bindir=${MEDIAPLANE_BIN_DIR:-/usr/local/bin}
sudo=${MEDIAPLANE_SUDO:-sudo}
socket=${MEDIAPLANE_DOCKER_SOCKET:-/var/run/docker.sock}

say() { printf '%s\n' "$*"; }
fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
# Whether version $1 (such as 2.38.2 or v2.38.2) is at least major $2, minor $3.
at_least() {
  v=${1#v}
  major=${v%%.*}
  rest=${v#*.}
  minor=${rest%%.*}
  case $major$minor in *[!0-9]* | '') return 1 ;; esac
  [ "$major" -gt "$2" ] || { [ "$major" -eq "$2" ] && [ "$minor" -ge "$3" ]; }
}

[ "$(id -u)" != 0 ] ||
  fail "run this as your normal user, not root: Mediaplane's container must not run as root, and the installer asks for sudo only where it needs it"

command -v docker >/dev/null 2>&1 ||
  fail "Docker isn't installed: install Docker Engine 24 or newer, with its Compose plugin, then run this again"
docker info >/dev/null 2>&1 ||
  fail "Docker isn't answering: start it, and check that your user may use it (docker info says why), then run this again"
engine=$(docker version --format '{{.Server.Version}}')
at_least "$engine" 24 0 ||
  fail "Docker Engine $engine is too old: Mediaplane needs 24 or newer"
compose=$(docker compose version --short 2>/dev/null) ||
  fail "Docker's Compose plugin is missing: install docker-compose-plugin, then run this again"
at_least "$compose" 2 24 ||
  fail "Docker Compose $compose is too old: Mediaplane needs 2.24 or newer"
case $(docker info --format '{{.SecurityOptions}}') in
  *rootless*) fail "this Docker is rootless, which Mediaplane doesn't support yet: use rootful Docker" ;;
esac
[ -S "$socket" ] ||
  fail "Docker's socket isn't at $socket, where Mediaplane's socket proxy looks for it"

# The home is yours: Mediaplane runs as you, and writes its stack there.
if [ ! -d "$home" ]; then
  if ! mkdir -p "$home" 2>/dev/null; then
    say "Creating $home, owned by you, needs sudo:"
    $sudo mkdir -p "$home"
    $sudo chown "$(id -u):$(id -g)" "$home"
  fi
fi
[ -w "$home" ] ||
  fail "$home isn't yours to write: run \"sudo chown $(id -u):$(id -g) $home\" if it holds nothing of someone else's, or set MEDIAPLANE_HOME to a folder of yours, then run this again"

if [ "$image" = mediaplane:local ]; then
  say "Building Mediaplane's image from this checkout (a few minutes the first time)..."
  docker build --tag mediaplane:local "$root"
fi

if [ -e "$here/.env" ]; then
  say "Keeping your deploy/.env as it is."
else
  tz=$(timedatectl show --property=Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || true)
  {
    say "MEDIAPLANE_IMAGE=$image"
    say "MEDIAPLANE_UID=$(id -u)"
    say "MEDIAPLANE_GID=$(id -g)"
    say "DOCKER_GID=$(stat -c %g "$socket")"
    say "TZ=$tz"
    if [ "$home" != /opt/mediaplane ]; then say "MEDIAPLANE_HOME=$home"; fi
  } >"$here/.env"
  say "Wrote deploy/.env."
fi

docker compose -f "$here/mediaplane.compose.yaml" up -d

if ! cmp -s "$here/mediaplane" "$bindir/mediaplane"; then
  if ! install -m 0755 "$here/mediaplane" "$bindir/mediaplane" 2>/dev/null; then
    say "Installing the mediaplane command in $bindir needs sudo:"
    $sudo install -m 0755 "$here/mediaplane" "$bindir/mediaplane"
  fi
fi
found=$(command -v mediaplane 2>/dev/null || true)
if [ "$found" != "$bindir/mediaplane" ]; then
  say "Note: \"mediaplane\" runs ${found:-nothing} here, not $bindir/mediaplane: put $bindir first in your PATH."
fi
say "Mediaplane is running. If \"mediaplane\" does something else in your shell, an old alias may be in the way: \"type -a mediaplane\" shows it."

if [ -e "$home/stack.yaml" ]; then
  say ""
  say "Next: \"mediaplane plan\" checks your stack, then \"mediaplane apply\"."
  exit 0
fi
if [ -t 0 ] && [ -t 1 ]; then
  printf '\nSet up your stack now with "mediaplane init"? [Y/n] '
  read -r answer || answer=n
  case $answer in
    [nN]*) ;;
    *)
      if [ "$home" = /opt/mediaplane ]; then exec "$bindir/mediaplane" init; fi
      exec "$bindir/mediaplane" init --home "$home"
      ;;
  esac
fi
say ""
if [ "$home" = /opt/mediaplane ]; then init=init; else init="init --home $home"; fi
say "Next: \"mediaplane $init\" asks a few questions and writes your stack."
