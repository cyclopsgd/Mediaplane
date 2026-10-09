import { join, resolve } from 'node:path';
import { error, type Diagnostic } from '../diagnostics';
import {
  CHANGE_SCHEMA,
  newRecordId,
  stackSha256,
  writeRecord,
  type ActionResult,
  type ApplyStep,
  type ChangeRecord,
} from '../history/records';
import { COMPOSE_PATH, COMPOSE_PREV_PATH, ENV_PATH, STACK_PATH } from '../paths';
import { plan, planStack, type PlanOptions, type PlanResult } from '../plan/plan';
import { renderEnvFile } from '../render/env';
import { composeToYaml } from '../render/yaml';
import type { CommandResult, ContainerState, Runtime } from '../runtime/types';
import { withGeneratedSecrets, type RandomBytes } from '../secrets/generate';
import { writeSecretStore } from '../secrets/store';
import { secretValues } from '../secrets/values';
import { acquireLock, LockedError, type Lock } from '../state/lock';
import { writeFileAtomic } from '../util/atomic';
import { readIfExists } from '../util/fs';
import { compare } from '../util/sort';
import { ensureAppdataDirs, ownershipFixes } from './ownership';

export const DEFAULT_WAIT_SECONDS = 600;

export type StepEvent =
  | { step: ApplyStep; phase: 'start' }
  | { step: ApplyStep; phase: 'end'; action: ActionResult };

export interface ApplyOptions extends PlanOptions {
  /** Shown the plan before anything changes; resolve true to go ahead. */
  confirm: (plan: PlanResult) => Promise<boolean>;
  /** Progress, as each step starts and ends. */
  onStep?: (event: StepEvent) => void;
  random?: RandomBytes;
  now?: () => Date;
  /** How long `up --wait` waits for every app to be healthy. */
  waitSeconds?: number;
}

export type ApplyOutcome = 'success' | 'failed' | 'no-changes' | 'cancelled' | 'invalid';

export interface ApplyResult {
  outcome: ApplyOutcome;
  /** The plan that was shown (empty when one could not be made). */
  plan: PlanResult;
  actions: ActionResult[];
  /** The change record's id, when one was written. */
  recordId: string | undefined;
  /** The plan's warnings, plus an error for each failed step. */
  diagnostics: Diagnostic[];
}

const STEP_HINTS: Record<ApplyStep, string> = {
  keys: 'check that this user can write to the Mediaplane home, then run apply again',
  files: 'check that this user can write to the Mediaplane home, then run apply again',
  pull: 'check the network connection and that the image registries are reachable, then run apply again',
  ownership: "the error comes from the app's own image; run apply again to retry",
  start: 'run "mediaplane status" to see each app, fix the cause, then run apply again',
  verify: 'run "mediaplane plan" to see what is still different',
};

/** Make the running stack match stack.yaml (spec §5). Converges forward (ADR 0004). */
export async function apply(options: ApplyOptions): Promise<ApplyResult> {
  const home = resolve(options.home);
  // Never create state/ in a folder that isn't a Mediaplane home; plan explains why.
  if ((await readIfExists(join(home, STACK_PATH))) === undefined) {
    return stopped('invalid', await plan(options));
  }
  let lock: Lock;
  try {
    lock = await acquireLock(home, options.now);
  } catch (cause) {
    if (!(cause instanceof LockedError)) throw cause;
    return stopped('invalid', emptyPlan(), [
      error('apply.locked', cause.message, {
        hint: 'wait for it to finish; if no apply is running, delete state/lock',
      }),
    ]);
  }
  try {
    return await applyLocked({ ...options, home });
  } finally {
    await lock.release();
  }
}

