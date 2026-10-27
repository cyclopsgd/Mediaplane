import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../testing/temp';
import { queryDatabase } from './database';

/**
 * What `sh -c script` prints, once it has exited (waited for, so none is left behind), run in
 * a process group of its own: a kill aimed at the group of pid 0 can't reach the test run.
 */
function runApart(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', script], {
      detached: true,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 30_000);
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`the script exited with ${String(code)}`));
    });
  });
}

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
let started = false;
const answer = await queryDatabase(fd, new URL('file:///proc/self/fd/3'), ${JSON.stringify(SQLITE)}, {
  started: () => {
    started = true;
  },
});
console.log(JSON.stringify({ answer, started }));
`,
    );
    // sh sets the limit for the one Node process it starts.
    const stdout = await runApart(
      `ulimit -n 64 && exec "${process.execPath}" "${script}"`,
    );
    const result: unknown = JSON.parse(stdout);
    // No process, so none to tell about.
    expect(result).toMatchObject({ answer: { found: 'failed' }, started: false });
  });
});
