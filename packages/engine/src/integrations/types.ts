import type { AppApi } from '../http/client';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import type { KnownResource } from './resources';

/** A managed field's value. */
export type Scalar = string | number | boolean;

/** Managed fields, by name. */
export type Fields = Readonly<Record<string, Scalar>>;

/** What Mediaplane wants a resource to be (spec §6.3: D). */
export interface DesiredResource {
  /** Its name in the app. */
  name: string;
  /** The managed fields: compared with the app's, and kept in resources.json. */
  fields: Fields;
  /** The secret values it holds: applied and verified, never compared, kept or shown. */
  secrets: Readonly<Record<string, string>>;
  /**
   * Folders, as the app's container sees them, that must exist before the app can make
   * it, such as a root folder's (spec §6.2). The wire step makes them first, as the
   * stack's user, in a throwaway container of the app's own service.
   */
  folders?: readonly string[];
}

/** What the app holds now (spec §6.3: O): its id, its name and its managed fields. */
export interface ObservedResource {
  /** The app's id for it; null for a singleton, such as the app's own settings. */
  id: string | number | null;
  name: string;
  fields: Fields;
}

/** What a resource's desired() sees. It holds secrets: never log, print or keep it. */
export interface WiringContext {
  stack: ResolvedStack;
  app: ResolvedApp;
  /** The shared admin login (spec §6.1). */
  admin: { username: string; password: string };
  /**
   * The apps' keys from the secrets store, by app, then by name: what a resource holds of
   * another app's, such as qBittorrent's key in Sonarr's download client.
   */
  keys: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/**
 * One resource Mediaplane manages in an app (spec §3.2, §6.2), such as Sonarr's admin
 * login or its download client. Its address is "<app>.<name>", and a managed field's is
 * "<app>.<name>.<field>", as override keys name them (spec §4.2).
 */
export interface ResourceSpec {
  /** One segment of lower-case letters, digits and "_": "admin", "download_client". */
  name: string;
  /** The managed fields: compared, kept, and listed in the app's README. */
  fields: readonly string[];
  /** The secrets it holds, by name: applied and checked with verify, never compared. */
  secrets: readonly string[];
  /** Resources ("<app>.<name>") that must be in place first: one that failed skips this. */
  requires?: readonly string[];
  /** What the stack wants, or undefined when it wants none. Pure. */
  desired(ctx: WiringContext): DesiredResource | undefined;
  /**
   * What the app holds: by the id resources.json recorded (`known`), else by the exact
   * name Mediaplane gives it (spec §6.3), which `desired` holds where it comes from the
   * stack (Jellyfin's admin is the shared admin's user name). Undefined when it holds none.
   */
  observe(
    api: AppApi,
    known: KnownResource | undefined,
    desired?: DesiredResource,
  ): Promise<ObservedResource | undefined>;
  /**
   * Whether the app takes the desired secrets: a sign-in, or the app's own test of what it
   * holds (`observed`) (spec §6.3, "secrets are verified, never compared"). Required when
   * `secrets` isn't empty. Asked only while every managed field matches: update sets the
   * secrets with the fields. Throws AppApiError when the app can't say.
   */
  verify?(
    api: AppApi,
    desired: DesiredResource,
    observed: ObservedResource,
  ): Promise<boolean>;
  /** Make it. The id the app gave it, or null for a singleton. */
  create(api: AppApi, desired: DesiredResource): Promise<{ id: string | number | null }>;
  /**
   * Make what the app holds match: the managed fields and the secrets, always both, since
   * the secrets go unchecked when a field differs. Idempotent.
   */
  update(
    api: AppApi,
    desired: DesiredResource,
    observed: ObservedResource,
  ): Promise<void>;
}

/** How Mediaplane wires one app (spec §3.2): its resources, after which apps. */
export interface Integration {
  /** Apps whose resources go first (spec §6.2, "Ordering"). Others are ignored. */
  after: readonly string[];
  resources: readonly ResourceSpec[];
}

/** Identity function that gives an integration full type inference. */
export function defineIntegration(integration: Integration): Integration {
  return integration;
}
