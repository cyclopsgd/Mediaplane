import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { warning, type Diagnostic } from '../diagnostics';
import { COMPOSE_PATH, ENV_PATH, OVERRIDE_PATH } from '../paths';
import { nodeExec, type Exec, type ExecResult } from './exec';
import {
  HelperError,
  RuntimeError,
  type CommandResult,
  type ContainerDetails,
  type ContainerState,
  type HashesResult,
  type HelperMount,
  type HelperResult,
  type OneOffCommand,
  type Runtime,
} from './types';

/** Mediaplane's own deployment (spec §4.4): read-only to Mediaplane, never managed. */
export const SYSTEM_PROJECT = 'mediaplane-system';

/** How long a docker call may take before Mediaplane gives up on it, in ms. */
export const DOCKER_TIMEOUTS = { query: 60_000, pull: 1_800_000, run: 300_000 } as const;

/** The label on every host-helper container, so a leftover one is easy to find. */
export const HELPER_LABEL = 'io.mediaplane.helper';

/**
 * Whether Mediaplane may act on a Compose project: "mediaplane" or "mediaplane-<name>",
 * never its own "mediaplane-system" (spec §7.2(2)).
 */
export function isManagedProject(project: string): boolean {
  return (
    /^mediaplane(?:-[a-z0-9][a-z0-9_-]*)?$/.test(project) && project !== SYSTEM_PROJECT
  );
}

/** Where Docker's own socket is: talking to it means there is no socket proxy. */
const RAW_SOCKETS = new Set([
  '',
  'unix:///var/run/docker.sock',
  'unix:///run/docker.sock',
]);

/** Whether Mediaplane runs from its image: mediaplane.compose.yaml sets MEDIAPLANE_IMAGE. */
function inImage(env: NodeJS.ProcessEnv): boolean {
  return (env.MEDIAPLANE_IMAGE ?? '') !== '';
}

/** Whether Mediaplane runs from its image and reaches Docker through the socket proxy. */
export function usesSocketProxy(env: NodeJS.ProcessEnv): boolean {
  return inImage(env) && !RAW_SOCKETS.has(env.DOCKER_HOST ?? '');
}

/**
 * A warning when Mediaplane runs from its image (MEDIAPLANE_IMAGE is set) but reaches the
 * Docker socket directly, not through the socket proxy. Spec §7.2(2): the proxy is on by
 * default and can be disabled, with a warning.
 */
export function dockerAccessWarnings(env: NodeJS.ProcessEnv): Diagnostic[] {
  if (!inImage(env) || usesSocketProxy(env)) return [];
  return [
    warning(
      'docker.no-proxy',
      'Mediaplane is using the Docker socket directly, without the socket proxy',
      {
        hint: 'the proxy limits the Docker calls Mediaplane can make; deploy/README.md shows how to turn it back on',
      },
    ),
  ];
}

export interface DockerRuntimeOptions {
  /** Absolute Mediaplane home: the Compose project directory. */
  home: string;
  project: string;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
}

