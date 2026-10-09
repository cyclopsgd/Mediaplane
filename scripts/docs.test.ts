import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FACTS_END, FACTS_START } from './docs/catalog-facts';
import { readReadme } from './docs';

describe('readReadme', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mediaplane-docs-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads a README that exists', async () => {
    await mkdir(join(root, 'catalog/sonarr'), { recursive: true });
    await writeFile(join(root, 'catalog/sonarr/README.md'), '# Sonarr\n');
    await expect(readReadme(root, 'catalog/sonarr/README.md')).resolves.toBe(
      '# Sonarr\n',
    );
  });

  it('names a missing README and says how to create it, not a raw ENOENT', async () => {
    const failure = readReadme(root, 'catalog/sonarr/README.md');
    await expect(failure).rejects.toThrow('catalog/sonarr/README.md does not exist');
    await expect(failure).rejects.toThrow(`create it with the lines ${FACTS_START}`);
    await expect(failure).rejects.toThrow(FACTS_END);
  });

  it('passes on any other read error', async () => {
    // A directory where the README should be: EISDIR, not "missing".
    await mkdir(join(root, 'catalog/sonarr/README.md'), { recursive: true });
    await expect(readReadme(root, 'catalog/sonarr/README.md')).rejects.toThrow(/EISDIR/);
  });
});
