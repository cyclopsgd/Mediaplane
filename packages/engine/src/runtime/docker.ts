import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { OVERRIDE_PATH } from '../paths';
import { nodeExec, type Exec, type ExecResult } from './exec';
import {
  RuntimeError,
  type ContainerState,
  type HashesResult,
  type Runtime,
} from './types';

/** Mediaplane's own deployment (spec §4.4): read-only to Mediaplane, never managed. */
export const SYSTEM_PROJECT = 'mediaplane-system';

/** How long a docker call may take before Mediaplane gives up on it, in ms. */
export const DOCKER_TIMEOUTS = { query: 60_000 } as const;

/**
 * Whether Mediaplane may act on a Compose project: "mediaplane" or "mediaplane-<name>",
 * never its own "mediaplane-system" (spec §7.2(2)).
 */
export function isManagedProject(project: string): boolean {
  return (
    /^mediaplane(?:-[a-z0-9][a-z0-9_-]*)?$/.test(project) && project !== SYSTEM_PROJECT
  );
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
    extra: { input?: string; env?: Record<string, string>; timeoutMs?: number } = {},
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
      throw new RuntimeError(spawnFailure(label, timeoutMs, cause), { cause });
    }
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
  };
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
      const publishers = Array.isArray(raw.Publishers)
        ? (raw.Publishers as PsPublisher[])
        : [];
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
      };
      return [state];
    });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
