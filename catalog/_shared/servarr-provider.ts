import {
  AppApiError,
  type AppApi,
  type DesiredResource,
  type KnownResource,
  type ObservedResource,
} from '@mediaplane/engine';
import { z } from 'zod';

/** One setting of a Servarr provider; the rest of it goes back as it came. */
const setting = z.looseObject({ name: z.string(), value: z.unknown().optional() });

/**
 * A provider as a Servarr app gives it: Sonarr's or Radarr's download client, or one of
 * Prowlarr's links to them (its applications) or indexer proxies. Its secrets are masked
 * as "********", and the rest of it goes back as it came, so a setting Mediaplane doesn't
 * manage stays the user's.
 */
const provider = z.looseObject({
  id: z.number(),
  name: z.string(),
  implementation: z.string(),
  fields: z.array(setting),
});

export type Provider = z.infer<typeof provider>;

/** One of the app's templates for a new provider (`…/schema`). */
const template = z.looseObject({ implementation: z.string(), fields: z.array(setting) });

const created = z.looseObject({ id: z.number() });

/** One kind of provider Mediaplane makes in a Servarr app, and where the app keeps it. */
export interface ProviderKind {
  /** Where: "/api/v3/downloadclient", "/api/v1/applications", "/api/v1/indexerproxy". */
  path: string;
  /** Its implementation, as the app names it: "QBittorrent", "Sonarr", "FlareSolverr". */
  implementation: string;
  /** What it is, in messages: "qBittorrent download client". */
  what: string;
  /** Whose settings it holds, in messages: "qBittorrent". */
  of: string;
}

/** What a provider's setting `name` holds, as the app gives it. */
export function settingOf(held: Provider, name: string): unknown {
  return held.fields.find((f) => f.name === name)?.value;
}

/** A setting's text, or "" when it holds none. */
export function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A setting's number, or 0 when it holds none. */
export function numberOf(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/**
 * The secret `name` that `desired` holds, to send in clear in a request body: one app's
 * key, given to another. desired() gives it whenever it wants the provider.
 */
export function secretOf(desired: DesiredResource, name: string): string {
  const value = desired.secrets[name];
  if (value === undefined) throw new Error(`${desired.name} has no ${name} to send`);
  return value;
}

/**
 * The provider Mediaplane made, among the app's of `kind`: by the id resources.json
 * recorded, else by the name Mediaplane gives it (spec §6.3).
 */
export async function findProvider(
  api: AppApi,
  kind: ProviderKind,
  known: KnownResource | undefined,
  name: string,
): Promise<Provider | undefined> {
  const held = (await api.get(kind.path, z.array(provider))).filter(
    (p) => p.implementation === kind.implementation,
  );
  return (
    held.find((p) => known !== undefined && p.id === known.id) ??
    held.find((p) => p.name === name)
  );
}

/**
 * `body`, as the app gave it at `read`, with `settings` set: secrets among them in clear,
 * in this request body only. A setting the app doesn't have means a version Mediaplane
 * doesn't know: say so, rather than save a provider that can't work.
 */
function withSettings<T extends { fields: z.infer<typeof setting>[] }>(
  api: AppApi,
  kind: ProviderKind,
  read: string,
  body: T,
  settings: Readonly<Record<string, unknown>>,
): T {
  const missing = Object.keys(settings).filter(
    (name) => !body.fields.some((f) => f.name === name),
  );
  if (missing.length > 0) {
    throw new AppApiError(
      `${api.name} at ${api.where} has no ${missing.join(', ')} setting for ${kind.of}, which Mediaplane needs (GET ${read})`,
      { kind: 'protocol' },
    );
  }
  return {
    ...body,
    fields: body.fields.map((f) =>
      Object.hasOwn(settings, f.name) ? { ...f, value: settings[f.name] } : f,
    ),
  };
}

/**
 * Make one from the app's own template (without its UI presets), with `settings` and the
 * provider's own properties `top` (its name, enable, tags…), saved with forceSave. The
 * app still tests a new provider as it saves it, skipping only the warnings, so a create
 * fails while the test does: while the arr can't reach qBittorrent, say.
 */
export async function createProvider(
  api: AppApi,
  kind: ProviderKind,
  settings: Readonly<Record<string, unknown>>,
  top: Readonly<Record<string, unknown>>,
): Promise<{ id: number }> {
  const schema = `${kind.path}/schema`;
  const offered = (await api.get(schema, z.array(template))).find(
    (t) => t.implementation === kind.implementation,
  );
  if (offered === undefined) {
    throw new AppApiError(
      `${api.name} at ${api.where} offers no ${kind.what} (GET ${schema})`,
      { kind: 'protocol' },
    );
  }
  const { presets, ...body } = offered;
  const made = await api.post(
    `${kind.path}?forceSave=true`,
    { ...withSettings(api, kind, schema, body, settings), ...top },
    created,
  );
  return { id: made.id };
}

/**
 * Update the provider with the app's id `id`: PUT it back as the app gave it, with
 * `settings` and `top`, and its masked secrets as they came, which keeps them. With
 * forceSave the app skips its test, so an update is saved even while the test would
 * fail: the check says whether it works.
 */
export async function updateProvider(
  api: AppApi,
  kind: ProviderKind,
  id: ObservedResource['id'],
  settings: Readonly<Record<string, unknown>>,
  top: Readonly<Record<string, unknown>>,
): Promise<void> {
  const path = `${kind.path}/${String(id)}`;
  const held = await api.get(path, provider);
  await api.put(`${path}?forceSave=true`, {
    ...withSettings(api, kind, path, held, settings),
    ...top,
  });
}

/**
 * The app's own test of the provider it holds as `id`, sent as the app gave it (its
 * secrets masked) and with that id, or the app tests it as a new one and refuses its
 * name. True when it passes; false when it fails on one of `credentials`, a secret the
 * update sets; otherwise the app's own words, thrown.
 */
export async function testProvider(
  api: AppApi,
  kind: ProviderKind,
  id: ObservedResource['id'],
  name: string,
  credentials: readonly string[],
): Promise<boolean> {
  const held = await api.get(`${kind.path}/${String(id)}`, provider);
  const result = await api.test(`${kind.path}/test`, held);
  if (result.passed) return true;
  if (result.failures.some((f) => credentials.includes(f.property))) return false;
  const said = result.failures
    .map((f) => (f.property === '' ? f.message : `${f.property}: ${f.message}`))
    .join('; ');
  throw new AppApiError(
    `${api.name} at ${api.where} tested ${name}, and it failed: ${said} (POST ${kind.path}/test)`,
    { kind: 'rejected', status: 400 },
  );
}
