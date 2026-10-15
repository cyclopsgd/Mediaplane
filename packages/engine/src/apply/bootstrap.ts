import { AppApiError, APP_DEADLINE_MS } from '../http/client';
import {
  joinFailure,
  knownSecrets,
  notOnNetwork,
  reachApps,
  redactionValues,
  WIRING_RUNBOOK,
  type ReachedApp,
  type WiringSeams,
} from '../integrations/wiring';
import type { BootstrapChange } from '../plan/bootstrap';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { RuntimeError, type Runtime } from '../runtime/types';
import { adminLogin } from '../secrets/admin';
import { writeSecretStore, type SecretStore } from '../secrets/store';
import { redact } from '../util/redact';

export interface BootstrapOptions {
  home: string;
  stack: ResolvedStack;
  store: SecretStore;
  /** The secret values of .env: kept out of every message. */
  values: Readonly<Record<string, string>>;
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  /** What apply's own plan said to set up. */
  pending: readonly BootstrapChange[];
  /**
   * Start the stack again with `unpublished` still without their published ports, and the
   * other apps the plan started unpublished with theirs. Throws when that fails.
   */
  publish: (unpublished: readonly string[]) => Promise<void>;
  seams?: WiringSeams;
}

/** The first-run setup failed: what it said, and what to do. It keeps no cause. */
export class BootstrapFailed extends Error {
  override readonly name = 'BootstrapFailed';
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

const HINT = `fix what the error says, then run apply again: an app whose setup is still open keeps its ports unpublished until then. See ${WIRING_RUNBOOK}`;

const LEAVE_HINT = `Mediaplane steps off the stack's wiring network before Compose publishes the apps, and couldn't, so nothing was published; fix what the error says, then run apply again. See ${WIRING_RUNBOOK}`;

/** `store`, with the secret `name` of `app` set to `value`. */
function withSecret(
  store: SecretStore,
  app: string,
  name: string,
  value: string,
): SecretStore {
  return {
    ...store,
    apps: { ...store.apps, [app]: { ...store.apps[app], [name]: value } },
  };
}

/**
 * Apply's bootstrap step (spec §5 step 9, §6.4): for each app the plan names, reach it over
 * the wiring network, without a key, and finish its first-run setup as the shared admin.
 * The key it makes goes into state/secrets.json at once (spec §5 step 4). Then the stack
 * starts again, publishing every app the plan started unpublished, but one whose setup
 * is still open: nobody else ever reaches an open setup. Returns the store with the new
 * keys and what it did; throws BootstrapFailed when a setup failed, once it has published
 * what it can.
 */
export async function bootstrapApps(
  options: BootstrapOptions,
): Promise<{ store: SecretStore; detail: string }> {
  const { stack, runtime } = options;
  const apps = options.pending.flatMap((change) => {
    const app = stack.apps.find((a) => a.def.id === change.app);
    return app?.def.bootstrap === undefined ? [] : [app];
  });
  const admin = await adminLogin(stack.config, options.home, options.store, options.env);
  const secrets = knownSecrets(options.values, options.store, admin);
  let reached: Map<string, ReachedApp>;
  try {
    if ((await runtime.joinWiring()) === 'no-network') {
      throw new BootstrapFailed(
        'the stack has no wiring network, though apply has just started it',
        HINT,
      );
    }
    reached = await reachApps(apps, {
      runtime,
      current: await runtime.containers(),
      keys: {},
      secrets,
      deadlineMs: APP_DEADLINE_MS,
      ...(options.seams === undefined ? {} : { seams: options.seams }),
    });
  } catch (cause) {
    if (!(cause instanceof RuntimeError)) throw cause;
    const failure = joinFailure(cause, options.env);
    throw new BootstrapFailed(failure.message, failure.hint ?? HINT);
  }
  let store = options.store;
  const done: string[] = [];
  const failed: string[] = [];
  const stillOpen: string[] = [];
  for (const app of apps) {
    const result = await setUp(app, reached.get(app.def.id), admin);
    if (result.key !== undefined) {
      const secret = app.def.bootstrap?.secret ?? '';
      store = withSecret(store, app.def.id, secret, result.key);
      // At once: a key the app made, and Mediaplane lost, would need making again.
      await writeSecretStore(options.home, store);
      done.push(`${app.def.id}.${secret}`);
      continue;
    }
    failed.push(redact(result.failure, redactionValues(secrets)));
    if (result.open) stillOpen.push(app.def.id);
  }
  const unpublished = options.pending.filter((p) => p.unpublished).map((p) => p.app);
  if (unpublished.length > 0) {
    // Compose can't recreate the wiring network while another project's container is on
    // it, so Mediaplane steps off before up, as the start step does, and back on in the
    // wire step (ADR 0011).
    try {
      await runtime.leaveWiring();
    } catch (cause) {
      if (!(cause instanceof RuntimeError)) throw cause;
      throw new BootstrapFailed(cause.message, LEAVE_HINT);
    }
    await options.publish(stillOpen);
  }
  if (failed.length > 0) {
    throw new BootstrapFailed(`the first-run setup failed: ${failed.join('; ')}`, HINT);
  }
  const published = unpublished.filter((app) => !stillOpen.includes(app));
  return {
    store,
    detail: [
      `set up ${apps.map((a) => a.def.id).join(', ')} and saved ${done.join(', ')}`,
      ...(published.length === 0 ? [] : [`published ${published.join(', ')}`]),
    ].join('; '),
  };
}

/**
 * Finish `app`'s setup: its new key, or why not and whether the setup is still open (then
 * it stays unpublished). One Mediaplane can't ask counts as open.
 */
async function setUp(
  app: ResolvedApp,
  client: ReachedApp | undefined,
  admin: { username: string; password: string },
): Promise<{ key: string } | { key?: undefined; failure: string; open: boolean }> {
  const { bootstrap, api } = app.def;
  if (client === undefined || bootstrap === undefined || api === undefined) {
    return { failure: notOnNetwork(app), open: true };
  }
  try {
    await client.api.ready(api.ready);
    return { key: await bootstrap.run(client.api, admin) };
  } catch (cause) {
    if (!(cause instanceof AppApiError)) throw cause;
    const open = await bootstrap.open(client.api).catch((also: unknown) => {
      if (also instanceof AppApiError) return true;
      throw also;
    });
    return { failure: cause.message, open };
  }
}
