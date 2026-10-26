import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ranAsScript, ROOT } from '../root';
import { pinnedDeployment, pinnedInstaller } from './pin';

/**
 * A release's deploy files (deploy/README.md): mediaplane-deploy-<version>.tar.gz, which
 * unpacks to mediaplane/deploy/, with the release's image named in install.sh and
 * mediaplane.compose.yaml, and SHA256SUMS beside it. The same files and time always make
 * the same bytes, so anyone can check a release's file against its source.
 */

export interface BundleFile {
  path: string;
  content: string;
  mode: number;
}

/** What the bundle holds, read from the repository with `read`, for `image`. */
export function bundleFiles(read: (path: string) => string, image: string): BundleFile[] {
  return [
    { path: 'mediaplane/LICENSE', content: read('LICENSE'), mode: 0o644 },
    {
      path: 'mediaplane/deploy/README.md',
      content: read('deploy/README.md'),
      mode: 0o644,
    },
    {
      path: 'mediaplane/deploy/install.sh',
      content: pinnedInstaller(read('deploy/install.sh'), image),
      mode: 0o755,
    },
    {
      path: 'mediaplane/deploy/mediaplane',
      content: read('deploy/mediaplane'),
      mode: 0o755,
    },
    {
      path: 'mediaplane/deploy/mediaplane.compose.yaml',
      content: pinnedDeployment(read('deploy/mediaplane.compose.yaml'), image),
      mode: 0o644,
    },
  ];
}

export interface BundleOptions {
  /** The repository to read the files from. */
  root: string;
  /** Where the archive and SHA256SUMS go. */
  out: string;
  version: string;
  image: string;
  /** Every file's time, in seconds: the release commit's. */
  epoch: number;
}

/** Writes the archive and SHA256SUMS into `out`: the archive's path and digest. */
export async function writeBundle(
  options: BundleOptions,
): Promise<{ archive: string; sha256: string }> {
  const { root, out, version, image, epoch } = options;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`the version is <major>.<minor>.<patch>, not "${version}"`);
  }
  // Each file bundleFiles names, read from the repository: one list, so none ships empty.
  const files = bundleFiles((path) => readFileSync(join(root, path), 'utf8'), image);
  const stage = await mkdtemp(join(tmpdir(), 'mediaplane-bundle-'));
  try {
    for (const file of files) {
      const target = join(stage, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
      await chmod(target, file.mode);
    }
    for (const dir of ['mediaplane/deploy', 'mediaplane']) {
      await chmod(join(stage, dir), 0o755);
    }
    for (const path of [...files.map((f) => f.path), 'mediaplane/deploy', 'mediaplane']) {
      await utimes(join(stage, path), epoch, epoch);
    }
    // GNU tar, in a fixed order, owner and time, then gzip without a name or a time.
    const tar = spawnSync(
      'tar',
      [
        '--create',
        '--format=gnu',
        '--sort=name',
        '--owner=0',
        '--group=0',
        '--numeric-owner',
        `--mtime=@${String(epoch)}`,
        '--directory',
        stage,
        'mediaplane',
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );
    if (tar.status !== 0) {
      throw new Error(`tar failed: ${tar.stderr.toString().trim()}`);
    }
    const archive = join(out, `mediaplane-deploy-${version}.tar.gz`);
    const bytes = gzipSync(tar.stdout, { level: 9 });
    await mkdir(out, { recursive: true });
    await writeFile(archive, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeFile(
      join(out, 'SHA256SUMS'),
      `${sha256}  mediaplane-deploy-${version}.tar.gz\n`,
    );
    return { archive, sha256 };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

// pnpm exec tsx scripts/release/deploy-bundle.ts <version> <image> <out-dir>, with the
// files' time in SOURCE_DATE_EPOCH.
if (ranAsScript(import.meta.url, process.argv[1])) {
  const [version = '', image = '', out = ''] = process.argv.slice(2);
  const epoch = Number(process.env.SOURCE_DATE_EPOCH ?? '');
  try {
    if (out === '' || !Number.isInteger(epoch) || epoch < 0) {
      throw new Error(
        'usage: deploy-bundle.ts <version> <image> <out-dir>, with SOURCE_DATE_EPOCH set',
      );
    }
    const { archive, sha256 } = await writeBundle({
      root: ROOT,
      out,
      version,
      image,
      epoch,
    });
    console.log(`Wrote ${archive} (sha256 ${sha256})`);
  } catch (cause) {
    console.error(`error: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
