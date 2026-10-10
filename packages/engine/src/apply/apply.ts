import { chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { error, warning, type Diagnostic } from '../diagnostics';
import {
  CHANGE_SCHEMA,
  newRecordId,
  stackSha256,
  writeRecord,
  type ActionResult,
  type ApplyStep,
  type ChangeRecord,
} from '../history/records';
import { wire, WiringFailed } from '../integrations/wire';
import { COMPOSE_PATH, COMPOSE_PREV_PATH, ENV_PATH, STACK_PATH } from '../paths';
import { plan, planStack, type PlanOptions, type PlanResult } from '../plan/plan';
import { PROJECT_NAME } from '../render/compose';
import { renderEnvFile } from '../render/env';
import { runbookUrl } from '../runbooks';
import { prestartFilesFor } from '../render/prestart';
import { composeToYaml } from '../render/yaml';
import {
  RuntimeError,
  type CommandResult,
  type ContainerState,
  type Runtime,
} from '../runtime/types';
import { withGeneratedSecrets, type RandomBytes } from '../secrets/generate';
import { writeSecretStore } from '../secrets/store';
import { secretValues } from '../secrets/values';
import { acquireLock, LockedError, type Lock } from '../state/lock';
import { writeFileAtomic } from '../util/atomic';
import { codeOf } from '../util/error-code';
import { readIfExists } from '../util/fs';
import { compare } from '../util/sort';
import { vpnCheck, VPN_RUNBOOK } from '../vpn/check';
import {
  AppdataNotPrivateError,
  ensureAppdataDirs,
  keepAppdataPrivate,
  ownershipFixes,
} from './ownership';
import { writePrestartFiles } from './prestart';
import { pullImages } from './pull';

export const DEFAULT_WAIT_SECONDS = 600;

/** The detail of a step that ran but found nothing to change. */
export const NONE_NEEDED = 'none needed';

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
  /** How apply waits between pull retries; tests pass one that returns at once. */
  sleep?: (ms: number) => Promise<unknown>;
  /**
   * The Compose project `runtime` manages ("mediaplane" by default): verify's VPN check
   * names its containers by it.
   */
  project?: string;
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
  start: `run "mediaplane status" to see each app, fix the cause, then run apply again; see ${runbookUrl('app-wont-start')}`,
  wire: `fix what the error says, then run apply again; see ${runbookUrl('wiring-failed')}`,
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
  if (!shown.changed) {
    // Nothing else to change, but appdata/ may have been opened up since the last apply.
    try {
      await keepAppdataPrivate(options.home);
    } catch (cause) {
      if (!(cause instanceof AppdataNotPrivateError)) throw cause;
      return stopped('invalid', shown, [
        error('apply.appdata-not-private', cause.message, { hint: cause.hint }),
      ]);
    }
    return stopped('no-changes', shown);
  }
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
      ? NONE_NEEDED
      : `generated ${result.generated.join(', ')}`;
  });
  await steps.run('files', async () => {
    values = await secretValues(stack, store, options.env);
    const written = await writeGenerated(
      home,
      composeToYaml(compose, home),
      renderEnvFile(values),
    );
    await ensureAppdataDirs(stack);
    // Before any app starts, and only where the app has no file of its own (spec §6.4).
    const created = await writePrestartFiles(
      home,
      await prestartFilesFor(stack, store, options.env, options.random),
    );
    const done = [
      ...(written.length === 0 ? [] : [`wrote ${written.join(' and ')}`]),
      ...(created.length === 0 ? [] : [`created ${created.join(', ')}`]),
    ];
    return done.length === 0 ? NONE_NEEDED : done.join('; ');
  });
  await steps.run('pull', () => pullImages(runtime, values, options.sleep));
  await steps.run('ownership', async () => {
    const fixes = await ownershipFixes(stack, options.probe);
    for (const fix of fixes) {
      succeeded(
        await runtime.chown(fix.service, fix.containerPath, fix, values),
        `${fix.service}: `,
      );
    }
    return fixes.length === 0
      ? NONE_NEEDED
      : fixes.map((f) => `${f.service} → ${String(f.uid)}:${String(f.gid)}`).join(', ');
  });
  await steps.run('start', async () => {
    // Compose can't recreate the wiring network while another project's container is on
    // it, so Mediaplane steps off before up, and back on in the wire step (ADR 0011).
    try {
      await runtime.leaveWiring();
    } catch (cause) {
      if (!(cause instanceof RuntimeError)) throw cause;
      throw new LeaveFailed(cause.message, { cause });
    }
    // A guest whose host up starts again (strandedGuests): stopped now, up starts it in
    // the host's new network.
    const restart = shown.containers
      .filter((change) => change.action === 'restart')
      .map((change) => change.service);
    if (restart.length > 0) succeeded(await runtime.stop(restart, values));
    const result = await runtime.up(options.waitSeconds ?? DEFAULT_WAIT_SECONDS, values);
    if (!result.ok) throw new Error(await startFailure(runtime, result.error));
    return restart.length === 0
      ? 'every app is running and healthy'
      : `every app is running and healthy; restarted ${restart.join(', ')}`;
  });
  await steps.run('wire', async () => {
    try {
      const done = await wire({
        home,
        stack,
        store,
        values,
        env: options.env,
        runtime,
        now,
        record: (action) => {
          steps.record(action);
        },
        ...(options.wiring === undefined ? {} : { seams: options.wiring }),
      });
      return done.length === 0 ? NONE_NEEDED : done.join('; ');
    } catch (cause) {
      // Each failure's own message, as well as the step's.
      if (cause instanceof WiringFailed) steps.diagnostics.push(...cause.diagnostics);
      throw cause;
    }
  });
  await steps.run('verify', async () => {
    const after = await plan(options);
    if (!after.ok) {
      const first = after.diagnostics.find((d) => d.severity === 'error');
      throw new Error(`could not plan again: ${first?.message ?? 'unknown error'}`);
    }
    if (after.changed) throw new Error(`changes remain after apply: ${remaining(after)}`);
    // The VPN's topology too (spec §6.4, §7.2(6)): vpn-check's checks, without egress.
    if (
      !stack.apps.some(
        (app) => app.def.id === 'qbittorrent' && app.networkVia === 'gluetun',
      )
    ) {
      return 'no changes remain';
    }
    const vpn = await vpnCheck({
      home,
      catalog: options.catalog,
      host: options.host,
      env: options.env,
      runtime,
      project: options.project ?? PROJECT_NAME,
    });
    if (!vpn.ok) {
      const first = vpn.diagnostics.find((d) => d.severity === 'error');
      throw new StepError(
        `the VPN check could not run: ${first?.message ?? 'unknown error'}`,
        first?.hint ?? `see ${VPN_RUNBOOK}`,
      );
    }
    if (vpn.verdict !== 'pass') {
      const failing = vpn.checks.find((c) => c.status === 'leak' || c.status === 'down');
      throw new StepError(
        `the VPN check found ${vpn.verdict === 'leak' ? 'a leak' : 'the VPN down'}: ${failing?.message ?? vpn.verdict}`,
        failing?.hint ?? `see ${VPN_RUNBOOK}`,
      );
    }
    // Its warnings stay: a control server that answers anyone on the stack's networks, or
    // that didn't answer, is worth knowing, and leaves "with the VPN up" unproven.
    const warnings = vpn.checks.filter((c) => c.status === 'warning');
    for (const check of warnings) {
      steps.diagnostics.push(
        warning(
          `vpn.${check.id}`,
          check.message,
          check.hint === undefined ? {} : { hint: check.hint },
        ),
      );
    }
    if (warnings.length > 0) {
      const count =
        warnings.length === 1 ? 'a warning' : `${String(warnings.length)} warnings`;
      return `no changes remain, and qBittorrent's network is Gluetun's, but the VPN check has ${count}`;
    }
    return "no changes remain, and qBittorrent's network is Gluetun's, with the VPN up";
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
      wiring: shown.wiring,
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
      // An error that knows its own cause says what to do better than the step's hint.
      const hint = ownHint(cause) ?? STEP_HINTS[step];
      this.diagnostics.push(error(`apply.${step}-failed`, message, { hint }));
      this.#finish({ step, result: 'failed', error: message });
    }
  }

  /** One result inside the step that runs: the wire step's, for each resource. */
  record(action: ActionResult): void {
    this.#finish(action);
  }

  #finish(action: ActionResult): void {
    this.actions.push(action);
    this.#onStep?.({ step: action.step, phase: 'end', action });
  }
}

