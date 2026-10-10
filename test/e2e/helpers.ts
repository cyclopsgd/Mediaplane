import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeExec, type ExecResult } from '@mediaplane/engine';
import { expect, onTestFinished } from 'vitest';

export const BUSYBOX =
  'busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e';

/**
 * How long one teardown command may run. Each is bounded, so one that hangs fails on its
 * own and the removals after it still run, within the timeout of the hook or test that
 * runs them, which is set above their sum.
 */
export const TEARDOWN_MS = 120_000;

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
 * The M1 video stack without the VPN (vpn.e2e.test.ts has its own, behind the VPN).
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

/**
 * A new temporary Mediaplane home holding the video stack's `stack.yaml` and a data
 * folder. It is removed when the test finishes, files the apps wrote as other users
 * included, so a test that starts containers must bring its project down
 * (`composeDown`) in its own `finally`, which runs first.
 */
export async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-'));
  // removeHome runs one bounded command, then removes the folder.
  onTestFinished(() => removeHome(home), 2 * TEARDOWN_MS);
  await mkdir(join(home, 'data'));
  await writeFile(join(home, 'stack.yaml'), stackFor(join(home, 'data')));
  return home;
}

/** What `credentials --json --reveal` prints: the shared login, and each app's. */
export interface RevealedLogin {
  username: string;
  password: string;
  apps: { app: string; urls: string[]; login: string }[];
}

/**
 * `credentials --json --reveal`'s output, parsed. It holds the password, so a failure
 * says only that it failed: JSON.parse's own error quotes the text, into the CI log.
 */
export function parseRevealed(stdout: string): RevealedLogin {
  try {
    return JSON.parse(stdout) as RevealedLogin;
  } catch {
    throw new Error('credentials --json --reveal did not print JSON');
  }
}

/**
 * The stack's wiring network (`<project>_wiring`): whether it is internal, and the names
 * of the containers on it, sorted.
 */
export async function wiringMembers(
  project: string,
): Promise<{ internal: boolean; members: string[] }> {
  const inspect = await nodeExec(
    'docker',
    [
      'network',
      'inspect',
      '--format',
      '{{.Internal}}{{range $id, $c := .Containers}} {{$c.Name}}{{end}}',
      `${project}_wiring`,
    ],
    { cwd: '/' },
  );
  expect(inspect.code, inspect.stderr).toBe(0);
  const [internal, ...members] = inspect.stdout.trim().split(' ');
  return { internal: internal === 'true', members: members.sort() };
}

/**
 * `<project>_wiring` is gone. Compose still exits 0 when it can't remove a network,
 * such as one that a container of another project is still on: a teardown looks for it.
 */
export async function expectWiringRemoved(project: string): Promise<void> {
  const wiring = await nodeExec('docker', ['network', 'inspect', `${project}_wiring`], {
    cwd: '/',
    timeoutMs: TEARDOWN_MS,
  });
  expect(wiring.code, `${project}_wiring was left behind`).not.toBe(0);
  expect(wiring.stderr).toMatch(/not found/);
}

/**
 * Remove a test project's containers, network and anonymous volumes, whatever it
 * contains. `-v` is the short form of `--volumes` in Compose v2 and v5.
 */
export function composeDown(project: string): Promise<ExecResult> {
  return nodeExec(
    'docker',
    ['compose', '-p', project, 'down', '--remove-orphans', '-v'],
    { cwd: '/', timeoutMs: TEARDOWN_MS },
  );
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
    { cwd: '/', timeoutMs: TEARDOWN_MS },
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
    { cwd: '/', timeoutMs: TEARDOWN_MS },
  );
  if (result.code !== 0) {
    throw new Error(`could not empty ${dir} as root:\n${result.stderr}`);
  }
  await rm(dir, { recursive: true, force: true });
}

/** Mediaplane deployed for a test, as `deployMediaplane` started it. */
export interface DeployedMediaplane {
  /**
   * `mediaplane <args>` in its container, with `env` added to the command's. Never a
   * secret in `env`: its values go on `docker exec`'s command line, which `ps` shows.
   */
  mediaplane(args: readonly string[], env?: Record<string, string>): Promise<ExecResult>;
  /** Bring the deployment down, and remove its image; fails if either fails. */
  remove(): Promise<void>;
}

