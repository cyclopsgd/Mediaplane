import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDirSync } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
// Real Docker, but never the real stack: plan only reads, under its own project name.
const ENV = {
  ...process.env,
  MEDIAPLANE_COMPOSE_PROJECT: `mediaplane-test-${process.pid}`,
};

/** Whether nothing listens on `port` on this host's loopback: bound once, then let go. */
function isFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once('error', () => {
      done(false);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close(() => {
        done(true);
      });
    });
  });
}

/**
 * Ports nothing on this host listens on, chosen right before each spawn, so the spawned
 * plan passes preflight even on a machine that runs a real stack on the default ports.
 * They are outside the kernel's range for ports it picks itself (32768 and up on Linux):
 * the other test files' fake apps listen on port 0 meanwhile, and get theirs from there.
 */
async function freePorts(): Promise<{
  sonarr: number;
  qbittorrent: number;
  jellyfin: number;
}> {
  const ports: number[] = [];
  while (ports.length < 3) {
    const port = 20_000 + Math.floor(Math.random() * 10_000);
    if (!ports.includes(port) && (await isFree(port))) ports.push(port);
  }
  const [sonarr = 0, qbittorrent = 0, jellyfin = 0] = ports;
  return { sonarr, qbittorrent, jellyfin };
}

async function stackFor(data: string): Promise<string> {
  const ports = await freePorts();
  return `version: 1
user: { uid: ${String(process.getuid?.() ?? 1000)}, gid: ${String(process.getgid?.() ?? 1000)} }
paths: { data: ${data} }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: { port: ${String(ports.sonarr)} }
  qbittorrent: { vpn: false, port: ${String(ports.qbittorrent)} }
  jellyfin: { port: ${String(ports.jellyfin)} }
`;
}

function spawnMain(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', MAIN, ...args], {
    encoding: 'utf8',
    env: ENV,
  });
}

async function freshHome(): Promise<string> {
  const home = tempDirSync('mediaplane-main-');
  mkdirSync(join(home, 'data'));
  writeFileSync(join(home, 'stack.yaml'), await stackFor(join(home, 'data')));
  return home;
}

// These tests spawn the real CLI through tsx, and the plan ones call Docker: a cold CI
// runner needs well over the default 5 s.
describe('main', { timeout: 60_000 }, () => {
  it('runs as a real process and exits with the command status', () => {
    const result = spawnMain('--version');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });

  it('exits 1 for a plan that fails, with nothing on stdout', () => {
    const home = tempDirSync('mediaplane-main-');
    const result = spawnMain('plan', '--home', home);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('exits 2 for a plan that would change something', async () => {
    const result = spawnMain('plan', '--home', await freshHome());
    // What the plan said, should it fail: a port in use, or Docker.
    expect(result.stderr).not.toContain('error:');
    expect(result.status, result.stderr).toBe(2);
    expect(result.stdout).toContain('+ generated/compose.yaml');
    expect(result.stdout).toContain('  + create    sonarr\n');
  });

  it('keeps the plan exit code when stdout is closed early', async () => {
    const home = await freshHome();
    const result = spawnSync(
      'bash',
      [
        '-c',
        `"${process.execPath}" --import tsx "${MAIN}" plan --home "${home}" | head -1; echo "status=\${PIPESTATUS[0]}"`,
      ],
      { encoding: 'utf8', env: ENV },
    );
    expect(result.stdout, result.stderr).toContain('status=2');
    expect(result.stderr).not.toContain('EPIPE');
  });
});
