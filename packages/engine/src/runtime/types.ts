export interface PublishedAddress {
  address: string;
  port: number;
  protocol: 'tcp' | 'udp';
}

/** One container of the Compose project, as `docker compose ps` reports it. */
export interface ContainerState {
  service: string;
  id: string;
  /** "running", "exited", "created", … */
  state: string;
  /** "healthy", "unhealthy", "starting", or "" when the service has no health check. */
  health: string;
  /** Compose's com.docker.compose.config-hash label: equal hashes mean no recreate. */
  configHash: string | undefined;
  published: PublishedAddress[];
}

export type HashesResult =
  { ok: true; hashes: Record<string, string> } | { ok: false; error: string };

/** Everything Mediaplane asks of Docker. One implementation drives the docker CLI. */
export interface Runtime {
  /** Docker Engine and Compose versions; throws RuntimeError when Docker can't be reached. */
  versions(): Promise<{ engine: string; compose: string }>;
  /** Compose's per-service config hashes for an unwritten compose.yaml (+ the user's override). */
  configHashes(compose: string, values: Record<string, string>): Promise<HashesResult>;
  /** Every container in the project, running or not. */
  containers(): Promise<ContainerState[]>;
}

/** Docker is missing or unreachable; the message says which, in words for the user. */
export class RuntimeError extends Error {
  override readonly name = 'RuntimeError';
}
