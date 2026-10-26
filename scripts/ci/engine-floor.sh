#!/bin/sh
# The Docker CLI and Compose that Mediaplane's image bundles (the Dockerfile's docker-cli
# stage), against the oldest Docker Engine Mediaplane supports, 24, in a throwaway
# Docker-in-Docker. It makes the kinds of call Mediaplane makes: versions, config hashes,
# `up --wait` with a health check and a service in another's network, `!reset`, `run
# --rm`, joining and leaving an internal network, and `down`. CI's other jobs run the
# runners' Docker; this is the floor (spec §3.3, deploy/README.md).
#
#   scripts/ci/engine-floor.sh
set -eu

ENGINE=docker:24.0.9-dind@sha256:9b17a9f25adf17b88d0a013b4f00160754adf4b07ccbe9986664a49886c2c98e
BUSYBOX=busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e

root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
cli=$(sed -n 's/^FROM \(docker:[^ ]*-cli@sha256:[0-9a-f]\{64\}\) AS docker-cli$/\1/p' "$root/Dockerfile")
[ -n "$cli" ] || {
  echo "error: the Dockerfile has no docker-cli stage pinned by digest" >&2
  exit 1
}
name=mediaplane-floor-$$
project=$(mktemp -d)
cleanup() {
  # With its volumes: the engine keeps its data in an anonymous one.
  docker rm --force --volumes "$name" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  rm -rf "$project"
}
trap cleanup EXIT
fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

docker network create "$name" >/dev/null
docker run --detach --privileged --name "$name" --network "$name" \
  --env DOCKER_TLS_CERTDIR= "$ENGINE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$name" docker version >/dev/null 2>&1 && break
  sleep 1
done
engine=$(docker exec "$name" docker version --format '{{.Server.Version}}') ||
  fail "Docker Engine didn't start"
case $engine in 24.*) ;; *) fail "expected Docker Engine 24, got $engine" ;; esac

cat >"$project/compose.yaml" <<EOF
name: floor
services:
  app:
    image: $BUSYBOX
    command: ['sh', '-c', 'touch /tmp/ready; exec sleep 600']
    healthcheck: { test: ['CMD', 'test', '-f', '/tmp/ready'], interval: 1s, retries: 30 }
    ports: ['127.0.0.1:8080:80']
    networks: [default, wiring]
  guest:
    image: $BUSYBOX
    command: ['sleep', '600']
    network_mode: service:app
    depends_on: { app: { condition: service_healthy, restart: true } }
networks:
  wiring: { internal: true }
EOF
printf 'services:\n  app:\n    ports: !reset []\n' >"$project/unpublished.yaml"

# The bundled CLI, talking to Engine 24.
bundled() {
  docker run --rm --network "$name" --env "DOCKER_HOST=tcp://$name:2375" \
    --volume "$project:$project" --workdir "$project" "$cli" "$@"
}
step() {
  what=$1
  shift
  echo "--- $what"
  bundled "$@" || fail "$what"
}

step 'docker version' docker version --format 'CLI {{.Client.Version}}, Engine {{.Server.Version}}'
step 'compose version' docker compose version
step 'compose config --hash' docker compose config --hash '*'
step 'compose config, with !reset' docker compose -f compose.yaml -f unpublished.yaml config --quiet
step 'compose up --wait' docker compose -f compose.yaml -f unpublished.yaml up --detach --wait
step 'compose ps --format json' docker compose ps --all --format json
step 'compose run --rm --no-deps' docker compose run --rm --no-deps app true
step 'run --rm --pull never' docker run --rm --pull never "$BUSYBOX" true
step 'network inspect' docker network inspect floor_wiring --format '{{.Internal}}'
step 'compose up, publishing' docker compose up --detach --wait
step 'run a container to join the network' docker run --detach --name joiner "$BUSYBOX" sleep 600
step 'network connect' docker network connect floor_wiring joiner
step 'network disconnect' docker network disconnect floor_wiring joiner
step 'rm -f' docker rm --force joiner
step 'compose stop' docker compose stop guest
step 'compose down' docker compose down --timeout 1
echo "The image's Docker CLI and Compose work with Docker Engine $engine."
