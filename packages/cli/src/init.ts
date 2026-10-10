import { chmod, mkdir } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import {
  inSubnet,
  invokingUser,
  parseConfig,
  privateNetworks,
  STACK_PATH,
  starterStack,
  writeFileExclusive,
  type Diagnostic,
  type HostFacts,
  type StarterAnswers,
} from '@mediaplane/engine';
import { printDiagnostics, printError } from './output';
import type { Io } from './run';

export const INIT_JSON_SCHEMA = 'mediaplane.init/v1';

/** Where init suggests you keep your own admin password, inside the home. */
export const DEFAULT_PASSWORD_FILE = 'secrets/admin-password';

export interface InitOptions {
  home: string;
  mediaServer?: string;
  data?: string;
  vpnProvider?: string;
  vpnAddresses?: string;
  bind?: string;
  lanSubnet?: string;
  loginOnLan: boolean;
  adminUser?: string;
  adminPasswordFile?: string;
  timezone: string;
  json?: boolean;
}

/** `mediaplane init`: write a starter stack.yaml and secrets/, never overwriting. */
export async function init(
  options: InitOptions,
  io: Io,
  host: HostFacts,
): Promise<number> {
  const asJson = options.json === true;
  const home = resolve(options.home);
  const stackPath = join(home, STACK_PATH);
  const answers = await gatherAnswers(options, io, host);
  if (typeof answers === 'string') {
    printError(answers, { json: asJson }, io);
    return 1;
  }
  const text = starterStack(answers);
  const parsed = parseConfig(text);
  if (!parsed.ok) {
    printDiagnostics(parsed.diagnostics, { json: asJson }, io);
    return 1;
  }
  await mkdir(home, { recursive: true });
  // All at once and only if absent, so a failed write never leaves half a stack.yaml.
  if (!(await writeFileExclusive(stackPath, text, 0o644))) {
    printError(
      `${stackPath} already exists; init never overwrites it`,
      { json: asJson },
      io,
    );
    return 1;
  }
  const secrets = join(home, 'secrets');
  await mkdir(secrets, { recursive: true });
  await chmod(secrets, 0o700);

  const next = [
    ...(answers.vpnProvider === undefined
      ? []
      : [`Put your VPN's WireGuard private key in ${join(secrets, 'wg.key')}.`]),
    ...(answers.mediaServer === 'plex'
      ? [`Save your Plex token in ${join(secrets, 'plex-token')}.`]
      : []),
    ...(answers.adminPasswordFile === undefined
      ? []
      : [
          `Put your admin password, at least 12 characters, in ${join(home, answers.adminPasswordFile)}.`,
        ]),
    `Create ${answers.dataPath} and make sure uid ${String(answers.user.uid)} (gid ${String(answers.user.gid)}) can write to it.`,
    'Run "mediaplane plan" to check everything, then "mediaplane apply".',
    'Then "mediaplane credentials" shows the admin login and where each app is.',
  ];
  if (asJson) {
    io.stdout(
      `${JSON.stringify({ schema: INIT_JSON_SCHEMA, ok: true, stackPath, next }, null, 2)}\n`,
    );
    return 0;
  }
  io.stdout(`Wrote ${stackPath}.\n`);
  if (host.cloud !== undefined && answers.bind === 'localhost') {
    io.stdout(
      `This looks like a VM on ${host.cloud}, so the web UIs stay on localhost (network.bind).\n`,
    );
  }
  io.stdout(`\nNext steps:\n${next.map((step) => `  - ${step}\n`).join('')}`);
  return 0;
}

type Ask = (question: string) => Promise<string>;
type Bind = 'lan' | 'localhost';
type MediaServer = 'jellyfin' | 'plex';

/** An answer that passed, or what is wrong with it, said as a sentence to the person. */
type Check<T> = { value: T } | { problem: string };

const isMediaServer = (value: string): value is MediaServer =>
  value === 'jellyfin' || value === 'plex';
const isBind = (value: string): value is Bind => value === 'lan' || value === 'localhost';

