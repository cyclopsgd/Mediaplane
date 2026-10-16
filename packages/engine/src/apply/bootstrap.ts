import type { Bootstrap } from '../catalog/types';
import { AppApiError, APP_DEADLINE_MS, type AppApi } from '../http/client';
import {
  joinFailure,
  knownSecrets,
  notOnNetwork,
  reachApps,
  redactionValues,
  WIRING_RUNBOOK,
  wiringOrder,
  type ReachedApp,
  type WiringSeams,
} from '../integrations/wiring';
import { appSetupDone, type BootstrapChange } from '../plan/bootstrap';
import type { ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { RuntimeError, type Runtime } from '../runtime/types';
import { adminLogin } from '../secrets/admin';
import { writeSecretStore, type SecretStore } from '../secrets/store';
import { foundSecrets, redact, type FoundSecrets } from '../util/redact';

export interface BootstrapOptions {
  home: string;
  stack: ResolvedStack;
  store: SecretStore;
  /** The secret values of .env: kept out of every message. */
  values: Readonly<Record<string, string>>;
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  /** The Compose project `runtime` manages: hints name its containers as Compose does. */
  project: string;
  /** What apply's own plan said to set up. */
  pending: readonly BootstrapChange[];
  /**
   * Start the stack again with `unpublished` still without their published ports, and the
   * other apps the plan started unpublished with theirs. Throws when that fails.
   */
  publish: (unpublished: readonly string[]) => Promise<void>;
  /** What the run finds in the apps' answers (FoundSecrets); the step's own, by default. */
  found?: FoundSecrets;
  seams?: WiringSeams;
}

/**
 * A first-run setup that can't run yet, because another app it goes through isn't ready
 * for it: Jellyfin refusing the shared admin that Seerr signs in as, until the wire step
 * sets Jellyfin's admin. It leaves the app as it was, unpublished, and doesn't fail the
 * step: the wire step runs, skipping the app's resources, and the next apply sets it up.
 * Its message is said to the user.
 */
export class SetupWaiting extends Error {
  override readonly name = 'SetupWaiting';
}

/** An app whose first-run setup waits, and why (SetupWaiting). */
export interface WaitingSetup {
  app: string;
  reason: string;
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
 * is still open: nobody else ever reaches an open setup.
 *
 * The apps go in the order of their integrations' `after`, so Jellyfin is set up before
 * Seerr signs in through it. A setup that waits (SetupWaiting), or one after an app whose
 * setup failed or waits, is left as it is, unpublished, and doesn't fail the step.
 *
 * Returns the store with the new keys, what it did, and the apps whose setup waits;
 * throws BootstrapFailed when a setup failed, once it has published what it can.
 */
export async function bootstrapApps(
  options: BootstrapOptions,
): Promise<{ store: SecretStore; detail: string; waiting: WaitingSetup[] }> {
  const { stack, runtime } = options;
  // An app without an API isn't in the wiring order: it goes last, and setUp fails it.
  const order = wiringOrder(stack).map((app) => app.def.id);
  const rank = (app: ResolvedApp) => {
    const at = order.indexOf(app.def.id);
    return at < 0 ? order.length : at;
  };
  const apps = options.pending
    .flatMap((change) => {
      const app = stack.apps.find((a) => a.def.id === change.app);
      return app?.def.bootstrap === undefined ? [] : [app];
    })
    .sort((a, b) => rank(a) - rank(b));
  const admin = await adminLogin(stack.config, options.home, options.store, options.env);
  const secrets = knownSecrets(options.values, options.store, admin);
  const found = options.found ?? foundSecrets();
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
      found,
      deadlineMs: APP_DEADLINE_MS,
      ...(options.seams === undefined ? {} : { seams: options.seams }),
    });
  } catch (cause) {
    if (!(cause instanceof RuntimeError)) throw cause;
    const failure = joinFailure(cause, options.env);
    throw new BootstrapFailed(failure.message, failure.hint ?? HINT);
  }
  let store = options.store;
  const saved: string[] = [];
  const failed: string[] = [];
  const waiting: WaitingSetup[] = [];
  /** The apps whose setup failed or waits: one that comes after them waits too. */
  const unfinished: ResolvedApp[] = [];
  const stillOpen: string[] = [];
  for (const app of apps) {
    const change = options.pending.find((p) => p.app === app.def.id);
    const before = unfinished.find((other) =>
      (app.def.integration?.after ?? []).includes(other.def.id),
    );
    const result: SetUpResult =
      before === undefined
        ? await setUp(app, reached.get(app.def.id), admin, {
            unpublished: change?.unpublished ?? true,
            container: `${options.project}-${app.def.id}-1`,
            home: options.home,
            stack,
          })
        : {
            waiting: `${app.def.name} waits for ${before.def.name}'s first-run setup, which isn't done`,
            open: true,
          };
    const secret = app.def.bootstrap?.secret;
    if (result.key !== undefined && secret !== undefined) {
      store = withSecret(store, app.def.id, secret, result.key);
      // At once: a key the app made, and Mediaplane lost, would need making again.
      await writeSecretStore(options.home, store);
      saved.push(`${app.def.id}.${secret}`);
    }
    // The key it just made too, and what the run found: a failure after it may come from
    // the app's answer.
    const clean = (said: string) =>
      redact(
        said,
        redactionValues([
          ...secrets,
          ...found.values,
          ...(result.key === undefined ? [] : [result.key]),
        ]),
      );
    if (result.failure !== undefined) failed.push(clean(result.failure));
    if (result.waiting !== undefined) {
      waiting.push({ app: app.def.id, reason: clean(result.waiting) });
    }
    if (result.failure !== undefined || result.waiting !== undefined) {
      unfinished.push(app);
      // An app the plan started published isn't unpublished now: its failure says so,
      // and it keeps its ports in the publishing up that another app's setup brings, as
      // Jellyfin does when Seerr is set up after it.
      if (result.open && change?.unpublished !== false) stillOpen.push(app.def.id);
    }
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
  const waits = waiting.map((w) => `${w.app} waits: ${w.reason}`);
  if (failed.length > 0) {
    throw new BootstrapFailed(
      `the first-run setup failed: ${[...failed, ...waits].join('; ')}`,
      HINT,
    );
  }
  const finished = apps.filter((app) => !unfinished.includes(app)).map((a) => a.def.id);
  const published = unpublished.filter((app) => !stillOpen.includes(app));
  const keys = saved.length === 0 ? '' : ` and saved ${saved.join(', ')}`;
  return {
    store,
    detail: [
      ...(finished.length === 0 ? [] : [`set up ${finished.join(', ')}${keys}`]),
      ...(published.length === 0 ? [] : [`published ${published.join(', ')}`]),
      ...waits,
    ].join('; '),
    waiting,
  };
}

