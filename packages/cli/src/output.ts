import {
  unhealthyServices,
  type ActionResult,
  type ApplyResult,
  type ApplyStep,
  type ChangeRecord,
  type ContainerAction,
  type Diagnostic,
  type PlanResult,
  type StatusResult,
  type StepEvent,
} from '@mediaplane/engine';
import type { Io } from './run';

export const PLAN_JSON_SCHEMA = 'mediaplane.plan/v1';
export const ERROR_JSON_SCHEMA = 'mediaplane.error/v1';
export const APPLY_JSON_SCHEMA = 'mediaplane.apply/v1';
export const STATUS_JSON_SCHEMA = 'mediaplane.status/v1';
export const HISTORY_JSON_SCHEMA = 'mediaplane.history/v1';

const MARKS: Record<ContainerAction, string> = {
  create: '+',
  recreate: '~',
  start: '>',
  remove: '-',
  unchanged: ' ',
};

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const hint = diagnostic.hint === undefined ? '' : `\n  hint: ${diagnostic.hint}`;
  return `${diagnostic.severity}: ${diagnostic.message}${hint}\n`;
}

export function printError(message: string, options: { json: boolean }, io: Io): void {
  if (options.json) {
    io.stdout(
      `${JSON.stringify({ schema: ERROR_JSON_SCHEMA, ok: false, error: { message } }, null, 2)}\n`,
    );
    return;
  }
  io.stderr(`error: ${message}\n`);
}

export function printPlan(result: PlanResult, options: { json: boolean }, io: Io): void {
  if (options.json) {
    const files = result.files.map(({ content, ...file }) => file);
    io.stdout(
      `${JSON.stringify({ schema: PLAN_JSON_SCHEMA, ...result, files }, null, 2)}\n`,
    );
    return;
  }
  for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
  if (!result.ok) {
    io.stderr('\nPlan failed. Fix the errors above and run it again.\n');
    return;
  }
  const files = result.files.filter((file) => file.status !== 'unchanged');
  for (const file of files) {
    const mark = file.status === 'create' ? '+' : '~';
    io.stdout(
      file.sensitive === true
        ? `${mark} ${file.path} (secret values, not shown)\n\n`
        : `${mark} ${file.path}\n${file.diff}\n`,
    );
  }
  const containers = result.containers.filter((change) => change.action !== 'unchanged');
  if (containers.length > 0) {
    io.stdout('Containers:\n');
    for (const change of containers) {
      io.stdout(
        `  ${MARKS[change.action]} ${change.action.padEnd(9)} ${change.service}\n`,
      );
    }
  }
  const generate = result.secrets.generate;
  if (generate.length > 0) io.stdout(`Secrets to generate: ${generate.join(', ')}\n`);
  const unhealthy = result.unhealthy;
  if (unhealthy.length > 0) io.stdout(`Not healthy yet: ${unhealthy.join(', ')}\n`);
  const parts = [
    count(files.length, 'file', 'to write'),
    count(containers.length, 'container', 'to change'),
    count(generate.length, 'secret', 'to generate'),
    count(unhealthy.length, 'app', 'to wait for'),
  ].filter((part): part is string => part !== undefined);
  io.stdout(parts.length === 0 ? 'No changes.\n' : `Plan: ${parts.join(', ')}.\n`);
}

function count(n: number, noun: string, verb: string): string | undefined {
  return n === 0 ? undefined : `${n} ${noun}${n === 1 ? '' : 's'} ${verb}`;
}

const STEP_LABELS: Record<ApplyStep, string> = {
  keys: 'secrets',
  files: 'files',
  pull: 'images',
  ownership: 'appdata ownership',
  start: 'containers',
  verify: 'verify',
};

const SLOW_STEPS: Partial<Record<ApplyStep, string>> = {
  pull: 'Pulling images (the first time can take several minutes)…',
  start: 'Starting containers and waiting until every app is healthy…',
};

/** Progress lines while apply runs. A failure's message comes once, at the end. */
export function printStep(event: StepEvent, io: Io): void {
  if (event.phase === 'start') {
    const note = SLOW_STEPS[event.step];
    if (note !== undefined) io.stdout(`${note}\n`);
    return;
  }
  const { action } = event;
  const detail = action.detail === undefined ? '' : `: ${action.detail}`;
  io.stdout(`  ${action.result.padEnd(7)} ${STEP_LABELS[action.step]}${detail}\n`);
}