export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
  if (!isManagedProject(options.project)) {
    throw new RuntimeError(
      `refusing to manage the Compose project "${options.project}": Mediaplane only manages "mediaplane" or "mediaplane-<name>", and never "${SYSTEM_PROJECT}"`,
    );
  }
  const exec = options.exec ?? nodeExec;
  const baseEnv = options.env ?? process.env;

  async function docker(
    label: string,
    args: readonly string[],
    extra: {
      input?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      /** The error for a call that times out, instead of the generic daemon advice. */
      timeoutError?: (cause: unknown) => RuntimeError;
    } = {},
  ): Promise<ExecResult> {
    const timeoutMs = extra.timeoutMs ?? DOCKER_TIMEOUTS.query;
    try {
      return await exec('docker', args, {
        input: extra.input,
        env: { ...baseEnv, ...extra.env },
        cwd: '/',
        timeoutMs,
      });
    } catch (cause) {
      if (extra.timeoutError !== undefined && hasCode(cause, 'ETIMEDOUT')) {
        throw extra.timeoutError(cause);
      }
      throw new RuntimeError(spawnFailure(label, timeoutMs, cause), { cause });
    }
  }

  /** The written project: compose.yaml, the user's override if present, and .env. */
  async function projectArgs(): Promise<string[]> {
    const override = join(options.home, OVERRIDE_PATH);
    return [
      'compose',
      '-p',
      options.project,
      '--project-directory',
      options.home,
      '-f',
      join(options.home, COMPOSE_PATH),
      ...((await exists(override)) ? ['-f', override] : []),
      '--env-file',
      join(options.home, ENV_PATH),
    ];
  }

  async function run(service: string, command: OneOffCommand): Promise<ExecResult> {
    const result = await docker(
      'compose run',
      [
        ...(await projectArgs()),
        'run',
        '--rm',
        '--no-deps',
        // -T, not --no-tty: Compose v2 spells the long form --no-TTY, v5 --no-tty.
        '-T',
        '--user',
        `${String(command.user.uid)}:${String(command.user.gid)}`,
        '--entrypoint',
        command.entrypoint,
        service,
        ...command.args,
      ],
      { input: command.input, timeoutMs: DOCKER_TIMEOUTS.run },
    );
    return {
      code: result.code,
      stdout: redact(result.stdout, command.values),
      stderr: redact(result.stderr, command.values),
    };
  }

  return {
    async versions() {
      const engine = await docker('version', [
        'version',
        '--format',
        '{{.Server.Version}}',
      ]);
      if (engine.code !== 0) {
        throw new RuntimeError(`cannot talk to Docker: ${firstLine(engine.stderr)}`);
      }
      const compose = await docker('compose version', ['compose', 'version', '--short']);
      if (compose.code !== 0) {
        throw new RuntimeError(
          `Docker Compose is not available: ${firstLine(compose.stderr)}`,
        );
      }
      return {
        engine: engine.stdout.trim(),
        compose: compose.stdout.trim().replace(/^v/, ''),
      };
    },

    async configHashes(compose, values): Promise<HashesResult> {
      const override = join(options.home, OVERRIDE_PATH);
      const overrideArgs = (await exists(override)) ? ['-f', override] : [];
      const result = await docker(
        'compose config',
        [
          'compose',
          '-p',
          options.project,
          '--project-directory',
          options.home,
          '-f',
          '-',
          ...overrideArgs,
          // Not <home>/.env, which Compose would load by default: up loads only
          // generated/.env, and these values come in through the environment.
          '--env-file',
          '/dev/null',
          'config',
          '--hash',
          '*',
        ],
        { input: compose, env: values },
      );
      if (result.code !== 0)
        return { ok: false, error: redact(result.stderr.trim(), values) };
      return { ok: true, hashes: parseHashes(result.stdout) };
    },

    async containers() {
      const result = await docker('compose ps', [
        'compose',
        '-p',
        options.project,
        'ps',
        '--all',
        // Full IDs: a guest's hash depends on its host's full ID (see predictContainers).
        '--no-trunc',
        '--format',
        'json',
      ]);
      if (result.code !== 0) {
        throw new RuntimeError(`docker compose ps failed: ${firstLine(result.stderr)}`);
      }
      return parseContainers(result.stdout);
    },

    async pull(values) {
      const result = await docker(
        'compose pull',
        [...(await projectArgs()), 'pull', '--policy', 'missing', '--quiet'],
        { timeoutMs: DOCKER_TIMEOUTS.pull },
      );
      return commandResult(result, values);
    },

    async up(waitSeconds, values) {
      const result = await docker(
        'compose up',
        [
          ...(await projectArgs()),
          'up',
          '--detach',
          '--wait',
          '--wait-timeout',
          String(waitSeconds),
          '--remove-orphans',
          '--quiet-pull',
        ],
        { timeoutMs: (waitSeconds + 120) * 1000 },
      );
      return commandResult(result, values);
    },

    run,

    async inspect(ids) {
      // IDs, never names or options: they come from containers().
      const bad = ids.find((id) => !/^[0-9a-f]{12,64}$/.test(id));
      if (bad !== undefined) {
        throw new RuntimeError(`not a container ID: ${JSON.stringify(bad)}`);
      }
      if (ids.length === 0) return [];
      const result = await docker('container inspect', [
        'container',
        'inspect',
        '--format',
        '{{.Id}} {{.HostConfig.NetworkMode}} {{.State.StartedAt}} {{index .Config.Labels "com.docker.compose.project"}}',
        ...ids,
      ]);
      if (result.code !== 0) {
        throw new RuntimeError(
          `docker container inspect failed: ${firstLine(result.stderr)}`,
        );
      }
      return parseDetails(result.stdout, options.project);
    },

    async chown(service, path, owner, values) {
      const result = await run(service, {
        user: { uid: 0, gid: 0 },
        entrypoint: 'chown',
        args: ['-R', `${String(owner.uid)}:${String(owner.gid)}`, path],
        values,
      });
      return commandResult(result, {});
    },

    async hostHelper(image, request, mounts, user): Promise<HelperResult> {
      const timeoutMs = DOCKER_TIMEOUTS.query;
      const result = await docker(
        'run (host helper)',
        [
          'run',
          '--rm',
          // docker-init as PID 1: Node ignores SIGTERM as PID 1, so without it a helper
          // that times out would outlive the `docker run` client that was stopped.
          '--init',
          '--pull',
          'never',
          '--network',
          'host',
          '--user',
          `${String(user.uid)}:${String(user.gid)}`,
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '--read-only',
          '--label',
          `${HELPER_LABEL}=host-report`,
          ...mounts.flatMap((mount) => ['--mount', bindMount(mount)]),
          '--entrypoint',
          'mediaplane',
          image,
          'host-report',
          request,
        ],
        {
          timeoutMs,
          // Usually a network share that stopped answering hangs it. A Docker that stopped
          // answering would too: plan tells the two apart by asking Docker its version.
          timeoutError: (cause) =>
            new HelperError(
              `the host helper did not finish within ${String(timeoutMs / 1000)} s`,
              {
                cause,
                hint: 'check that the data folder and the Mediaplane home are reachable: a network share (NFS or SMB) that is not responding is the usual cause',
              },
            ),
        },
      );
      if (result.code === 0) return { ok: true, stdout: result.stdout };
      const missing = missingMountSource(result.stderr, mounts);
      return {
        ok: false,
        error: lastLines(result.stderr),
        ...(missing === undefined ? {} : { missingSource: missing }),
      };
    },
  };
}

