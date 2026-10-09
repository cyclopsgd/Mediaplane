import { rm } from 'node:fs/promises';
import { nodeExec, type ExecResult } from '@mediaplane/engine';

export const BUSYBOX =
  'busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e';

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
