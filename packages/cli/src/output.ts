import type { ContainerAction, Diagnostic, PlanResult } from '@mediaplane/engine';
import type { Io } from './run';

export const PLAN_JSON_SCHEMA = 'mediaplane.plan/v1';
export const ERROR_JSON_SCHEMA = 'mediaplane.error/v1';

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
    io.stdout(`${file.status === 'create' ? '+' : '~'} ${file.path}\n${file.diff}\n`);
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
  const parts = [
    count(files.length, 'file', 'to write'),
    count(containers.length, 'container', 'to change'),
    count(generate.length, 'secret', 'to generate'),
  ].filter((part): part is string => part !== undefined);
  io.stdout(parts.length === 0 ? 'No changes.\n' : `Plan: ${parts.join(', ')}.\n`);
}

function count(n: number, noun: string, verb: string): string | undefined {
  return n === 0 ? undefined : `${n} ${noun}${n === 1 ? '' : 's'} ${verb}`;
}
