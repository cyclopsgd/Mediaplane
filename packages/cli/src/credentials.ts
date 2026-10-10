import type { AppLogin, CredentialsResult } from '@mediaplane/engine';
import { formatDiagnostic, printError } from './output';
import type { Io } from './run';

export const CREDENTIALS_JSON_SCHEMA = 'mediaplane.credentials/v1';

/**
 * `mediaplane credentials [app]` (spec §5.2): the shared login and where each app is.
 * The human output shows a generated password; --json leaves the password out unless
 * --reveal is given, and your own password needs --reveal either way. Returns the exit
 * code.
 */
export function printCredentials(
  result: CredentialsResult,
  app: string | undefined,
  options: { json: boolean; reveal: boolean },
  io: Io,
): number {
  if (!result.ok) {
    if (options.json) {
      printError(result.diagnostics.map((d) => d.message).join('; '), { json: true }, io);
    } else {
      for (const diagnostic of result.diagnostics)
        io.stderr(formatDiagnostic(diagnostic));
    }
    return 1;
  }
  const apps = app === undefined ? result.apps : result.apps.filter((a) => a.app === app);
  if (app !== undefined && apps.length === 0) {
    printError(`no app "${app}" with a web login in this stack`, options, io);
    return 1;
  }
  if (options.json) {
    const shown = {
      schema: CREDENTIALS_JSON_SCHEMA,
      username: result.username,
      password: options.reveal ? result.password : null,
      passwordSource: result.source.kind,
      apps,
    };
    io.stdout(`${JSON.stringify(shown, null, 2)}\n`);
    return 0;
  }
  const password =
    result.source.kind === 'generated' || options.reveal
      ? result.password
      : `yours, from ${result.source.ref} (--reveal shows it)`;
  io.stdout(
    `Admin login for the apps:\n  user name  ${result.username}\n  password   ${password}\n\n`,
  );
  const width = Math.max(...apps.map((entry) => entry.name.length)) + 2;
  for (const entry of apps) io.stdout(`${entry.name.padEnd(width)}${where(entry)}\n`);
  return 0;
}

function where(entry: AppLogin): string {
  const urls = entry.urls.length === 0 ? 'not published' : entry.urls.join(', ');
  return entry.login === 'shared'
    ? urls
    : `${urls}  (its login arrives in ${entry.comingIn})`;
}
