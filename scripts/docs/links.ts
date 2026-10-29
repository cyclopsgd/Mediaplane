import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** This repository's own files on GitHub: such a link is checked as a path in it. */
const REPO_FILE =
  /^https:\/\/(?:github\.com\/cyclopsgd\/Mediaplane\/(?:blob|tree)\/main|raw\.githubusercontent\.com\/cyclopsgd\/Mediaplane\/main)\/([^#?]*)/;

/**
 * Folders that hold no docs of the repository's own, skipped when the files can't be
 * listed from git (which leaves out the git-ignored folders itself).
 */
const SKIPPED = new Set([
  'node_modules',
  '.git',
  'coverage',
  'dist',
  '.claude',
  '.superpowers',
  '.mediaplane-dev',
]);

/**
 * The kinds of file whose mentions of a doc are checked, besides Markdown's links: not a
 * test, whose fixtures may name docs that don't exist.
 */
const CODE = /(?<!\.test)\.(ts|sh|ya?ml|json)$|^Dockerfile$/;

/** A doc named by its path from the repository root, as code and prose name one. */
const DOC_PATH = /(?<![\w./-])docs\/[\w./-]+\.(?:md|json)\b/g;

/**
 * The slices' plans: records of what was built, whose prose names files as they were then.
 * Their links are checked; their mentions of a path are not.
 */
const RECORDS = /^docs\/plans\/(?!m1-roadmap\.md$)/;

/** Markdown's inline links and images, and its reference definitions. */
const LINK =
  /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|^\s*\[[^\]]+\]:\s*<?(\S+?)>?\s*$/gm;

/** Every file under `root` but those in SKIPPED folders, by path from `root`. */
async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((path) => !path.split('/').some((part) => SKIPPED.has(part)));
}

/**
 * The repository's files, by path from `root`: those git tracks, and those it doesn't
 * that it wouldn't ignore, so a git-ignored folder (a worktree's scratch space) isn't
 * checked. Without git, or outside a repository, every file but those in SKIPPED folders.
 */
async function filesUnder(root: string): Promise<string[]> {
  let files: string[];
  try {
    const { stdout } = await exec(
      'git',
      ['ls-files', '-co', '--exclude-standard', '-z'],
      {
        cwd: root,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    files = [];
    for (const path of stdout.split('\0')) {
      // git lists a tracked file that was deleted, too.
      if (
        path !== '' &&
        (await stat(join(root, path)).catch(() => undefined))?.isFile()
      ) {
        files.push(path);
      }
    }
  } catch {
    files = await walk(root);
  }
  return files.sort();
}

/**
 * A Markdown file's text without its fenced code blocks, which quote files (a plan's
 * diffs) rather than link to them; with `inline`, without its code spans too.
 */
export function withoutCode(text: string, inline: boolean): string {
  let fence: string | undefined;
  return text
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence === undefined) {
        if (marker !== undefined) {
          fence = marker;
          return '';
        }
        return inline ? line.replace(/(`+)[^`]*?\1/g, '') : line;
      }
      const closes =
        marker !== undefined &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        line.trim() === marker;
      if (closes) fence = undefined;
      return '';
    })
    .join('\n');
}

/**
 * Where a link in `file` leads, as a path from `root`; undefined for one that leaves the
 * repository, or stays on its own page (#anchor).
 */
export function linkTarget(
  root: string,
  file: string,
  target: string,
): string | undefined {
  const own = REPO_FILE.exec(target);
  if (own !== null) return decodeURIComponent(own[1] ?? '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) return undefined;
  const path = decodeURIComponent(target.replace(/[#?].*$/, ''));
  if (path === '') return undefined;
  const from = path.startsWith('/') ? root : dirname(join(root, file));
  return relative(root, resolve(from, path.replace(/^\//, '')));
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every link in the repository's Markdown, and every doc its code or its prose names by
 * path (docs/…), that leads nowhere: as `<file>: <target>`, each once.
 */
export async function brokenLinks(root: string): Promise<string[]> {
  const broken = new Set<string>();
  for (const file of await filesUnder(root)) {
    const markdown = file.endsWith('.md');
    if (!markdown && !CODE.test(file.split('/').at(-1) ?? '')) continue;
    const text = await readFile(join(root, file), 'utf8');
    const targets = new Set<string>();
    if (markdown) {
      for (const match of withoutCode(text, true).matchAll(LINK)) {
        const target = match[1] ?? match[2] ?? '';
        const path = linkTarget(root, file, target);
        if (path !== undefined && !(await exists(join(root, path)))) {
          broken.add(`${file}: ${target}`);
        }
      }
    }
    if (!RECORDS.test(file)) {
      for (const match of (markdown ? withoutCode(text, false) : text).matchAll(
        DOC_PATH,
      )) {
        targets.add(match[0]);
      }
    }
    for (const path of targets) {
      if (!(await exists(join(root, path)))) broken.add(`${file}: ${path}`);
    }
  }
  return [...broken];
}
