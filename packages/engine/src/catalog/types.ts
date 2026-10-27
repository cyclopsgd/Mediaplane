import type { z } from 'zod';
import type { AppSettings, StackConfig } from '../config/schema';
import type { Diagnostic } from '../diagnostics';
import type { AppApi, KeyScheme } from '../http/client';
import type { Integration } from '../integrations/types';
import type { PlexTv } from '../plextv/client';
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
  /**
   * Whether it holds the shared admin password (as a hash), which the app takes as its
   * admin's when it starts: qBittorrent's conf. Once apply has written it and started the
   * app, the app has that password (`shared.adminPasswordNotIn` no longer names it). The
   * app's own admin resource (`ownAdmin`) must set it otherwise.
   */
  givesAdminPassword?: boolean;
}

/**
 * Where an app keeps one of its keys in its appdata folder (spec §6.1, key recovery): a
 * key Mediaplane gave it, or one it made. When state/secrets.json lacks the key, plan and
 * apply read it from here before generating anything, so a lost store never locks
 * Mediaplane out of an app that still holds its key. Never read or written through a link
 * that leads out of the app's appdata folder.
 */
export type KeyFile =
  | {
      /** Relative to the app's appdata folder, such as "config.xml". */
      path: string;
      /**
       * The key the file's text holds, or undefined when it holds none. Pure. Throws on
       * text it can't understand (not the form the app writes): the file is then
       * unreadable, which stops `plan`, rather than holding none.
       */
      read(text: string): string | undefined;
      /**
       * The file's text with `key` in it, as the app keeps it, everything else as it was;
       * undefined when Mediaplane can't tell where it goes. For putting the key back at its
       * source (spec §6.3), which apply does while the app is stopped: the app reads the
       * file when it starts. Absent for a key the app takes from its environment alone.
       * Pure.
       */
      write?(text: string, key: string): string | undefined;
    }
  | {
      /** Relative to the app's appdata folder: a SQLite database the app keeps. */
      path: string;
      /**
       * Opened read-only, which the app's own writes don't notice: `query` gives at most
       * one row, whose `column` is the key (Jellyfin's newest key named Mediaplane).
       */
      sqlite: { query: string; column: string };
    };

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
  /**
   * For an app that answers `ready` before it takes changes, what says it has started:
   * the answer of `path`, asked with the key, that `done` takes. Plex answers /identity
   * while it still starts its plugins (`startState`), and refuses a new library until then
   * (probed). Asked after `ready`, again until `done` or the deadline.
   */
  started?: { path: string; done: (answer: unknown) => boolean };
}

/** What a first-run setup can use besides the app's API. It holds secrets: never print it. */
export interface BootstrapContext {
  /**
   * The keys you give that an app's API takes as its key, by app then name: Plex's token
   * (`given.plex.token`). None of state/secrets.json's: a setup reaches its own app with
   * the client apply gives it, and no other app's key.
   */
  given: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** plex.tv: called directly from source, through the plex.tv helper in the image. */
  plexTv: PlexTv;
  /**
   * The setup is done, and signs in again with what you gave anew (`--rotate plex.token`:
   * Seerr, with your new Plex token), once it has shown the app is Mediaplane's.
   */
  again?: boolean;
}

/**
 * First-run setup that an app opens to anyone who reaches it, which Mediaplane finishes
 * before it publishes the app's ports (spec §5 step 9, §6.4: bootstrap before publish),
 * over the wiring network, without a key: Jellyfin's startup wizard, then the API key that
 * only the app can make; Seerr's first sign-in, through Jellyfin; Plex's claim.
 */
