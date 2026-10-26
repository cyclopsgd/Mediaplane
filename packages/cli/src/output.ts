import {
  NONE_NEEDED,
  overrideLine,
  splitKey,
  unhealthyServices,
  WIRING_RUNBOOK,
  type ActionResult,
  type ApplyResult,
  type ApplyStep,
  type ChangeRecord,
  type ContainerAction,
  type Diagnostic,
  type Drift,
  type DriftResult,
  type KeepResult,
  type MigrateResult,
  type PlanResult,
  type StatusResult,
  type StepEvent,
  type WiringAction,
  type WiringChange,
} from '@mediaplane/engine';
import type { Io } from './run';

export const PLAN_JSON_SCHEMA = 'mediaplane.plan/v1';
export const ERROR_JSON_SCHEMA = 'mediaplane.error/v1';
export const APPLY_JSON_SCHEMA = 'mediaplane.apply/v1';
export const STATUS_JSON_SCHEMA = 'mediaplane.status/v1';
export const HISTORY_JSON_SCHEMA = 'mediaplane.history/v1';
export const DRIFT_JSON_SCHEMA = 'mediaplane.drift/v1';
export const KEEP_JSON_SCHEMA = 'mediaplane.keep/v1';
export const MIGRATE_JSON_SCHEMA = 'mediaplane.migrate/v1';

/** What keep takes, where drift shows a change: the field's address, or the resource's. */
const KEEP_HINT =
  'mediaplane keep <app>.<resource>.<field> keeps what the app holds instead, and <app>.<resource> stops Mediaplane managing one deleted';

const MARKS: Record<ContainerAction, string> = {
  create: '+',
  recreate: '~',
  start: '>',
  restart: '>',
  remove: '-',
  unchanged: ' ',
};

const WIRING_MARKS: Record<WiringAction, string> = {
  create: '+',
  update: '~',
  adopt: '=',
  'after-start': '>',
  unknown: '?',
  remove: '-',
  unchanged: ' ',
};

/** One resource's line, as plan and history show it: "  + create      sonarr.admin". */
function wiringLine(change: WiringChange): string {
  const what = change.changes === undefined ? '' : ` (${change.changes.join(', ')})`;
  return `  ${WIRING_MARKS[change.action]} ${change.action.replace('-', ' ').padEnd(11)} ${change.resource}${what}`;
}

/** A value as drift shows it: text in quotes, so that an empty one shows. */
function shownValue(value: Drift['actual']): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * One change made outside Mediaplane, as plan and drift show it: the field, what was
 * applied and what the app holds; a resource deleted; or a secret the app refuses.
 */
export function driftLine(drift: Drift): string {
  switch (drift.kind) {
    case 'field': {
      const actual =
        drift.unreadable === undefined
          ? shownValue(drift.actual ?? null)
          : `one Mediaplane can't read (${drift.unreadable})`;
      return `  ~ ${drift.resource}.${drift.field ?? ''}: expected ${shownValue(drift.expected ?? null)}, actual ${actual}${drift.applied === undefined ? '' : ` (Mediaplane applied ${shownValue(drift.applied)}; stack.yaml has changed it since)`}`;
    }
    case 'missing':
      return `  - ${drift.resource}: deleted outside Mediaplane`;
    case 'secret':
      return `  ! ${drift.resource}.${drift.secret ?? ''}: refused by the app's own check${drift.since === undefined ? '' : ` (found by drift at ${drift.since}; not checked again until apply sets it)`}`;
    case 'key':
      return drift.source === undefined
        ? `  ! ${drift.resource}: refuses the key Mediaplane holds for it (${drift.secret ?? ''}), as if it was changed in the app${drift.since === undefined ? '' : ` (found at ${drift.since}; not sent again until apply checks it)`}`
        : `  ! ${drift.resource}.${drift.secret ?? ''}: holds ${drift.source}'s key, which ${drift.source} refuses`;
    case 'left':
      return drift.stays === undefined
        ? `  - ${drift.resource}: still in the app, though the stack no longer wants it; apply removes it`
        : `  ? ${drift.resource}: still in the app, though the stack no longer wants it; apply leaves it: ${drift.stays}`;
  }
}

