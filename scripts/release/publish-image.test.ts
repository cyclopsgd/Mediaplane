import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDirSync } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../root';

const SCRIPT = join(ROOT, 'scripts/release/publish-image.sh');
const NAME = 'ghcr.io/owner/mediaplane';
const AMD64 = `sha256:${'1'.repeat(64)}`;
const ARM64 = `sha256:${'2'.repeat(64)}`;
const INDEX = `sha256:${'3'.repeat(64)}`;

/** An image index with one entry per `platforms` item: `os/arch`, or `unknown` for an attestation. */
const index = (...platforms: string[]) =>
  JSON.stringify({
    manifests: platforms.map((platform) => {
      const [os = 'unknown', architecture = 'unknown'] = platform.split('/');
      return { platform: { os, architecture } };
    }),
  });

interface Options {
  /** What `imagetools inspect --raw` answers. */
  raw?: string;
  /** What `imagetools inspect --format {{.Manifest.Digest}}` answers. */
  digest?: string;
  version?: string;
  /** The digests the architectures pushed, one file each. */
  pushed?: string[];
  args?: string[];
}

/**
 * publish-image.sh with a stand-in for docker, first on PATH: it logs every call, has no
 * builder of its own (so the script uses Docker's default), and answers the two inspects
 * from `options`. The real docker, and any registry, are never reached.
 */
function run(options: Options = {}) {
  const dir = tempDirSync('mp-publish-image-');
  writeFileSync(join(dir, 'raw'), options.raw ?? index('linux/amd64', 'linux/arm64'));
  writeFileSync(join(dir, 'digest'), `${options.digest ?? INDEX}\n`);
  writeFileSync(
    join(dir, 'docker'),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${dir}/calls'
case "$*" in
  'buildx inspect mediaplane-release') exit 1 ;;
  *'imagetools inspect'*'--raw'*) cat '${dir}/raw' ;;
  *'imagetools inspect'*'--format'*) cat '${dir}/digest' ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  const files = (options.pushed ?? [AMD64, ARM64]).map((digest, i) => {
    const file = join(dir, `pushed-${String(i)}`);
    writeFileSync(file, `${digest}\n`);
    return file;
  });
  const out = join(dir, 'published');
  const result = spawnSync(
    SCRIPT,
    options.args ?? [NAME, options.version ?? '0.1.0', out, ...files],
    { encoding: 'utf8', env: { PATH: `${dir}:${process.env.PATH ?? ''}` } },
  );
  const log = join(dir, 'calls');
  return {
    code: result.status,
    out: result.stdout,
    err: result.stderr,
    calls: existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n') : [],
    published: existsSync(out) ? readFileSync(out, 'utf8') : undefined,
  };
}

describe('publish-image.sh', () => {
  it('tags one index of the images pushed, and writes the image by digest', () => {
    const result = run();
    expect(result.code, result.err).toBe(0);
    expect(result.calls).toContain(
      `buildx imagetools create --builder default --tag ${NAME}:0.1.0 ${NAME}@${AMD64} ${NAME}@${ARM64}`,
    );
    expect(result.published).toBe(`${NAME}:0.1.0@${INDEX}\n`);
    expect(result.out).toContain(`Published ${NAME}:0.1.0@${INDEX}, for amd64 arm64`);
    // Never a tag but the version's.
    expect(result.calls.join('\n')).not.toContain('latest');
  });

  it("ignores the index's attestations, which are no linux image", () => {
    const result = run({
      raw: index('linux/amd64', 'linux/arm64', 'unknown/unknown', 'unknown/unknown'),
    });
    expect(result.code, result.err).toBe(0);
  });

  it('refuses a call without the images pushed, running no docker', () => {
    const result = run({ args: [NAME, '0.1.0', '/dev/null'] });
    expect(result.code).toBe(1);
    expect(result.err).toContain('usage:');
    expect(result.calls).toEqual([]);
  });

  it.each([
    ['missing', (file: string) => `${file}.missing`],
    [
      'empty',
      (file: string) => {
        writeFileSync(file, '');
        return file;
      },
    ],
  ])('refuses a pushed-digest file that is %s, running no docker', (_what, spoil) => {
    const dir = tempDirSync('mp-publish-image-files-');
    const amd64 = join(dir, 'amd64');
    writeFileSync(amd64, `${AMD64}\n`);
    const arm64 = spoil(join(dir, 'arm64'));
    const result = run({ args: [NAME, '0.1.0', join(dir, 'published'), amd64, arm64] });
    expect(result.code).toBe(1);
    expect(result.err).toContain(`no digest in ${arm64}, the file of an image pushed`);
    expect(result.calls).toEqual([]);
    expect(existsSync(join(dir, 'published'))).toBe(false);
  });

  it.each([
    ['v0.1.0'],
    ['1'],
    ['1.2'],
    ['1.2.3.4'],
    ['1..3'],
    ['.1.2'],
    ['1.2.'],
    ['1.2.x'],
  ])('refuses the version "%s", running no docker', (version) => {
    const result = run({ version });
    expect(result.code).toBe(1);
    expect(result.err).toContain('the version is <major>.<minor>.<patch>');
    expect(result.calls).toEqual([]);
    expect(result.published).toBeUndefined();
  });

  it('refuses an empty version', () => {
    const result = run({ version: '' });
    expect(result.code).toBe(1);
    expect(result.err).toContain('the version is <major>.<minor>.<patch>');
    expect(result.calls).toEqual([]);
  });

  it('refuses an index that lacks one of the architectures pushed', () => {
    const result = run({ raw: index('linux/amd64', 'unknown/unknown') });
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      'holds linux images for "amd64", not one for each of the 2',
    );
    expect(result.published).toBeUndefined();
  });

  it('refuses an index with one architecture twice', () => {
    const result = run({ raw: index('linux/amd64', 'linux/amd64') });
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      'holds linux images for "amd64 amd64", not one for each',
    );
    expect(result.published).toBeUndefined();
  });

  it('refuses an index with an image more than were pushed', () => {
    const result = run({ raw: index('linux/amd64', 'linux/arm64', 'linux/riscv64') });
    expect(result.code).toBe(1);
    expect(result.err).toContain('not one for each of the 2 pushed');
    expect(result.published).toBeUndefined();
  });

  it.each([[''], ['<no value>'], ['md5:abc']])(
    'refuses the digest "%s", which is no sha256 digest',
    (digest) => {
      const result = run({ digest });
      expect(result.code).toBe(1);
      expect(result.err).toContain("couldn't read the digest of");
      expect(result.published).toBeUndefined();
    },
  );
});
