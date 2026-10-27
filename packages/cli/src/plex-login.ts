import { mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import {
  ensureDir,
  loadConfigFile,
  newClientId,
  PlexTvError,
  signInLink,
  STACK_PATH,
  writeFileAtomic,
  type PlexTv,
} from '@mediaplane/engine';
import { printDiagnostics, printError } from './output';
import type { Io } from './run';

export const PLEX_LOGIN_JSON_SCHEMA = 'mediaplane.plex-login/v1';

/** The longest plex-login waits: a strong PIN lasts 30 minutes (probed). */
export const PLEX_LOGIN_MAX_SECONDS = 1800;

export interface PlexLoginOptions {
  /** The Mediaplane home, absolute. */
  home: string;
  json: boolean;
  /** Sign in again even though the saved token works. */
  force: boolean;
  /** The longest to wait for the sign-in, in seconds; the link's own life by default. */
  timeout?: string;
  /** Run by init, whose own next steps follow: say nothing of what to do next. */
  fromInit?: boolean;
}

/** Why the sign-in didn't happen, said once; never holds a token. */
class LoginStopped extends Error {}

/**
 * `mediaplane plex-login` (spec §5.2, §6.1): sign in to plex.tv with its PIN flow, and save
 * the token where stack.yaml's `plex.token` names a file, 0600. It prints a link, then waits
 * for the sign-in, asking plex.tv every 2 seconds, for as long as the link lasts (30
 * minutes) or `--timeout` says. The token is the account's long-lived one, which the PIN
 * gives: never the 7-day JWT. A saved token that plex.tv still takes is kept, unless
 * `--force`; one it refuses is replaced. The token is never printed. Returns the exit code.
 */
export async function plexLogin(
  options: PlexLoginOptions,
  io: Io,
  plexTv: PlexTv,
): Promise<number> {
  const { home, json } = options;
  const seconds = timeoutSeconds(options.timeout);
  if (seconds === undefined) {
    printError(
      `--timeout must be a whole number of seconds from 1 to ${String(PLEX_LOGIN_MAX_SECONDS)}`,
      { json },
      io,
    );
    return 1;
  }
  const loaded = await loadConfigFile(join(home, STACK_PATH));
  if (!loaded.ok) {
    printDiagnostics(loaded.diagnostics, { json }, io);
    return 1;
  }
  const ref = loaded.config.plex?.token;
  if (ref === undefined) {
    printError(
      'stack.yaml has no plex.token, which says where your Plex token goes: set media_server: plex and plex.token: { file: secrets/plex-token }, then run plex-login again',
      { json },
      io,
    );
    return 1;
  }
  if ('env' in ref) {
    printError(
      `plex.token is read from the environment variable ${ref.env}, where plex-login can't save it: set plex.token: { file: secrets/plex-token } instead, then run plex-login again`,
      { json },
      io,
    );
    return 1;
  }
  const path = isAbsolute(ref.file) ? ref.file : join(home, ref.file);
  const shown = isAbsolute(ref.file) ? ref.file : relative(home, path);
  // Whether the failing call is the check of the saved token, which the message says.
  let checking = false;
  try {
    // Read even with --force: a file that can't be read is the file's owner's to fix.
    const existing = await readToken(path, shown);
    const saved = existing === '' ? undefined : existing;
    if (saved !== undefined && !options.force) {
      checking = true;
      const takes = await works(plexTv, saved);
      checking = false;
      if (takes) {
        report(options, io, {
          saved: shown,
          signedIn: false,
          replaced: false,
          said: `The Plex token in ${shown} works, so there is nothing to do. Run "mediaplane plex-login --force" to sign in again.`,
        });
        return 0;
      }
      io.stderr(`plex.tv refuses the Plex token in ${shown}, so sign in again.\n`);
    }
    // Before the PIN, so a folder that can't be made loses no sign-in.
    await prepareFolder(path, home, shown);
    const pin = await plexTv.createPin(newClientId());
    const wait = Math.min(seconds ?? pin.expiresIn, pin.expiresIn);
    // On stderr with --json: what to do, for you, apart from what scripts read.
    const say = (text: string) => {
      if (json) io.stderr(text);
      else io.stdout(text);
    };
    say(
      `Sign in to Plex in a browser, with this link:\n\n  ${signInLink(pin)}\n\nWaiting for you to sign in (up to ${duration(wait)})...\n`,
    );
    const token = await plexTv.waitForPin(pin, wait);
    if (token === undefined) {
      throw new LoginStopped(
        `nobody signed in within ${duration(wait)}; run plex-login again for a new link`,
      );
    }
    // Whole or not at all, and 0600: the token is the key to your Plex account.
    await writeFileAtomic(path, `${token}\n`, 0o600);
    // A token in place of another: Sonarr, Radarr and Seerr hold the old one, which only
    // a rotation gives them the new one in place of.
    const next =
      options.fromInit === true
        ? ''
        : saved === undefined
          ? ' Next: run "mediaplane apply".'
          : ' Next: run "mediaplane apply --rotate plex.token", which gives it to the apps that hold the old one, then you can sign the old one out at plex.tv.';
    report(options, io, {
      saved: shown,
      signedIn: true,
      replaced: existing !== undefined,
      said: `Signed in. Saved your Plex token in ${shown}.${next}`,
    });
    return 0;
  } catch (cause) {
    if (cause instanceof LoginStopped) {
      printError(cause.message, { json }, io);
      return 1;
    }
    if (!(cause instanceof PlexTvError)) throw cause;
    printError(failureMessage(cause, checking, shown), { json }, io);
    return 1;
  }
}

/**
 * What a plex.tv failure says. "Couldn't reach" is only for no answer at all; a 403, a 429
 * or a 5xx is an answer that doesn't say whether the token works. plex.tv's body is never
 * quoted (the error holds the status only).
 */
function failureMessage(cause: PlexTvError, checking: boolean, shown: string): string {
  const keep = `the Plex token in ${shown} is kept`;
  const later =
    'try again later, or run "mediaplane plex-login --force" to sign in anyway';
  if (cause.kind === 'expired') {
    return 'the link ran out before you signed in; run plex-login again for a new one';
  }
  if (cause.kind === 'unreachable') {
    return checking
      ? `couldn't reach plex.tv: ${cause.message}; ${keep}. Check this host's internet connection and ${later}.`
      : `couldn't reach plex.tv: ${cause.message}; check this host's internet connection, then run plex-login again`;
  }
  if (cause.kind === 'failed') {
    const status = cause.status === undefined ? '' : ` with HTTP ${String(cause.status)}`;
    return checking
      ? `plex.tv answered${status}, so Mediaplane can't tell whether the Plex token in ${shown} still works. It is kept. Try again later, or run "mediaplane plex-login --force" to sign in anyway.`
      : `plex.tv answered${status}; run plex-login again later`;
  }
  // An answer Mediaplane can't read: the error says what it was, as it is. The check
  // never gets here with a refusal (works), so a token it couldn't check is kept.
  return checking
    ? `${cause.message}, so Mediaplane can't tell whether the Plex token in ${shown} still works. It is kept. Run "mediaplane plex-login --force" to sign in anyway.`
    : cause.message;
}

/** The saved token ('' when the file is empty); undefined when there is no file. */
async function readToken(path: string, shown: string): Promise<string | undefined> {
  try {
    return (await readFile(path, 'utf8')).trim();
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    throw new LoginStopped(
      `can't read the Plex token file ${shown} (${code ?? 'unknown error'}): fix the file's owner or mode, then run plex-login again`,
    );
  }
}

/** Make the token's folder: 0700 for secrets/, whatever it is already for another. */
async function prepareFolder(path: string, home: string, shown: string): Promise<void> {
  const folder = dirname(path);
  try {
    if (folder === join(home, 'secrets')) await ensureDir(folder, 0o700);
    else await mkdir(folder, { recursive: true });
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    const name = isAbsolute(shown) ? folder : dirname(shown);
    throw new LoginStopped(
      `can't make the folder ${name} for the Plex token (${code ?? 'unknown error'}): fix the folder's owner or mode, then run plex-login again`,
    );
  }
}

/** Whether plex.tv takes `token`: it refuses one that was revoked (401). */
async function works(plexTv: PlexTv, token: string): Promise<boolean> {
  try {
    await plexTv.accountId(token);
    return true;
  } catch (cause) {
    if (cause instanceof PlexTvError && cause.kind === 'refused') return false;
    throw cause;
  }
}

/** --timeout's seconds; null when it isn't given, undefined when it isn't one. */
function timeoutSeconds(value: string | undefined): number | null | undefined {
  if (value === undefined) return null;
  if (!/^[1-9][0-9]*$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds > PLEX_LOGIN_MAX_SECONDS ? undefined : seconds;
}

/** "30 minutes", "2 minutes", "1 minute", "45 seconds", "1 second". */
function duration(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const count = seconds / 60;
    return `${String(count)} minute${count === 1 ? '' : 's'}`;
  }
  return `${String(seconds)} second${seconds === 1 ? '' : 's'}`;
}

function report(
  options: PlexLoginOptions,
  io: Io,
  result: { saved: string; signedIn: boolean; replaced: boolean; said: string },
): void {
  if (options.json) {
    io.stdout(
      `${JSON.stringify(
        {
          schema: PLEX_LOGIN_JSON_SCHEMA,
          ok: true,
          saved: result.saved,
          signedIn: result.signedIn,
          replaced: result.replaced,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  io.stdout(`${result.said}\n`);
}
