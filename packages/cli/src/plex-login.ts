import { chmod, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import {
  loadConfigFile,
  newClientId,
  PlexTvError,
  readSecret,
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
  try {
    const saved = await readSecret(ref, home, io.env);
    if (saved !== undefined && !options.force) {
      if (await works(plexTv, saved)) {
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
    const pin = await plexTv.createPin(newClientId());
    const wait = Math.min(seconds ?? pin.expiresIn, pin.expiresIn);
    // On stderr with --json: what to do, for you, apart from what scripts read.
    const say = (text: string) => {
      if (json) io.stderr(text);
      else io.stdout(text);
    };
    say(
      `Sign in to Plex in a browser, with this link:\n\n  ${signInLink(pin)}\n\nWaiting for you to sign in (up to ${minutes(wait)})...\n`,
    );
    const token = await plexTv.waitForPin(pin, wait);
    if (token === undefined) {
      throw new LoginStopped(
        `nobody signed in within ${minutes(wait)}; run plex-login again for a new link`,
      );
    }
    await mkdir(dirname(path), { recursive: true });
    if (dirname(path) === join(home, 'secrets')) await chmod(dirname(path), 0o700);
    // Whole or not at all, and 0600: the token is the key to your Plex account.
    await writeFileAtomic(path, `${token}\n`, 0o600);
    report(options, io, {
      saved: shown,
      signedIn: true,
      replaced: saved !== undefined,
      said: `Signed in. Saved your Plex token in ${shown}. Next: run "mediaplane apply".`,
    });
    return 0;
  } catch (cause) {
    if (cause instanceof LoginStopped) {
      printError(cause.message, { json }, io);
      return 1;
    }
    if (!(cause instanceof PlexTvError)) throw cause;
    const next =
      cause.kind === 'expired'
        ? 'the link ran out before you signed in; run plex-login again for a new one'
        : cause.unsure
          ? `couldn't reach plex.tv: ${cause.message}; check this host's internet connection, then run plex-login again`
          : `plex.tv refused: ${cause.message}`;
    printError(next, { json }, io);
    return 1;
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
function minutes(seconds: number): string {
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
