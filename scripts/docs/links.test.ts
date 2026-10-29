import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { tempDir } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { brokenLinks, linkTarget, withoutCode } from './links';

const exec = promisify(execFile);

/** A repository of `files`, by path, in a folder of its own. */
async function repo(files: Record<string, string>): Promise<string> {
  const root = await tempDir('mediaplane-links-');
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

describe('withoutCode', () => {
  it("drops fenced blocks, a longer fence's too, and with `inline` code spans", () => {
    const text = [
      'a [x](one.md) `[y](two.md)`',
      '```text',
      '[z](three.md)',
      '```',
      '````markdown',
      '```',
      '[w](four.md)',
      '````',
      'b',
    ].join('\n');
    expect(withoutCode(text, true)).toBe('a [x](one.md) \n\n\n\n\n\n\n\nb');
    expect(withoutCode(text, false)).toContain('`[y](two.md)`');
  });
});

describe('linkTarget', () => {
  it('resolves a link from its file, and a repo URL from the root; skips the rest', () => {
    expect(linkTarget('/r', 'docs/a/b.md', '../c.md#part')).toBe('docs/c.md');
    expect(linkTarget('/r', 'docs/a/b.md', '/README.md')).toBe('README.md');
    expect(
      linkTarget(
        '/r',
        'README.md',
        'https://github.com/cyclopsgd/Mediaplane/blob/main/docs/x%20y.md',
      ),
    ).toBe('docs/x y.md');
    expect(linkTarget('/r', 'README.md', 'https://example.com/a.md')).toBeUndefined();
    expect(linkTarget('/r', 'README.md', '#anchor')).toBeUndefined();
    expect(linkTarget('/r', 'README.md', 'mailto:someone@example.com')).toBeUndefined();
  });
});

describe('brokenLinks', () => {
  it('finds each link and each docs/ path that leads nowhere, and nothing else', async () => {
    const root = await repo({
      'README.md': [
        '[ok](docs/a.md) [gone](docs/gone.md)',
        '[ref]: docs/also-gone.md',
        '[site](https://github.com/cyclopsgd/Mediaplane/blob/main/docs/missing.md)',
        'Named in prose: docs/a.md, and docs/prose-gone.md.',
        '```text',
        '[quoted](docs/quoted.md) docs/quoted.md',
        '```',
      ].join('\n'),
      'docs/a.md': '[up](../README.md)',
      'packages/x/src/y.ts':
        "// see docs/a.md and docs/code-gone.md\nconst z = 'docs/a.md';\n",
      // A plan is a record: its prose names files as they were, but its links lead on.
      'docs/plans/m1/m1-s1-x.md': 'docs/old.md [roadmap](../m1-roadmap.md)',
      'docs/plans/m1-roadmap.md': 'docs/roadmap-gone.md',
      'node_modules/z/README.md': '[none](nowhere.md)',
    });
    expect(await brokenLinks(root)).toEqual([
      'README.md: docs/gone.md',
      'README.md: docs/also-gone.md',
      'README.md: https://github.com/cyclopsgd/Mediaplane/blob/main/docs/missing.md',
      'README.md: docs/prose-gone.md',
      'docs/plans/m1-roadmap.md: docs/roadmap-gone.md',
      'packages/x/src/y.ts: docs/code-gone.md',
    ]);
  });
});

describe('brokenLinks: which files it checks', () => {
  it("leaves out what git ignores, and checks a file that is untracked but isn't ignored", async () => {
    const root = await repo({
      '.gitignore': 'scratch/\n',
      'docs/a.md': '[ok](../README.md)',
      'README.md': 'x',
      'scratch/notes.md': '[ignored](nowhere.md)',
      'docs/new.md': '[untracked](nowhere.md)',
    });
    await exec('git', ['init', '--quiet'], { cwd: root });
    expect(await brokenLinks(root)).toEqual(['docs/new.md: nowhere.md']);
  });

  it('leaves out a tracked file that is no longer there', async () => {
    const root = await repo({ 'docs/gone.md': '[x](nowhere.md)', 'README.md': 'x' });
    await exec('git', ['init', '--quiet'], { cwd: root });
    await exec('git', ['add', '-A'], { cwd: root });
    await rm(join(root, 'docs/gone.md'));
    expect(await brokenLinks(root)).toEqual([]);
  });

  it('without git, walks the folder and skips the tooling folders', async () => {
    const root = await repo({
      'README.md': '[gone](nowhere.md)',
      '.superpowers/sdd/plan.md': '[gone](nowhere.md)',
      '.mediaplane-dev/notes.md': '[gone](nowhere.md)',
      '.claude/worktrees/x/README.md': '[gone](nowhere.md)',
    });
    expect(await brokenLinks(root)).toEqual(['README.md: nowhere.md']);
  });
});
