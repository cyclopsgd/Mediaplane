#!/bin/sh
# Mediaplane's installer (deploy/README.md): run ./deploy/install.sh as your normal user.
# From a release's own deploy files it pulls that release's image, pinned by digest;
# from a checkout it builds the image. It checks Docker, makes the home, writes
# deploy/.env, starts Mediaplane's container and installs the `mediaplane` command. It
# uses sudo only for what it can't do as you: to create the home under a folder that
# isn't yours, and to install the command in /usr/local/bin. Run it again to update, from
# the next release's deploy files or after `git pull`: it keeps your deploy/.env, home
# included, and never touches your stack.
set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname -- "$here")
env_file=$here/.env
# For the tests only: where the command goes, and the Docker socket to look at (the
# deployment itself always mounts /var/run/docker.sock).
bindir=${MEDIAPLANE_TEST_BIN_DIR:-/usr/local/bin}
socket=${MEDIAPLANE_TEST_DOCKER_SOCKET:-/var/run/docker.sock}
# The image a release runs, pinned by digest. A release's own copy of this file names it,
# as its mediaplane.compose.yaml does (scripts/release/pin.ts writes both). A checkout's
# is empty: the installer builds the image there instead.
release_image=''

say() { printf '%s\n' "$*"; }
fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
# Whether image $1 is pinned by digest, in the one shape a release names its image in
# (scripts/release/pin.ts): <name>:<tag>@sha256:<64 hex digits>, with nothing else in it:
# no space, #, $ or quote, which Compose would read otherwise than this does, and no line
# end, which grep would take for several images.
pinned() {
  case $1 in *[!A-Za-z0-9._:/@-]*) return 1 ;; esac
  printf '%s\n' "$1" |
    grep -Eq '^[a-z0-9]+([._:/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9._-]{0,127}@sha256:[0-9a-f]{64}$'
}
# Whether version $1 (such as 2.38.2 or v2.38.2) is at least major $2, minor $3.
at_least() {
  v=${1#v}
  major=${v%%.*}
  rest=${v#*.}
  minor=${rest%%[!0-9]*}
  case $major in '' | *[!0-9]*) return 1 ;; esac
  case $minor in '' | *[!0-9]*) return 1 ;; esac
  [ "$major" -gt "$2" ] || { [ "$major" -eq "$2" ] && [ "$minor" -ge "$3" ]; }
}
# The value deploy/.env gives `name`, or nothing. Only a plain NAME=value line is read,
# so the installer never reads it otherwise than Compose does: any other form is refused.
from_env_file() {
  [ -e "$env_file" ] || return 0
  if grep -Eq "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" "$env_file" &&
    ! grep -Eq "^$1=[^[:space:]\"'][^\"']*\$" "$env_file"; then
    fail "deploy/.env sets $1 in a form the installer doesn't read: write it as one line, $1=value, with no quotes, spaces or export, then run this again"
  fi
  # Without a Windows line end or trailing blanks, which Compose drops too.
  sed -n "s/^$1=//p" "$env_file" | tail -n 1 | tr -d '\r' | sed 's/[[:space:]]*$//'
}

# The home: the one deploy/.env names once it exists, so a re-run keeps it.
kept_home=$(from_env_file MEDIAPLANE_HOME)
if [ -e "$env_file" ]; then
  home=${kept_home:-/opt/mediaplane}
  if [ -n "${MEDIAPLANE_HOME:-}" ] && [ "$MEDIAPLANE_HOME" != "$home" ]; then
    fail "deploy/.env says the home is $home, but MEDIAPLANE_HOME says $MEDIAPLANE_HOME: unset MEDIAPLANE_HOME, or change deploy/.env, then run this again"
  fi
else
  home=${MEDIAPLANE_HOME:-/opt/mediaplane}