/** The flags, once checked: what they decide, and what is left to ask. */
interface Flags {
  mediaServer: MediaServer | undefined;
  dataPath: string | undefined;
  vpnProvider: string | undefined;
  vpnAddresses: string | undefined;
  bind: Bind | undefined;
  lanSubnet: string | undefined;
  adminUser: string | undefined;
  adminPasswordFile: string | undefined;
}

async function gatherAnswers(
  options: InitOptions,
  io: Io,
  host: HostFacts,
): Promise<StarterAnswers | string> {
  const ask = options.json === true ? undefined : io.ask;
  const defaultBind: Bind = host.cloud === undefined ? 'lan' : 'localhost';
  // Every flag that needs no question is checked first, so a typo costs no answers.
  const flags = readFlags(options, host, defaultBind, ask !== undefined);
  if (typeof flags === 'string') return flags;
  let { mediaServer, dataPath, vpnProvider, vpnAddresses, bind, lanSubnet } = flags;
  let { adminUser, adminPasswordFile } = flags;
  let loginOnLan = options.loginOnLan;
  if (ask !== undefined) {
    mediaServer ??= await askUntil(
      ask,
      io,
      'Media server, jellyfin or plex [jellyfin]: ',
      (answer) => {
        const choice = answer.toLowerCase() || 'jellyfin';
        return isMediaServer(choice)
          ? { value: choice }
          : { problem: 'Please answer jellyfin or plex.' };
      },
    );
    dataPath ??= await askUntil(
      ask,
      io,
      'Data folder for downloads and media [/srv/data]: ',
      (answer) => schemaCheck({ dataPath: answer || '/srv/data' }, answer || '/srv/data'),
    );
    if (vpnProvider === undefined) {
      const answer = (
        await ask('VPN provider for qBittorrent, e.g. mullvad (empty for none): ')
      ).trim();
      vpnProvider = answer === '' ? undefined : answer;
    }
    if (vpnProvider === undefined && vpnAddresses !== undefined) {
      return '--vpn-addresses needs --vpn-provider';
    }
    if (vpnProvider !== undefined && vpnAddresses === undefined) {
      const answer = (
        await ask(
          "Your provider's WireGuard address, if its config file has one, e.g. 10.64.0.2/32 (empty to skip): ",
        )
      ).trim();
      vpnAddresses = answer === '' ? undefined : answer;
    }
    bind ??= await askUntil(
      ask,
      io,
      `Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [${defaultBind}]: `,
      (answer) => {
        const choice = answer.toLowerCase() || defaultBind;
        return isBind(choice)
          ? { value: choice }
          : { problem: 'Please answer lan or localhost.' };
      },
    );
    if (bind === 'lan' && lanSubnet === undefined) {
      lanSubnet = await askLanSubnet(ask, io, host);
    }
    // A subnet given as a flag can't be re-asked, so it is refused. Known bind refused it
    // already, before the first question.
    if (bind === 'lan' && flags.lanSubnet !== undefined) {
      const refusal = lanSubnetFlagRefusal(flags.lanSubnet, host);
      if (refusal !== undefined) return refusal;
    }
    // Only a LAN has a network of your own to ask about: on localhost nothing is published.
    if (bind === 'lan' && loginOnLan) {
      loginOnLan = !/^n/i.test(
        (await ask('Ask for a login from your own network too? [Y/n] ')).trim(),
      );
    }
    adminUser ??= await askUntil(
      ask,
      io,
      'Admin user name for the apps [admin]: ',
      (answer) => schemaCheck({ adminUser: answer || 'admin' }, answer || 'admin'),
    );
    if (
      adminPasswordFile === undefined &&
      /^n/i.test((await ask('Generate the admin password? [Y/n] ')).trim())
    ) {
      adminPasswordFile = await askUntil(
        ask,
        io,
        `File holding your password, inside the Mediaplane home [${DEFAULT_PASSWORD_FILE}]: `,
        (answer) => {
          const file = answer || DEFAULT_PASSWORD_FILE;
          const problem = passwordFileProblem(file);
          return problem === undefined
            ? { value: file }
            : { problem: `That ${problem}.` };
        },
      );
    }
  }
  if (mediaServer === undefined || dataPath === undefined) {
    return 'init needs --media-server and --data when it cannot ask (with --json, or when not run in a terminal)';
  }
  bind ??= defaultBind;
  if (bind === 'lan' && host.cloud !== undefined && lanSubnet === undefined) {
    return `this looks like a VM on ${host.cloud}, where bind: lan needs your LAN subnet: add --lan-subnet, or use --bind localhost`;
  }
  return {
    mediaServer,
    dataPath,
    vpnProvider,
    vpnAddresses,
    loginOnLan,
    timezone: options.timezone,
    user: invokingUser(),
    bind,
    lanSubnet,
    adminUser: adminUser ?? 'admin',
    adminPasswordFile,
  };
}

