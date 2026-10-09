import { resolve } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  collectHostReport,
  createDockerRuntime,
  detectHostFacts,
  helperHostFacts,
  helperProbe,
  invokingUser,
  listRecords,
  nodeProbe,
  parseHostRequest,
  plan,
  PROJECT_NAME,
  readRecord,
  status,
  type HostFacts,
  type HostProbe,
  type Runtime,
} from '@mediaplane/engine';
import { Command, CommanderError } from 'commander';
import { init, type InitOptions } from './init';
import {
  printApply,
  printError,
  printHistory,
  printPlan,
  printRecord,
  printStatus,
  printStep,
} from './output';
import { VERSION } from './version';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
  /** Ask the user something and return the answer; absent when not on a terminal. */
  ask?: (question: string) => Promise<string>;
}

/** What the CLI talks to: the real host by default, fakes in tests. */
export interface CliDeps {
  /** Facts about the host; from inside the Mediaplane container, through `runtime`. */
  host: (runtime: Runtime) => Promise<HostFacts>;
  runtime: (home: string, project: string) => Runtime;
  /** What preflight asks about the host, for the Mediaplane home `home`. */
  probe: (runtime: Runtime, home: string) => HostProbe;
}

export const DEFAULT_HOME = '/opt/mediaplane';

/** An environment variable's value, treating "" as unset. */
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * The real host. In Mediaplane's image (mediaplane.compose.yaml sets MEDIAPLANE_IMAGE),
 * the host's network, ports and folders outside the home can't be seen from the
 * container, so a host helper container of that image looks at them (spec §4.2). Run from
 * source, the CLI looks at the host itself.
 */
export function defaultDeps(env: NodeJS.ProcessEnv): CliDeps {
  const runtime = (home: string, project: string) =>
    createDockerRuntime({ home, project });
  const image = setting(env, 'MEDIAPLANE_IMAGE');
  if (image === undefined) {
    return {
      host: () => Promise.resolve(detectHostFacts()),
      runtime,
      probe: () => nodeProbe,
    };
  }
  // Mediaplane's own user, as the helper must be; never root, even if the container is.
  const user = invokingUser();
  return {
    host: (docker) => helperHostFacts({ runtime: docker, image, user }),
    runtime,
    probe: (docker, home) => helperProbe({ runtime: docker, image, user, home }),
  };
}

/** The CLI's commands. Each action reports its exit code through `setExitCode`. */
export function createProgram(
  io: Io,
  deps: CliDeps,
  setExitCode: (code: number) => void,
): Command {
  const project = setting(io.env, 'MEDIAPLANE_COMPOSE_PROJECT') ?? PROJECT_NAME;
  const defaultHome = setting(io.env, 'MEDIAPLANE_HOME') ?? DEFAULT_HOME;
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
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--json', 'print machine-readable JSON')
    .action(async (options: { home: string; json?: boolean }) => {
      const home = resolve(options.home);
      const runtime = deps.runtime(home, project);
      const result = await plan({
        home,
        catalog,
        // Asked for by plan, so a helper that fails is a plan error, not a crash.
        host: () => deps.host(runtime),
        env: io.env,
        runtime,
        probe: deps.probe(runtime, home),
      });
      printPlan(result, { json: options.json === true }, io);
      setExitCode(result.ok ? (result.changed ? 2 : 0) : 1);
    });

  program
    .command('apply')
    .description('Make the running stack match stack.yaml')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--yes', 'apply without asking for confirmation')
    .option('--json', 'print machine-readable JSON (needs --yes)')
    .action(async (options: { home: string; yes?: boolean; json?: boolean }) => {
      const asJson = options.json === true;
      const yes = options.yes === true;
      const ask = io.ask;
      if (!yes && (asJson || ask === undefined)) {
        printError(
          'apply needs --yes when it cannot ask for confirmation (with --json, or when not run in a terminal)',
          { json: asJson },
          io,
        );
        setExitCode(1);
        return;
      }
      const home = resolve(options.home);
      const runtime = deps.runtime(home, project);
      const result = await apply({
        home,
        catalog,
        host: () => deps.host(runtime),
        env: io.env,
        runtime,
        probe: deps.probe(runtime, home),
        confirm: async (shown) => {
          if (!asJson) printPlan(shown, { json: false }, io);
          if (yes || ask === undefined) return true;
          const answer = await ask('\nApply these changes? [y/N] ');
          return /^y(es)?$/i.test(answer.trim());
        },
        onStep: asJson
          ? undefined
          : (event) => {
              printStep(event, io);
            },
      });
      printApply(result, { json: asJson }, io);
      setExitCode(
        result.outcome === 'success' || result.outcome === 'no-changes' ? 0 : 1,
      );
    });

  program
    .command('status')
    .description("Show each app's container, and the last apply")
    .argument('[app]', 'show only this app')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--json', 'print machine-readable JSON')
    .action(
      async (app: string | undefined, options: { home: string; json?: boolean }) => {
        const asJson = options.json === true;
        const home = resolve(options.home);
        const result = await status(home, deps.runtime(home, project));
        const containers =
          app === undefined
            ? result.containers
            : result.containers.filter((c) => c.service === app);
        if (app !== undefined && containers.length === 0) {
          printError(`no container for "${app}" in this stack`, { json: asJson }, io);
          setExitCode(1);
          return;
        }
        printStatus({ ...result, containers }, { json: asJson }, io);
      },
    );

  program
    .command('history')
    .description('List change records, or show one in full')
    .argument('[id]', 'the change record to show')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--json', 'print machine-readable JSON')
    .action(async (id: string | undefined, options: { home: string; json?: boolean }) => {
      const asJson = options.json === true;
      const home = resolve(options.home);
      if (id === undefined) {
        printHistory(await listRecords(home), { json: asJson }, io);
        return;
      }
      const record = await readRecord(home, id);
      if (record === undefined) {
        printError(
          `no change record "${id}"; run "mediaplane history" to list them`,
          { json: asJson },
          io,
        );
        setExitCode(1);
        return;
      }
      printRecord(record, { json: asJson }, io);
    });

  program
    .command('init')
    .description('Write a starter stack.yaml and a secrets/ folder (never overwrites)')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option('--media-server <name>', 'jellyfin or plex')
    .option('--data <path>', 'the data folder for downloads and media (absolute)')
    .option(
      '--vpn-provider <name>',
      'Gluetun VPN provider, e.g. mullvad; leave out for no VPN',
    )
    .option('--no-login-on-lan', "don't ask for a login from your own network")
    .option(
      '--timezone <zone>',
      'timezone, e.g. Europe/London',
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )
    .option('--json', 'print machine-readable JSON')
    .action(async (options: InitOptions) => {
      const runtime = deps.runtime(resolve(options.home), project);
      setExitCode(await init(options, io, await deps.host(runtime)));
    });

  // What the host helper container runs (spec §4.2); not for people, so not in --help.
  program
    .command('host-report', { hidden: true })
    .description("Print what this host's network, folders and ports look like")
    .argument('<request>', 'what to look at, as JSON')
    .action(async (request: string) => {
      const report = await collectHostReport(parseHostRequest(request));
      io.stdout(`${JSON.stringify(report)}\n`);
    });

  return program;
}

/** Run the CLI with user arguments (no node/script prefix) and return the exit code. */
export async function run(
  argv: readonly string[],
  io: Io,
  overrides: Partial<CliDeps> = {},
): Promise<number> {
  const deps: CliDeps = { ...defaultDeps(io.env), ...overrides };
  const json = argv.includes('--json');
  let exitCode = 0;
  const program = createProgram(io, deps, (code) => {
    exitCode = code;
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
