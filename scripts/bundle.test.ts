import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../packages/cli/src/version';
import { bundle, packagesOf } from './bundle';

describe('bundle', () => {
  it('builds one executable file that runs the CLI, with the licences it needs', async () => {
    const out = await mkdtemp(join(tmpdir(), 'mediaplane-bundle-'));
    const { file, packages } = await bundle(out);
    expect(packages).toEqual(['commander', 'diff', 'yaml', 'zod']);
    expect((await stat(file)).mode & 0o111).not.toBe(0);
    expect((await readFile(file, 'utf8')).startsWith('#!/usr/bin/env node\n')).toBe(true);

    const version = spawnSync(process.execPath, [file, '--version'], {
      encoding: 'utf8',
    });
    expect(version.stderr).toBe('');
    expect(version.stdout.trim()).toBe(VERSION);
    const missing = spawnSync(
      process.execPath,
      [file, 'plan', '--home', join(out, 'none')],
      {
        encoding: 'utf8',
        env: { ...process.env, MEDIAPLANE_IMAGE: '' },
      },
    );
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('no stack.yaml');

    // The hidden command the host helper runs from the image: `mediaplane host-report`.
    const request = JSON.stringify({
      facts: false,
      stat: [{ key: '/srv/data', at: out }],
      free: [],
      ports: [],
    });
    const report = spawnSync(process.execPath, [file, 'host-report', request], {
      encoding: 'utf8',
    });
    expect(report.stderr).toBe('');
    expect(JSON.parse(report.stdout)).toMatchObject({
      schema: 'mediaplane.host-report/v1',
      stat: { '/srv/data': { isDirectory: true } },
    });

    const licences = await readFile(join(out, 'THIRD-PARTY-LICENSES.txt'), 'utf8');
    for (const name of packages) expect(licences).toContain(`== ${name} ==`);
    expect(licences).toContain('Permission is hereby granted');
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
