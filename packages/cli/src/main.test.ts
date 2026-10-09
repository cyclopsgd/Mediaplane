import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));
// Real Docker, but never the real stack: plan only reads, under its own project name.
const ENV = {
  ...process.env,
  MEDIAPLANE_COMPOSE_PROJECT: `mediaplane-test-${process.pid}`,
};

function stackFor(data: string): string {
  return `version: 1
user: { uid: ${process.getuid?.() ?? 1000}, gid: ${process.getgid?.() ?? 1000} }
paths: { data: ${data} }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
`;
}

function spawnMain(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', MAIN, ...args], {
    encoding: 'utf8',
    env: ENV,
  });
}

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'mediaplane-main-'));
  mkdirSync(join(home, 'data'));
  writeFileSync(join(home, 'stack.yaml'), stackFor(join(home, 'data')));
  return home;
}

describe('main', () => {
  it('runs as a real process and exits with the command status', () => {
    const result = spawnMain('--version');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });

  it('exits 1 for a plan that fails, with nothing on stdout', () => {
    const home = mkdtempSync(join(tmpdir(), 'mediaplane-main-'));
    const result = spawnMain('plan', '--home', home);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('exits 2 for a plan that would change something', () => {
    const result = spawnMain('plan', '--home', freshHome());
    expect(result.stderr).not.toContain('error:');
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('+ generated/compose.yaml');
    expect(result.stdout).toContain('  + create    sonarr\n');
  });

  it('keeps the plan exit code when stdout is closed early', () => {
    const home = freshHome();
    const result = spawnSync(
      'bash',
      [
        '-c',
        `"${process.execPath}" --import tsx "${MAIN}" plan --home "${home}" | head -1; echo "status=\${PIPESTATUS[0]}"`,
      ],
      { encoding: 'utf8', env: ENV },
    );
    expect(result.stdout).toContain('status=2');
    expect(result.stderr).not.toContain('EPIPE');
  });
});