/**
 * The flags that need no question, checked before the first one is asked: what is wrong
 * with them, named by flag, or what they decide.
 */
function readFlags(
  options: InitOptions,
  host: HostFacts,
  defaultBind: Bind,
  canAsk: boolean,
): Flags | string {
  const mediaServer = options.mediaServer?.trim().toLowerCase();
  if (mediaServer !== undefined && !isMediaServer(mediaServer)) {
    return `--media-server must be jellyfin or plex, not "${options.mediaServer ?? ''}"`;
  }
  const bind = options.bind?.trim().toLowerCase();
  if (bind !== undefined && !isBind(bind)) {
    return `--bind must be lan or localhost, not "${options.bind ?? ''}"`;
  }
  if (options.adminPasswordFile !== undefined) {
    const problem = passwordFileProblem(options.adminPasswordFile);
    if (problem !== undefined) return `--admin-password-file ${problem}`;
  }
  // The starter writes the address only in a vpn: block, so say so rather than drop it.
  // When a terminal asks for the provider, that check waits for the answer.
  if (
    !canAsk &&
    options.vpnAddresses !== undefined &&
    options.vpnProvider === undefined
  ) {
    return '--vpn-addresses needs --vpn-provider';
  }
  const diagnostic = schemaDiagnostic({
    ...(options.data === undefined ? {} : { dataPath: options.data }),
    ...(options.adminUser === undefined ? {} : { adminUser: options.adminUser }),
    ...(options.lanSubnet === undefined ? {} : { lanSubnet: options.lanSubnet }),
  });
  if (diagnostic !== undefined) return diagnostic.message;
  // With the bind known, so is whether the subnet fits this host. When a terminal asks for
  // the bind, that check waits for the answer.
  if ((bind ?? (canAsk ? undefined : defaultBind)) === 'lan') {
    const refusal =
      options.lanSubnet === undefined
        ? undefined
        : lanSubnetFlagRefusal(options.lanSubnet, host);
    if (refusal !== undefined) return refusal;
  }
  return {
    mediaServer,
    dataPath: options.data,
    vpnProvider: options.vpnProvider,
    vpnAddresses: options.vpnAddresses,
    bind,
    lanSubnet: options.lanSubnet,
    adminUser: options.adminUser,
    adminPasswordFile: options.adminPasswordFile,
  };
}

/** Ask until the answer passes `check`, saying at once what is wrong with each that fails. */
async function askUntil<T>(
  ask: Ask,
  io: Io,
  question: string,
  check: (answer: string) => Check<T>,
): Promise<T> {
  for (;;) {
    const result = check((await ask(question)).trim());
    if ('value' in result) return result.value;
    io.stderr(`${result.problem}\n`);
  }
}

/** Answers that parse: the starting point to learn what the schema says about one change. */
const BASELINE: StarterAnswers = {
  mediaServer: 'jellyfin',
  dataPath: '/srv/data',
  vpnProvider: undefined,
  vpnAddresses: undefined,
  loginOnLan: true,
  timezone: 'UTC',
  user: { uid: 1000, gid: 1000 },
  bind: 'lan',
  lanSubnet: undefined,
  adminUser: 'admin',
  adminPasswordFile: undefined,
};