/** An error's message, or what was thrown, as text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Mediaplane deployed as a user deploys it (deploy/mediaplane.compose.yaml): its image,
 * built from this checkout, behind the socket proxy, on a network with no route out,
 * managing the Compose project `stack` in `home`. Its own project is `<stack>-system`.
 */
export async function deployMediaplane(options: {
  home: string;
  stack: string;
}): Promise<DeployedMediaplane> {
  const { home, stack } = options;
  // mediaplane-e2e-<pid>-vpn is tagged mediaplane-e2e:<pid>-vpn.
  const tag = `mediaplane-e2e:${stack.replace(/^mediaplane-e2e-/, '')}`;
  const container = `${stack}-mediaplane`;
  // Before anything is made, so a failure here leaves nothing behind.
  const dockerGid = String((await stat('/var/run/docker.sock')).gid);
  await buildImage(tag);
  /** The override's folder. Made in the try below, so a failure there still removes the image. */
  let dir: string | undefined;
  const override = () => join(dir ?? '', 'override.yaml');
  const env = {
    ...process.env,
    MEDIAPLANE_IMAGE: tag,
    MEDIAPLANE_HOME: home,
    MEDIAPLANE_UID: String(process.getuid?.() ?? 1000),
    MEDIAPLANE_GID: String(process.getgid?.() ?? 1000),
    DOCKER_GID: dockerGid,
  };
  const deploy = join(REPO, 'deploy', 'mediaplane.compose.yaml');
  const system = (args: readonly string[], timeoutMs = 300_000) =>
    nodeExec(
      'docker',
      [
        'compose',
        '-p',
        `${stack}-system`,
        '--env-file',
        '/dev/null',
        '-f',
        deploy,
        '-f',
        override(),
        ...args,
      ],
      { env, cwd: '/', timeoutMs },
    );
  /** Every removal, each whether or not the one before it worked; what failed. */
  const teardown = async (): Promise<string[]> => {
    const failed: string[] = [];
    const step = async (what: string, run: () => Promise<ExecResult | undefined>) => {
      try {
        const result = await run();
        if (result !== undefined && result.code !== 0) {
          failed.push(`${what} failed: ${result.stderr}`);
        }
      } catch (error) {
        failed.push(`${what} failed: ${messageOf(error)}`);
      }
    };
    // Without the folder, nothing was started: there is only the image to remove.
    const made = dir;
    if (made !== undefined) {
      await step('compose down', () => system(['down', '--remove-orphans'], TEARDOWN_MS));
      await step('removing the override', async () => {
        await rm(made, { recursive: true, force: true });
        return undefined;
      });
    }
    await step('docker image rm', () =>
      nodeExec('docker', ['image', 'rm', tag], { cwd: '/', timeoutMs: TEARDOWN_MS }),
    );
    return failed;
  };
  try {
    dir = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-system-'));
    await writeFile(
      override(),
      [
        'services:',
        '  mediaplane:',
        `    container_name: ${container}`,
        '    environment:',
        `      MEDIAPLANE_COMPOSE_PROJECT: ${stack}`,
        '',
      ].join('\n'),
    );
    const up = await system(['up', '-d', '--wait']);
    if (up.code !== 0) throw new Error(`mediaplane-system did not start:\n${up.stderr}`);
  } catch (error) {
    // The startup error first; a failed teardown is only added to it.
    const failed = await teardown();
    const also =
      failed.length === 0 ? '' : `\nIts removal failed too:\n${failed.join('\n')}`;
    throw new Error(`${messageOf(error)}${also}`, { cause: error });
  }
  return {
    mediaplane: (args, extra = {}) =>
      nodeExec(
        'docker',
        [
          'exec',
          ...Object.entries(extra).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
          container,
          'mediaplane',
          ...args,
        ],
        { cwd: '/', timeoutMs: 300_000 },
      ),
    remove: async () => {
      expect(await teardown()).toEqual([]);
    },
  };
}
