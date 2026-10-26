#!/bin/sh
# Waits until CI's last job, "All checks passed", has passed on a commit: a release
# publishes only a commit CI passed. It fails at once when every such run finished
# without passing, and after <minutes> (90 by default) when none has passed yet.
#
#   scripts/release/ci-passed.sh <commit sha> [<minutes>]
#
# It asks GitHub with gh, as GH_TOKEN, about GITHUB_REPOSITORY, for the check run of
# GitHub Actions (app 15368) only, so that no other app's check of that name counts.
set -eu

[ $# -ge 1 ] && [ $# -le 2 ] || {
  echo "usage: $0 <commit sha> [<minutes>]" >&2
  exit 1
}
sha=$1
minutes=${2:-90}
repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY names the repository}
case $sha in
  *[!0-9a-f]* | '')
    echo "error: \"$sha\" is not a commit sha" >&2
    exit 1
    ;;
esac
deadline=$(($(date +%s) + minutes * 60))
while :; do
  runs=$(gh api "repos/$repo/commits/$sha/check-runs?check_name=All%20checks%20passed&app_id=15368&per_page=100" \
    --jq '[.check_runs[] | {status, conclusion}]')
  if printf '%s' "$runs" | jq -e 'any(.[]; .status == "completed" and .conclusion == "success")' >/dev/null; then
    echo "CI passed on $sha."
    exit 0
  fi
  if printf '%s' "$runs" | jq -e 'length > 0 and all(.[]; .status == "completed")' >/dev/null; then
    echo "error: CI's \"All checks passed\" didn't pass on $sha, so nothing is published" >&2
    exit 1
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "error: CI's \"All checks passed\" hasn't passed on $sha within $minutes minutes, so nothing is published" >&2
    exit 1
  fi
  echo "Waiting for CI on $sha..."
  sleep "${MEDIAPLANE_TEST_POLL_SECONDS:-60}"
done
