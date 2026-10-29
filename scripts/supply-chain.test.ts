import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { RELEASE_JOB_PERMISSIONS } from './release/permissions';
import { ROOT } from './root';

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/** Every workflow GitHub runs: a `.yml` or a `.yaml` file in `.github/workflows`. */
const WORKFLOWS = readdirSync(join(ROOT, '.github/workflows'))
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()
  .map((name) => `.github/workflows/${name}`);

/** The repository's own composite actions, which workflows run as `./.github/actions/…`. */
const ACTIONS = readdirSync(join(ROOT, '.github/actions'))
  .sort()
  .flatMap((name) =>
    ['action.yml', 'action.yaml']
      .map((file) => `.github/actions/${name}/${file}`)
      .filter((path) => existsSync(join(ROOT, path))),
  );

/** `${{ … }}` text a script must never hold: a secret, or what anyone can write. */
const PASTED = /\$\{\{[^}]*\b(?:secrets|github\.event|github\.head_ref|inputs)\b/;

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Job {
  permissions?: unknown;
  steps?: Step[];
}
interface Workflow {
  on: unknown;
  permissions?: unknown;
  jobs: Record<string, Job>;
}
const workflow = (path: string): Workflow => parse(read(path)) as Workflow;

/** The events a workflow runs on, from each form `on:` takes: one name, a list or a map. */
function triggers(on: unknown): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  return typeof on === 'object' && on !== null ? Object.keys(on) : [];
}

/** A `uses:` line: an Action pinned by commit SHA, with its version, or one of ours. */
const PINNED_ACTION =
  /uses: (?:\.\/\S+|[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+(?:\.\d+){0,2})$/;
const usesLines = (path: string): string[] =>
  read(path)
    .split('\n')
    .filter((line) => /^\s*(?:-\s+)?uses:/.test(line));

/**
 * Every job that sets its own permissions, with exactly what it sets. Every other job
 * inherits the workflow's `permissions`.
 */
const JOB_PERMISSIONS: Record<string, Record<string, unknown>> = {
  '.github/workflows/ci.yml': { gate: {} },
  '.github/workflows/plex.yml': {},
  '.github/workflows/release.yml': RELEASE_JOB_PERMISSIONS,
};

/** An image pinned by tag and digest, as every image outside the catalog is written. */
const PINNED = /[a-z0-9][a-z0-9._/-]*:[A-Za-z0-9][A-Za-z0-9._-]*@sha256:[0-9a-f]{64}/g;

interface RegexManager {
  managerFilePatterns: string[];
  matchStrings: string[];
}
interface PackageRule {
  matchDepNames?: string[];
  matchFileNames?: string[];
  versioning?: string;
  automerge?: boolean;
  prBodyNotes?: string[];
}
const renovate = JSON.parse(read('renovate.json')) as {
  automerge?: boolean;
  ignorePaths?: string[];
  'docker-compose'?: { managerFilePatterns: string[] };
  customManagers: RegexManager[];
  packageRules: PackageRule[];
};
/** Renovate writes a regex pattern as "/…/"; anything else would be a glob. */
const pattern = (text: string): RegExp => {
  expect(text).toMatch(/^\/.*\/$/);
  return new RegExp(text.slice(1, -1));
};
const manager = (index: number): RegexManager => {
  const found = renovate.customManagers[index];
  if (found === undefined)
    throw new Error(`renovate.json has no custom manager ${String(index)}`);
  return found;
};
/** The catalog's pins, then those outside it. */
const catalogManager = manager(0);
const pinnedManager = manager(1);

/**
 * Every file git tracks, with its path: what CI checks out, whatever else lies in this
 * checkout. A tracked file deleted here, and not yet committed, is left out.
 */
function repoFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '' && existsSync(join(ROOT, path)));
}

/**
 * Files that show a pin rather than pin it: the app READMEs and the golden files show the
 * catalog's, which docs:generate and the tests rewrite; a plan is the record of what was
 * built, its pins as they were then.
 */
const showsPins = (path: string) =>
  path.startsWith('docs/plans/') ||
  /^catalog\/[^/]+\/README\.md$/.test(path) ||
  path.includes('/__golden__/');