/**
 * What `setUp` found: the key it made, and/or why the setup isn't finished or safe, or
 * why it waits.
 */
interface SetUpResult {
  key?: string;
  failure?: string;
  waiting?: string;
  /** Whether the app must stay unpublished: it still looks open, or was claimed. */
  open: boolean;
}

/**
 * Whether `app` can still be claimed; one Mediaplane can't ask counts as open, and `why`
 * says what the asking met.
 */
async function looksOpen(
  bootstrap: Bootstrap,
  api: AppApi,
): Promise<{ open: boolean; why?: string }> {
  try {
    return { open: await bootstrap.open(api) };
  } catch (cause) {
    if (cause instanceof AppApiError) return { open: true, why: cause.message };
    throw cause;
  }
}

/**
 * Finish `app`'s setup: its new key, or why not and whether the app must stay
 * unpublished. One Mediaplane can't reach or ask counts as open. A setup that says it is
 * done is asked once more before the app is published: the engine, and not each catalog
 * entry, keeps an app that still looks open unpublished. It still gets its key stored,
 * since the app made it. An app the plan started unpublished, since its setup didn't look
 * done, whose shared admin is then refused (an `auth` failure) stays unpublished, however
 * done its setup now looks (see `claimed`). One the plan started published was done
 * before this run, by hand say, and nobody can claim it. A setup that waits leaves the
 * app as it was, unpublished if the plan started it so; asked once more, one that no
 * longer looks open was claimed meanwhile, and fails as a claimed one does.
 */