export function printApply(
  result: ApplyResult,
  options: { json: boolean },
  io: Io,
): void {
  if (options.json) {
    const { files, containers, secrets, unhealthy } = result.plan;
    io.stdout(
      `${JSON.stringify(
        {
          schema: APPLY_JSON_SCHEMA,
          ok: result.outcome === 'success' || result.outcome === 'no-changes',
          changed: result.actions.some((a) => a.result === 'done' && a.step !== 'verify'),
          outcome: result.outcome,
          plan: {
            files: files.map(({ content, ...file }) => file),
            containers,
            secrets,
            unhealthy,
          },
          actions: result.actions,
          recordId: result.recordId ?? null,
          diagnostics: result.diagnostics,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  // The plan was already printed (with its warnings) when the user was asked to confirm,
  // so only invalid and no-changes, which stop before asking, show its diagnostics here.
  const shownBefore = result.outcome !== 'invalid' && result.outcome !== 'no-changes';
  for (const diagnostic of result.diagnostics) {
    const repeated =
      shownBefore &&
      result.plan.diagnostics.some(
        (d) => d.code === diagnostic.code && d.message === diagnostic.message,
      );
    if (!repeated) io.stderr(formatDiagnostic(diagnostic));
  }
  // No id when the record could not be saved: say nothing rather than print an empty one.
  const recordNote =
    result.recordId === undefined ? '' : ` Change record: ${result.recordId}`;
  switch (result.outcome) {
    case 'invalid':
      io.stderr(
        '\nApply stopped before changing anything. Fix the errors above and run it again.\n',
      );
      return;
    case 'no-changes':
      io.stdout('No changes.\n');
      return;
    case 'cancelled':
      io.stderr('Apply cancelled; nothing was changed.\n');
      return;
    case 'success':
      io.stdout(`\nApply complete.${recordNote}\n`);
      return;
    case 'failed': {
      const tally = (outcome: ActionResult['result']) =>
        result.actions.filter((a) => a.result === outcome).length;
      if (result.recordId === undefined && tally('failed') === 0) {
        // Every step worked, so "run apply again" would only say "No changes."
        io.stderr('\nApply finished, but its change record could not be saved.\n');
        return;
      }
      io.stderr(
        `\nApply failed: ${tally('done')} done, ${tally('failed')} failed, ${tally('skipped')} skipped. Run apply again to retry.${recordNote}\n`,
      );
    }
  }
}

/** The short form of a change record used by `status` and `history --json`. */
function summary(record: ChangeRecord) {
  return {
    id: record.id,
    startedAt: record.startedAt,
    durationMs: record.durationMs,
    outcome: record.outcome,
    changes: {
      files: record.plan.files.filter((f) => f.status !== 'unchanged').length,
      containers: record.plan.containers.filter((c) => c.action !== 'unchanged').length,
      secrets: record.plan.secrets.generate.length,
    },
  };
}

export function printStatus(
  result: StatusResult,
  options: { json: boolean },
  io: Io,
): void {
  if (options.json) {
    io.stdout(
      `${JSON.stringify(
        {
          schema: STATUS_JSON_SCHEMA,
          healthy:
            result.containers.length > 0 &&
            unhealthyServices(result.containers).length === 0,
          containers: result.containers.map(({ service, state, health, published }) => ({
            service,
            state,
            health,
            published,
          })),
          lastApply: result.lastApply === undefined ? null : summary(result.lastApply),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (result.containers.length === 0) {
    io.stdout(
      'No containers are running for this stack. Run "mediaplane apply" to start it.\n',
    );
  } else {
    // Each column is as wide as its longest value plus two spaces, so values never run together.
    const appWidth = Math.max(3, ...result.containers.map((c) => c.service.length)) + 2;
    const stateWidth = Math.max(5, ...result.containers.map((c) => c.state.length)) + 2;
    io.stdout(`${'APP'.padEnd(appWidth)}${'STATE'.padEnd(stateWidth)}HEALTH\n`);
    for (const c of result.containers) {
      io.stdout(
        `${c.service.padEnd(appWidth)}${c.state.padEnd(stateWidth)}${c.health === '' ? '-' : c.health}\n`,
      );
    }
  }
  const last = result.lastApply;
  io.stdout(
    last === undefined
      ? 'No apply has run yet.\n'
      : `Last apply: ${last.startedAt}, ${last.outcome} (${last.id})\n`,
  );
}

export function printHistory(
  list: { records: ChangeRecord[]; unreadable: string[] },
  options: { json: boolean },
  io: Io,
): void {
  if (options.json) {
    io.stdout(
      `${JSON.stringify(
        {
          schema: HISTORY_JSON_SCHEMA,
          records: list.records.map(summary),
          unreadable: list.unreadable,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  for (const name of list.unreadable)
    io.stderr(`warning: could not read state/history/${name}\n`);
  if (list.records.length === 0) {
    io.stdout('No changes have been applied yet.\n');
    return;
  }
  for (const record of list.records) {
    const { changes } = summary(record);
    const parts = [
      count(changes.files, 'file', 'written'),
      count(changes.containers, 'container', 'changed'),
      count(changes.secrets, 'secret', 'generated'),
    ].filter((part): part is string => part !== undefined);
    io.stdout(
      `${record.id}  ${record.outcome.padEnd(7)}  ${parts.length === 0 ? 'no changes' : parts.join(', ')}\n`,
    );
  }
}

export function printRecord(
  record: ChangeRecord,
  options: { json: boolean },
  io: Io,
): void {
  if (options.json) {
    io.stdout(`${JSON.stringify(record, null, 2)}\n`);
    return;
  }
  io.stdout(`Change ${record.id}\n`);
  io.stdout(
    `  started  ${record.startedAt}, took ${String(Math.round(record.durationMs / 1000))}s\n`,
  );
  io.stdout(`  outcome  ${record.outcome}\n`);
  io.stdout(`  stack    sha256:${record.stackSha256}\n`);
  for (const change of record.plan.containers.filter((c) => c.action !== 'unchanged')) {
    io.stdout(`  ${MARKS[change.action]} ${change.action.padEnd(9)} ${change.service}\n`);
  }
  if (record.plan.secrets.generate.length > 0) {
    io.stdout(`  secrets generated: ${record.plan.secrets.generate.join(', ')}\n`);
  }
  io.stdout('Steps:\n');
  for (const action of record.actions) {
    const detail = action.detail ?? action.error;
    io.stdout(
      `  ${action.result.padEnd(7)} ${STEP_LABELS[action.step]}${detail === undefined ? '' : `: ${detail}`}\n`,
    );
  }
}
