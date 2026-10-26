#!/bin/sh
# Mediaplane's image as a release builds it (spec §8.2), for one architecture, natively:
#
#   scripts/ci/build-image.sh <amd64|arm64> <out-dir>
#
# BuildKit is pinned, the image gets an SBOM and build provenance, and its times come
# from the commit, so the same commit builds the same image. It writes the image as an
# OCI layout in <out-dir>/oci, for Trivy, and its manifest's digest in <out-dir>/digest.
set -eu

BUILDKIT=moby/buildkit:v0.34.0@sha256:b059f8d7226d0b326bc871af489a5dddf65e36af4d20d14251b072974d9ee87c
SYFT=docker/buildkit-syft-scanner:1.12.0@sha256:ae4f3b554449e7e25548e7d8ccc029d17357348e30c6e3df01b92bc93654d6a9
BUILDER=mediaplane-release

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
[ $# -eq 2 ] || fail "usage: $0 <amd64|arm64> <out-dir>"
arch=$1
out=$2
case $arch in
  amd64 | arm64) ;;
  *) fail "the architecture is amd64 or arm64, not \"$arch\"" ;;
esac
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)

# A builder of its own, with the pinned BuildKit: Docker's own builder can't attach an
# SBOM or provenance to an image it keeps.
docker buildx inspect "$BUILDER" >/dev/null 2>&1 ||
  docker buildx create --name "$BUILDER" --driver docker-container \
    --driver-opt "image=$BUILDKIT" --bootstrap >/dev/null
# The commit's time, for the image's creation time and its files' times.
SOURCE_DATE_EPOCH=$(git -C "$root" log -1 --format=%ct)
export SOURCE_DATE_EPOCH

# $1: where buildx writes what it made; $2: the output.
build() {
  docker buildx build --builder "$BUILDER" --platform "linux/$arch" \
    --attest "type=sbom,generator=$SYFT" --attest type=provenance,mode=max \
    --metadata-file "$1" --output "$2" "$root"
}
# The digest of the one linux/<arch> image in an index read from stdin.
image_in() {
  jq -er --arg arch "$arch" \
    '[.manifests[] | select(.platform.os == "linux" and .platform.architecture == $arch)]
     | if length == 1 then .[0].digest else error("not one linux/\($arch) image") end'
}

mkdir -p "$out"
rm -rf "$out/oci" "$out/digest"
build "$out/oci.json" "type=oci,dest=$out/oci,tar=false,rewrite-timestamp=true"
index=$(jq -er '.manifests[0].digest' "$out/oci/index.json")
digest=$(image_in <"$out/oci/blobs/sha256/${index#sha256:}")
printf '%s\n' "$digest" >"$out/digest"
echo "Built linux/$arch: $digest"
