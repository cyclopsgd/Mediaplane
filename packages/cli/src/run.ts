import { resolve } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  collectHostReport,
  createDockerRuntime,
  credentials,
  DEFAULT_VPN_CHECK_URL,
  detectHostFacts,
  EGRESS_TIMEOUT_MS,
  fetchEgress,
  helperEgress,
  helperHostFacts,
  helperProbe,
  hostFactsOrFailure,
  invokingUser,
  listRecords,
  nodeProbe,
  parseHostRequest,
  plan,
  PROJECT_NAME,
  readRecord,
  status,
  vpnCheck,
  type EgressResult,
  type HostFacts,
  type HostProbe,
  type Runtime,
} from '@mediaplane/engine';
import { Command, CommanderError, Option } from 'commander';
import { printCredentials } from './credentials';
import { init, type InitOptions } from './init';
import {
  printApply,
  printDiagnostics,
  printError,
  printHistory,
  printPlan,
  printRecord,
  printStatus,
  printStep,
} from './output';
import { PromptCancelled } from './prompt';
import { VERSION } from './version';
import { printVpnCheck } from './vpn-check';

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
  /**
   * Ask the user something and return the answer; absent when not on a terminal. Rejects
   * with PromptCancelled when the user ends the input instead (Ctrl-D, Ctrl-C).
   */
  ask?: (question: string) => Promise<string>;
}

/** What the CLI talks to: the real host by default, fakes in tests. */
export interface CliDeps {
  /** Facts about the host; from inside the Mediaplane container, through `runtime`. */
  host: (runtime: Runtime) => Promise<HostFacts>;
  runtime: (home: string, project: string) => Runtime;
  /** What preflight asks about the host, for the Mediaplane home `home`. */
  probe: (runtime: Runtime, home: string) => HostProbe;
  /** Which address the host comes from, as the IP-echo service at a URL sees it. */
  egress: (runtime: Runtime) => (url: string) => Promise<EgressResult>;
}

export const DEFAULT_HOME = '/opt/mediaplane';

/** What each command's exit code means (spec §5.2): in --help, and in the CLI reference. */
export const EXIT_CODES: Readonly<Record<string, readonly string[]>> = {
  plan: [
    '0: nothing would change',
    '2: apply would change something, or apps are still waiting for a health check',
    '1: an error; nothing was changed',
  ],
  apply: [
    '0: applied, or nothing needed changing',
    '1: a step failed, or the apply was cancelled',
    '1: any other error: stack.yaml or the host, a held lock, Docker unreachable',
  ],
  status: ['0: the containers were listed', '1: an error, or no container for that app'],
  history: ['0: the records were listed or shown', '1: an error, or no such record'],
  credentials: [
    '0: the login was shown',
    '1: an error: no stack.yaml, no password yet, or no such app',
  ],
  init: [
    '0: stack.yaml and secrets/ were written',
    '1: an error; an existing stack.yaml is never overwritten',
  ],
  'vpn-check': [
    '0: passed: qBittorrent reaches the internet only through the VPN',
    '1: a leak, or the VPN is down',
    '1: an error: stack.yaml, Docker unreachable, or the stack not applied yet',
  ],
};

/** The environment variables the CLI reads. */
export const ENVIRONMENT: readonly { name: string; description: string }[] = [
  {
    name: 'MEDIAPLANE_HOME',
    description: 'The Mediaplane home when --home is not given. Default /opt/mediaplane.',
  },
  {
    name: 'MEDIAPLANE_IMAGE',
    description:
      'Set by mediaplane.compose.yaml in the Mediaplane container: the image the host helper runs. Leave it unset when running from source.',
  },
  {
    name: 'MEDIAPLANE_COMPOSE_PROJECT',
    description:
      'For tests and development only: the full name of the Compose project to manage instead of mediaplane. It must be mediaplane-<name>, such as mediaplane-dev.',
  },
  {
    name: 'MEDIAPLANE_VPN_CHECK_URL',
    description: `The IP-echo service vpn-check asks which address qBittorrent and this host come from: an http or https URL that answers ip=<address>, as Cloudflare's trace does, or only the address. Default ${DEFAULT_VPN_CHECK_URL}. vpn-check --no-egress asks none.`,
  },
  {
    name: 'DOCKER_HOST',
    description:
      "Docker's own setting, passed to every docker command. In the Mediaplane container it points at the socket proxy. Run from source with anything but a unix:// socket, Docker may be on another host, so vpn-check doesn't compare this machine's address.",
  },
];

function exitCodesHelp(command: string): string {
  const lines = (EXIT_CODES[command] ?? []).map((line) => `  ${line}`);
  return `\nExit codes:\n${lines.join('\n')}\n`;
}

/** An environment variable's value, treating "" as unset. */
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Why the host's side of vpn-check isn't measured from source when DOCKER_HOST names a
 * Docker that isn't on a local socket: the stack then runs on that other host, whose
 * address is the one a leak would show.
 */