/** Success, or Compose's last three stderr lines with secret values replaced. */
function commandResult(
  result: ExecResult,
  values: Record<string, string>,
): CommandResult {
  if (result.code === 0) return { ok: true };
  return { ok: false, error: redact(lastLines(result.stderr), values) };
}

/** The last three non-empty lines of a command's stderr. */
function lastLines(stderr: string): string {
  return stderr
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-3)
    .join('\n');
}

/**
 * The mount source that Docker's "bind source path does not exist" error names, or
 * undefined when it names none of the `mounts` sent. Docker CLI 27 and older end the
 * sentence with a full stop, so a source followed by one counts too.
 */
function missingMountSource(
  stderr: string,
  mounts: readonly HelperMount[],
): string | undefined {
  const reported = /bind source path does not exist: (.+)$/m.exec(stderr)?.[1];
  if (reported === undefined) return undefined;
  const sources = mounts.map((mount) => mount.source);
  return (
    sources.find((source) => source === reported) ??
    sources.find((source) => `${source}.` === reported)
  );
}

/**
 * The --mount value for a read-only bind. Docker reads it as CSV, so the source is quoted
 * (a path may contain a comma), with any quote in it doubled. The target is not quoted, so
 * it must be a `/mediaplane-host/<number>` path: a comma or newline in it could add or
 * override options, such as `readonly`.
 */
export function bindMount(mount: HelperMount): string {
  if (!/^\/mediaplane-host\/\d+$/.test(mount.target)) {
    throw new Error(
      `bindMount: the target ${JSON.stringify(mount.target)} is not /mediaplane-host/<number>`,
    );
  }
  return `type=bind,"source=${mount.source.replaceAll('"', '""')}",target=${mount.target},readonly`;
}

/**
 * `docker container inspect` lines of "<id> <network mode> <started at> <project>". A
 * container of any other Compose project is refused: Mediaplane acts on its own project
 * only (spec §7.2(2)).
 */
