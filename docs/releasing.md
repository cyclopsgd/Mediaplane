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
   or a breaking change the minor one. The pull request also updates `CHANGELOG.md`,
   the version in both `package.json` files, and the CLI's `mediaplane --version`.
2. **CI runs on that pull request** at once when the repository has the
   `RELEASE_PLEASE_TOKEN` secret. With GitHub's own token, GitHub starts no workflow for
   it, so close the pull request and open it again: that starts CI.
3. **Merging it cuts the release.** release-please tags the commit `v<version>` and
   writes the GitHub release, with the changelog, at once: the tag and the release page
   exist from the merge, before CI has passed on it.
4. **In the same run, the release workflow publishes it,** once CI's last job,
   `All checks passed`, has passed on that commit (it waits up to 90 minutes):
   - on an amd64 runner and an arm64 runner, natively, it builds the image, with its
     SBOM and build provenance, scans it with Trivy, and pushes the image it scanned by
     digest, checking that what it pushed is what it scanned;
   - it tags `ghcr.io/cyclopsgd/mediaplane:<version>`, one index for both, and attests
     its provenance, signed, beside the image;
   - it makes the deploy files, `mediaplane-deploy-<version>.tar.gz`, whose `install.sh`
     and `mediaplane.compose.yaml` name that image by its digest, with `SHA256SUMS`,
     attests them too, adds them to the release, and adds the tested app versions to
     its notes.

## What never publishes

- A push to `main` that doesn't merge the release pull request publishes nothing.
- A pull request publishes nothing. CI builds the release's own image on both
  architectures, with the same script, and pushes nothing.
- A fork publishes nothing: release-please runs in `cyclopsgd/Mediaplane` only.
- No image is tagged `latest`. Each is named by its version, and a release's deploy files
  name it by its digest.

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
- `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`: a Docker Hub token that may only read public
  images, so that CI's pulls don't meet Docker Hub's limit for anonymous ones.

GitHub gives no secret to a fork's pull request: there, CI pulls anonymously.

## If a release stops halfway

Re-run the failed jobs from the workflow run's page. Each step can run again:

- before the images are pushed, nothing is published but the tag and the release page,
  which release-please made at the merge;
- the wait for CI fails at once when every `All checks passed` run on the commit so far
  failed, such as the pull request's, before the run of the push to `main` has
  finished: re-run it once that run has passed;
- an image pushed by digest but not tagged is an untagged version in the package, which
  the next run tags or leaves;
- the deploy files are uploaded with `--clobber`, and the notes are written from the
  release's own, the tested app versions taking the place of those a run added before.

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