const REMOTE_DOCKER: EgressResult = {
  ok: false,
  error:
    "Docker runs on another host (DOCKER_HOST), so this machine's address is not the one to compare",
};

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
    // Only a unix socket is this machine's own Docker; tcp://, ssh:// and the rest may be
    // anywhere. (In the image, DOCKER_HOST is the socket proxy, and the helper runs on
    // Docker's host, so this applies from source only.)
    const docker = setting(env, 'DOCKER_HOST');
    const remote = docker !== undefined && !docker.startsWith('unix://');
    return {
      host: () => Promise.resolve(detectHostFacts()),
      runtime,
      probe: () => nodeProbe,
      egress: () =>
        remote
          ? () => Promise.resolve(REMOTE_DOCKER)
          : // The CLI's own environment, and node's flags, decide whether fetch uses a proxy.
            (url) =>
              fetchEgress(url, fetch, EGRESS_TIMEOUT_MS, {
                env,
                execArgv: process.execArgv,
              }),
    };
  }
  // Mediaplane's own user, as the helper must be; never root, even if the container is.
  const user = invokingUser();
  return {
    host: (docker) => helperHostFacts({ runtime: docker, image, user }),
    runtime,
    probe: (docker, home) => helperProbe({ runtime: docker, image, user, home }),
    egress: (docker) => (url) => helperEgress({ runtime: docker, image, user }, url),
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
    .addHelpText('after', exitCodesHelp('plan'))
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
    .addHelpText('after', exitCodesHelp('apply'))
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
          try {
            const answer = await ask('\nApply these changes? [y/N] ');
            return /^y(es)?$/i.test(answer.trim());
          } catch (cause) {
            // Ending the input is no answer, so the default: no.
            if (cause instanceof PromptCancelled) return false;
            throw cause;
          }
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
    .addHelpText('after', exitCodesHelp('status'))
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
    .addHelpText('after', exitCodesHelp('history'))
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
    .command('credentials')
    .description("Show the shared admin login and each app's web address")
    .argument('[app]', 'show only this app')
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option(
      '--reveal',
      'show the password in --json output, and show your own password (admin.password)',
    )
    .option('--json', 'print machine-readable JSON, without the password unless --reveal')
    .addHelpText('after', exitCodesHelp('credentials'))
    .action(
      async (
        app: string | undefined,
        options: { home: string; json?: boolean; reveal?: boolean },
      ) => {
        const home = resolve(options.home);
        const runtime = deps.runtime(home, project);
        const result = await credentials({
          home,
          catalog,
          // In the image, the host helper: needed for the LAN addresses. A helper that
          // fails is an error result, as for plan, not a crash.
          host: () => deps.host(runtime),
          env: io.env,
          runtime,
        });
        setExitCode(
          printCredentials(
            result,
            app,
            { json: options.json === true, reveal: options.reveal === true },
            io,
          ),
        );
      },
    );

  program
    .command('vpn-check')
    .description(
      "Check that qBittorrent reaches the internet only through the VPN, and compare its address with this host's",
    )
    .option('--home <dir>', 'Mediaplane home directory', defaultHome)
    .option(
      '--no-egress',
      'check the containers and the tunnel only, asking no IP-echo service for the two addresses',
    )
    .option('--json', 'print machine-readable JSON')
    .addHelpText('after', exitCodesHelp('vpn-check'))
    .action(async (options: { home: string; egress: boolean; json?: boolean }) => {
      const home = resolve(options.home);
      const runtime = deps.runtime(home, project);
      const url = setting(io.env, 'MEDIAPLANE_VPN_CHECK_URL') ?? DEFAULT_VPN_CHECK_URL;
      const result = await vpnCheck({
        home,
        catalog,
        // In the image, the host helper: as for plan, one that fails is an error result.
        host: () => deps.host(runtime),
        env: io.env,
        runtime,
        project,
        // Commander makes --no-egress `egress: false`, and `true` when it isn't given.
        ...(options.egress ? { egress: { url, fromHost: deps.egress(runtime) } } : {}),
      });
      setExitCode(printVpnCheck(result, { json: options.json === true }, io));
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
    .option(
      '--vpn-addresses <cidr>',
      "your VPN provider's WireGuard address, if its config file has one, e.g. 10.64.0.2/32",
    )
    .option(
      '--bind <where>',
      'lan or localhost: publish the web UIs on your LAN, or keep them on this machine (default lan, or localhost on a cloud VM)',
    )
    .option(
      '--lan-subnet <cidr>',
      'your LAN with --bind lan, e.g. 192.168.1.0/24 (default: detected when plan runs)',
    )
    .option('--no-login-on-lan', "don't ask for a login from your own network")
    .option('--admin-user <name>', 'the admin user name for the apps (default admin)')
    .option(
      '--admin-password-file <path>',
      'a file inside the home holding your own admin password, at least 12 characters (default: Mediaplane generates one)',
    )
    .addOption(
      new Option('--timezone <zone>', 'timezone, e.g. Europe/London').default(
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        "this machine's timezone",
      ),
    )
    .option('--json', 'print machine-readable JSON')
    .addHelpText('after', exitCodesHelp('init'))
    .action(async (options: InitOptions) => {
      const runtime = deps.runtime(resolve(options.home), project);
      // In the image, the host helper looks at the network. As for plan, one that fails
      // is explained, with its hint, not crashed on.
      const host = await hostFactsOrFailure(() => deps.host(runtime), {
        runtime,
        env: io.env,
      });
      if (!host.ok) {
        printDiagnostics([host.diagnostic], { json: options.json === true }, io);
        setExitCode(1);
        return;
      }
      setExitCode(await init(options, io, host.host));
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
