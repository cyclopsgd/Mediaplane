# Releasing Mediaplane

Mediaplane's releases come from
[release-please](https://github.com/googleapis/release-please) and the release workflow,
`.github/workflows/release.yml` (spec §8.2). This page says
how a release is cut, what it publishes, and how to check one. There has been no
release yet: everything below happens from the first one.

## How a release is cut

```text
push to main
 └─ release-please
     ├─ updates its pull
     │  request: version,
     │  changelog
     └─ that pull request
        merged: tag, release
         └─ CI passed on it?
             ├─ image, amd64
             ├─ image, arm64
             ├─ one tag for both
             ├─ deploy files
             └─ tested versions
```

1. **Every push to `main`** has release-please update its release pull request,
   `chore(main): release <version>`. The version comes from the Conventional Commits
   since the last release: before 1.0, a `fix:` raises the patch number, and a `feat:`
   or a breaking change the minor one. The first release is 0.1.0, which
   `release-please-config.json` sets (`initial-version`), whatever the commits are. The
   pull request also updates `CHANGELOG.md`, the version in both `package.json` files, and
   the CLI's `mediaplane --version`.
2. **CI runs on that pull request** at once when the repository has the
   `RELEASE_PLEASE_TOKEN` secret. Without it, release-please uses GitHub's own token,
   which may open the pull request only once the repository allows GitHub Actions to
   create pull requests (Settings, Actions, General, Workflow permissions; the owner's
   step). Even then GitHub starts no workflow for that pull request, so close it and open
   it again: that starts CI. Until one of the two is done, release-please can't open its
   pull request, and the Release workflow fails on each push to `main`.
3. **Merging it cuts the release.** release-please tags the commit `v<version>` and
   writes the GitHub release, with the changelog, at once: the tag and the release page
   exist from the merge, before CI has passed on it.
4. **In the same run, the release workflow publishes it,** once CI's last job,
   `All checks passed`, has passed on that commit (it waits up to 90 minutes). CI runs on
   every commit on `main`, none cancelled or queued behind another, so the release's
   commit always gets a run of its own. Each job that checks out the release's tag (the
   wait for CI, the images, the tag and the deploy files) checks that it is still the
   commit release-please tagged, the one CI passed:
   - on an amd64 runner and an arm64 runner, natively, it builds the image, with its
     SBOM and build provenance, scans it with Trivy, and pushes the image it scanned by
     digest, checking that what it pushed is what it scanned;
   - it tags `ghcr.io/cyclopsgd/mediaplane:<version>`, one index for both, and attests
     its provenance, signed, beside the image;
   - it makes the deploy files, `mediaplane-deploy-<version>.tar.gz`, whose `install.sh`
     and `mediaplane.compose.yaml` name that image by its digest, with `SHA256SUMS`,
     attests them too, adds them to the release, and adds the tested app versions to
     its notes.

The image is built to be reproducible: every time in it is the commit's, so one commit
builds the same image for an architecture each time. The index of both images is not: its
digest also covers the attestations, which hold the times of the build, so running the
image job again gives another index digest, and so other deploy files, which name the
image. Those are the same bytes only for the same image and the same tools.

For the first release only, once its image is published: make the package public (on
GitHub, Packages, `mediaplane`, Package settings, Change visibility, Public). Until then
nobody else can pull the image, so installing from a release and checking the image fail.

## What never publishes

- A push to `main` that doesn't merge the release pull request publishes nothing.
- A pull request publishes nothing. CI builds the release's own image on both
  architectures, with the same script, and pushes nothing.
- A fork publishes nothing: release-please runs in `cyclopsgd/Mediaplane` only.
- No image is tagged `latest`. Each is named by its version, and a release's deploy files
  name it by its digest.

## When a release changes Compose

Updating Mediaplane, or going back, never recreates, restarts or pulls an app container,
network or volume, and never changes `generated/` or `state/`. But a later `apply` runs
the image's own Docker Compose, and different versions of Compose can work out a
service's configuration differently: Compose 5.5.1 recreated containers that 2.38.2 had
made, from a file that had not changed. So the first `apply` after an update that
changed the Compose in the image may recreate every app container: a restart, which
keeps their data and settings.

Which versions differ was probed on 2026-10-29, with `docker compose config --hash` on
every service of two stacks Mediaplane renders (Jellyfin with the VPN, and Plex with
FlareSolverr), for eleven releases of Compose:

- 2.29.7, 2.33.1, 2.36.2, 2.38.2, 2.39.4 and 2.40.3 work out the same hash for every
  service;
- so do 5.0.2, 5.3.1, 5.5.1 and 5.6.1;
- but a 2.x and a 5.x differ for every service but Byparr;
- and 2.24.0, the oldest Compose Mediaplane takes, differs from the later 2.x for Gluetun
  and qBittorrent.

