import type { FakeReply, FakeRequest } from './http';

/**
 * What Sonarr, Radarr and Prowlarr have in common in a "provider": Servarr's name for a
 * download client, a link to another app (Prowlarr's application) or an indexer proxy. Each
 * app keeps them with their secrets in clear, and shows them with the key masked.
 */
export interface FakeProviderBase {
  id: number;
  name: string;
  implementation: string;
  fields: { name: string; value?: unknown }[];
}

/** The value of the field `name` in a provider's settings, if it has one. */
export function fieldValue(
  sent: Pick<FakeProviderBase, 'fields'>,
  name: string,
): unknown {
  return sent.fields.find((f) => f.name === name)?.value;
}

/** A path as the fake apps list it: without a trailing "/" (the root stays "/"). */
export function withoutSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** What the arrs say when their test can't open a TLS connection to an app. */
const SSL_FAILURE = 'The SSL connection could not be established, see inner exception.';

/**
 * Why an arr's test of the app at `at` ("host:port") can't reach it, or undefined when it
 * can: the host isn't found (`unresolved` is the arr's words for that), the port is
 * refused, or the app serves no TLS. The checks run in that order. Each arr words the rest
 * of its refusal, around this reason.
 */
export function unreachable(
  at: string,
  reach: { resolves: boolean; portOpen: boolean; tls: boolean },
  unresolved: string,
): string | undefined {
  if (!reach.resolves) return `${unresolved} (${at})`;
  if (!reach.portOpen) return `Connection refused (${at})`;
  return reach.tls ? SSL_FAILURE : undefined;
}

/** An app's refusal of a save or a test: 400, and its validation list. */
export type FakeRefusal = FakeReply & { status: 400 };

/** The refusal an app gives for `property`, with the `details` it may add. */
export function refusal(
  property: string,
  message: string,
  details?: string,
): FakeRefusal {
  return {
    status: 400,
    body: [
      {
        propertyName: property,
        errorMessage: message,
        ...(details === undefined ? {} : { detailedDescription: details }),
        isWarning: false,
      },
    ],
  };
}

/** The settings a provider holds a secret in: a key, or Plex's token. */
const SECRET_FIELDS: ReadonlySet<string> = new Set(['apiKey', 'authToken']);

/** A provider as the app shows it: its key masked. */
export function maskedProvider<P extends FakeProviderBase>(held: P): P {
  return {
    ...held,
    fields: held.fields.map((f) =>
      SECRET_FIELDS.has(f.name) && f.value !== undefined
        ? { ...f, value: '********' }
        : f,
    ),
  };
}

/** How one kind of provider is kept and tested by an app. */
export interface FakeProviderKind<P extends FakeProviderBase> {
  /** Where the app serves them, such as `/api/v3/downloadclient`. */
  path: string;
  /** The providers the app holds. */
  held: P[];
  /** Its templates, as `…/schema` gives them. */
  templates: () => unknown[];
  /**
   * The app's own test of `sent`, with `key` in clear (the one held, for a masked key): its
   * refusal, or undefined when it passes.
   */
  test: (sent: P, key: unknown) => FakeRefusal | undefined;
  /** Whether a new provider is tested as it is saved. Default: always. */
  testedOnCreate?: (sent: P) => boolean;
  /** What a new provider holds when it is sent without. */
  defaults?: Partial<P>;
}

/**
 * One kind of provider at `path`, as Sonarr, Radarr and Prowlarr serve them: listed, read
 * and updated by id, made from `templates`, and tested by `test`, with a masked key
 * standing for the one held.
 * - A new provider is tested as it is saved, with forceSave too (which skips only the
 *   test's warnings), unless `testedOnCreate` says no; one that fails isn't saved.
 * - An update with forceSave isn't tested.
 * - A name is taken once: a new provider under one already held, or an update renaming one
 *   to another's, is refused (`Name: Should be unique`).
 */
export function fakeProviders<P extends FakeProviderBase>(
  request: FakeRequest,
  { path, held, templates, test, testedOnCreate, defaults }: FakeProviderKind<P>,
): FakeReply | undefined {
  const { method } = request;
  if (request.path === `${path}/schema`) return { status: 200, body: templates() };
  if (request.path === path && method === 'GET') {
    return { status: 200, body: held.map(maskedProvider) };
  }
  const keyOf = (sent: P) => {
    const field = sent.fields.find((f) => SECRET_FIELDS.has(f.name));
    const stored = held
      .find((p) => p.id === sent.id)
      ?.fields.find((f) => f.name === field?.name)?.value;
    return field?.value === '********' ? stored : field?.value;
  };
  const taken = () => refusal('Name', 'Should be unique');
  const one = new RegExp(`^${path}/(\\d+)(\\?forceSave=true)?$`).exec(request.path);
  const found = held.find((p) => p.id === Number(one?.[1]));
  if (one !== null && method === 'GET') {
    return found === undefined
      ? { status: 404 }
      : { status: 200, body: maskedProvider(found) };
  }
  if (request.path === `${path}?forceSave=true` && method === 'POST') {
    const sent = { ...defaults, ...JSON.parse(request.body) } as P;
    if (held.some((p) => p.name === sent.name)) return taken();
    const failed = testedOnCreate?.(sent) === false ? undefined : test(sent, keyOf(sent));
    if (failed !== undefined) return failed;
    const made = { ...sent, id: held.length + 1 };
    held.push(made);
    return { status: 201, body: maskedProvider(made) };
  }
  if (one?.[2] !== undefined && method === 'PUT' && found !== undefined) {
    const sent = JSON.parse(request.body) as P;
    if (held.some((p) => p.name === sent.name && p.id !== found.id)) return taken();
    // "********" keeps the key it holds.
    const kept = (name: string) => found.fields.find((f) => f.name === name)?.value;
    Object.assign(found, {
      ...sent,
      fields: sent.fields.map((f) =>
        SECRET_FIELDS.has(f.name) && f.value === '********'
          ? { ...f, value: kept(f.name) }
          : f,
      ),
    });
    return { status: 202, body: maskedProvider(found) };
  }
  if (request.path === `${path}/test` && method === 'POST') {
    const sent = JSON.parse(request.body) as P;
    return test(sent, keyOf(sent)) ?? { status: 200, body: {} };
  }
  return undefined;
}