/**
 * What puts right the drift found, one line for each kind of it there is: apply puts back
 * a field, a resource or a secret changed in an app, and an app's own key where the app
 * keeps it in a file of its own; and it removes what Mediaplane made that the stack no
 * longer wants, but for what it says it leaves (`stays`).
 */
export function driftAdvice(drift: readonly Drift[]): string[] {
  const has = (...kinds: Drift['kind'][]) => drift.some((d) => kinds.includes(d.kind));
  return [
    ...(has('field', 'missing', 'secret')
      ? [
          `apply puts back each field, resource and secret changed in the apps; ${KEEP_HINT}`,
        ]
      : []),
    ...(has('key')
      ? [
          `apply puts the key Mediaplane holds back where an app keeps it in a file of its own, such as qBittorrent's, and restarts the app, and has an app that made its own key, such as Jellyfin, make another; for any other app, put it back as ${WIRING_RUNBOOK} shows. mediaplane keep <app>.<key> keeps the app's own key instead`,
        ]
      : []),
    ...(drift.some((d) => d.kind === 'left' && d.stays === undefined)
      ? [
          'apply removes what Mediaplane made that the stack no longer wants; to keep one as yours instead, run mediaplane keep <app>.<resource> first, which also stops the report',
        ]
      : []),
    ...(drift.some((d) => d.kind === 'left' && d.stays !== undefined)
      ? [
          'what apply leaves is for you to remove in the app, if you want it gone; or keep it as yours with mediaplane keep <app>.<resource>, which stops the report',
        ]
      : []),
  ];
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const hint = diagnostic.hint === undefined ? '' : `\n  hint: ${diagnostic.hint}`;
  return `${diagnostic.severity}: ${diagnostic.message}${hint}\n`;
}

/**
 * Diagnostics that stopped a command: each as an error line with its hint, or, with
 * --json, one error envelope that joins their messages.
 */
export function printDiagnostics(
  diagnostics: readonly Diagnostic[],
  options: { json: boolean },
  io: Io,
): void {
  if (options.json) {
    printError(diagnostics.map((d) => d.message).join('; '), options, io);
    return;
  }
  for (const diagnostic of diagnostics) io.stderr(formatDiagnostic(diagnostic));
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
      file.prestart === true
        ? `${mark} ${file.path} (before first start; secret values, not shown)\n\n`
        : file.sensitive === true
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
  const { generate, recover, restore } = result.secrets;
  if (recover.length > 0) {
    io.stdout(`Secrets to recover from the apps' appdata: ${recover.join(', ')}\n`);
  }
  if (generate.length > 0) io.stdout(`Secrets to generate: ${generate.join(', ')}\n`);
  if (restore.length > 0) {
    io.stdout(
      `Keys to put back in their apps' own files, each app stopped first: ${restore.join(', ')}\n`,
    );
  }
  const unhealthy = result.unhealthy;
  if (unhealthy.length > 0) io.stdout(`Not healthy yet: ${unhealthy.join(', ')}\n`);
  if (result.bootstrap.length > 0) {
    io.stdout('First-run setup:\n');
    for (const { app, unpublished } of result.bootstrap) {
      const how = unpublished
        ? 'with no port published until it is done'
        : 'signing in as the admin, to make its key';
      io.stdout(`  + ${app} (${how})\n`);
    }
  }
  if (result.drift.length > 0) {
    io.stdout('Drift, changed outside Mediaplane since it was applied:\n');
    for (const drift of result.drift) io.stdout(`${driftLine(drift)}\n`);
    for (const line of driftAdvice(result.drift)) io.stdout(`  ${line}.\n`);
  }
  const wiring = result.wiring.filter((change) => change.action !== 'unchanged');
  if (wiring.length > 0) {
    io.stdout('Wiring:\n');
    for (const change of wiring) {
      io.stdout(`${wiringLine(change)}\n`);
    }
  }
  const tally = (...actions: WiringAction[]) =>
    wiring.filter((change) => actions.includes(change.action)).length;
  const parts = [
    count(files.length, 'file', 'to write'),
    count(containers.length, 'container', 'to change'),
    count(recover.length, 'secret', 'to recover'),
    count(generate.length, 'secret', 'to generate'),
    count(restore.length, 'key', 'to put back'),
    count(unhealthy.length, 'app', 'to wait for'),
    count(result.bootstrap.length, 'app', 'to set up'),
    count(tally('create', 'update', 'adopt'), 'resource', 'to wire'),
    count(tally('remove'), 'resource', 'to remove'),
    count(tally('after-start'), 'wiring check', 'after the start'),
    count(tally('unknown'), 'wiring check', 'that could not be made'),
  ].filter((part): part is string => part !== undefined);
  io.stdout(parts.length === 0 ? 'No changes.\n' : `Plan: ${parts.join(', ')}.\n`);
}