/** A step that failed, and what to do about it, better said than the step's own hint. */
class StepError extends Error {
  readonly hint: string;

  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

/** Mediaplane couldn't step off the wiring network before up, so nothing was started. */
class LeaveFailed extends Error {
  override readonly name = 'LeaveFailed';
  readonly hint = `Mediaplane steps off the stack's wiring network before Compose starts the apps, and couldn't, so nothing was started; fix what the error says, then run apply again. See ${runbookUrl('wiring-failed')}`;
}

/** What an error that knows its own cause says to do, if it does. */
function ownHint(cause: unknown): string | undefined {
  if (
    cause instanceof AppdataNotPrivateError ||
    cause instanceof LeaveFailed ||
    cause instanceof StepError
  ) {
    return cause.hint;
  }
  return cause instanceof WiringFailed ? cause.hint : undefined;
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

/**
 * compose.yaml and .env, each only when it changed, as plan says, keeping the previous
 * compose.yaml as compose.prev.yaml (spec §5 step 6). An unchanged .env is still made
 * private again. Returns the paths it wrote, relative to the home.
 */
async function writeGenerated(
  home: string,
  compose: string,
  env: string,
): Promise<string[]> {
  const written: string[] = [];
  const composePath = join(home, COMPOSE_PATH);
  const previous = await readIfExists(composePath);
  if (previous !== compose) {
    if (previous !== undefined) {
      await writeFileAtomic(join(home, COMPOSE_PREV_PATH), previous);
    }
    await writeFileAtomic(composePath, compose);
    written.push(COMPOSE_PATH);
  }
  const envPath = join(home, ENV_PATH);
  if ((await readIfExists(envPath)) === env && (await madePrivate(envPath))) {
    return written;
  }
  await writeFileAtomic(envPath, env, 0o600);
  written.push(ENV_PATH);
  return written;
}

/**
 * chmod 0600, or false where only the owner may and this user isn't it (after a run with
 * sudo): the rewrite, as before Slice 3b, makes it this user's and private.
 */
async function madePrivate(path: string): Promise<boolean> {
  try {
    await chmod(path, 0o600);
    return true;
  } catch (cause) {
    if (codeOf(cause) === 'EPERM') return false;
    throw cause;
  }
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
    // An unknown one says why: its reason names the app and what failed, redacted.
    ...result.wiring
      .filter((w) => w.action !== 'unchanged')
      .map((w) =>
        w.action === 'unknown' && w.reason !== undefined
          ? `${w.resource} (unknown: ${w.reason})`
          : `${w.resource} (${w.action})`,
      ),
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
    wiring: [],
    diagnostics: [],
  };
}
