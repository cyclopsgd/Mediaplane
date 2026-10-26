import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDirSync } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../root';

const SCRIPT = join(ROOT, 'scripts/ci/build-image.sh');
const BUILDKIT = /^BUILDKIT=(\S+)$/m.exec(readFileSync(SCRIPT, 'utf8'))?.[1] ?? '';
const NAME = 'ghcr.io/owner/mediaplane';
const SCANNED = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;
const PUSHED = `sha256:${'c'.repeat(64)}`;

/** An image index: each of `images` as `arch` and its digest, and an attestation. */
const index = (...images: [string, string][]) =>
  JSON.stringify({
    manifests: [
      ...images.map(([arch, digest]) => ({
        digest,
        platform: { os: 'linux', architecture: arch },
      })),
      { digest: OTHER, platform: { os: 'unknown', architecture: 'unknown' } },
    ],
  });

interface Options {
  /** The index of the image built (and of the one built again, pushed). */
  built?: string;
  /** What `imagetools inspect --raw` answers for the image pushed. */
  pushedIndex?: string;
  /** What `buildx inspect` prints for the builder: absent when not given. */
  builder?: string;
  /** Files in the out folder before the run, by name. */
  before?: Record<string, string>;
  failBuild?: boolean;
}

/**
 * build-image.sh with a stand-in for docker, first on PATH, which logs every call, has
 * the builder `options.builder` describes, and answers `buildx build` the way BuildKit
 * does: an OCI layout for an oci output, the pushed digest in the metadata for an image
 * output. The real docker, BuildKit and any registry are never reached.
 */
