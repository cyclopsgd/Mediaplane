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
 * The M1 video stack without the VPN (vpn.e2e.test.ts has its own, behind the VPN), or
 * without Seerr too. The apps run as the current user, who owns the temporary data
 * folder.
 */
export function stackFor(
  data: string,
  { seerr = true }: { seerr?: boolean } = {},
): string {
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
${seerr ? '  seerr: {}\n' : ''}`;
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
 * Run a test's teardown: every step in order, each whether or not the one before it
 * worked (a step that rejects or times out, as well as one whose assertion fails), then
 * throw an AggregateError of what failed, if anything did. Each step should be bounded by
 * TEARDOWN_MS, so one that hangs fails on its own and the test's timeout leaves room for
 * the rest.
 */
export async function runTeardown(
  steps: readonly (() => Promise<unknown>)[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'teardown failed');
}

/** `docker <args>`'s output, trimmed; a failure throws, with Docker's own words. */
export async function docker(...args: string[]): Promise<string> {
  const result = await nodeExec('docker', args, { cwd: '/', timeoutMs: 120_000 });
  if (result.code !== 0) {
    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

/** The host port Docker chose for a container's `port` (such as "51820/udp"). */
export async function publishedPort(container: string, port: string): Promise<number> {
  const output = await docker('port', container, port);
  const [first] = output.split('\n');
  const published = Number(first?.split(':').at(-1));
  if (!Number.isInteger(published) || published < 1 || published > 65535) {
    throw new Error(`docker port ${container} ${port} gave no host port:\n${output}`);
  }
  return published;
}

/**
 * A removal that must not fail silently: a non-zero exit is an error, unless stderr says
 * the thing was already gone ("No such container", or "network … not found").
 */
export async function removeOrIgnoreMissing(...args: string[]): Promise<void> {
  const result = await nodeExec('docker', args, { cwd: '/', timeoutMs: 120_000 });
  if (result.code !== 0 && !/No such|not found/.test(result.stderr)) {
    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed:\n${result.stderr}`);
  }
}

/**
 * A call to an app's API on its published port, with its key, as JSON. It waits up to
 * `timeoutMs`, 60 s unless given.
 */
export async function api(
  port: number,
  path: string,
  headers: Record<string, string>,
  init: { method?: string; body?: string; type?: string; timeoutMs?: number } = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      ...headers,
      ...(init.type === undefined ? {} : { 'Content-Type': init.type }),
    },
    ...(init.body === undefined ? {} : { body: init.body }),
    signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
  });
}

/**
 * A GET of an app's API, as JSON, after checking it answered 2xx. A failure gives the
 * status, and only the body's length when it isn't JSON: an app's answer can hold a key
 * (qBittorrent's preferences hold its own), and CI's log is public.
 */
export async function getJson<T>(
  port: number,
  path: string,
  headers: Record<string, string>,
  { timeoutMs }: { timeoutMs?: number } = {},
): Promise<T> {
  const response = await api(port, path, headers, { timeoutMs });
  const what = `GET ${path} on port ${String(port)}`;
  expect(response.ok, `${what} answered ${String(response.status)}`).toBe(true);
  return jsonBody<T>(response, what);
}

/**
 * A response's body, as JSON. A body that isn't JSON gives only the status and the
 * body's length, never its text, which JSON.parse's own error would quote.
 */
export async function jsonBody<T>(response: Response, what: string): Promise<T> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(
      `${what} answered ${String(response.status)} with ${String(body.length)} characters that aren't JSON`,
    );
  }
}

/**
 * Why an arr refused a request, safe for CI's public log: the status, and each validation
 * error's `propertyName: errorMessage`, with every one of `secrets` replaced. Never the
 * raw body, nor an error's `attemptedValue`, which can be the key under test. A body that
 * isn't such a list gives only its length.
 */
export async function servarrFailure(
  response: Response,
  secrets: readonly string[],
): Promise<string> {
  const status = `status ${String(response.status)}`;
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return `${status}, with ${String(body.length)} characters that aren't JSON`;
  }
  if (!Array.isArray(parsed)) {
    return `${status}, with ${String(body.length)} characters of JSON that isn't a list`;
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : '?');
  const said = parsed.map((item: unknown) => {
    const { propertyName, errorMessage } = (
      typeof item === 'object' && item !== null ? item : {}
    ) as Record<string, unknown>;
    return `${text(propertyName)}: ${text(errorMessage)}`;
  });
  return secrets
    .filter((secret) => secret !== '')
    .reduce(
      (message, secret) => message.replaceAll(secret, '***'),
      `${status}: ${said.join('; ')}`,
    );
}

/** What `apply --json` says, and `apply` returns: its outcome, and each action. */
export interface WireActions {
  outcome: string;
  actions: { step: string; resource?: string; detail?: string }[];
}

/** Each wired resource's detail, in order. */
export function wired(actions: WireActions['actions']): string[][] {
  return actions
    .filter((a) => a.resource !== undefined)
    .map((a) => [a.resource ?? '', a.detail ?? '']);
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
