import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../testing/temp';
import { queryDatabase } from './database';

const run = promisify(execFile);

const SQLITE = { query: 'SELECT 1 AS x', column: 'x' };
const URL_FD3 = new URL('file:///proc/self/fd/3');

describe('queryDatabase', () => {
  it('resolves, never rejects, when the database cannot be handed over', async () => {
    // Not an open descriptor: spawn throws before any process exists.
    expect(await queryDatabase(9999, URL_FD3, SQLITE)).toEqual({
      found: 'failed',
      why: 'it could not be read (EBADF)',
    });
  });

  it('resolves, and does not crash, when no process can be started for want of descriptors', async () => {
    const dir = await tempDir('mediaplane-database-');
    // The module as the image bundles it, so the script needs no TypeScript loader.
    const bundle = join(dir, 'database.mjs');
    buildSync({
      entryPoints: [fileURLToPath(new URL('./database.ts', import.meta.url))],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'silent',
    });
    const script = join(dir, 'exhaust.mjs');
    await writeFile(
      script,
      `import { openSync } from 'node:fs';
import { queryDatabase } from ${JSON.stringify(bundle)};
const fd = openSync('/dev/null', 'r');
try {
  for (;;) openSync('/dev/null', 'r');
} catch {
  // Out of descriptors, as meant.
}
const answer = await queryDatabase(fd, new URL('file:///proc/self/fd/3'), ${JSON.stringify(SQLITE)});
console.log(JSON.stringify(answer));
`,
    );
    // sh sets the limit for the one Node process it starts.
    const { stdout } = await run('sh', [
      '-c',
      `ulimit -n 64 && exec "${process.execPath}" "${script}"`,
    ]);
    const answer: unknown = JSON.parse(stdout);
    expect(answer).toMatchObject({ found: 'failed' });
  });
});