/**
 * What `mediaplane drift` found: each change made outside Mediaplane, what it couldn't
 * check, and how the secrets fared, by name only.
 */
export function printDrift(
  result: DriftResult,
  options: { json: boolean },
  io: Io,
): void {
  if (options.json) {
    io.stdout(`${JSON.stringify({ schema: DRIFT_JSON_SCHEMA, ...result }, null, 2)}\n`);
    return;
  }
  for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
  if (!result.ok) {
    io.stderr('\nDrift could not look. Fix the errors above and run it again.\n');
    return;
  }
  if (result.drift.length > 0) {
    io.stdout('Changed outside Mediaplane since it was applied:\n');
    for (const drift of result.drift) io.stdout(`${driftLine(drift)}\n`);
  }
  if (result.unchecked.length > 0) {
    io.stdout('Not checked:\n');
    for (const { resource, reason } of result.unchecked) {
      io.stdout(`  ? ${resource}: ${reason}\n`);
    }
  }
  const verdicts = (verdict: string) =>
    result.checks.filter((check) => check.verdict === verdict);
  const unchecked = verdicts('unchecked');
  // A secret that passed lately isn't checked again until its time is up (checkEvery).
  const recalled = verdicts('passed').filter((check) => check.at !== undefined);
  const passed = verdicts('passed').length;
  const secrets = [
    [
      passed,
      recalled.length === 0
        ? 'passed'
        : `passed (${String(recalled.length)} as last checked)`,
    ] as const,
    [verdicts('refused').length, 'refused'] as const,
    [unchecked.length, 'not checked'] as const,
  ].flatMap(([n, what]) => (n === 0 ? [] : [`${String(n)} ${what}`]));
  if (secrets.length > 0) {
    io.stdout(`Secrets, checked with each app's own check: ${secrets.join(', ')}.\n`);
    for (const { resource, secret, at } of recalled) {
      io.stdout(
        `  = ${resource}.${secret}: passed when drift last checked it, at ${at ?? ''}; it isn't checked again until its time is up\n`,
      );
    }
    for (const { resource, secret, reason } of unchecked) {
      io.stdout(`  ? ${resource}.${secret}: ${reason ?? 'not checked'}\n`);
    }
  }
  if (result.clear) {
    io.stdout('No drift: the apps hold what Mediaplane applied.\n');
  } else if (result.drift.length > 0) {
    io.stdout('Drift found.\n');
    for (const line of driftAdvice(result.drift)) io.stdout(`  ${line}.\n`);
  } else {
    io.stdout(
      'No drift found where Mediaplane could look, but it could not look at everything, or check every secret: see above.\n',
    );
  }
}

