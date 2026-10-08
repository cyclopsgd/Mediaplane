import type { Diagnostic, PlanResult } from '@mediaplane/engine';
import type { Io } from './run';

export const PLAN_JSON_SCHEMA = 'mediaplane.plan/v1';

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const hint = diagnostic.hint === undefined ? '' : `\n  hint: ${diagnostic.hint}`;
  return `${diagnostic.severity}: ${diagnostic.message}${hint}\n`;
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
  const changes = result.files.filter((file) => file.status !== 'unchanged');
  for (const file of changes) {
    io.stdout(`${file.status === 'create' ? '+' : '~'} ${file.path}\n${file.diff}\n`);
  }
  io.stdout(
    changes.length === 0
      ? 'No changes.\n'
      : `Plan: ${changes.length} file(s) to write.\n`,
  );
  io.stdout(
    'Note: this version plans generated files only; containers and app wiring come later.\n',
  );
}
