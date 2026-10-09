import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeExec, type ExecResult } from '@mediaplane/engine';

export const BUSYBOX =
  'busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e';

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
  await nodeExec(
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
  await rm(home, { recursive: true, force: true });
}
