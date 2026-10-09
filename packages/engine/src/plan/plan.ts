import { join, resolve } from 'node:path';
import type { Catalog } from '../catalog/types';
import { loadConfigFile } from '../config/load';
import { checkSecretRefs } from '../config/secrets';
import { error, hasErrors, type Diagnostic } from '../diagnostics';
import type { HostFacts } from '../host/facts';
import { COMPOSE_PATH, ENV_PATH, STACK_PATH } from '../paths';
import { runPreflight } from '../preflight/checks';
import type { HostProbe } from '../preflight/probe';
import { renderCompose, type ComposeFile } from '../render/compose';
import { renderEnvFile } from '../render/env';
import { composeToYaml } from '../render/yaml';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
import { readSecretStore, type SecretStore } from '../secrets/store';
import { secretsToGenerate, secretValues } from '../secrets/values';
import { notYetHealthy, otherHomes, ownPorts, type ContainerChange } from './containers';
import { diffFiles, type FileChange } from './files';
import { predictContainers, type PredictResult } from './predict';

export interface PlanOptions {
  home: string;
  catalog: Catalog;
  host: HostFacts;
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  probe: HostProbe;
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
  const resolved = resolveStack(loaded.config, options.catalog, options.host, home);
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
    return failed([...diagnostics, dockerUnavailable(cause)]);
  }

  diagnostics.push(...otherHomes(current, home));
  diagnostics.push(
    ...(await runPreflight(
      { stack, versions, ownPorts: ownPorts(current) },
      options.probe,
    )),
  );
  if (hasErrors(diagnostics)) return failed(diagnostics);

  const compose = renderCompose(stack);
  const store = await readSecretStore(home);
  const values = await secretValues(stack, store, options.env);
  const files = await diffFiles(home, [
    { path: COMPOSE_PATH, content: composeToYaml(compose, home) },
    // The secret values: compared with what is on disk, never shown or kept.
    { path: ENV_PATH, content: renderEnvFile(values), sensitive: true },
  ]);
  const generate = secretsToGenerate(stack, store);
  let predicted: PredictResult;
  try {
    predicted = await predictContainers(compose, values, options.runtime, current);
  } catch (cause) {
    if (!(cause instanceof RuntimeError)) throw cause;
    return failed([...diagnostics, dockerUnavailable(cause)]);
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
  const containers = predicted.changes;
  const unhealthy = notYetHealthy(current, containers);
  return {
    result: {
      ok: true,
      changed:
        files.some((file) => file.status !== 'unchanged') ||
        containers.some((change) => change.action !== 'unchanged') ||
        generate.length > 0 ||
        unhealthy.length > 0,
      files,
      containers,
      secrets: { generate },
      unhealthy,
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
      diagnostics,
    },
    context: undefined,
  };
}

function dockerUnavailable(cause: RuntimeError): Diagnostic {
  return error('docker.unavailable', cause.message, {
    hint: 'start Docker, and make sure your user can run "docker ps" (for example, add it to the docker group)',
  });
}