function run(args: (out: string) => string[], options: Options = {}) {
  const dir = tempDirSync('mp-build-image-');
  const out = join(dir, 'out');
  mkdirSync(out);
  for (const [name, content] of Object.entries(options.before ?? {})) {
    writeFileSync(join(out, name), content);
  }
  writeFileSync(
    join(dir, 'index.json'),
    options.built ?? index(['arm64', SCANNED], ['amd64', OTHER]),
  );
  writeFileSync(
    join(dir, 'push.json'),
    JSON.stringify({ 'containerimage.digest': PUSHED }),
  );
  writeFileSync(
    join(dir, 'pushed-index.json'),
    options.pushedIndex ?? index(['arm64', SCANNED]),
  );
  if (options.builder !== undefined) writeFileSync(join(dir, 'builder'), options.builder);
  writeFileSync(
    join(dir, 'docker'),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${dir}/calls'
case "$1 $2" in
  'buildx inspect') [ -e '${dir}/builder' ] && cat '${dir}/builder'; exit $? ;;
  'buildx imagetools') cat '${dir}/pushed-index.json' ;;
  'buildx build')
    ${options.failBuild === true ? 'exit 1' : ''}
    shift 2
    while [ $# -gt 0 ]; do
      case "$1" in
        --metadata-file) meta=$2; shift ;;
        --output) output=$2; shift ;;
      esac
      shift
    done
    case "$output" in
      type=oci,*)
        dest=\${output#*dest=}; dest=\${dest%%,*}
        mkdir -p "$dest/blobs/sha256"
        cp '${dir}/index.json' "$dest/blobs/sha256/idx"
        echo '{"manifests":[{"digest":"sha256:idx"}]}' > "$dest/index.json"
        echo '{}' > "$meta" ;;
      type=image,*) cp '${dir}/push.json' "$meta" ;;
    esac ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  const result = spawnSync(SCRIPT, args(out), {
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH ?? ''}` },
  });
  const log = join(dir, 'calls');
  const file = (name: string) =>
    existsSync(join(out, name)) ? readFileSync(join(out, name), 'utf8') : undefined;
  return {
    code: result.status,
    out: result.stdout,
    err: result.stderr,
    calls: existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n') : [],
    file,
  };
}

const builds = (calls: string[]) => calls.filter((c) => c.startsWith('buildx build'));
const withPinned = `Driver Options:        image="${BUILDKIT}"\n`;

describe('build-image.sh, building', () => {
  it('writes the OCI layout and the digest of the one image for the architecture', () => {
    const result = run((out) => ['arm64', out]);
    expect(result.code, result.err).toBe(0);
    expect(result.file('digest')).toBe(`${SCANNED}\n`);
    expect(result.file('oci/index.json')).toBeDefined();
    expect(result.out).toContain(`Built linux/arm64: ${SCANNED}`);
    expect(builds(result.calls)).toHaveLength(1);
    expect(builds(result.calls)[0]).toContain('--platform linux/arm64');
  });

  it('clears what an earlier build left, whether this one works or not', () => {
    const result = run((out) => ['arm64', out], {
      failBuild: true,
      before: { digest: `${OTHER}\n`, 'oci.json': '{}', pushed: PUSHED },
    });
    expect(result.code).not.toBe(0);
    expect(result.file('digest')).toBeUndefined();
    expect(result.file('oci.json')).toBeUndefined();
  });

  it.each([
    ['none', index(['amd64', OTHER])],
    ['two', index(['arm64', SCANNED], ['arm64', OTHER])],
  ])(
    'refuses an index with %s images for the architecture, writing no digest',
    (_n, built) => {
      const result = run((out) => ['arm64', out], { built });
      expect(result.code).not.toBe(0);
      expect(result.err).toContain('not one linux/arm64 image');
      expect(result.file('digest')).toBeUndefined();
    },
  );
});

describe('build-image.sh, its usage', () => {
  it.each([
    ['no arguments', () => []],
    ['one', () => ['arm64']],
    ['three', (out: string) => ['arm64', out, '--push']],
    ['another flag than --push', (out: string) => ['arm64', out, '--tag', NAME]],
  ])('refuses %s, running no docker', (_name, args) => {
    const result = run(args);
    expect(result.code).toBe(1);
    expect(result.err).toContain('usage:');
    expect(result.calls).toEqual([]);
  });

  it('refuses an architecture other than amd64 and arm64', () => {
    const result = run((out) => ['riscv64', out]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('the architecture is amd64 or arm64, not "riscv64"');
    expect(result.calls).toEqual([]);
  });
});

describe('build-image.sh --push', () => {
  const push = (out: string) => ['arm64', out, '--push', NAME];
  const built = { before: { digest: `${SCANNED}\n` }, builder: withPinned };

  it('pushes by digest the image built before, and writes what it pushed', () => {
    const result = run(push, built);
    expect(result.code, result.err).toBe(0);
    expect(result.file('pushed')).toBe(`${PUSHED}\n`);
    expect(builds(result.calls)[0]).toContain(
      `--output type=image,name=${NAME},push-by-digest=true,name-canonical=true,push=true,rewrite-timestamp=true`,
    );
    expect(result.calls).toContain(
      `buildx imagetools inspect --builder mediaplane-release --raw ${NAME}@${PUSHED}`,
    );
    expect(result.out).toContain(`Pushed linux/arm64, ${SCANNED}, as ${NAME}@${PUSHED}`);
  });

  it('refuses to push before a build, pushing nothing', () => {
    const result = run(push, { builder: withPinned });
    expect(result.code).toBe(1);
    expect(result.err).toContain('nothing built in');
    expect(builds(result.calls)).toEqual([]);
    expect(result.file('pushed')).toBeUndefined();
  });

  it('refuses to push after an empty digest', () => {
    const result = run(push, { builder: withPinned, before: { digest: '' } });
    expect(result.code).toBe(1);
    expect(result.err).toContain('nothing built in');
    expect(builds(result.calls)).toEqual([]);
  });

  it('refuses an image pushed that is not the one scanned, writing nothing', () => {
    const result = run(push, {
      ...built,
      pushedIndex: index(['arm64', OTHER]),
      before: { ...built.before, pushed: `${OTHER}\n` },
    });
    expect(result.code).toBe(1);
    expect(result.err).toContain(
      `pushed linux/arm64 as ${OTHER}, not the image scanned, ${SCANNED}: nothing is tagged`,
    );
    expect(result.file('pushed')).toBeUndefined();
  });

  it('refuses a pushed index without exactly one image for the architecture', () => {
    const result = run(push, { ...built, pushedIndex: index(['amd64', SCANNED]) });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('not one linux/arm64 image');
    expect(result.file('pushed')).toBeUndefined();
  });
});

describe('build-image.sh, its builder', () => {
  const create = (calls: string[]) => calls.filter((c) => c.startsWith('buildx create'));
  const removed = (calls: string[]) => calls.filter((c) => c.startsWith('buildx rm'));

  it('makes it with the pinned BuildKit when there is none', () => {
    expect(BUILDKIT).toMatch(/^moby\/buildkit:v[\d.]+@sha256:[0-9a-f]{64}$/);
    const result = run((out) => ['arm64', out]);
    expect(create(result.calls)).toEqual([
      `buildx create --name mediaplane-release --driver docker-container --driver-opt image=${BUILDKIT} --bootstrap`,
    ]);
  });

  it('keeps the one that runs the pinned BuildKit', () => {
    const result = run((out) => ['arm64', out], { builder: withPinned });
    expect(create(result.calls)).toEqual([]);
    expect(removed(result.calls)).toEqual([]);
  });

  it('makes it afresh when it runs another BuildKit, such as an earlier pin', () => {
    const result = run((out) => ['arm64', out], {
      builder: `Driver Options:        image="moby/buildkit:v0.1.0@sha256:${'0'.repeat(64)}"\n`,
    });
    expect(removed(result.calls)).toEqual(['buildx rm mediaplane-release']);
    expect(create(result.calls)).toHaveLength(1);
    expect(result.calls.indexOf('buildx rm mediaplane-release')).toBeLessThan(
      result.calls.findIndex((c) => c.startsWith('buildx create')),
    );
  });
});
