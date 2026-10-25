import { join, resolve } from 'node:path';
import type { Catalog } from '../catalog/types';
import { loadConfigFile } from '../config/load';
import { checkSecretRefs } from '../config/secrets';
import { error, hasErrors, type Diagnostic } from '../diagnostics';
import type { HostFacts } from '../host/facts';
import {
  dockerUnavailable,
  helperOrDockerFailure,
  hostFactsOrFailure,
} from '../host/failure';
import { COMPOSE_PATH, ENV_PATH, STACK_PATH } from '../paths';
import { runPreflight } from '../preflight/checks';
import type { HostProbe } from '../preflight/probe';
import { renderCompose, type ComposeFile } from '../render/compose';
import { renderEnvFile } from '../render/env';
import { prestartFilesFor } from '../render/prestart';
import { composeToYaml } from '../render/yaml';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { checkOverrides } from '../integrations/overrides';
import { readResources, type KnownResources } from '../integrations/resources';
import {
  joinFailure,
  knownSecrets,
  planWiring,
  resourcesInvalid,
  settled,
  wiringOrder,
  type Drift,
  type SecretCheck,
  type WiringChange,
  type WiringSeams,
} from '../integrations/wiring';
import { dockerAccessWarnings } from '../runtime/docker';
import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
import { adminLogin } from '../secrets/admin';
import { withGeneratedSecrets } from '../secrets/generate';
import { readSecretStore, type SecretStore } from '../secrets/store';
import {
  secretsToGenerate,
  secretValues,
  stackKeys,
  userSecrets,
} from '../secrets/values';
import { planAppdata } from './appdata';
import { inspectBootstrap, type BootstrapChange } from './bootstrap';
import { notYetHealthy, otherHomes, ownPorts, type ContainerChange } from './containers';
import { diffFiles, type FileChange } from './files';
import { predictContainers, type PredictResult } from './predict';
import { planPrestartFiles } from './prestart';
import { strandedGuests } from './stranded';

export interface PlanOptions {
  home: string;
  catalog: Catalog;
  /**
   * Facts about the host, or how to get them once the stack has loaded. In its image,
   * Mediaplane asks the host helper (helperHostFacts), so Docker or the helper failing
   * is a plan error like any other.
   */
  host: HostFacts | (() => Promise<HostFacts>);
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  probe: HostProbe;
  /** For tests: where the apps' APIs are reached, and how long their calls are tried. */
  wiring?: WiringSeams;
  /**
   * `mediaplane drift`'s plan (spec §6.3, "the planner in observe-only mode"), from
   * `now`: no preflight, every running and healthy app asked, even one apply would
   * change, a secret that passed checked again only once its `checkEvery` has gone by,
   * and the apps' own health checks read.
   */
  drift?: { now: () => Date };
  /**
   * `mediaplane keep`'s: look at this one resource ("<app>.<resource>"), and check none of
   * its secrets.
   */
  only?: string;
}

export interface PlanResult {
  /** False when any diagnostic is an error; files and containers are then empty. */
  ok: boolean;
  changed: boolean;
  files: FileChange[];
  containers: ContainerChange[];
  /** Names ("sonarr.apiKey"), never values. */
  secrets: { generate: string[] };
  /**
   * Running apps whose health check has not passed yet, as "sonarr (unhealthy)": apply
   * waits for them again, so they make the plan changed.
   */
  unhealthy: string[];
  /** What apply would do to each managed resource in the apps (spec §5 step 5). */
  wiring: WiringChange[];
  /**
   * What changed in the apps outside Mediaplane since it applied them (spec §6.3): apply
   * puts it back, as `wiring` says.
   */
  drift: Drift[];
  /** How each secret of each resource plan looked at was checked: names, never values. */
  checks: SecretCheck[];
  /** The apps whose first-run setup apply would finish before publishing them. */
  bootstrap: BootstrapChange[];
  diagnostics: Diagnostic[];
}

/**
 * What apply builds on after a successful plan, so it never works it out differently.
 * `store` holds the generated secrets in plain text: never log, print or serialise a
 * PlanContext.
 */
export interface PlanContext {
  stack: ResolvedStack;
  compose: ComposeFile;
  store: SecretStore;
  current: ContainerState[];
}

