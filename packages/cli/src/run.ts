import { resolve } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  createDockerRuntime,
  detectHostFacts,
  nodeProbe,
  plan,
  PROJECT_NAME,
  type HostFacts,
  type HostProbe,
  type Runtime,
} from '@mediaplane/engine';
import { Command, CommanderError } from 'commander';
import { printError, printPlan } from './output';
import { VERSION } from './version';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
}

/** What the CLI talks to: the real host by default, fakes in tests. */
export interface CliDeps {
  host: () => HostFacts;
  runtime: (home: string, project: string) => Runtime;
  probe: HostProbe;
}

export const DEFAULT_HOME = '/opt/mediaplane';

const defaultDeps: CliDeps = {
  host: () => detectHostFacts(),
  runtime: (home, project) => createDockerRuntime({ home, project }),
  probe: nodeProbe,
};

/** An environment variable's value, treating "" as unset. */
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Run the CLI with user arguments (no node/script prefix) and return the exit code. */
export async function run(
  argv: readonly string[],
  io: Io,
  overrides: Partial<CliDeps> = {},
): Promise<number> {
  const deps: CliDeps = { ...defaultDeps, ...overrides };
  const json = argv.includes('--json');
  const project = setting(io.env, 'MEDIAPLANE_COMPOSE_PROJECT') ?? PROJECT_NAME;
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
      setting(io.env, 'MEDIAPLANE_HOME') ?? DEFAULT_HOME,
    )
    .option('--json', 'print machine-readable JSON')
    .action(async (options: { home: string; json?: boolean }) => {
      const home = resolve(options.home);
      const result = await plan({
        home,
        catalog,
        host: deps.host(),
        env: io.env,
        runtime: deps.runtime(home, project),
        probe: deps.probe,
      });
      printPlan(result, { json: options.json === true }, io);
      exitCode = result.ok ? (result.changed ? 2 : 0) : 1;
    });

  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (cause) {
    if (cause instanceof CommanderError) return cause.exitCode;
    // Anything else (an unreadable stack.yaml, an unsupported CPU) is described, not crashed on.
    printError(cause instanceof Error ? cause.message : String(cause), { json }, io);
    return 1;
  }
  return exitCode;
}