fi
case $home in
  /*) ;;
  *) fail "the home must be an absolute path, such as /opt/mediaplane, not \"$home\"" ;;
esac
case $home in
  / | *[\"\'\$\#\\\`]* | *[[:space:]] | *[[:cntrl:]]* | *'
'*) fail "the home \"$home\" won't do: use a folder below /, with no quotes, \$, #, \\ or backquotes in its name" ;;
esac
# The image: the one deploy/.env names once it exists, so a re-run keeps yours; else a
# release's own; else, in a checkout, the one it builds.
kept_image=$(from_env_file MEDIAPLANE_IMAGE)
if [ -e "$env_file" ]; then
  image=${kept_image:-$release_image}
  [ -n "$image" ] ||
    fail "deploy/.env names no MEDIAPLANE_IMAGE: add MEDIAPLANE_IMAGE=mediaplane:local to it to build the image from this checkout, then run this again"
  if [ -n "${MEDIAPLANE_IMAGE:-}" ] && [ "$MEDIAPLANE_IMAGE" != "$image" ]; then
    fail "deploy/.env says the image is $image, but MEDIAPLANE_IMAGE says $MEDIAPLANE_IMAGE: unset MEDIAPLANE_IMAGE, or change deploy/.env, then run this again"
  fi
else
  image=${MEDIAPLANE_IMAGE:-$release_image}
  image=${image:-mediaplane:local}
fi
# An image from a registry is pinned by digest, which Docker verifies as it pulls it;
# mediaplane:local is built from the checkout instead. Compose is then given this image
# itself (system, below), so it runs exactly what was checked here.
if [ "$image" != mediaplane:local ] && ! pinned "$image"; then
  fail "MEDIAPLANE_IMAGE=$image isn't pinned by digest: name it as <name>:<tag>@sha256:<digest>, as a release's deploy files do (docker buildx imagetools inspect <name>:<tag> shows the digest), or as mediaplane:local to build it from a checkout"
fi
if [ "$image" = mediaplane:local ] && [ ! -f "$root/Dockerfile" ]; then
  fail "mediaplane:local is built from a checkout, and $root isn't one: remove MEDIAPLANE_IMAGE from deploy/.env to run this release's image, then run this again"
fi

[ "$(id -u)" != 0 ] ||
  fail "run this as your normal user, not root: Mediaplane's container must not run as root, and the installer asks for sudo only where it needs it"

command -v docker >/dev/null 2>&1 ||
  fail "Docker isn't installed: install Docker Engine 24 or newer, with its Compose plugin, then run this again"
# docker and Compose talk to the Docker that DOCKER_HOST or DOCKER_CONTEXT names, which may
# be another host's; the installer checks this host's socket, which the deployment mounts.
if [ -n "${DOCKER_HOST:-}" ] && [ "$DOCKER_HOST" != "unix://$socket" ]; then
  fail "DOCKER_HOST is set, so docker would use another Docker than this host's, at $socket, which Mediaplane's container uses: unset DOCKER_HOST, then run this again"
fi
if [ -n "${DOCKER_CONTEXT:-}" ] && [ "$DOCKER_CONTEXT" != default ]; then
  fail "DOCKER_CONTEXT is set, so docker would use another Docker than this host's, at $socket, which Mediaplane's container uses: unset DOCKER_CONTEXT, then run this again"
fi
docker info >/dev/null 2>&1 ||
  fail "Docker isn't answering: start it, and check that your user may use it (docker info says why), then run this again"
engine=$(docker version --format '{{.Server.Version}}' 2>/dev/null) || engine=
[ -n "$engine" ] || fail "couldn't read Docker Engine's version (docker version says why)"
at_least "$engine" 24 0 ||
  fail "Docker Engine $engine is too old: Mediaplane needs 24 or newer"
compose=$(docker compose version --short 2>/dev/null) || compose=
[ -n "$compose" ] ||
  fail "Docker's Compose plugin is missing: install docker-compose-plugin, then run this again"
at_least "$compose" 2 24 ||
  fail "Docker Compose $compose is too old: Mediaplane needs 2.24 or newer"
case $(docker info --format '{{.SecurityOptions}}' 2>/dev/null) in
  *rootless*) fail "this Docker is rootless, which Mediaplane doesn't support yet: use rootful Docker" ;;
esac
[ -S "$socket" ] ||
  fail "Docker's socket isn't at $socket, where Mediaplane's socket proxy looks for it"

me="$(id -u):$(id -g)"
# The home is yours: Mediaplane runs as you, and writes its stack there. With sudo, only a
# folder it has just made is given to you: a plain mkdir fails on one that was there.
if [ ! -d "$home" ] && ! mkdir -p -- "$home" 2>/dev/null; then
  say "Creating $home, owned by you, needs sudo:"
  sudo mkdir -p -- "$(dirname -- "$home")"
  sudo mkdir -- "$home" ||
    fail "$home is already there, in a folder you can't look into: if it is meant to be Mediaplane's home, run: sudo chown $me \"$home\", then run this again"
  sudo chown -- "$me" "$home"
fi
[ -w "$home" ] ||
  fail "$home isn't yours to write: if it holds nothing of anyone else's, run: sudo chown $me \"$home\" (or set MEDIAPLANE_HOME to a folder of yours), then run this again"

if [ "$image" = mediaplane:local ]; then
  say "Building Mediaplane's image from this checkout (a few minutes the first time)..."
  docker build --tag mediaplane:local "$root" ||
    fail "Mediaplane's image didn't build: the lines above say why"
fi

if [ -e "$env_file" ]; then
  say "Keeping your deploy/.env as it is."
else
  tz=$(timedatectl show --property=Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || true)
  # Whole or not at all: an interrupted write leaves no half deploy/.env to keep.
  {
    # A release's image goes unnamed: its mediaplane.compose.yaml names it, and the next
    # release's names the next one.
    if [ "$image" != "$release_image" ]; then say "MEDIAPLANE_IMAGE=$image"; fi
    say "MEDIAPLANE_UID=$(id -u)"
    say "MEDIAPLANE_GID=$(id -g)"
    say "DOCKER_GID=$(stat -L -c %g "$socket")"
    say "TZ=$tz"
    if [ "$home" != /opt/mediaplane ]; then say "MEDIAPLANE_HOME=$home"; fi
  } >"$env_file.new"
  mv -- "$env_file.new" "$env_file"
  say "Wrote deploy/.env."
fi

if [ -n "$release_image" ] && [ "$image" != "$release_image" ]; then
  say "Note: deploy/.env names MEDIAPLANE_IMAGE=$image, so this release's image, $release_image, isn't the one that runs: to run it, remove that line from deploy/.env, then run this again."
fi

# Mediaplane's own deployment, and nothing else: never the stack. It runs the image that
# was checked above, whatever deploy/.env or the file's default say. deploy/.env decides
# the rest: the same names exported in this shell would override it. So would Compose's
# own, which would move it to another project, file or .env, and -p names the project
# against those in deploy/.env too.
system() (
  unset MEDIAPLANE_UID MEDIAPLANE_GID DOCKER_GID TZ MEDIAPLANE_HOME \
    COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES \
    COMPOSE_DISABLE_ENV_FILE COMPOSE_PROJECT_DIRECTORY
  MEDIAPLANE_IMAGE=$image
  export MEDIAPLANE_IMAGE
  docker compose -f "$here/mediaplane.compose.yaml" -p mediaplane-system "$@"
)
# Pulled before anything is recreated, so a pull that fails leaves Mediaplane as it was.
if [ "$image" = mediaplane:local ]; then
  say "Pulling the socket proxy (pinned by digest, so Docker checks every byte against it)..."
  system pull socket-proxy || fail "couldn't pull Mediaplane's images: the lines above say why"
else
  say "Pulling $image and the socket proxy (pinned by digest, so Docker checks every byte against it)..."
  system pull || fail "couldn't pull Mediaplane's images: the lines above say why"
fi
system up -d

if ! cmp -s "$here/mediaplane" "$bindir/mediaplane"; then
  if ! install -m 0755 "$here/mediaplane" "$bindir/mediaplane" 2>/dev/null; then
    say "Installing the mediaplane command in $bindir needs sudo:"
    sudo install -m 0755 "$here/mediaplane" "$bindir/mediaplane"
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
if [ "$home" = /opt/mediaplane ]; then init=init; else init="init --home \"$home\""; fi
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
say "Next: run mediaplane $init. It asks a few questions and writes your stack."
