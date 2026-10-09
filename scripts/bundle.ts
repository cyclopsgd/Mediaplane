import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { ROOT } from './root';

/**
 * Node's require, for the CommonJS packages in the bundle (yaml requires "process"). An
 * ES-module bundle has no require of its own.
 */
const BANNER = [
  '#!/usr/bin/env node',
  "import { createRequire as mediaplaneCreateRequire } from 'node:module';",
  'const require = mediaplaneCreateRequire(import.meta.url);',
].join('\n');

const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'license'];

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The npm package each bundled file came from: name → its folder. With pnpm a file sits
 * under node_modules/.pnpm/<id>/node_modules/<name>/, so the last node_modules counts.
 */
export function packagesOf(inputs: readonly string[]): Map<string, string> {
  const packages = new Map<string, string>();
  for (const input of inputs) {
    const match = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(input);
    if (match?.[1] !== undefined && match[2] !== undefined)
      packages.set(match[2], match[1]);
  }
  return new Map([...packages].sort(([a], [b]) => byName(a, b)));
}

/** Bundle the CLI into one file Node runs directly, plus the licences of what it includes. */
export async function bundle(
  outDir = join(ROOT, 'dist'),
): Promise<{ file: string; packages: string[] }> {
  await rm(outDir, { recursive: true, force: true });
  const file = join(outDir, 'mediaplane.mjs');
  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: ['packages/cli/src/main.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    outfile: file,
    banner: { js: BANNER },
    legalComments: 'none',
    metafile: true,
    logLevel: 'warning',
  });
  await chmod(file, 0o755);
  const packages = packagesOf(Object.keys(result.metafile.inputs));
  const notices = [
    'Mediaplane is licensed under the GPL-3.0 (see LICENSE).',
    'Its CLI bundle includes these packages, each under its own licence:',
  ];
  for (const [name, folder] of packages) {
    notices.push('', `== ${name} ==`, '', await licenceText(join(ROOT, folder)));
  }
  await writeFile(join(outDir, 'THIRD-PARTY-LICENSES.txt'), `${notices.join('\n')}\n`);
  return { file, packages: [...packages.keys()] };
}

async function licenceText(folder: string): Promise<string> {
  for (const name of LICENCE_FILES) {
    try {
      return (await readFile(join(folder, name), 'utf8')).trim();
    } catch {
      // Not this name; try the next.
    }
  }
  throw new Error(`no licence file in ${folder}: the bundle cannot ship without one`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { file, packages } = await bundle();
  console.log(`Wrote ${file}, bundling ${packages.join(', ')}.`);
}
