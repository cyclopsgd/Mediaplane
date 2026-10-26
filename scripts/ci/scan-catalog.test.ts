import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT } from '../root';

const SCRIPT = join(ROOT, 'scripts/ci/scan-catalog.sh');

/** What a scan of one image does, in turn, as Trivy would: its exit code or a finding. */
type Outcome = 'ok' | 'finding' | 'error' | 'killed';

const A = `registry.test/a:1.0.0@sha256:${'a'.repeat(64)}`;
const B = `registry.test/b:2.0.0@sha256:${'b'.repeat(64)}`;
const key = (image: string) => image.replaceAll(/[^A-Za-z0-9]/g, '_');

interface Options {
  /** Each image, with what its scans do in turn; the last one repeats. */
  images: Record<string, Outcome[]>;
  /** What the image list command prints, instead of the keys of `images`. */
  list?: string;
  /** The ignore-file command fails. */
  ignoreFails?: boolean;
}

const boxes: string[] = [];
afterEach(() => {
  for (const box of boxes.splice(0)) rmSync(box, { recursive: true, force: true });
});

/**
 * The script, run with stand-ins for docker, pnpm and sleep first on PATH, so that no
 * real Docker, no real Trivy and no waiting is ever involved. docker answers like
 * Trivy: `finding` exits with the `--exit-code` it was given, `error` with 1. Every
 * call is logged, and the ignore file each scan was given is read into the log.
 */
function run(options: Options, args: string[] = ['arm64']) {
  const top = mkdtempSync(join(tmpdir(), 'mp-scan-catalog-'));
  boxes.push(top);
  const bin = join(top, 'bin');
  const plans = join(top, 'plans');
  const home = join(top, 'home');
  const temp = join(top, 'tmp');
  for (const dir of [bin, plans, home, temp]) mkdirSync(dir);
  const log = join(top, 'calls.log');
  for (const [image, outcomes] of Object.entries(options.images)) {
    writeFileSync(join(plans, key(image)), outcomes.join('\n') + '\n');
  }
  const list = options.list ?? Object.keys(options.images).join('\n');
  writeFileSync(join(top, 'images'), list === '' ? '' : list + '\n');
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/sh
[ "$1" = run ] || { echo "docker $*" >> '${log}'; exit 99; }
image=
exitcode=
ignore=
prev=
for arg in "$@"; do
  case $prev in
    --exit-code) exitcode=$arg ;;
    --volume) case $arg in *:/ignore.yaml:ro) ignore=\${arg%:/ignore.yaml:ro} ;; esac ;;
  esac
  prev=$arg
  image=$arg
done
echo "docker-run $image exit-code=$exitcode" >> '${log}'
[ -z "$ignore" ] || sed "s|^|ignore-file $image: |" "$ignore" >> '${log}'
case " $* " in
  *' --platform linux/${args[0] ?? ''} '*'--ignorefile /ignore.yaml '*'--severity CRITICAL '*) ;;
  *) echo "docker-run $image: unexpected arguments" >> '${log}' ;;