export function parseDetails(stdout: string, project: string): ContainerDetails[] {
  return stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .flatMap(([id, networkMode, startedAt, owner]) => {
      if (id === undefined || networkMode === undefined || startedAt === undefined) {
        return [];
      }
      if (owner !== project) {
        throw new RuntimeError(
          `container ${id.slice(0, 12)} is not in the Compose project "${project}"`,
        );
      }
      return [{ id, networkMode, startedAt }];
    });
}

/** `docker compose config --hash` output: one "service hash" pair per line. */
export function parseHashes(stdout: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const [service, hash] = line.trim().split(/\s+/);
    if (service !== undefined && service !== '' && hash !== undefined)
      hashes[service] = hash;
  }
  return hashes;
}

interface PsLine {
  Service?: unknown;
  ID?: unknown;
  State?: unknown;
  Health?: unknown;
  Labels?: unknown;
  Publishers?: unknown;
}

interface PsPublisher {
  URL?: unknown;
  PublishedPort?: unknown;
  Protocol?: unknown;
}

/** `docker compose ps --no-trunc --format json` output: one JSON object per line. */
export function parseContainers(stdout: string): ContainerState[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .flatMap((line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        throw new RuntimeError(
          `docker compose ps printed a line that is not JSON: ${line.slice(0, 120)}`,
        );
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return [];
      const raw = parsed as PsLine;
      // Labels is one "k=v,k=v" string whose values may contain commas: match, don't split.
      const labels = text(raw.Labels);
      // A `compose run` leftover is not one of the service's containers: never plan it.
      if (/(?:^|,)com\.docker\.compose\.oneoff=True(?:,|$)/.test(labels)) return [];
      const publishers = Array.isArray(raw.Publishers)
        ? (raw.Publishers as PsPublisher[])
        : [];
      const workingDir = labelValue(labels, 'com.docker.compose.project.working_dir');
      const state: ContainerState = {
        service: text(raw.Service),
        id: text(raw.ID),
        state: text(raw.State),
        health: text(raw.Health),
        configHash: /com\.docker\.compose\.config-hash=([0-9a-f]{64})/.exec(labels)?.[1],
        published: publishers.flatMap((p) =>
          typeof p.PublishedPort === 'number' && p.PublishedPort > 0
            ? [
                {
                  address: text(p.URL),
                  port: p.PublishedPort,
                  protocol: p.Protocol === 'udp' ? ('udp' as const) : ('tcp' as const),
                },
              ]
            : [],
        ),
        ...(workingDir === undefined ? {} : { workingDir }),
      };
      return [state];
    });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * One label's value from ps's "k=v,k=v" Labels string. Values can contain commas (the
 * config_files label lists several files), so a value runs up to the next ",<key>=". A
 * key is anything without a comma or "=": keys such as app.kubernetes.io/name hold "/",
 * and Compose 5 prints the labels in any order.
 */
function labelValue(labels: string, key: string): string | undefined {
  const name = key.replaceAll('.', '\\.');
  return new RegExp(`(?:^|,)${name}=(.*?)(?=,[^,=]+=|$)`).exec(labels)?.[1];
}

/**
 * Replace every secret value in `text` with "***". Longest first, so a value that contains
 * another is replaced whole; plain-string matching, so regex characters in a value are safe.
 */
function redact(text: string, values: Record<string, string>): string {
  return Object.values(values)
    .filter((value) => value !== '')
    .sort((a, b) => b.length - a.length)
    .reduce((redacted, value) => redacted.replaceAll(value, '***'), text);
}

function firstLine(value: string): string {
  return value.trim().split('\n')[0] ?? '';
}

function spawnFailure(label: string, timeoutMs: number, cause: unknown): string {
  if (hasCode(cause, 'ENOENT')) return 'docker was not found on PATH';
  if (hasCode(cause, 'ETIMEDOUT')) {
    return `docker ${label} did not finish within ${String(timeoutMs / 1000)}s; check that the Docker daemon is responding`;
  }
  return `could not run docker: ${cause instanceof Error ? cause.message : String(cause)}`;
}

function hasCode(cause: unknown, code: string): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === code;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