describe('the workflows (spec §7.2(7))', () => {
  it.each(WORKFLOWS)('%s pins every Action by commit SHA, with its version', (path) => {
    const uses = usesLines(path);
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(PINNED_ACTION);
  });

  it.each(ACTIONS)('%s, a composite action, pins every Action it uses too', (path) => {
    for (const line of usesLines(path)) expect(line).toMatch(PINNED_ACTION);
  });

  it.each([
    ['one name', 'pull_request_target', ['pull_request_target']],
    ['a list', ['push', 'pull_request_target'], ['push', 'pull_request_target']],
    ['a map', { push: null, pull_request_target: {} }, ['push', 'pull_request_target']],
  ])('reads the events of `on:` written as %s', (_form, on, events) => {
    expect(triggers(on)).toEqual(events);
  });

  it.each(WORKFLOWS)(
    '%s gives its jobs a read-only token unless one says more',
    (path) => {
      const { permissions, jobs } = workflow(path);
      expect([{}, { contents: 'read' }]).toContainEqual(permissions);
      const asked = Object.fromEntries(
        Object.entries(jobs)
          .filter(([, job]) => job.permissions !== undefined)
          .map(([name, job]) => [name, job.permissions]),
      );
      expect(asked).toEqual(JOB_PERMISSIONS[path]);
    },
  );

  it.each(WORKFLOWS)("%s never runs a pull request's code with secrets", (path) => {
    const events = triggers(workflow(path).on);
    expect(events.length).toBeGreaterThan(0);
    for (const trigger of ['pull_request_target', 'workflow_run', 'issue_comment']) {
      expect(events).not.toContain(trigger);
    }
  });

  it.each(WORKFLOWS)(
    '%s keeps secrets and event text out of its scripts, and credentials out of checkouts',
    (path) => {
      for (const job of Object.values(workflow(path).jobs)) {
        for (const step of job.steps ?? []) {
          // A script gets a secret, or text anyone can write, through env: never pasted
          // into its source, where a quote in it would run as code.
          expect(step.run ?? '').not.toMatch(PASTED);
          if (step.uses?.startsWith('actions/checkout@') === true) {
            expect(step.with?.['persist-credentials']).toBe(false);
          }
        }
      }
      expect(read(path)).not.toContain('secrets.GITHUB_TOKEN');
    },
  );

  it.each(ACTIONS)(
    '%s, a composite action, keeps secrets and inputs out of its scripts',
    (path) => {
      const { runs } = parse(read(path)) as { runs: { steps: Step[] } };
      expect(runs.steps.length).toBeGreaterThan(0);
      // Its inputs reach a script through env, as a workflow's secrets do.
      for (const step of runs.steps) expect(step.run ?? '').not.toMatch(PASTED);
    },
  );
});

