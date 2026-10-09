import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ranAsScript } from './root';

describe('ranAsScript', () => {
  it('is true for the script Node started, also through a symlinked folder', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'mediaplane-guard-')));
    try {
      await mkdir(join(dir, 'real'));
      const script = join(dir, 'real', 'run.ts');
      await writeFile(script, '');
      await writeFile(join(dir, 'real', 'other.ts'), '');
      await symlink(join(dir, 'real'), join(dir, 'link'));
      const url = pathToFileURL(script).href;

      expect(ranAsScript(url, script)).toBe(true);
      expect(ranAsScript(url, join(dir, 'link', 'run.ts'))).toBe(true);
      expect(ranAsScript(url, join(dir, 'link', 'other.ts'))).toBe(false);
      expect(ranAsScript(url, join(dir, 'real', 'missing.ts'))).toBe(false);
      expect(ranAsScript(url, undefined)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
