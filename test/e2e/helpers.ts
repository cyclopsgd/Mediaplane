import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeExec, type ExecResult } from '@mediaplane/engine';
import { expect } from 'vitest';

export const BUSYBOX =
  'busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e';

/** The repository root: the image's build context. */
export const REPO = fileURLToPath(new URL('../..', import.meta.url));

/** Build the Mediaplane image from this checkout as `tag`. The first build takes minutes. */
export async function buildImage(tag: string): Promise<void> {
  const result = await nodeExec('docker', ['build', '--tag', tag, REPO], {
    cwd: '/',
    timeoutMs: 900_000,
  });
  if (result.code !== 0) {
    throw new Error(`docker build failed:\n${result.stderr.slice(-3000)}`);
  }
}

/**
 * The M1 video stack without the VPN (the VPN gets its own end-to-end test in Slice 3).
 * The apps run as the current user, who owns the temporary data folder.
 */
export function stackFor(data: string): string {
  return `version: 1
user: { uid: ${process.getuid?.() ?? 1000}, gid: ${process.getgid?.() ?? 1000} }
paths: { data: ${data} }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`;
}

/** A new temporary Mediaplane home holding the video stack's `stack.yaml` and a data folder. */
export async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
  await mkdir(join(home, 'data'));
  await writeFile(join(home, 'stack.yaml'), stackFor(join(home, 'data')));
  return home;
}

/** Remove a test project's containers and network, whatever it contains. */
export function composeDown(project: string): Promise<ExecResult> {
  return nodeExec('docker', ['compose', '-p', project, 'down', '--remove-orphans'], {
    cwd: '/',
  });
}

/**
 * Delete a test home, including files the apps created as other users (Seerr runs as
 * uid 1000). Those are removed as root, from a throwaway container.
 */
export async function removeHome(home: string): Promise<void> {
  const result = await nodeExec(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${home}:/home-to-remove`,
      BUSYBOX,
      'rm',
      '-rf',
      '/home-to-remove/appdata',
      '/home-to-remove/data',
    ],
    { cwd: '/' },
  );
  if (result.code !== 0) {
    throw new Error(`could not remove ${home} as root:\n${result.stderr}`);
  }
  await rm(home, { recursive: true, force: true });
}

/**
 * The command from the "To run this stack without Mediaplane" comment in compose.yaml's
 * header, as arguments for `docker`, with the project name swapped for `project` so the
 * test stays isolated. The home's path has no spaces, so splitting on whitespace is enough.
 */
export function ejectArguments(compose: string, project: string): string[] {
  const lines = compose
    .split('\n')
    .filter((line) => line.startsWith('#'))
    .map((line) => line.slice(1).trim());
  const first = lines.findIndex((line) => line.startsWith('docker compose '));
  const last = lines.findIndex((line) => line.endsWith(' up -d'));
  if (first < 0 || last < first) throw new Error('compose.yaml has no eject command');
  const command = lines
    .slice(first, last + 1)
    .map((line) => line.replace(/\\$/, '').trim())
    .join(' ');
  const [docker, ...args] = command.split(/\s+/);
  expect(docker).toBe('docker');
  const name = args.indexOf('-p') + 1;
  expect(args[name]).toBe('mediaplane');
  args[name] = project;
  return args;
}

/**
 * Delete a folder the apps may have written to as other users, from a throwaway
 * container running as root, and then the folder itself.
 */
export async function removeAsRoot(dir: string): Promise<void> {
  const result = await nodeExec(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${dir}:/to-remove`,
      BUSYBOX,
      'find',
      '/to-remove',
      '-mindepth',
      '1',
      '-delete',
    ],
    { cwd: '/' },
  );
  if (result.code !== 0) {
    throw new Error(`could not empty ${dir} as root:\n${result.stderr}`);
  }
  await rm(dir, { recursive: true, force: true });
}