describe('every image is pinned by digest (spec §7.2(7))', () => {
  it('in the Dockerfile', () => {
    const from = read('Dockerfile')
      .split('\n')
      .filter((line) => line.startsWith('FROM '));
    expect(from.length).toBeGreaterThan(0);
    for (const line of from) expect(line).toMatch(/@sha256:[0-9a-f]{64}( AS \S+)?$/);
  });

  it("in Mediaplane's deployment, but for the image it is given", () => {
    const deployment = parse(read('deploy/mediaplane.compose.yaml')) as {
      services: Record<string, { image: string }>;
      'x-mediaplane-image': string;
    };
    for (const service of Object.values(deployment.services)) {
      if (service.image === deployment['x-mediaplane-image']) continue;
      expect(service.image).toMatch(/^[^@\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/);
    }
  });

  it('in a file Renovate keeps current, wherever one is written', () => {
    const managed = [
      ...pinnedManager.managerFilePatterns.map(pattern),
      ...(renovate['docker-compose']?.managerFilePatterns ?? []).map(pattern),
      /^Dockerfile$/,
    ];
    // The catalog's pins are the catalog manager's.
    const pinned = repoFiles().filter(
      (path) => !showsPins(path) && [...read(path).matchAll(PINNED)].length > 0,
    );
    expect(pinned.length).toBeGreaterThan(0);
    for (const path of pinned) {
      expect(
        managed.some((re) => re.test(path)),
        path,
      ).toBe(true);
    }
  });
});

describe('Renovate (spec §8.2)', () => {
  it('reads every file it is given, tests included, and merges nothing itself', () => {
    // config:recommended ignores test folders, which hold the end-to-end tests' images.
    expect(renovate.ignorePaths).toEqual(['**/node_modules/**']);
    expect(renovate.automerge).toBe(false);
  });

  it.each(catalog.map((def) => [def.id, def] as const))(
    "finds %s's pin, tag and digest, in its app.ts",
    (id, def) => {
      expect(
        catalogManager.managerFilePatterns
          .map(pattern)
          .some((re) => re.test(`catalog/${id}/app.ts`)),
      ).toBe(true);
      const found = [
        ...read(`catalog/${id}/app.ts`).matchAll(
          new RegExp(catalogManager.matchStrings[0] ?? '', 'g'),
        ),
      ];
      expect(found.map((match) => match.groups)).toEqual([
        {
          depName: def.image.repo,
          currentValue: def.image.tag,
          currentDigest: def.image.digest,
        },
      ]);
    },
  );

  it('finds the images pinned outside the catalog, as the roadmap lists them', () => {
    const found = (path: string) =>
      [...read(path).matchAll(new RegExp(pinnedManager.matchStrings[0] ?? '', 'g'))].map(
        (match) => match.groups?.depName,
      );
    expect(found('.github/workflows/ci.yml')).toEqual([
      'rhysd/actionlint',
      'ghcr.io/gitleaks/gitleaks',
    ]);
    expect(found('scripts/ci/scan-image.sh')).toEqual(['aquasec/trivy']);
    expect(found('scripts/ci/scan-catalog.sh')).toEqual(['aquasec/trivy']);
    expect(found('scripts/ci/build-image.sh')).toEqual([
      'moby/buildkit',
      'docker/buildkit-syft-scanner',
    ]);
    expect(found('scripts/ci/engine-floor.sh')).toEqual(['docker', 'busybox']);
    expect(found('.githooks/pre-commit')).toEqual(['ghcr.io/gitleaks/gitleaks']);
    expect(found('test/e2e/helpers.ts')).toContain('busybox');
    expect(found('test/e2e/wireguard.ts')).toEqual(['lscr.io/linuxserver/wireguard']);
  });

  it("can read every pinned tag, the catalog's and every other, so that it can find a newer one", () => {
    // Each image, as [name, tag]: the catalog's, and every image pinned outside it
    // (busybox, Trivy, gitleaks, actionlint, Node, Docker, the socket proxy, BuildKit and
    // its SBOM scanner, the registry, the WireGuard test server), wherever it is written.
    const tags: [string, string][] = catalog.map((def) => [
      def.image.repo,
      def.image.tag,
    ]);
    for (const path of repoFiles().filter((p) => !showsPins(p))) {
      for (const [image] of read(path).matchAll(PINNED)) {
        const named = image.slice(0, image.indexOf('@'));
        const colon = named.lastIndexOf(':');
        tags.push([named.slice(0, colon), named.slice(colon + 1)]);
      }
    }
    expect(tags.some(([name]) => name === 'wollomatic/socket-proxy')).toBe(true);
    expect(tags.some(([name]) => name === 'moby/buildkit')).toBe(true);
    const rules = new Map<string, RegExp>();
    for (const rule of renovate.packageRules) {
      if (rule.versioning?.startsWith('regex:') !== true) continue;
      const re = new RegExp(rule.versioning.slice('regex:'.length));
      for (const name of rule.matchDepNames ?? []) rules.set(name, re);
    }
    for (const [name, tag] of tags) {
      // Its own rule's, or Renovate's Docker versioning: a version of two to four
      // numbers, and a suffix it keeps (-alpine3.24, -cli, -dind).
      const readable = rules.get(name) ?? /^v?\d+(?:\.\d+){1,3}(?:-[a-z][a-z0-9.]*)?$/;
      expect(tag, `${name}:${tag}`).toMatch(readable);
    }
  });

  it("says, on a bump of the image's Docker CLI, what a change of its Compose does", () => {
    const rule = renovate.packageRules.find(
      (r) =>
        r.matchFileNames?.join() === 'Dockerfile' && r.matchDepNames?.join() === 'docker',
    );
    const notes = rule?.prBodyNotes?.join(' ') ?? '';
    expect(notes).toContain('compose version');
    expect(notes).toContain('recreate every app container');
    expect(notes).toContain('docs/releasing.md');
  });

  it('never merges an app pin by itself, and says to regenerate the docs', () => {
    const rule = renovate.packageRules.find((r) =>
      r.matchFileNames?.includes('catalog/*/app.ts'),
    );
    expect(rule?.automerge).toBe(false);
    expect(rule?.prBodyNotes?.join(' ')).toContain('pnpm docs:generate');
  });
});

describe('Node stays on its 24 line wherever its version is written (spec §3.3)', () => {
  interface NodeRule {
    matchDepNames?: string[];
    matchFileNames?: string[];
    allowedVersions?: string;
  }
  const rules = renovate.packageRules as NodeRule[];

  it.each(['Dockerfile', '.nvmrc'])('caps Node below 25 in %s', (file) => {
    const capped = rules.filter(
      (rule) =>
        rule.matchDepNames?.includes('node') === true &&
        rule.matchFileNames?.includes(file) === true &&
        rule.allowedVersions === '<25',
    );
    expect(capped).toHaveLength(1);
  });
});
