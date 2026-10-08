import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

describe('main', () => {
  it('runs as a real process and exits with the command status', () => {
    const main = fileURLToPath(new URL('./main.ts', import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', main, '--version'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });
});