esac
plan='${plans}'/$(printf %s "$image" | tr -c 'A-Za-z0-9' _)
outcome=$(head -n 1 "$plan")
if [ "$(wc -l < "$plan")" -gt 1 ]; then sed 1d "$plan" > "$plan.next"; mv "$plan.next" "$plan"; fi
case $outcome in
  ok) exit 0 ;;
  finding) exit "$exitcode" ;;
  killed) exit 137 ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, 'pnpm'),
    `#!/bin/sh
# pnpm --silent exec tsx scripts/ci/catalog-images.ts <arch> | ignore <image>
echo "pnpm $*" >> '${log}'
case "$5" in
  ignore)
    ${options.ignoreFails === true ? 'exit 1' : `printf 'vulnerabilities: [for %s]\\n' "$6"`} ;;
  *) cat '${join(top, 'images')}' ;;
esac
`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, 'sleep'), `#!/bin/sh\necho "sleep $*" >> '${log}'\n`, {
    mode: 0o755,
  });
  const result = spawnSync(SCRIPT, args, {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: home,
      TMPDIR: temp,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n') : [];
  return {
    code: result.status,
    out: result.stdout,
    err: result.stderr,
    calls,
    runs: (image: string) => calls.filter((c) => c.startsWith(`docker-run ${image} `)),
    sleeps: calls.filter((c) => c.startsWith('sleep ')),
    leftover: readdirSync(temp),
  };
}

const CLEAN = (arch: string) =>
  `No critical vulnerability with a fix in the catalog's images (linux/${arch}), but those listed in scripts/ci/catalog-ignore.yaml.`;

describe('scripts/ci/scan-catalog.sh', () => {
  it('is executable, and plain sh', () => {
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
    expect(readFileSync(SCRIPT, 'utf8').split('\n')[0]).toBe('#!/bin/sh');
    expect(spawnSync('sh', ['-n', SCRIPT]).status).toBe(0);
  });

  it('passes when every scan is clean, and scans each image once, without waiting', () => {
    const result = run({ images: { [A]: ['ok'], [B]: ['ok'] } });
    expect(result.code).toBe(0);
    expect(result.out).toContain(CLEAN('arm64'));
    expect(result.err).toBe('');
    expect(result.runs(A)).toEqual([`docker-run ${A} exit-code=3`]);
    expect(result.runs(B)).toEqual([`docker-run ${B} exit-code=3`]);
    expect(result.sleeps).toEqual(['sleep 0', 'sleep 0']);
    expect(result.calls.some((call) => call.includes('unexpected arguments'))).toBe(
      false,
    );
  });

  it('gives each image the ignore file of its own app, and cleans up after itself', () => {
    const result = run({ images: { [A]: ['ok'], [B]: ['ok'] } });
    expect(result.calls).toContain(`ignore-file ${A}: vulnerabilities: [for ${A}]`);
    expect(result.calls).toContain(`ignore-file ${B}: vulnerabilities: [for ${B}]`);
    expect(result.calls).toContain(
      `pnpm --silent exec tsx scripts/ci/catalog-images.ts ignore ${A}`,
    );
    expect(result.leftover).toEqual([]);
  });

  it('fails on a finding, without trying again, and still scans the other images', () => {
    const result = run({ images: { [A]: ['finding'], [B]: ['ok'] } });
    expect(result.code).toBe(1);
    expect(result.runs(A)).toHaveLength(1);
    expect(result.runs(B)).toHaveLength(1);
    expect(result.sleeps).toEqual(['sleep 0', 'sleep 0']);
    expect(result.err).toContain("catalog-ignore.yaml doesn't list (linux/arm64):");
    expect(result.err).toContain(`  ${A}`);
    expect(result.err).not.toContain(`  ${B}`);
    expect(result.err).not.toContain("couldn't be scanned");
    expect(result.out).not.toContain(CLEAN('arm64'));
  });

  it('tries a scan that errors twice more, after 15 and 45 seconds, then fails it', () => {
    const result = run({ images: { [A]: ['error'], [B]: ['ok'] } });
    expect(result.code).toBe(1);
    expect(result.runs(A)).toHaveLength(3);
    expect(result.sleeps).toEqual(['sleep 0', 'sleep 15', 'sleep 45', 'sleep 0']);
    expect(result.err).toContain("couldn't be scanned, three times (linux/arm64):");
    expect(result.err).toContain(`  ${A}`);
    expect(result.err).not.toContain('critical vulnerability');
    expect(result.out).not.toContain(CLEAN('arm64'));
  });

  it('counts any other exit code than 0 and 3 as a scan that did not happen', () => {
    // Docker's own failure to run Trivy, or a kill, is no clean scan.
    const result = run({ images: { [A]: ['killed'] } });
    expect(result.code).toBe(1);
    expect(result.runs(A)).toHaveLength(3);
    expect(result.err).toContain("couldn't be scanned");
    expect(result.out).not.toContain(CLEAN('arm64'));
  });

  it('passes an image whose scan errors, then succeeds', () => {
    const once = run({ images: { [A]: ['error', 'ok'], [B]: ['ok'] } });
    expect(once.code).toBe(0);
    expect(once.runs(A)).toHaveLength(2);
    expect(once.sleeps).toEqual(['sleep 0', 'sleep 15', 'sleep 0']);
    expect(once.out).toContain(CLEAN('arm64'));
    const twice = run({ images: { [A]: ['error', 'error', 'ok'] } });
    expect(twice.code).toBe(0);
    expect(twice.runs(A)).toHaveLength(3);
  });

  it('fails an image whose scan errors, then finds something', () => {
    const result = run({ images: { [A]: ['error', 'finding'] } });
    expect(result.code).toBe(1);
    expect(result.runs(A)).toHaveLength(2);
    expect(result.err).toContain("catalog-ignore.yaml doesn't list");
    expect(result.err).not.toContain("couldn't be scanned");
  });

  it('says both when one image has a finding and another could not be scanned', () => {
    const result = run({ images: { [A]: ['finding'], [B]: ['error'] } });
    expect(result.code).toBe(1);
    expect(result.err).toContain("doesn't list");
    expect(result.err).toContain("couldn't be scanned");
  });

  it('fails, scanning nothing, when the catalog has no image for the architecture', () => {
    const result = run({ images: {}, list: '' });
    expect(result.code).toBe(1);
    expect(result.err).toContain('no catalog images for arm64');
    expect(result.runs(A)).toEqual([]);
    expect(result.calls.some((call) => call.startsWith('docker'))).toBe(false);
  });

  it("stops when an image's ignore file can't be made, and scans nothing", () => {
    const result = run({ images: { [A]: ['ok'] }, ignoreFails: true });
    expect(result.code).not.toBe(0);
    expect(result.out).not.toContain(CLEAN('arm64'));
    expect(result.runs(A)).toEqual([]);
    expect(result.leftover).toEqual([]);
  });

  it('takes one architecture, and scans for it', () => {
    const amd64 = run({ images: { [A]: ['ok'] } }, ['amd64']);
    expect(amd64.code).toBe(0);
    expect(amd64.out).toContain(CLEAN('amd64'));
    expect(amd64.calls).toContain(
      'pnpm --silent exec tsx scripts/ci/catalog-images.ts amd64',
    );
    expect(amd64.calls.some((call) => call.includes('unexpected arguments'))).toBe(false);
    for (const args of [[], ['arm64', 'amd64']]) {
      const result = run({ images: { [A]: ['ok'] } }, args);
      expect(result.code).toBe(1);
      expect(result.err).toContain('usage:');
      expect(result.calls).toEqual([]);
    }
  });
});