/** What `mediaplane keep` kept, or why it kept nothing. */
export function printKeep(result: KeepResult, options: { json: boolean }, io: Io): void {
  if (options.json) {
    io.stdout(
      `${JSON.stringify({ schema: KEEP_JSON_SCHEMA, ...result, value: result.value ?? null }, null, 2)}\n`,
    );
    return;
  }
  for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
  if (result.ok && result.holders !== undefined) {
    const { app } = splitKey(result.key);
    io.stdout(
      `Kept ${app}'s own key (${result.key}) in state/secrets.json, where Mediaplane keeps its keys; stack.yaml is as it was.\n${
        result.holders.length === 0
          ? 'No resource of the stack holds the old one.\n'
          : `Run apply to give it to ${result.holders.join(', ')}, which hold the old one.\n`
      }`,
    );
    return;
  }
  if (!result.ok || result.value === undefined) {
    io.stderr(
      '\nNothing was kept; stack.yaml and state/secrets.json are as they were.\n',
    );
    return;
  }
  const resource = result.value === 'unmanaged' && result.key.split('.').length === 2;
  if (result.written === false) {
    // managed_by: external: the line is yours to add, where stack.yaml is kept.
    io.stdout(
      `Add this line under overrides: in stack.yaml, where it is kept:\n  ${result.line ?? overrideLine(result.key, result.value, true)}\n${
        resource
          ? 'Mediaplane has forgotten that it made it, so apply never removes it. Until stack.yaml holds the line, apply makes it again if the stack still wants it.\n'
          : 'Until stack.yaml holds it, apply puts back what it applied, and drift reports it.\n'
      }`,
    );
    return;
  }
  io.stdout(
    resource
      ? `Wrote ${result.key}: unmanaged under overrides: in stack.yaml. Mediaplane no longer manages it, and apply doesn't make it again.\n`
      : `Wrote ${overrideLine(result.key, result.value)} under overrides: in stack.yaml. apply now leaves it as the app holds it, and drift no longer reports it.\n`,
  );
}

/** What `mediaplane migrate` rewrote, or why it didn't, with the file as it should be. */
export function printMigrate(
  result: MigrateResult,
  options: { json: boolean },
  io: Io,
): void {
  if (options.json) {
    io.stdout(`${JSON.stringify({ schema: MIGRATE_JSON_SCHEMA, ...result }, null, 2)}\n`);
    return;
  }
  for (const diagnostic of result.diagnostics) io.stderr(formatDiagnostic(diagnostic));
  if (!result.ok) {
    // The file alone on stdout, so that it can be saved as it is.
    if (result.text !== undefined) io.stdout(result.text);
    io.stderr(
      result.text === undefined
        ? '\nstack.yaml is as it was.\n'
        : `\nstack.yaml is as it was. As version ${String(result.to)}, it reads as above, on standard output.\n`,
    );
    return;
  }
  if (!result.changed) {
    io.stdout(
      `stack.yaml is version ${String(result.to)}, the version this Mediaplane writes: nothing to migrate.\n`,
    );
    return;
  }
  io.stdout(
    `Rewrote stack.yaml from version ${String(result.from)} to version ${String(result.to)}, keeping its comments:\n${result.applied.map((step) => `  - ${step}\n`).join('')}`,
  );
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
  bootstrap: 'first-run setup',
  wire: 'wiring',
  verify: 'verify',
};

const SLOW_STEPS: Partial<Record<ApplyStep, string>> = {
  pull: 'Pulling images (the first time can take several minutes)…',
  start: 'Starting containers and waiting until every app is healthy…',
  bootstrap: 'Finishing first-run setup before publishing the web UIs…',
  wire: 'Wiring the apps…',
};

/**
 * Progress lines while apply runs. A failed step's message comes once, at the end, with
 * what to do; a resource's (the wire step's) shows on its own line, as it comes.
 */
