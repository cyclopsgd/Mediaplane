import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from '../root';
import { RELEASE_JOB_PERMISSIONS } from './permissions';

interface Step {
  id?: string;
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
}
interface Job {
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps: Step[];
}
const text = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
const ciText = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
const release = parse(text) as {
  on: Record<string, unknown>;
  permissions: unknown;
  concurrency: { 'cancel-in-progress': boolean };
  jobs: Record<string, Job>;
};
const { jobs } = release;
const CREATED = "needs.release-please.outputs.created == 'true'";
const needs = (job: Job): string[] =>
  job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];

describe('the release workflow (spec §8.2)', () => {
  it('runs on a push to main, and never for a pull request', () => {
    expect(release.on).toEqual({ push: { branches: ['main'] } });
    expect(release.permissions).toEqual({});
    expect(release.concurrency['cancel-in-progress']).toBe(false);
  });

  it("lets release-please run in this repository only, a fork's main publishing nothing", () => {
    expect(jobs['release-please']?.if).toBe(
      "github.repository == 'cyclopsgd/Mediaplane'",
    );
    expect(jobs['release-please']?.steps[0]?.uses).toMatch(
      /^googleapis\/release-please-action@[0-9a-f]{40}$/,
    );
  });

  it('publishes only once release-please has cut a release, and only after CI passed on it', () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (name === 'release-please') continue;
      expect(job.if, name).toBe(CREATED);
      expect(needs(job), name).toContain('release-please');
    }
    expect(needs(jobs.image ?? ({} as Job))).toContain('ci-passed');
    const wait = jobs['ci-passed']?.steps.find((step) =>
      step.run?.includes('ci-passed.sh'),
    );
    expect(wait?.env?.SHA).toBe('${{ needs.release-please.outputs.sha }}');
  });

  it('has CI passed in the needs, direct or not, of every job that publishes', () => {
    const closure = (name: string, seen = new Set<string>()): Set<string> => {
      for (const need of needs(jobs[name] ?? ({} as Job))) {
        if (!seen.has(need)) {
          seen.add(need);
          closure(need, seen);
        }
      }
      return seen;
    };
    const publishing = Object.keys(jobs).filter(
      (name) => name !== 'release-please' && name !== 'ci-passed',
    );
    expect(publishing.sort()).toEqual(['assets', 'image', 'publish', 'upload']);
    for (const name of publishing) {
      expect(closure(name), name).toContain('ci-passed');
    }
  });

  it('checks, in each job that builds or ships, that the tag is the commit CI passed', () => {
    for (const name of ['image', 'publish', 'assets']) {
      const steps = jobs[name]?.steps ?? [];
      const checkout = steps.findIndex((step) =>
        step.uses?.startsWith('actions/checkout@'),
      );
      const check = steps[checkout + 1];
      expect(check?.run, name).toContain('git rev-parse HEAD');
      // The sha reaches the script through the environment, never pasted into it.
      expect(check?.env?.SHA, name).toBe('${{ needs.release-please.outputs.sha }}');
      expect(check?.run, name).not.toContain('${{');
    }
  });

  it("runs CI for every commit on main, none cancelled or queued behind another's", () => {
    const ci = parse(ciText) as {
      concurrency: { group: string; 'cancel-in-progress': string };
    };
    expect(ci.concurrency.group).toBe(
      "ci-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}",
    );
    // A branch's new push still cancels its older run, and main's never does.
    expect(ci.concurrency['cancel-in-progress']).toBe(
      "${{ github.ref != 'refs/heads/main' }}",
    );
  });

  it('names the gate as ci-passed.sh looks for it, "All checks passed"', () => {
    const ci = parse(ciText) as { jobs: Record<string, { name?: string }> };
    expect(ci.jobs.gate?.name).toBe('All checks passed');
    const script = readFileSync(join(ROOT, 'scripts/release/ci-passed.sh'), 'utf8');
    expect(script).toContain('check_name=All%20checks%20passed');
  });

  it("builds from the release's tag, never from main as it is later", () => {
    for (const [name, job] of Object.entries(jobs)) {
      for (const step of job.steps) {
        if (step.uses?.startsWith('actions/checkout@') !== true) continue;
        expect(step.with?.ref, name).toBe('${{ needs.release-please.outputs.tag }}');
      }
    }
  });

  it('gives each job only what it needs', () => {
    expect(
      Object.fromEntries(
        Object.entries(jobs).map(([name, job]) => [name, job.permissions]),
      ),
    ).toEqual(RELEASE_JOB_PERMISSIONS);
  });

  it('keeps every secret out of the job that installs npm packages, and of the rest but two', () => {
    const secrets = (job: Job) =>
      [...JSON.stringify(job).matchAll(/secrets\.(\w+)/g)].map((m) => m[1]);
    expect(secrets(jobs['release-please'] ?? ({} as Job))).toEqual([
      'RELEASE_PLEASE_TOKEN',
    ]);
    expect(secrets(jobs.image ?? ({} as Job))).toEqual([
      'DOCKERHUB_USERNAME',
      'DOCKERHUB_TOKEN',
    ]);
    for (const name of ['ci-passed', 'publish', 'assets', 'upload']) {
      expect(secrets(jobs[name] ?? ({} as Job)), name).toEqual([]);
    }
  });

  it('scans each image before it pushes it, and pushes by digest, the name in lowercase', () => {
    const runs = (jobs.image?.steps ?? []).map((step) => step.run ?? '');
    const build = runs.findIndex((run) =>
      /build-image\.sh "\$\{\{ matrix\.arch \}\}" "\$RUNNER_TEMP\/image"$/.test(
        run.trim(),
      ),
    );
    const scan = runs.findIndex((run) => run.includes('scripts/ci/scan-image.sh'));
    const push = runs.findIndex((run) =>
      run.includes('--push "ghcr.io/${GITHUB_REPOSITORY,,}"'),
    );
    expect(build).toBeGreaterThanOrEqual(0);
    expect(scan).toBeGreaterThan(build);
    expect(push).toBeGreaterThan(scan);
    // GHCR takes lowercase names: the repository is cyclopsgd/Mediaplane.
    expect(text).not.toMatch(/ghcr\.io\/cyclopsgd\/Mediaplane/);
  });

  it('attests the image and the deploy files, and adds the tested app versions to the notes', () => {
    const attest = (job: string) =>
      (jobs[job]?.steps ?? []).filter((step) =>
        step.uses?.startsWith('actions/attest-build-provenance@'),
      );
    expect(attest('publish')[0]?.with).toMatchObject({ 'push-to-registry': true });
    const subjects = String(attest('upload')[0]?.with?.['subject-path'])
      .trim()
      .split('\n');
    expect(subjects.map((path) => path.replace(/^.*\//, ''))).toEqual([
      'mediaplane-deploy-*.tar.gz',
      'SHA256SUMS',
    ]);
    const runs = JSON.stringify(jobs.assets?.steps);
    expect(runs).toContain('scripts/release/deploy-bundle.ts');
    expect(runs).toContain('scripts/release/tested-apps.ts');
    const upload = JSON.stringify(jobs.upload?.steps);
    expect(upload).toContain('gh release edit');
    // A re-run replaces the section, rather than adding a second.
    expect(upload).toContain("sed -i '/^## Tested app versions$/,$d' body.md");
  });
});
