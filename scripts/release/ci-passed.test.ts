import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDirSync } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../root';

const SCRIPT = join(ROOT, 'scripts/release/ci-passed.sh');
const SHA = 'a'.repeat(40);

/**
 * ci-passed.sh with a stand-in for gh, first on PATH, that answers each call with the
 * next of `answers` (the check runs, as the script's --jq gives them), the last one again
 * after that, and logs its arguments.
 */
function run(answers: object[][], minutes = '1') {
  const dir = tempDirSync('mp-ci-passed-');
  answers.forEach((answer, i) => {
    writeFileSync(join(dir, `answer-${String(i)}`), JSON.stringify(answer));
  });
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${dir}/calls'
n=$(cat '${dir}/n' 2>/dev/null || echo 0)
[ -e "${dir}/answer-$n" ] || n=${String(answers.length - 1)}
echo $((n + 1)) > '${dir}/n'
cat "${dir}/answer-$n"
`,
    { mode: 0o755 },
  );
  const result = spawnSync(SCRIPT, [SHA, minutes], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      GITHUB_REPOSITORY: 'owner/repo',
      MEDIAPLANE_TEST_POLL_SECONDS: '0',
    },
  });
  const calls = readFileSync(join(dir, 'calls'), 'utf8').trimEnd().split('\n');
  return { code: result.status, out: result.stdout, err: result.stderr, calls };
}

const passed = { status: 'completed', conclusion: 'success' };
const failed = { status: 'completed', conclusion: 'failure' };
const running = { status: 'in_progress', conclusion: null };

describe('ci-passed.sh', () => {
  it("asks GitHub for CI's last job on the commit", () => {
    const result = run([[passed]]);
    expect(result.calls).toEqual([
      `api repos/owner/repo/commits/${SHA}/check-runs?check_name=All%20checks%20passed&app_id=15368&per_page=100 --jq [.check_runs[] | {status, conclusion}]`,
    ]);
  });

  it('passes once one run has passed, a failed one before it or not', () => {
    expect(run([[failed, passed]]).code).toBe(0);
  });

  it('waits while CI runs, then passes', () => {
    const result = run([[], [running], [running, passed]]);
    expect(result.code).toBe(0);
    expect(result.calls).toHaveLength(3);
    expect(result.out).toContain(`CI passed on ${SHA}.`);
  });

  it('fails at once when every run finished without passing', () => {
    const result = run([[failed, { status: 'completed', conclusion: 'cancelled' }]]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("didn't pass on");
    expect(result.calls).toHaveLength(1);
  });

  it('fails once its time is up, with none passed', () => {
    const result = run([[running]], '0');
    expect(result.code).toBe(1);
    expect(result.err).toContain('within 0 minutes, so nothing is published');
  });

  it('refuses what is not a commit sha, asking GitHub nothing', () => {
    // A stand-in gh first on PATH, which fails and logs: never the real one.
    const dir = tempDirSync('mp-ci-passed-');
    writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$*" >> '${dir}/calls'\nexit 1\n`, {
      mode: 0o755,
    });
    const result = spawnSync(SCRIPT, ['main'], {
      encoding: 'utf8',
      env: { PATH: `${dir}:${process.env.PATH ?? ''}`, GITHUB_REPOSITORY: 'owner/repo' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('"main" is not a commit sha');
    expect(existsSync(join(dir, 'calls'))).toBe(false);
  });

  it.each([['abc1234'], ['a'.repeat(39)], ['a'.repeat(41)], ['A'.repeat(40)]])(
    'refuses %s: a commit sha is exactly 40 lowercase hex characters',
    (sha) => {
      const dir = tempDirSync('mp-ci-passed-');
      writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$*" >> '${dir}/calls'\nexit 1\n`, {
        mode: 0o755,
      });
      const result = spawnSync(SCRIPT, [sha], {
        encoding: 'utf8',
        env: {
          PATH: `${dir}:${process.env.PATH ?? ''}`,
          GITHUB_REPOSITORY: 'owner/repo',
        },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('is not a commit sha');
      expect(existsSync(join(dir, 'calls'))).toBe(false);
    },
  );
});
