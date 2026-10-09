import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../packages/cli/src/version';
import { bundle, packagesOf } from './bundle';

/** Run the bundle like the image does: no MEDIAPLANE_IMAGE, and never for over 20 s. */
function runBundle(file: string, args: string[]) {
  return spawnSync(process.execPath, [file, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, MEDIAPLANE_IMAGE: '' },
  });
}

describe('bundle', () => {
  it('builds one executable file that runs the CLI, with the licences it needs', async () => {
    const out = await mkdtemp(join(tmpdir(), 'mediaplane-bundle-'));
    try {
      const { file, packages } = await bundle(out);
      expect(packages).toEqual(['commander', 'diff', 'yaml', 'zod']);
      expect((await stat(file)).mode & 0o111).not.toBe(0);
      expect((await readFile(file, 'utf8')).startsWith('#!/usr/bin/env node\n')).toBe(
        true,
      );

      const version = runBundle(file, ['--version']);
      expect(version.stderr).toBe('');
      expect(version.stdout.trim()).toBe(VERSION);
      const missing = runBundle(file, ['plan', '--home', join(out, 'none')]);
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('no stack.yaml');

      // The hidden command the host helper runs from the image: `mediaplane host-report`.
      const request = JSON.stringify({
        facts: false,
        stat: [{ key: '/srv/data', at: out }],
        free: [],
        ports: [],
      });
      const report = runBundle(file, ['host-report', request]);
      expect(report.stderr).toBe('');
      expect(JSON.parse(report.stdout)).toMatchObject({
        schema: 'mediaplane.host-report/v1',
        stat: { '/srv/data': { isDirectory: true } },
      });

      const licences = await readFile(join(out, 'THIRD-PARTY-LICENSES.txt'), 'utf8');
      for (const name of packages) expect(licences).toContain(`== ${name} ==`);
      expect(licences).toContain('Permission is hereby granted');
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('packagesOf', () => {
  it("names each bundled file's package, scoped or not, through pnpm's store", () => {
    expect(
      packagesOf([
        'packages/engine/src/index.ts',
        'node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/core.js',
        'node_modules/.pnpm/zod@4.6.5/node_modules/zod/index.js',
        'node_modules/.pnpm/@scope+thing@1.0.0/node_modules/@scope/thing/lib/a.js',
      ]),
    ).toEqual(
      new Map([
        [
          '@scope/thing',
          'node_modules/.pnpm/@scope+thing@1.0.0/node_modules/@scope/thing',
        ],
        ['zod', 'node_modules/.pnpm/zod@4.6.5/node_modules/zod'],
      ]),
    );
  });
});
