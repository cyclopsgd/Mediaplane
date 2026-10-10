import type { z } from 'zod';
import type { AppSettings, StackConfig } from '../config/schema';
import type { Diagnostic } from '../diagnostics';

export type Arch = 'amd64' | 'arm64';
export type Category =
  'network' | 'download' | 'indexer' | 'pvr' | 'media-server' | 'requests';

export interface ImagePin {
  repo: string;
  /** Exact upstream tag, never "latest". */
  tag: string;
  /** Multi-arch index digest: "sha256:" + 64 hex characters. */
  digest: string;
}

export interface PortSpec {
  name: string;
  container: number;
  protocol?: 'tcp' | 'udp';
  /** false = reachable only inside the stack. Default true. */
  publish?: boolean;
  /** Host and container port must be equal; this env var sets the container port. */
  hostEqualsContainer?: { env: string };
}

/** Where a secret's value comes from. */
export type SecretSource =
  | { generate: 'hex32' | 'qbt' }
  | { createdBy: 'app' }
  | { userProvided: 'vpn.private_key' | 'plex.token' };

/** How secrets and first-run setup reach the app, in order. */
export type CredentialStep =
  | { step: 'env'; var: string; secret: string }
  | { step: 'config-file'; path: string }
  | { step: 'bootstrap-api'; action: string };

export interface HealthCheck {
  /** Compose healthcheck test. Write a literal $ as $$ (Compose interpolates). */
  test: string[];
  startPeriod?: string;
}

/** What an app's hooks can see once the stack is resolved. */
export interface AppContext<Options = Record<string, unknown>> {
  config: StackConfig;
  settings: AppSettings;
  options: Options;
  /**
   * LAN subnets: network.lan_subnet, or those of the host's private addresses. Empty on a
   * cloud VM without lan_subnet, whose private network is not a LAN.
   */
  lanSubnets: string[];
  /** Whether the web UIs are published on the LAN: network.bind is lan or all. */
  publishesOnLan: boolean;
  /**
   * The LAN subnets whose clients may be trusted: lanSubnets while publishesOnLan,
   * otherwise none. Use it, not lanSubnets, to skip a login or open a firewall.
   */
  lanClientSubnets: string[];
}

/**
 * A file the app reads when it starts, written into its appdata folder before its first
 * start, and only when absent (spec §6.4). The app rewrites it afterwards, so Mediaplane
 * never updates it.
 */
export interface ConfigFile {
  /** Relative to the app's appdata folder, such as "qBittorrent/qBittorrent.conf". */
  path: string;
  content: string;
  /**
   * Matches the file for as long as it holds what Mediaplane seeded (its key), even after
   * the app has rewritten it. An existing file that doesn't match is from an install made
   * before Mediaplane seeded the app, and plan reports it.
   */
  seeded: RegExp;
}

/** What a pre-start file renderer sees. It holds secrets: never log or print it. */
export interface ConfigFileContext<
  Options = Record<string, unknown>,
> extends AppContext<Options> {
  /** The shared admin login (spec §6.1). */
  admin: { username: string; password: string };
  /** One of this app's generated secrets, such as "apiKey". Throws when it is missing. */
  secret(name: string): string;
  /** Cryptographically random bytes, such as a password hash's salt. */
  random(size: number): Buffer;
}

export interface ServiceExtras {
  cap_add?: string[];
  devices?: string[];
  init?: boolean;
}

export interface AppDefinition<Options = Record<string, unknown>> {
  id: string;
  name: string;
  category: Category;
  image: ImagePin;
  arch: Arch[];
  ports: PortSpec[];
  /** Container mount points for the app's config dir and the shared data root. */
  volumes: { appdata?: string; data?: string };
  runAs: 'puid-env' | 'user-directive' | 'image-default' | `fixed:${number}`;
  /** Capabilities, e.g. "download-client:torrent" (also satisfies "download-client"). */
  provides: string[];
  requires: { capability: string; min: number }[];
  /** Capabilities that no other enabled app may also provide. */
  exclusive?: string[];
  secrets: Record<string, SecretSource>;
  credentials: CredentialStep[];
  /** 'image' uses the image's own HEALTHCHECK. 'none' has no health check. */
  health: HealthCheck | 'image' | 'none';
  /** App-specific settings under apps.<id> in stack.yaml. */
  options?: z.ZodType<Options>;
  /** Apps this one needs, given its options (e.g. qBittorrent with a VPN needs Gluetun). */
  implies?(options: Options): string[];
  /** Run inside another app's network namespace. */
  networkVia?(options: Options): string | undefined;
  env?(ctx: AppContext<Options>): Record<string, string>;
  extras?(ctx: AppContext<Options>): ServiceExtras;
  validate?(ctx: AppContext<Options>): Diagnostic[];
  /** Files to write into its appdata folder before its first start, if absent. Pure. */
  configFiles?(ctx: ConfigFileContext<Options>): ConfigFile[];
  experimental: boolean;
}

export type Catalog = readonly AppDefinition[];

/** Identity function that gives catalog entries full type inference. */
export function defineApp<Options = Record<string, unknown>>(
  definition: AppDefinition<Options>,
): AppDefinition<Options> {
  return definition;
}
