import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  qbittorrent: {}
`;

function spawnMain(...args: string[]) {
  const main = fileURLToPath(new URL('./main.ts', import.meta.url));
  return spawnSync(process.execPath, ['--import', 'tsx', main, ...args], {
    encoding: 'utf8',
  });
}

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'mediaplane-main-'));
  mkdirSync(join(home, 'secrets'));
  writeFileSync(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key-for-tests\n');
  writeFileSync(join(home, 'stack.yaml'), STACK);
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

  it('exits 2 for a plan that would write files', () => {
    const home = freshHome();
    const result = spawnMain('plan', '--home', home);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain('+ generated/compose.yaml');
  });

  it('keeps the plan exit code when stdout is closed early', () => {
    const home = freshHome();
    const main = fileURLToPath(new URL('./main.ts', import.meta.url));
    const result = spawnSync(
      'bash',
      [
        '-c',
        `"${process.execPath}" --import tsx "${main}" plan --home "${home}" | head -1; echo "status=\${PIPESTATUS[0]}"`,
      ],
      { encoding: 'utf8' },
    );
    expect(result.stdout).toContain('status=2');
    expect(result.stderr).not.toContain('EPIPE');
  });
});