export interface Bootstrap {
  /**
   * The secret the setup makes, which the app creates (`createdBy: 'app'`): its key. None
   * when Mediaplane chose the app's key (Seerr's, in `API_KEY`): no key can say the setup
   * is Mediaplane's, so it counts as done only when its `done` file says so and
   * Mediaplane's record names the app (`setUp` in state/secrets.json), made when `run`
   * succeeded. Without the record the app starts unpublished and `run` checks it.
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
   * The secrets you give that the setup signs in with, by their path in stack.yaml
   * (`plex.token`, Seerr's on a Plex stack): rotating one (`--rotate`) has the setup, done
   * already, run again, published, with `again` (BootstrapContext), so that the app takes
   * the new one. The app keeps the one it signed in with, and can't be asked which.
   */
  signsInWith?: readonly string[];
  /**
   * Environment variables for the app's start while its setup isn't done, which only
   * apply's start step gives it, with its ports unpublished: Plex's PLEX_CLAIM, a claim
   * token fetched from plex.tv. They reach Compose on its standard input, as references to
   * values in its own environment: never in compose.yaml, .env, a record or the output.
   * Each value is a secret of the run. Throws BootstrapFailed, and then nothing starts.
   */
  firstStart?(ctx: BootstrapContext): Promise<Record<string, string>>;
  /**
   * Finish what is left of the setup as the shared admin, in `stack`, and give the secret
   * it made, or the one the app already holds for Mediaplane; undefined for a setup that
   * makes none. A setup that makes none may succeed only once it has shown that the app is
   * Mediaplane's (it signed in first, or the app's admin is the shared admin's): success
   * is what the record rests on. Throws AppApiError, of kind `auth` when the app refuses
   * the shared admin: an app the plan started unpublished then stays so. Throws
   * SetupWaiting when another app the setup goes through isn't ready for it: Jellyfin
   * refusing the shared admin that Seerr signs in as.
   */
  run(
    api: AppApi,
    admin: { username: string; password: string },
    stack: ResolvedStack,
    ctx: BootstrapContext,
  ): Promise<string | undefined>;
  /**
   * For a setup that makes no key: what to do about an app found set up that Mediaplane
   * can't show is its own, the safe remedies first and starting afresh last, as sentences.
   * `container` is the app's container's name. Without it, the step says to start the app
   * afresh if you did not set it up.
   */
  claimedHint?(stack: ResolvedStack, container: string): string;
}

/**
 * How you sign in to an app's web UI: with the shared admin login (`'shared'`), with your
 * own plex.tv account (`{ own: 'Plex' }`), or with a login a later slice brings
 * (`{ comingIn }`), which no app of the catalog has now: `mediaplane credentials` keeps
 * saying `not-yet` for one, as `mediaplane.credentials/v1` allows, for the apps to come.
 */
export type AppLoginKind = 'shared' | { own: 'Plex' } | { comingIn: string };

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
  /**
   * Where it keeps its keys in its appdata folder, by the secret's name (KeyFile): each
   * key a pre-start file writes, and the keys it makes or takes from its environment.
   */
  keyFiles?: Readonly<Record<string, KeyFile>>;
  /**
   * The fewest characters it takes in the shared admin password, when that is more than
   * Mediaplane's own minimum (`ADMIN_PASSWORD_MIN_LENGTH`, 6; probed on its pinned image):
   * a shorter password is refused at plan, naming the app. Left out, it takes any password
   * of Mediaplane's minimum or more.
   */
  adminPasswordMinLength?: number;
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
   * How you sign in to its web UI (AppLoginKind), or, when that depends on the stack, how
   * in a stack with `config`: Seerr signs you in with your Plex account on a Plex stack.
   * Every app with a published web UI says, and `mediaplane credentials` lists them.
   */
  login?: AppLoginKind | ((config: StackConfig) => AppLoginKind);
  /**
   * Where its web UI is on its `web` port, when not at "/": Plex's is at "/web".
   * `mediaplane credentials` gives it in the app's addresses.
   */
  webPath?: string;
  experimental: boolean;
}

export type Catalog = readonly AppDefinition[];

/** Identity function that gives catalog entries full type inference. */
export function defineApp<Options = Record<string, unknown>>(
  definition: AppDefinition<Options>,
): AppDefinition<Options> {
  return definition;
}
