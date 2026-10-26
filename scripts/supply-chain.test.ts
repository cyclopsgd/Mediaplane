import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from './root';

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const WORKFLOWS = readdirSync(join(ROOT, '.github/workflows'))
  .filter((name) => name.endsWith('.yml'))
  .sort()
  .map((name) => `.github/workflows/${name}`);

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
  on: Record<string, unknown>;
  permissions?: unknown;
  jobs: Record<string, Job>;
}
const workflow = (path: string): Workflow => parse(read(path)) as Workflow;

/**
 * The jobs that ask for more than the workflow's read-only token, with exactly what they
 * ask for. Every other job inherits the workflow's `permissions`.
 */
const JOB_PERMISSIONS: Record<string, Record<string, unknown>> = {
  '.github/workflows/ci.yml': { gate: {} },
  '.github/workflows/plex.yml': {},
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

/** Every file in the repository but those that aren't its own, with its path. */
function repoFiles(dir = ''): string[] {
  const skip = new Set([
    '.git',
    'node_modules',
    'dist',
    'coverage',
    '.claude',
    '.superpowers',
  ]);
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (skip.has(entry.name)) return [];
    return entry.isDirectory() ? repoFiles(path) : [path];
  });
}

describe('the workflows (spec §7.2(7))', () => {
  it.each(WORKFLOWS)('%s pins every Action by commit SHA, with its version', (path) => {
    const uses = read(path)
      .split('\n')
      .filter((line) => /^\s*(?:-\s+)?uses:/.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line).toMatch(
        /uses: (?:\.\/\S+|[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+(?:\.\d+){0,2})$/,
      );
    }
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
    const { on } = workflow(path);
    for (const trigger of ['pull_request_target', 'workflow_run', 'issue_comment']) {
      expect(Object.keys(on)).not.toContain(trigger);
    }
  });

  it.each(WORKFLOWS)(
    '%s keeps secrets and event text out of its scripts, and credentials out of checkouts',
    (path) => {
      for (const job of Object.values(workflow(path).jobs)) {
        for (const step of job.steps ?? []) {
          // A script gets a secret, or text anyone can write, through env: never pasted
          // into its source, where a quote in it would run as code.
          expect(step.run ?? '').not.toMatch(
            /\$\{\{[^}]*\b(?:secrets|github\.event|github\.head_ref|inputs)\b/,
          );
          if (step.uses?.startsWith('actions/checkout@') === true) {
            expect(step.with?.['persist-credentials']).toBe(false);
          }
        }
      }
      expect(read(path)).not.toContain('secrets.GITHUB_TOKEN');
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
    // The catalog's pins are the catalog manager's; the app READMEs and the golden files
    // show them, and docs:generate and the tests rewrite those.
    const shown = (path: string) =>
      path.startsWith('docs/') ||
      /^catalog\/[^/]+\/README\.md$/.test(path) ||
      path.includes('/__golden__/');
    const pinned = repoFiles().filter(
      (path) => !shown(path) && [...read(path).matchAll(PINNED)].length > 0,
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
    expect(found('.github/workflows/ci.yml')).toEqual(
      expect.arrayContaining(['aquasec/trivy', 'ghcr.io/gitleaks/gitleaks']),
    );
    expect(found('.githooks/pre-commit')).toEqual(['ghcr.io/gitleaks/gitleaks']);
    expect(found('test/e2e/helpers.ts')).toContain('busybox');
    expect(found('test/e2e/wireguard.ts')).toEqual(['lscr.io/linuxserver/wireguard']);
  });

  it('can read every pinned tag, so that it can find a newer one', () => {
    const tags = new Map<string, string>(
      catalog.map((def) => [def.image.repo, def.image.tag]),
    );
    const wireguard = /'lscr\.io\/linuxserver\/wireguard:([^@']+)@/.exec(
      read('test/e2e/wireguard.ts'),
    );
    tags.set('lscr.io/linuxserver/wireguard', wireguard?.[1] ?? '');
    const versioned = new Set<string>();
    for (const rule of renovate.packageRules) {
      if (rule.versioning?.startsWith('regex:') !== true) continue;
      const re = new RegExp(rule.versioning.slice('regex:'.length));
      for (const name of rule.matchDepNames ?? []) {
        expect(tags.get(name), name).toMatch(re);
        versioned.add(name);
      }
    }
    // The rest are plain versions, which Renovate's Docker versioning reads.
    for (const [name, tag] of tags) {
      if (!versioned.has(name)) expect(tag, name).toMatch(/^v?\d+\.\d+\.\d+$/);
    }
  });

  it('never merges an app pin by itself, and says to regenerate the docs', () => {
    const rule = renovate.packageRules.find((r) =>
      r.matchFileNames?.includes('catalog/*/app.ts'),
    );
    expect(rule?.automerge).toBe(false);
    expect(rule?.prBodyNotes?.join(' ')).toContain('pnpm docs:generate');
  });
});
