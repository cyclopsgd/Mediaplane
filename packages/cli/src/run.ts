import { catalog } from '@mediaplane/catalog';
import { detectHostFacts, plan } from '@mediaplane/engine';
import { Command, CommanderError } from 'commander';
import { printPlan } from './output';
import { VERSION } from './version';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
}

export const DEFAULT_HOME = '/opt/mediaplane';

/** Run the CLI with user arguments (no node/script prefix) and return the exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  let exitCode = 0;
  const program = new Command('mediaplane')
    .description('Deploy and wire a self-hosted media stack from one stack.yaml')
    .version(VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        io.stdout(text);
      },
      writeErr: (text) => {
        io.stderr(text);
      },
    });

  program
    .command('plan')
    .description('Show what apply would change, without changing anything')
    .option(
      '--home <dir>',
      'Mediaplane home directory',
      io.env.MEDIAPLANE_HOME ?? DEFAULT_HOME,
    )
    .option('--json', 'print machine-readable JSON')
    .action(async (options: { home: string; json?: boolean }) => {
      const result = await plan({
        home: options.home,
        catalog,
        host: detectHostFacts(),
        env: io.env,
      });
      printPlan(result, { json: options.json === true }, io);
      exitCode = result.ok ? (result.changed ? 2 : 0) : 1;
    });

  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return cause.exitCode;
    // Anything else (an unreadable stack.yaml, an unsupported CPU) is described, not crashed on.
    io.stderr(`error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 1;
  }
  return exitCode;
}
