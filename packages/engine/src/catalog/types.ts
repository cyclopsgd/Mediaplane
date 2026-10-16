import type { z } from 'zod';
import type { AppSettings, StackConfig } from '../config/schema';
import type { Diagnostic } from '../diagnostics';
import type { AppApi, KeyScheme } from '../http/client';
import type { Integration } from '../integrations/types';
import type { ResolvedStack } from '../resolver/resolve';

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

/**
 * How secrets and first-run setup reach the app, in order. Files written before the
 * first start come from configFiles instead.
 */
export type CredentialStep =
  | { step: 'env'; var: string; secret: string }
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
   * LAN subnets, each as its network address (192.168.1.0/24): network.lan_subnet, its
   * host bits cleared, or those of the host's private addresses. Empty on a cloud VM
   * without lan_subnet, whose private network is not a LAN.
   */
  lanSubnets: string[];
  /** Whether the web UIs are published on the LAN: network.bind is lan or all. */
  publishesOnLan: boolean;
  /**
   * Where a browser reaches the web UIs: the bind addresses, or with bind: all, 127.0.0.1
   * and this host's private addresses.
   */
  webAddresses: string[];
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

/**
 * How Mediaplane reaches an app's HTTP API (spec §6.1), over the stack's wiring network.
 * An app with one joins that network. One that runs in another app's network namespace,
 * as qBittorrent does behind Gluetun, is reached through that app, which joins for it.
 */
export interface ApiSpec {
  /** The port, by name, that serves it: its container port, after apps.<id>.port. */
  port: string;
  /** A path that answers 200 without a key once the app is ready: /ping for the arrs. */
  ready: string;
  /** Which of the app's secrets is its API key, and how a request carries it. */
  key: { secret: string; scheme: KeyScheme };
  /** A path that answers 200 only with the key: it shows the key still works. */
  check: string;
}

/**
 * First-run setup that an app opens to anyone who reaches it, which Mediaplane finishes
 * before it publishes the app's ports (spec §5 step 9, §6.4: bootstrap before publish),
 * over the wiring network, without a key: Jellyfin's startup wizard, then the API key that
 * only the app can make; Seerr's first sign-in, through Jellyfin.
 */
export interface Bootstrap {
  /**
   * The secret the setup makes, which the app creates (`createdBy: 'app'`): its key. None
   * when Mediaplane chose the app's key (Seerr's, in `API_KEY`): its `done` file alone
   * then says whether the setup is done.
   */
  secret?: string;
  /**
   * A file in the app's appdata folder that says the setup is done, such as Jellyfin's
   * system.xml: until it exists and matches `pattern`, the app starts unpublished.
   */
  done: { path: string; pattern: RegExp };
  /** Whether anyone who reaches the app can still claim it. Throws AppApiError. */
  open(api: AppApi): Promise<boolean>;
  /**
   * Finish what is left of the setup as the shared admin, in `stack`, and give the secret
   * it made, or the one the app already holds for Mediaplane; undefined for a setup that
   * makes none. Throws AppApiError, of kind `auth` when the app refuses the shared admin:
   * an app the plan started unpublished then stays so. Throws SetupWaiting when another
   * app the setup goes through isn't ready for it: Jellyfin refusing the shared admin that
   * Seerr signs in as.
   */
  run(
    api: AppApi,
    admin: { username: string; password: string },
    stack: ResolvedStack,
  ): Promise<string | undefined>;
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
  /** Its HTTP API, when Mediaplane calls it. */
  api?: ApiSpec;
  /** What Mediaplane wires in it, through `api` (catalog/<app>/integration.ts). */
  integration?: Integration;
  /** First-run setup to finish through `api` before its ports are published. */
  bootstrap?: Bootstrap;
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
  /**
   * How you sign in to its web UI: 'shared' once the shared admin login works there, or
   * the slice that brings a login. Every app with a published web UI says, and
   * `mediaplane credentials` lists them.
   */
  login?: 'shared' | { comingIn: string };
  experimental: boolean;
}

export type Catalog = readonly AppDefinition[];

/** Identity function that gives catalog entries full type inference. */
export function defineApp<Options = Record<string, unknown>>(
  definition: AppDefinition<Options>,
): AppDefinition<Options> {
  return definition;
}