async function applyLocked(options: ApplyOptions): Promise<ApplyResult> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const stackSource = (await readIfExists(join(options.home, STACK_PATH))) ?? '';
  const { result: shown, context } = await planStack(options);
  if (!shown.ok || context === undefined) return stopped('invalid', shown);
  if (!shown.changed) return stopped('no-changes', shown);
  if (!(await options.confirm(shown))) return stopped('cancelled', shown);

  const { home, runtime } = options;
  const { stack, compose } = context;
  const steps = new Steps(options.onStep);
  let store = context.store;
  let values: Record<string, string> = {};

  await steps.run('keys', async () => {
    const result = withGeneratedSecrets(stack, store, options.random);
    if (result.generated.length > 0) await writeSecretStore(home, result.store);
    store = result.store;
    return result.generated.length === 0
      ? 'none needed'
      : `generated ${result.generated.join(', ')}`;
  });
  await steps.run('files', async () => {
    values = await secretValues(stack, store, options.env);
    await writeGenerated(home, composeToYaml(compose, home), renderEnvFile(values));
    await ensureAppdataDirs(stack);
    return `wrote ${COMPOSE_PATH} and ${ENV_PATH}`;
  });
  await steps.run('pull', async () => {
    succeeded(await runtime.pull(values));
    return 'images present';
  });
  await steps.run('ownership', async () => {
    const fixes = await ownershipFixes(stack, options.probe);
    for (const fix of fixes) {
      succeeded(
        await runtime.chown(fix.service, fix.containerPath, fix, values),
        `${fix.service}: `,
      );
    }
    return fixes.length === 0
      ? 'none needed'
      : fixes.map((f) => `${f.service} → ${String(f.uid)}:${String(f.gid)}`).join(', ');
  });
  await steps.run('start', async () => {
    const result = await runtime.up(options.waitSeconds ?? DEFAULT_WAIT_SECONDS, values);
    if (!result.ok) throw new Error(await startFailure(runtime, result.error));
    return 'every app is running and healthy';
  });
  await steps.run('verify', async () => {
    const after = await plan(options);
    if (!after.ok) {
      const first = after.diagnostics.find((d) => d.severity === 'error');
      throw new Error(`could not plan again: ${first?.message ?? 'unknown error'}`);
    }
    if (after.changed) throw new Error(`changes remain after apply: ${remaining(after)}`);
    return 'no changes remain';
  });

  const finishedAt = now();
  const record: ChangeRecord = {
    schema: CHANGE_SCHEMA,
    id: newRecordId(startedAt, options.random),
    trigger: 'cli',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    outcome: steps.failed ? 'failed' : 'success',
    stackSha256: stackSha256(stackSource),
    plan: {
      files: shown.files.map(({ path, status }) => ({ path, status })),
      containers: shown.containers,
      secrets: shown.secrets,
    },
    actions: steps.actions,
  };
  const diagnostics = [...shown.diagnostics, ...steps.diagnostics];
  try {
    await writeRecord(home, record);
  } catch (cause) {
    // The stack has changed by now: keep what ran and why a step failed, and add this.
    // Whatever went wrong, the caller still gets the steps' results (spec §5.2: exit 1).
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      outcome: 'failed',
      plan: shown,
      actions: steps.actions,
      recordId: undefined,
      diagnostics: [
        ...diagnostics,
        error('apply.record-failed', `the change record could not be saved: ${message}`, {
          hint: 'the stack was changed, but this apply was not recorded; free up disk space or check that this user can write to state/history',
        }),
      ],
    };
  }
  return {
    outcome: record.outcome,
    plan: shown,
    actions: steps.actions,
    recordId: record.id,
    diagnostics,
  };
}

/** Runs apply's steps in order; after a failure the rest are skipped (ADR 0004). */
class Steps {
  readonly actions: ActionResult[] = [];
  readonly diagnostics: Diagnostic[] = [];
  readonly #onStep: ApplyOptions['onStep'];

  constructor(onStep: ApplyOptions['onStep']) {
    this.#onStep = onStep;
  }

  get failed(): boolean {
    return this.actions.some((action) => action.result === 'failed');
  }

  async run(step: ApplyStep, work: () => Promise<string>): Promise<void> {
    if (this.failed) {
      this.#finish({ step, result: 'skipped' });
      return;
    }
    this.#onStep?.({ step, phase: 'start' });
    try {
      this.#finish({ step, result: 'done', detail: await work() });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.diagnostics.push(
        error(`apply.${step}-failed`, message, { hint: STEP_HINTS[step] }),
      );
      this.#finish({ step, result: 'failed', error: message });
    }
  }

  #finish(action: ActionResult): void {
    this.actions.push(action);
    this.#onStep?.({ step: action.step, phase: 'end', action });
  }
}

/** Services that are not running, or whose health check hasn't passed. */
export function unhealthyServices(containers: readonly ContainerState[]): string[] {
  return containers
    .filter((c) => c.state !== 'running' || (c.health !== '' && c.health !== 'healthy'))
    .map((c) => `${c.service} (${c.state === 'running' ? c.health : c.state})`)
    .sort(compare);
}

async function startFailure(runtime: Runtime, composeError: string): Promise<string> {
  let containers: ContainerState[] = [];
  try {
    containers = await runtime.containers();
  } catch {
    // Fall back to Compose's own message.
  }
  const unhealthy = unhealthyServices(containers);
  return unhealthy.length === 0
    ? `docker compose up failed: ${composeError}`
    : `these apps did not start healthy: ${unhealthy.join(', ')}. Compose said: ${composeError}`;
}

/** compose.yaml, keeping the previous one as compose.prev.yaml (spec §5 step 6), and .env. */
async function writeGenerated(home: string, compose: string, env: string): Promise<void> {
  const composePath = join(home, COMPOSE_PATH);
  const previous = await readIfExists(composePath);
  if (previous !== compose) {
    if (previous !== undefined) {
      await writeFileAtomic(join(home, COMPOSE_PREV_PATH), previous);
    }
    await writeFileAtomic(composePath, compose);
  }
  await writeFileAtomic(join(home, ENV_PATH), env, 0o600);
}

function succeeded(result: CommandResult, prefix = ''): void {
  if (!result.ok) throw new Error(`${prefix}${result.error}`);
}

function remaining(result: PlanResult): string {
  return [
    ...result.files.filter((f) => f.status !== 'unchanged').map((f) => f.path),
    ...result.containers
      .filter((c) => c.action !== 'unchanged')
      .map((c) => `${c.service} (${c.action})`),
    ...result.secrets.generate,
    ...result.unhealthy,
  ].join(', ');
}

function stopped(
  outcome: ApplyOutcome,
  shown: PlanResult,
  extra: Diagnostic[] = [],
): ApplyResult {
  return {
    outcome,
    plan: shown,
    actions: [],
    recordId: undefined,
    diagnostics: [...shown.diagnostics, ...extra],
  };
}

function emptyPlan(): PlanResult {
  return {
    ok: false,
    changed: false,
    files: [],
    containers: [],
    secrets: { generate: [] },
    unhealthy: [],
    diagnostics: [],
  };
}