export function printStep(event: StepEvent, io: Io): void {
  if (event.phase === 'start') {
    const note = SLOW_STEPS[event.step];
    if (note !== undefined) io.stdout(`${note}\n`);
    return;
  }
  const { action } = event;
  const shown = action.resource !== undefined;
  io.stdout(`  ${action.result.padEnd(7)} ${describeAction(action, shown)}\n`);
}

/**
 * "wiring sonarr.admin: created", or "files: wrote generated/.env"; with `withError`, a
 * failure's message where there is no detail.
 */
function describeAction(action: ActionResult, withError = true): string {
  const said = action.detail ?? (withError ? action.error : undefined);
  const what =
    action.resource === undefined
      ? STEP_LABELS[action.step]
      : `${STEP_LABELS[action.step]} ${action.resource}`;
  return said === undefined ? what : `${what}: ${said}`;
}

/**
 * The actions to count in a summary: every step's, except the wire step's own result
 * once its resources were counted one by one, which would count each failure twice. A
 * wire step that failed where none of its resources did still counts.
 */
function tallied(actions: readonly ActionResult[]): ActionResult[] {
  const resources = actions.filter((a) => a.step === 'wire' && a.resource !== undefined);
  const resourceFailed = resources.some((a) => a.result === 'failed');
  return actions.filter(
    (a) =>
      a.step !== 'wire' ||
      a.resource !== undefined ||
      resources.length === 0 ||
      (a.result === 'failed' && !resourceFailed),
  );
}

/**
 * An action that changed the stack: verify only checks, NONE_NEEDED did nothing, and an
 * `unchanged` resource was left as it was.
 */
function changedSomething(action: ActionResult): boolean {
  return (
    action.result === 'done' &&
    action.step !== 'verify' &&
    action.detail !== NONE_NEEDED &&
    action.detail !== 'unchanged'
  );
}

export function printApply(
  result: ApplyResult,
  options: { json: boolean },
  io: Io,
): void {
  if (options.json) {
    const { files, containers, secrets, unhealthy, wiring, bootstrap } = result.plan;
    io.stdout(
      `${JSON.stringify(
        {
          schema: APPLY_JSON_SCHEMA,
          ok: result.outcome === 'success' || result.outcome === 'no-changes',
          changed: result.actions.some(changedSomething),
          outcome: result.outcome,
          plan: {
            files: files.map(({ content, ...file }) => file),
            containers,
            secrets,
            unhealthy,
            wiring,
            bootstrap,
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
        tallied(result.actions).filter((a) => a.result === outcome).length;
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
      // What the wire step changed in the apps; the plan only knew it after the start.
      wiring: record.actions.filter(
        (a) =>
          a.step === 'wire' &&
          a.resource !== undefined &&
          a.result === 'done' &&
          a.detail !== 'unchanged',
      ).length,
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
          // Only present when state/history could not be read.
          historyError: result.historyError,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (result.historyError !== undefined) {
    io.stderr(`warning: could not read the change history: ${result.historyError}\n`);
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
  // Without the history, "No apply has run yet" might not be true: the warning says why.
  if (result.historyError !== undefined) return;
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
      count(changes.wiring, 'resource', 'wired'),
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
  const recovered = record.plan.secrets.recover ?? [];
  if (recovered.length > 0) {
    io.stdout(`  secrets recovered from appdata: ${recovered.join(', ')}\n`);
  }
  if (record.plan.secrets.generate.length > 0) {
    io.stdout(`  secrets generated: ${record.plan.secrets.generate.join(', ')}\n`);
  }
  const restored = record.plan.secrets.restore ?? [];
  if (restored.length > 0) {
    io.stdout(`  keys put back in their apps' files: ${restored.join(', ')}\n`);
  }
  for (const change of (record.plan.wiring ?? []).filter(
    (w) => w.action !== 'unchanged',
  )) {
    io.stdout(`${wiringLine(change)}\n`);
  }
  io.stdout('Steps:\n');
  for (const action of record.actions) {
    io.stdout(`  ${action.result.padEnd(7)} ${describeAction(action)}\n`);
  }
}
