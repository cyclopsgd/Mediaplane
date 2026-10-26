import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../../packages/cli/src/version';
import { ROOT } from '../root';

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const json = (path: string): unknown => JSON.parse(read(path));

/** Every package.json in the workspace: the root, the CLI, the engine and the catalog. */
const PACKAGES = [
  'package.json',
  'packages/cli/package.json',
  'packages/engine/package.json',
  'catalog/package.json',
];

interface ReleasePleaseConfig {
  'include-component-in-tag'?: boolean;
  'bump-minor-pre-major'?: boolean;
  'bump-patch-for-minor-pre-major'?: boolean;
  packages: Record<
    string,
    {
      'release-type': string;
      'package-name'?: string;
      'extra-files'?: (string | { type: string; path: string; jsonpath?: string })[];
    }
  >;
}

const config = json('release-please-config.json') as ReleasePleaseConfig;
const manifest = json('.release-please-manifest.json') as Record<string, string>;
const root = config.packages['.'];

describe('the licence (GPL-3.0-or-later, the owner decided on 2026-10-17)', () => {
  it.each(PACKAGES)('%s says so in its SPDX license field', (path) => {
    expect((json(path) as { license?: string }).license).toBe('GPL-3.0-or-later');
  });

  it('is the GPL version 3 text, which allows "or any later version"', () => {
    const text = read('LICENSE');
    expect(text).toMatch(/^\s*GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
    expect(text).toContain('"or any later version"');
  });

  it("is the image's licence label", () => {
    expect(read('Dockerfile')).toContain(
      'org.opencontainers.image.licenses="GPL-3.0-or-later"',
    );
  });
});

describe('versioned releases (release-please, spec §8.2)', () => {
  it('releases the repository as one Node package, tagged v<version>', () => {
    expect(Object.keys(config.packages)).toEqual(['.']);
    expect(root).toMatchObject({ 'release-type': 'node', 'package-name': 'mediaplane' });
    expect(config['include-component-in-tag']).toBe(false);
  });

  it('bumps the minor version for a feature or a breaking change before 1.0', () => {
    expect(config['bump-minor-pre-major']).toBe(true);
    expect(config['bump-patch-for-minor-pre-major']).toBeUndefined();
  });

  it('keeps every version in step: the manifest, both package.json files, the CLI', () => {
    const version = manifest['.'];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect((json('package.json') as { version?: string }).version).toBe(version);
    expect((json('packages/cli/package.json') as { version?: string }).version).toBe(
      version,
    );
    expect(VERSION).toBe(version);
  });

  it('bumps the CLI package and its VERSION too, at release-please markers', () => {
    expect(root?.['extra-files']).toEqual([
      { type: 'json', path: 'packages/cli/package.json', jsonpath: '$.version' },
      'packages/cli/src/version.ts',
    ]);
    // release-please's generic updater rewrites the version on a line with this marker.
    const marked = read('packages/cli/src/version.ts')
      .split('\n')
      .filter((line) => line.includes('x-release-please-version'));
    expect(marked).toEqual([
      `export const VERSION = '${VERSION}'; // x-release-please-version`,
    ]);
  });

  it("leaves the changelog it writes out of Prettier's check", () => {
    // release-please writes CHANGELOG.md in its own format, in the release pull request.
    expect(read('.prettierignore').split('\n')).toContain('CHANGELOG.md');
  });
});