/** What the stack.yaml schema objects to in `change`, when the rest is fine. */
function schemaDiagnostic(change: Partial<StarterAnswers>): Diagnostic | undefined {
  const parsed = parseConfig(starterStack({ ...BASELINE, ...change }));
  return parsed.ok ? undefined : parsed.diagnostics[0];
}

/** The schema's verdict on one typed answer, as a sentence about that answer. */
function schemaCheck<T>(change: Partial<StarterAnswers>, value: T): Check<T> {
  const diagnostic = schemaDiagnostic(change);
  if (diagnostic === undefined) return { value };
  const { message, path } = diagnostic;
  const prefix = `${path ?? ''}: `;
  return {
    problem: `That ${message.startsWith(prefix) ? message.slice(prefix.length) : message}.`,
  };
}

/**
 * Why plan would find no address to publish on inside `subnet` (network.no-lan-address),
 * or undefined when it would find one. `subnet` must already be a valid CIDR.
 */
function lanSubnetMiss(subnet: string, host: HostFacts): string | undefined {
  if (host.privateAddresses.some((a) => inSubnet(a.address, subnet))) return undefined;
  const addresses = host.privateAddresses.map((a) => a.address).join(', ');
  return addresses === ''
    ? 'this host has no private (RFC 1918) IPv4 address'
    : `none of this host's private addresses (${addresses}) is inside ${subnet}`;
}

/** The refusal for a `--lan-subnet` that plan would reject, or undefined when it would not. */
function lanSubnetFlagRefusal(subnet: string, host: HostFacts): string | undefined {
  const miss = lanSubnetMiss(subnet, host);
  return miss === undefined
    ? undefined
    : `network.bind is "lan", but ${miss}; give --lan-subnet a subnet this host is on, or use --bind localhost`;
}

/**
 * The LAN subnet: the one this host is on, if there is exactly one and you agree, or one
 * you type that holds an address of this host (or nothing, to have plan detect it). A
 * cloud VM's private network is not a LAN, so there it is never offered, and the question
 * asks for the private network to publish on, as plan's hint says.
 */
async function askLanSubnet(
  ask: Ask,
  io: Io,
  host: HostFacts,
): Promise<string | undefined> {
  const seen = privateNetworks(host);
  const [only] = seen;
  if (host.cloud === undefined && seen.length === 1 && only !== undefined) {
    const answer = (await ask(`Your LAN looks like ${only}. Use it? [Y/n] `)).trim();
    if (!/^n/i.test(answer)) return only;
  }
  return askUntil<string | undefined>(
    ask,
    io,
    host.cloud === undefined
      ? 'Your LAN subnet, e.g. 192.168.1.0/24: '
      : 'The private network to publish on, e.g. 10.0.0.0/24: ',
    (typed) => {
      if (typed === '') return { value: undefined };
      const checked = schemaCheck({ lanSubnet: typed }, typed);
      if ('problem' in checked) return checked;
      const miss = lanSubnetMiss(typed, host);
      if (miss === undefined) return checked;
      const retry =
        host.cloud === undefined
          ? 'Type a subnet this host is on, or nothing to have plan detect it.'
          : 'Type a subnet this host is on.';
      return { problem: `${miss.charAt(0).toUpperCase()}${miss.slice(1)}. ${retry}` };
    },
  );
}

/**
 * What is wrong with `path` as the file for your admin password, in words that follow
 * "must", or undefined. It names a file inside the home, which is all the container sees,
 * and not the stack itself.
 */
function passwordFileProblem(path: string): string | undefined {
  const clean = normalize(path);
  // A name that ends in "/", ".", or ".." is a folder (the home itself, say), not a file.
  const name = path.split('/').at(-1);
  if (
    isAbsolute(path) ||
    name === '' ||
    name === '.' ||
    name === '..' ||
    clean === '..' ||
    clean.startsWith('../')
  ) {
    return `must be a path inside the Mediaplane home, such as ${DEFAULT_PASSWORD_FILE}`;
  }
  return clean === STACK_PATH
    ? `must not be ${STACK_PATH}, which holds the stack itself`
    : undefined;
}
