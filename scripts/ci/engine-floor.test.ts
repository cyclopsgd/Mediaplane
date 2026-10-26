import { spawn, spawnSync } from 'node:child_process';
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

const SCRIPT = join(ROOT, 'scripts/ci/engine-floor.sh');

const boxes: string[] = [];
afterEach(() => {
  for (const box of boxes.splice(0)) rmSync(box, { recursive: true, force: true });
});

/**
 * A box for the script, with stand-ins for docker and sleep first on PATH, so no real
 * Docker is ever run. docker logs every call. `docker exec … docker version` answers as
 * `engine` says (`down`: the engine never comes up). The sleep stand-in waits a moment,
 * so a signal can arrive while the script waits for the engine.
 */
function box(engine: string) {
  const top = mkdtempSync(join(tmpdir(), 'mp-engine-floor-'));
  boxes.push(top);
  const bin = join(top, 'bin');
  const temp = join(top, 'tmp');
  mkdirSync(bin);
  mkdirSync(temp);
  const log = join(top, 'calls.log');
  writeFileSync(
    join(bin, 'docker'),
    `#!/bin/sh
echo "docker $*" >> '${log}'
case "$*" in
  *'exec '*' docker version --format '*)
    ${engine === 'down' ? 'exit 1' : `echo '${engine}'`} ;;
  *'exec '*' docker version') ${engine === 'down' ? 'exit 1' : 'exit 0'} ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexec /bin/sleep 0.03\n', { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH ?? ''}`, TMPDIR: temp };
  const calls = () =>
    existsSync(log) ? readFileSync(log, 'utf8').trimEnd().split('\n') : [];
  return { env, calls, temp };
}

/** The calls that clean up: the engine container with its volumes, and its network. */
const cleaned = (calls: string[]) => ({
  container: calls.some((c) =>
    /^docker rm --force --volumes mediaplane-floor-\d+$/.test(c),
  ),
  network: calls.some((c) => /^docker network rm mediaplane-floor-\d+$/.test(c)),
});

describe('scripts/ci/engine-floor.sh', () => {
  it('is executable, and plain sh', () => {
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
    expect(readFileSync(SCRIPT, 'utf8').split('\n')[0]).toBe('#!/bin/sh');
    expect(spawnSync('sh', ['-n', SCRIPT]).status).toBe(0);
  });

  it('refuses an engine that is not Docker Engine 24, and cleans up', () => {
    const sandbox = box('28.5.1');
    const result = spawnSync(SCRIPT, [], { encoding: 'utf8', env: sandbox.env });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FAIL: expected Docker Engine 24, got 28.5.1');
    const calls = sandbox.calls();
    // It went no further than the version: no Compose project, no bundled CLI.
    expect(calls.some((c) => /^docker run .*--rm/.test(c))).toBe(false);
    expect(cleaned(calls)).toEqual({ container: true, network: true });
    expect(readdirSync(sandbox.temp)).toEqual([]);
  });

  it("fails when the engine doesn't start, and cleans up", () => {
    const sandbox = box('down');
    const result = spawnSync(SCRIPT, [], {
      encoding: 'utf8',
      env: sandbox.env,
      timeout: 60_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("FAIL: Docker Engine didn't start");
    expect(cleaned(sandbox.calls())).toEqual({ container: true, network: true });
  });

  it.each([
    ['SIGTERM', 143],
    ['SIGINT', 130],
  ] as const)(
    'cleans up when it gets %s while waiting for the engine',
    async (signal, code) => {
      const sandbox = box('down');
      const child = spawn(SCRIPT, [], { env: sandbox.env, stdio: 'ignore' });
      const closed = new Promise<number | null>((done) => child.on('close', done));
      for (let waited = 0; waited < 100; waited++) {
        if (sandbox.calls().some((c) => c.includes('docker version'))) break;
        await new Promise((done) => setTimeout(done, 50));
      }
      child.kill(signal);
      await expect(closed).resolves.toBe(code);
      expect(cleaned(sandbox.calls())).toEqual({ container: true, network: true });
      expect(readdirSync(sandbox.temp)).toEqual([]);
    },
  );
});