/** Everything apply would do, without doing it. Writes nothing. */
export async function plan(options: PlanOptions): Promise<PlanResult> {
  return (await planStack(options)).result;
}

/** plan(), plus the context apply builds on (undefined whenever the plan failed). */
export async function planStack(
  options: PlanOptions,
): Promise<{ result: PlanResult; context: PlanContext | undefined }> {
  const home = resolve(options.home);
  if (home.includes(':')) {
    return failed([
      error('home.invalid', `the Mediaplane home ${home} must not contain ":"`, {
        hint: 'Docker uses ":" to separate volume paths; choose a path without one',
      }),
    ]);
  }
  const loaded = await loadConfigFile(join(home, STACK_PATH));
  if (!loaded.ok) return failed(loaded.diagnostics);

  const diagnostics = await checkSecretRefs(loaded.config, home, options.env);
  diagnostics.push(...dockerAccessWarnings(options.env));
  const hostFacts = await hostFactsOrFailure(options.host, options);
  if (!hostFacts.ok) return failed([...diagnostics, hostFacts.diagnostic]);
  const host = hostFacts.host;
  const resolved = resolveStack(loaded.config, options.catalog, host, home);
  diagnostics.push(...resolved.diagnostics);
  if (resolved.stack === undefined || hasErrors(diagnostics)) return failed(diagnostics);
  const stack = resolved.stack;

  let versions: { engine: string; compose: string };
  let current: ContainerState[];
  try {
    versions = await options.runtime.versions();
    current = await options.runtime.containers();
  } catch (cause) {
    if (!(cause instanceof RuntimeError)) throw cause;
    return failed([...diagnostics, dockerUnavailable(cause, options.env)]);
  }

  diagnostics.push(...otherHomes(current, home));
  // Drift asks what the apps hold now: the host's ports and folders don't change that.
  try {
    if (options.drift === undefined) {
      diagnostics.push(
        ...(await runPreflight(
          { stack, versions, ownPorts: ownPorts(current) },
          options.probe,
        )),
      );
    }
  } catch (cause) {
    const failure = await helperOrDockerFailure(cause, options);
    if (failure === undefined) throw cause;
    return failed([...diagnostics, failure]);
  }
  if (hasErrors(diagnostics)) return failed(diagnostics);

  const compose = renderCompose(stack);
  const store = await readSecretStore(home);
  const values = await secretValues(stack, store, options.env);
  // The secrets a first apply would generate, in memory only, so the pre-start files
  // can be rendered. Their content is never shown or kept: apply renders them again
  // with the keys it saves.
  const preview = withGeneratedSecrets(stack, store).store;
  const prestart = await planPrestartFiles(
    home,
    await prestartFilesFor(stack, preview, options.env),
  );
  if (hasErrors(prestart.diagnostics)) {
    return failed([...diagnostics, ...prestart.diagnostics]);
  }
  // Notes on what apply will do to appdata/ itself; they don't make the plan "changed".
  diagnostics.push(...(await planAppdata(home)));
  const files = [
    ...(await diffFiles(home, [
      { path: COMPOSE_PATH, content: composeToYaml(compose, home) },
      // The secret values: compared with what is on disk, never shown or kept.
      { path: ENV_PATH, content: renderEnvFile(values), sensitive: true },
    ])),
    ...prestart.changes,
  ];
  const generate = secretsToGenerate(stack, store);
  let predicted: PredictResult;
  try {
    predicted = await predictContainers(compose, values, options.runtime, current);
  } catch (cause) {
    if (!(cause instanceof RuntimeError)) throw cause;
    return failed([...diagnostics, dockerUnavailable(cause, options.env)]);
  }
  if (!predicted.ok) {
    return failed([
      ...diagnostics,
      error(
        'compose.invalid',
        `docker compose rejected the configuration: ${predicted.error}`,
        { hint: 'if you have a compose.override.yaml next to stack.yaml, check it' },
      ),
    ]);
  }
  let containers = predicted.changes;
  // An app whose setup is open starts again without its ports, whatever it runs now: up
  // recreates it, and again once it is set up.
  const setups = await inspectBootstrap(stack, store);
  diagnostics.push(...setups.diagnostics);
  if (hasErrors(diagnostics)) return failed(diagnostics);
  const bootstrap = setups.changes;
  const unpublished = new Set(bootstrap.filter((b) => b.unpublished).map((b) => b.app));
  containers = containers.map((change) =>
    unpublished.has(change.service) && change.action !== 'create'
      ? { ...change, action: 'recreate' }
      : change,
  );
  try {
    // A guest whose host apply starts again, or that holds a host's old network.
    const stranded = await strandedGuests(stack, current, containers, options.runtime);
    containers = containers.map((change) =>
      stranded.includes(change.service) ? { ...change, action: 'restart' } : change,
    );
  } catch (cause) {
    if (!(cause instanceof RuntimeError)) throw cause;
    return failed([...diagnostics, dockerUnavailable(cause, options.env)]);
  }
  const unhealthy = notYetHealthy(current, containers);

  let wiring: WiringChange[] = [];
  let drift: Drift[] = [];
  let checks: SecretCheck[] = [];
  const order = wiringOrder(stack);
  if (order.length > 0) {
    let known: KnownResources;
    try {
      known = await readResources(home);
    } catch (cause) {
      return failed([...diagnostics, resourcesInvalid(cause)]);
    }
    // In memory: the secrets apply would generate, so that a first plan can say what it
    // would set. Apply sets the ones it saves. Read before the join, so that a failure to
    // read the admin login doesn't come after the join (wiringAddresses can still fail
    // after it).
    const admin = await adminLogin(stack.config, home, preview, options.env);
    // The secrets you give, such as Plex's token, which is Plex's key.
    const given = await userSecrets(stack, options.env);
    const keys = stackKeys(stack, preview, given);
    // Keep mine's values (spec §6.3): an override that names nothing Mediaplane manages,
    // or can't be applied, fails the plan before any app is asked.
    diagnostics.push(...checkOverrides(stack, options.catalog, { admin, keys }));
    if (hasErrors(diagnostics)) return failed(diagnostics);
    // An app to set up is asked once it is: without its key, it can't be asked now.
    // Drift asks the others as they run now, even one apply would change.
    const changing = new Set([
      ...(options.drift === undefined
        ? containers.filter((c) => c.action !== 'unchanged').map((c) => c.service)
        : []),
      ...bootstrap.map((b) => b.app),
    ]);
    // The join is plan's one change to Docker, and only an app that is settled is asked:
    // with none, every resource is checked after the start, and nothing joins.
    let onNetwork = false;
    if (order.some((app) => settled(app, current, changing))) {
      try {
        onNetwork = (await options.runtime.joinWiring()) !== 'no-network';
      } catch (cause) {
        if (!(cause instanceof RuntimeError)) throw cause;
        return failed([...diagnostics, joinFailure(cause, options.env)]);
      }
    }
    try {
      const planned = await planWiring({
        stack,
        current,
        changing,
        onNetwork,
        runtime: options.runtime,
        keys,
        admin,
        secrets: knownSecrets(values, preview, admin, given),
        known,
        ...(options.drift === undefined ? {} : { drift: options.drift }),
        ...(options.only === undefined ? {} : { only: options.only }),
        ...(options.wiring === undefined ? {} : { seams: options.wiring }),
      });
      ({ drift, checks } = planned);
      wiring = planned.changes;
      diagnostics.push(...planned.diagnostics);
    } catch (cause) {
      if (!(cause instanceof RuntimeError)) throw cause;
      return failed([...diagnostics, dockerUnavailable(cause, options.env)]);
    }
  }
  return {
    result: {
      ok: true,
      changed:
        files.some((file) => file.status !== 'unchanged') ||
        containers.some((change) => change.action !== 'unchanged') ||
        generate.length > 0 ||
        unhealthy.length > 0 ||
        wiring.some((change) => change.action !== 'unchanged') ||
        bootstrap.length > 0,
      files,
      containers,
      secrets: { generate },
      unhealthy,
      wiring,
      drift,
      checks,
      bootstrap,
      diagnostics,
    },
    context: { stack, compose, store, current },
  };
}

function failed(diagnostics: Diagnostic[]): { result: PlanResult; context: undefined } {
  return {
    result: {
      ok: false,
      changed: false,
      files: [],
      containers: [],
      secrets: { generate: [] },
      unhealthy: [],
      wiring: [],
      drift: [],
      checks: [],
      bootstrap: [],
      diagnostics,
    },
    context: undefined,
  };
}