So what to check is whether the image's Compose moved to another of those lines, or to a
version not probed yet. Once the Renovate app is installed (an owner's step), Renovate's
pull request for a bump of the `docker` image in the `Dockerfile` says the same.

Nothing writes this into a release's notes. The Compose is the one inside the `docker`
image that the `Dockerfile` copies it from, so a change shows in the changelog as a bump
of that image, and the `Dockerfile` names no Compose version but in a comment. Whoever
cuts the release checks it, once the workflow has finished and the image is published:

```bash
docker run --rm ghcr.io/cyclopsgd/mediaplane:0.2.0 docker compose version
```

(`0.2.0` is an example. The image has no entrypoint, so this runs its own `docker`. The
same command on the previous release's image gives the version to compare. Run on the
`docker` stage's image, `docker run --rm --entrypoint docker <image> compose version`
printed `Docker Compose version v5.5.1`.)

If the versions differ, add a paragraph to the release's notes on GitHub, above "Tested
app versions": the first `apply` after this update may recreate every app container, a
restart that keeps their data and settings. Edit the release page, or:

```bash
gh release view v0.2.0 --repo cyclopsgd/Mediaplane --json body --jq .body > notes.md
# add the paragraph to notes.md, above "## Tested app versions"
gh release edit v0.2.0 --repo cyclopsgd/Mediaplane --notes-file notes.md
```

Do it after the run has finished: a re-run of the workflow keeps everything above that
heading, and writes its own below it. The notes must not suggest that the next `apply`
touches nothing.

## Tokens and secrets

Every job starts with a token that may do nothing, and asks for what it needs:

- **release-please:** write the repository's contents, issues and pull requests, for its
  pull request, the tag and the release.
- **Waiting for CI:** read the repository and its checks.
- **The images:** read the repository, and write packages, to push by digest.
- **One tag for both:** write packages, and sign and keep an attestation.
- **The deploy files:** read the repository only. This is the one job that installs npm
  packages, whose scripts run with its environment: it has no secret.
- **Adding them to the release:** write the repository's contents, and sign and keep an
  attestation.

Secrets, each optional:

- `RELEASE_PLEASE_TOKEN`: a fine-grained token of the owner's, for this repository only,
  that may write contents, issues and pull requests. It only makes CI run on the release
  pull request at once.
- `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`: a Docker Hub access token with the
  permission "Public Repo Read-only", so that CI's pulls don't meet Docker Hub's limit
  for anonymous ones. With both set, the jobs that pull images log in first. A revoked or
  wrong token fails those jobs: there is no fallback to anonymous pulls. To go back to
  anonymous pulls, remove both secrets. With only one of the two set, a job warns and
  pulls anonymously.

GitHub gives no secret to a fork's pull request: there, CI pulls anonymously.

CI also runs weekly, to find new vulnerabilities and Node security releases without a
push. GitHub turns off scheduled workflows in a public repository after 60 days without
activity: if the weekly run stops, turn it on again in the repository's Actions tab.

A critical vulnerability with a fix in an image of the catalog's apps is reported in the
run (a warning and the step summary), not failed, because only the app's maker can fix
it; Mediaplane's own image still fails CI. To fail on the apps' images again, change
`CATALOG_SCAN: report` to `CATALOG_SCAN: fail` on the `catalog-images` job in
`.github/workflows/ci.yml`.

## If a release stops halfway

Re-run the failed jobs from the workflow run's page, within 7 days: the jobs pass the
digests pushed and the deploy files on to the next as the run's files, which GitHub keeps
7 days. After that, re-run the image jobs, which re-runs the jobs after them too: they
build another index digest, and so other deploy files, as above. Each step can run again:

- before the images are pushed, nothing is published but the tag and the release page,
  which release-please made at the merge;
- the wait for CI fails at once when every `All checks passed` run on the commit so far
  failed, such as the pull request's, before the run of the push to `main` has
  finished: re-run it once that run has passed;
- an image pushed by digest but not tagged is an untagged version in the package, which
  the next run tags or leaves;
- the deploy files are uploaded with `--clobber`, and the notes are written from the
  release's own, the tested app versions taking the place of those a run added before;
- a release run can show as cancelled before it started: while one run is in progress,
  GitHub cancels a run queued behind it when a newer one queues. If that was the merge's
  run, the next push's run cuts the release (its release-please tags the merged pull
  request), or re-run the cancelled one.

If CI fails on the release's commit, nothing else is published: no image and no deploy
files, so the release page has none, and the deploy guide's commands find nothing for
that version. Take the release and its tag away, fix the fault on `main`, and let the
next release pull request cut a new version, once release-please opens it:

```bash
gh release delete v0.1.0 --cleanup-tag --repo cyclopsgd/Mediaplane
```

(`0.1.0` is an example.)

## Checking a release

From the first release, with the version you got (`0.1.0` is an example):

```bash
sha256sum --check SHA256SUMS
gh attestation verify mediaplane-deploy-0.1.0.tar.gz --repo cyclopsgd/Mediaplane
gh attestation verify oci://ghcr.io/cyclopsgd/mediaplane:0.1.0 --repo cyclopsgd/Mediaplane
docker buildx imagetools inspect ghcr.io/cyclopsgd/mediaplane:0.1.0
```

The last shows the image's digest, which the release's `mediaplane.compose.yaml` names,
and its SBOM and provenance with `--format '{{json .SBOM}}'` and
`--format '{{json .Provenance}}'`.
