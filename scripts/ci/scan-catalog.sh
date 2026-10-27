#!/bin/sh
# Trivy on every image the catalog pins, from its registry, for one architecture (spec
# §7.2(7)). A critical vulnerability that has a fix is a finding, but for those listed in
# scripts/ci/catalog-ignore.yaml until each entry's date: only upstream can fix them.
# Each image gets an ignore file of its own, with the entries that name its app, so an
# entry hides a finding in that app and no other (catalog-images.ts ignore <image>).
#
# What a finding does is decided by one switch, CATALOG_SCAN (set for CI on the
# catalog-images job in .github/workflows/ci.yml):
#
#   report  a finding is a GitHub warning for its image, and a list in the step summary;
#           the run still passes (the owner's decision of 2026-10-27, CI's setting)
#   fail    a finding fails the run (this script's default, when CATALOG_SCAN is unset,
#           so a run by hand is as strict as CI used to be)
#
# Any other value is an error, so that a typo never turns the scan off. In both modes an
# image that couldn't be scanned (Trivy's exit 1, after its tries) fails the run: report
# never means that the scanner silently stopped working.
#
#   [CATALOG_SCAN=<report|fail>] scripts/ci/scan-catalog.sh <amd64|arm64>
set -eu

TRIVY=aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969

[ $# -eq 1 ] || {
  echo "usage: $0 <amd64|arm64>" >&2
  exit 1
}
arch=$1
mode=${CATALOG_SCAN-fail}
case $mode in
  report | fail) ;;
  *)
    echo "error: CATALOG_SCAN is '$mode', and must be 'report' or 'fail'" >&2
    exit 1
    ;;
esac
root=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
images=$(cd "$root" && pnpm --silent exec tsx scripts/ci/catalog-images.ts "$arch")
[ -n "$images" ] || {
  echo "error: no catalog images for $arch" >&2
  exit 1
}
# One vulnerability database for every scan, and each scan's ignore file, in folders of
# this run's own, removed on the way out even when the second can't be made.
cache=$(mktemp -d)
trap 'rm -rf "$cache" ${ignores:+"$ignores"}' EXIT
ignores=$(mktemp -d)
trap 'exit 130' INT
trap 'exit 143' TERM
# Pulled with Docker's login, when there is one (CI logs in to Docker Hub when it can).
set -- --rm --user "$(id -u):$(id -g)" --env HOME=/home/trivy \
  --volume "$cache:/cache" --volume "$ignores/ignore.yaml:/ignore.yaml:ro"
if [ -f "$HOME/.docker/config.json" ]; then
  set -- "$@" --volume "$HOME/.docker/config.json:/home/trivy/.docker/config.json:ro"
fi
found=
unscanned=
for image in $images; do
  echo "--- $image (linux/$arch)"
  # Under set -e, an image the catalog doesn't know (or a failure here) stops the run.
  (cd "$root" && pnpm --silent exec tsx scripts/ci/catalog-images.ts ignore "$image") \
    >"$ignores/ignore.yaml"
  # Trivy exits 3 on a finding, and 1 when it couldn't scan, such as when the registry
  # asks it to slow down: that is tried again, after 15 and 45 seconds.
  for wait in 0 15 45; do
    sleep "$wait"
    code=0
    docker run "$@" "$TRIVY" image --cache-dir /cache --image-src remote \
      --platform "linux/$arch" --ignorefile /ignore.yaml --scanners vuln \
      --severity CRITICAL --ignore-unfixed --exit-code 3 --no-progress \
      --skip-version-check "$image" || code=$?
    [ "$code" -ne 0 ] && [ "$code" -ne 3 ] || break
  done
  case $code in
    0) ;;
    3) found="$found $image" ;;
    *) unscanned="$unscanned $image" ;;
  esac
done
if [ -n "$found" ] && [ "$mode" = report ]; then
  for image in $found; do
    echo "::warning::$image (linux/$arch) has a critical vulnerability with a fix that scripts/ci/catalog-ignore.yaml doesn't list"
  done
  echo "Reported, not failed (CATALOG_SCAN=report). To fail on these, set CATALOG_SCAN: fail on the catalog-images job in .github/workflows/ci.yml."
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### Catalog images with a critical vulnerability that has a fix (linux/$arch)"
      echo
      for image in $found; do echo "- \`$image\` (linux/$arch)"; done
      echo
      echo "Reported, not failed (\`CATALOG_SCAN: report\` on the \`catalog-images\` job in \`.github/workflows/ci.yml\`: change it to \`CATALOG_SCAN: fail\` to fail on these). Only upstream can fix them: list one in \`scripts/ci/catalog-ignore.yaml\` until its date to hide it."
      echo
    } >>"$GITHUB_STEP_SUMMARY"
  fi
elif [ -n "$found" ]; then
  echo "These images have a critical vulnerability with a fix that scripts/ci/catalog-ignore.yaml doesn't list (linux/$arch):" >&2
  for image in $found; do echo "  $image" >&2; done
fi
if [ -n "$unscanned" ]; then
  echo "These images couldn't be scanned, three times (linux/$arch):" >&2
  for image in $unscanned; do echo "  $image" >&2; done
fi
[ -z "$unscanned" ] || exit 1
[ -z "$found" ] || [ "$mode" = report ] || exit 1
if [ -z "$found" ]; then
  echo "No critical vulnerability with a fix in the catalog's images (linux/$arch), but those listed in scripts/ci/catalog-ignore.yaml."
fi
