import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ROOT } from '../root';
import { bundleFiles, writeBundle } from './deploy-bundle';
import { pinnedDeployment, pinnedInstaller } from './pin';

const IMAGE = `ghcr.io/cyclopsgd/mediaplane:0.1.0@sha256:${'1'.repeat(64)}`;
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
let dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mp-bundle-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('bundleFiles', () => {
  it("holds the deploy folder, with the release's image named in two of its files, and the licence", () => {
    expect(bundleFiles(read, IMAGE)).toEqual([
      { path: 'mediaplane/LICENSE', content: read('LICENSE'), mode: 0o644 },
      {
        path: 'mediaplane/deploy/README.md',
        content: read('deploy/README.md'),
        mode: 0o644,
      },
      {
        path: 'mediaplane/deploy/install.sh',
        content: pinnedInstaller(read('deploy/install.sh'), IMAGE),
        mode: 0o755,
      },
      {
        path: 'mediaplane/deploy/mediaplane',
        content: read('deploy/mediaplane'),
        mode: 0o755,
      },
      {
        path: 'mediaplane/deploy/mediaplane.compose.yaml',
        content: pinnedDeployment(read('deploy/mediaplane.compose.yaml'), IMAGE),
        mode: 0o644,
      },
    ]);
  });
});

describe('writeBundle', () => {
  it('writes mediaplane-deploy-<version>.tar.gz, and SHA256SUMS with its digest', async () => {
    const out = temp();
    const written = await writeBundle({
      root: ROOT,
      out,
      version: '0.1.0',
      image: IMAGE,
      epoch: 1_700_000_000,
    });
    const archive = join(out, 'mediaplane-deploy-0.1.0.tar.gz');
    expect(written).toEqual({
      archive,
      sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
    });
    expect(readFileSync(join(out, 'SHA256SUMS'), 'utf8')).toBe(
      `${written.sha256}  mediaplane-deploy-0.1.0.tar.gz\n`,
    );
    const listing = spawnSync(
      'tar',
      ['--list', '--verbose', '--numeric-owner', '--file', archive],
      {
        encoding: 'utf8',
      },
    ).stdout;
    expect(listing).toMatch(/^-rwxr-xr-x 0\/0 .* mediaplane\/deploy\/install\.sh$/m);
    expect(listing).toMatch(
      /^-rw-r--r-- 0\/0 .* mediaplane\/deploy\/mediaplane\.compose\.yaml$/m,
    );
    expect(listing).toMatch(/^drwxr-xr-x 0\/0 .* mediaplane\/$/m);
  });

  it('writes the same bytes from the same files and time', async () => {
    const a = await writeBundle({
      root: ROOT,
      out: temp(),
      version: '0.1.0',
      image: IMAGE,
      epoch: 1_700_000_000,
    });
    const b = await writeBundle({
      root: ROOT,
      out: temp(),
      version: '0.1.0',
      image: IMAGE,
      epoch: 1_700_000_000,
    });
    expect(a.sha256).toBe(b.sha256);
  });

  it("unpacks to an installer that runs, naming the release's image", async () => {
    const out = temp();
    const { archive } = await writeBundle({
      root: ROOT,
      out,
      version: '0.1.0',
      image: IMAGE,
      epoch: 0,
    });
    expect(
      spawnSync('tar', ['--extract', '--file', archive, '--directory', out]).status,
    ).toBe(0);
    const install = join(out, 'mediaplane/deploy/install.sh');
    expect(statSync(install).mode & 0o111).not.toBe(0);
    expect(spawnSync('sh', ['-n', install]).status).toBe(0);
    expect(readFileSync(install, 'utf8')).toContain(`release_image='${IMAGE}'`);
  });

  it.each([['v0.1.0'], ['0.1'], ['0.1.0; true']])(
    'refuses the version %s',
    async (version) => {
      await expect(
        writeBundle({ root: ROOT, out: temp(), version, image: IMAGE, epoch: 0 }),
      ).rejects.toThrow('the version is <major>.<minor>.<patch>');
    },
  );
});