async function setUp(
  app: ResolvedApp,
  client: ReachedApp | undefined,
  admin: { username: string; password: string },
  started: {
    unpublished: boolean;
    container: string;
    home: string;
    stack: ResolvedStack;
  },
): Promise<SetUpResult> {
  const { bootstrap, api } = app.def;
  if (client === undefined || bootstrap === undefined || api === undefined) {
    return { failure: notOnNetwork(app), open: true };
  }
  const name = app.def.name;
  try {
    await client.api.ready(api.ready);
    const key = await bootstrap.run(client.api, admin, started.stack);
    if (bootstrap.secret !== undefined && key === undefined) {
      // A setup that makes a key and gives none is a bug in the setup: the app would be
      // published with no key stored, and nothing failed.
      return {
        failure: `${name}'s setup finished without giving its ${bootstrap.secret}, which it makes`,
        open: true,
      };
    }
    const after = await looksOpen(bootstrap, client.api);
    if (!after.open) return { key, open: false };
    const still = `${name}'s setup reported success, but the app still looks open (or can't be asked)`;
    const failure = started.unpublished
      ? `${still}, so it stays unpublished`
      : `${still}, and it is published: stop it ("docker stop ${started.container}") and see the runbook`;
    return {
      key,
      open: true,
      failure: after.why === undefined ? failure : `${failure}: ${after.why}`,
    };
  } catch (cause) {
    if (cause instanceof SetupWaiting) {
      // Unpublished on this run either way. But a setup that no longer looks open was
      // finished by someone else while it waited: that is a claimed one, said loudly.
      if (started.unpublished && !(await looksOpen(bootstrap, client.api)).open) {
        return { failure: await claimed(app, cause.message, started.home), open: true };
      }
      return { waiting: cause.message, open: true };
    }
    if (!(cause instanceof AppApiError)) throw cause;
    const now = await looksOpen(bootstrap, client.api);
    if (started.unpublished && cause.kind === 'auth' && !now.open) {
      return { failure: await claimed(app, cause.message, started.home), open: true };
    }
    return { failure: cause.message, open: now.open };
  }
}

/**
 * Why an app the plan started unpublished, whose shared admin is refused once its setup
 * looks done, stays unpublished. Its appdata, read again, tells the two causes apart: a
 * file Mediaplane can't read may hide a setup the user finished by hand, which starting
 * afresh would lose; one it can read was finished with another login meanwhile.
 */
async function claimed(app: ResolvedApp, refused: string, home: string): Promise<string> {
  const { name, id } = app.def;
  const said = `${refused}; ${name}'s setup didn't look done when apply started it, and the shared admin is refused now, so it stays unpublished`;
  const done = await appSetupDone(home, app);
  if (done === undefined) {
    const file = `appdata/${id}/${app.def.bootstrap?.done.path ?? ''}`;
    return `${said}. Mediaplane can't read ${file}, which says whether it is set up, so this may be a ${name} you set up yourself: don't start it afresh. Make that file readable by Mediaplane, or set admin.username and admin.password to its login, then run apply again, as the runbook says`;
  }
  const next = done ? ', and the next apply would publish it' : '';
  return `${said}: its setup was finished with another login while Mediaplane set it up${next}. If you set it up yourself, set admin.username and admin.password to its login; if not, start it afresh first, as the runbook says`;
}
