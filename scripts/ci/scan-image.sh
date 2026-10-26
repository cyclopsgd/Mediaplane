#!/bin/sh
# Trivy on Mediaplane's image, as build-image.sh wrote it (an OCI layout), for one
# architecture. It fails on a critical vulnerability that has a fix (spec §7.2(7)).
#
#   scripts/ci/scan-image.sh <amd64|arm64> <oci-dir>
set -eu

TRIVY=aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969

[ $# -eq 2 ] || {
  echo "usage: $0 <amd64|arm64> <oci-dir>" >&2
  exit 1
}
arch=$1
oci=$(CDPATH='' cd -- "$2" && pwd)
# Only the image's folder is mounted, read-only.
docker run --rm --volume "$oci:/scan:ro" "$TRIVY" \
  image --input /scan --platform "linux/$arch" --scanners vuln --severity CRITICAL \
  --ignore-unfixed --exit-code 1 --no-progress --skip-version-check
