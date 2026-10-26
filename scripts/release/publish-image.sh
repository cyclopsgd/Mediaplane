#!/bin/sh
# Tags a release's image: one index for every architecture, from the images that
# scripts/ci/build-image.sh pushed by digest, each of another architecture. It writes the
# image, as <name>:<version>@<digest>, to <out-file>.
#
#   scripts/release/publish-image.sh <name> <version> <out-file> <pushed-file>...
set -eu

BUILDER=mediaplane-release

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
[ $# -ge 4 ] || fail "usage: $0 <name> <version> <out-file> <pushed-file>..."
name=$1
version=$2
out=$3
shift 3
# <major>.<minor>.<patch>, as deploy-bundle.ts takes it: digits and exactly two dots, none
# first, last or twice in a row.
dots=$(printf '%s' "$version" | tr -cd . | wc -c)
case $version in
  *[!0-9.]* | '' | .* | *. | *..*) dots=0 ;;
esac
[ "$dots" -eq 2 ] || fail "the version is <major>.<minor>.<patch>, not \"$version\""
sources=
for file in "$@"; do
  [ -s "$file" ] || fail "no digest in $file, the file of an image pushed"
  sources="$sources $name@$(cat "$file")"
done
# build-image.sh's builder, where this machine has it, for its registry settings; else
# Docker's own, which pulls nothing to do it.
docker buildx inspect "$BUILDER" >/dev/null 2>&1 || BUILDER=default
# shellcheck disable=SC2086 # one argument per image, none with a space
docker buildx imagetools create --builder "$BUILDER" --tag "$name:$version" $sources
raw=$(docker buildx imagetools inspect --builder "$BUILDER" --raw "$name:$version")
# One image for each image pushed, each of another architecture.
images=$(printf '%s' "$raw" | jq -r '[.manifests[] | select(.platform.os == "linux") | .platform.architecture] | sort | join(" ")')
count=$(printf '%s' "$raw" | jq '[.manifests[] | select(.platform.os == "linux")] | length')
unique=$(printf '%s' "$raw" | jq '[.manifests[] | select(.platform.os == "linux") | .platform.architecture] | unique | length')
[ "$count" -eq $# ] && [ "$unique" -eq $# ] ||
  fail "$name:$version holds linux images for \"$images\", not one for each of the $# pushed"
digest=$(docker buildx imagetools inspect --builder "$BUILDER" "$name:$version" \
  --format '{{.Manifest.Digest}}')
case $digest in
  sha256:*) ;;
  *) fail "couldn't read the digest of $name:$version" ;;
esac
printf '%s:%s@%s\n' "$name" "$version" "$digest" >"$out"
echo "Published $name:$version@$digest, for $images"
