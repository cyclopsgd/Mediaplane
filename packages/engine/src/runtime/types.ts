export interface PublishedAddress {
  address: string;
  port: number;
  protocol: 'tcp' | 'udp';
}

/** One container of the Compose project, as `docker compose ps` reports it. */
export interface ContainerState {
  service: string;
  /** The full 64-character container ID. */
  id: string;
  /** "running", "exited", "created", … */
  state: string;
  /** "healthy", "unhealthy", "starting", or "" when the service has no health check. */
  health: string;
  /** Compose's com.docker.compose.config-hash label: equal hashes mean no recreate. */
  configHash: string | undefined;
  /**
   * Compose's com.docker.compose.project.working_dir label: the project directory the
   * container was created from. Mediaplane always passes the home, so another folder
   * means another home, or a hand-run `docker compose`, created it.
   */
  workingDir?: string;
  published: PublishedAddress[];
}

export type HashesResult =
  { ok: true; hashes: Record<string, string> } | { ok: false; error: string };

/** A Compose command that ran: failed ones carry Compose's last stderr lines. */
export type CommandResult = { ok: true } | { ok: false; error: string };

/** A read-only bind mount for the host helper: the host's `source`, at `target` inside. */
export interface HelperMount {
  source: string;
  target: string;
}

/** The host helper's output, or why it failed; `missingSource` is a source the host lacks. */
export type HelperResult =
  { ok: true; stdout: string } | { ok: false; error: string; missingSource?: string };

/** Everything Mediaplane asks of Docker. One implementation drives the docker CLI. */
export interface Runtime {
  /** Docker Engine and Compose versions; throws RuntimeError when Docker can't be reached. */
  versions(): Promise<{ engine: string; compose: string }>;
  /**
   * Compose's per-service config hashes for an unwritten compose.yaml (+ the user's override).
   * `values` are secret values, passed to Compose in its environment; any of them that
   * appear in a returned `error` are replaced with `***`.
   */
  configHashes(compose: string, values: Record<string, string>): Promise<HashesResult>;
  /** Every container in the project, running or not, except `compose run` one-offs. */
  containers(): Promise<ContainerState[]>;
  /**
   * Pull images that aren't present yet for the written project (compose.yaml, the
   * user's override, .env). `values` are secret values to redact from errors.
   */
  pull(values: Record<string, string>): Promise<CommandResult>;
  /** `up --detach --wait --remove-orphans` on the written project. */
  up(waitSeconds: number, values: Record<string, string>): Promise<CommandResult>;
  /**
   * `chown -R uid:gid path` as root, in a throwaway container of `service` (`compose
   * run --rm --no-deps`), so the project's own image and mounts are used.
   */
  chown(
    service: string,
    path: string,
    owner: { uid: number; gid: number },
    values: Record<string, string>,
  ): Promise<CommandResult>;
  /**
   * Run the host helper (spec §4.2): a throwaway container of Mediaplane's own `image` on
   * the host network, as `user`, with no capabilities, a read-only root and `mounts`
   * bound read-only, running `mediaplane host-report <request>`. It never pulls. A helper
   * that ran and failed is a `HelperResult`. This throws a `HelperError` when the helper
   * doesn't finish in time, and a `RuntimeError` when docker can't be started.
   */
  hostHelper(
    image: string,
    request: string,
    mounts: readonly HelperMount[],
    user: { uid: number; gid: number },
  ): Promise<HelperResult>;
}

/** Docker is missing or unreachable; the message says which, in words for the user. */
export class RuntimeError extends Error {
  override readonly name: string = 'RuntimeError';
}

/**
 * The host helper could not run, did not finish, or printed something the engine cannot
 * read. `hint` says what to check, when the failure itself points to it.
 */
export class HelperError extends RuntimeError {
  override readonly name: string = 'HelperError';
  readonly hint: string | undefined;

  constructor(message: string, options: ErrorOptions & { hint?: string } = {}) {
    super(message, options);
    this.hint = options.hint;
  }
}
