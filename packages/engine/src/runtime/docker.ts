import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeExec, type Exec, type ExecResult } from './exec';
import {
  RuntimeError,
  type ContainerState,
  type HashesResult,
  type Runtime,
} from './types';

export const OVERRIDE_PATH = 'compose.override.yaml';

export interface DockerRuntimeOptions {
  /** Absolute Mediaplane home: the Compose project directory. */
  home: string;
  project: string;
  exec?: Exec;
  env?: NodeJS.ProcessEnv;
}

export function createDockerRuntime(options: DockerRuntimeOptions): Runtime {
  const exec = options.exec ?? nodeExec;
  const baseEnv = options.env ?? process.env;

  async function docker(
    args: readonly string[],
    extra: { input?: string; env?: Record<string, string> } = {},
  ): Promise<ExecResult> {
    try {
      return await exec('docker', args, {
        input: extra.input,
        env: { ...baseEnv, ...extra.env },
        cwd: '/',
      });
    } catch (cause) {
      throw new RuntimeError(
        isNotFound(cause)
          ? 'docker was not found on PATH'
          : `could not run docker: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    }
  }

  return {
    async versions() {
      const engine = await docker(['version', '--format', '{{.Server.Version}}']);
      if (engine.code !== 0) {
        throw new RuntimeError(`cannot talk to Docker: ${firstLine(engine.stderr)}`);
      }
      const compose = await docker(['compose', 'version', '--short']);
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
      const result = await docker([
        'compose',
        '-p',
        options.project,
        'ps',
        '--all',
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

/** `docker compose ps --format json` output: one JSON object per line. */
export function parseContainers(stdout: string): ContainerState[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const raw = JSON.parse(line) as PsLine;
      // Labels is one "k=v,k=v" string whose values may contain commas: match, don't split.
      const labels = text(raw.Labels);
      const publishers = Array.isArray(raw.Publishers)
        ? (raw.Publishers as PsPublisher[])
        : [];
      return {
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

function isNotFound(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === 'ENOENT';
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
