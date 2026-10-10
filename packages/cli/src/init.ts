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
import { dataSteps, exists, homeProblem, type DataFolder } from './folders';
import { printDiagnostics, printError } from './output';
import { PromptCancelled } from './prompt';
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
  dataFolder: (
    path: string,
    home: string,
    user: { uid: number; gid: number },
  ) => Promise<DataFolder>,
): Promise<number> {
  const asJson = options.json === true;
  const home = resolve(options.home);
  const stackPath = join(home, STACK_PATH);
  const gathered = await gatherAnswers(options, io, host).catch((cause: unknown) => {
    if (cause instanceof PromptCancelled) {
      return 'init stopped at a question; nothing was written';
    }
    throw cause;
  });
  if (typeof gathered === 'string') {
    printError(gathered, { json: asJson }, io);
    return 1;
  }
  const { starter: answers, wireguardKey } = gathered;
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
  const keyPath = join(home, WG_KEY_FILE);
  // Only if absent too: a key file of yours that appeared meanwhile stays.
  const savedKey =
    wireguardKey !== undefined &&
    (await writeFileExclusive(keyPath, `${wireguardKey}\n`, 0o600));
  const data = await dataFolder(answers.dataPath, home, answers.user);

  const next = [
    ...(answers.vpnProvider === undefined || savedKey
      ? []
      : [`Put your VPN's WireGuard private key in ${keyPath}.`]),
    ...(answers.mediaServer === 'plex'
      ? [`Save your Plex token in ${join(secrets, 'plex-token')}.`]
      : []),
    ...(answers.adminPasswordFile === undefined
      ? []
      : [
          `Put your admin password, at least 12 characters, in ${join(home, answers.adminPasswordFile)}.`,
        ]),
    ...dataSteps(answers.dataPath, data, answers.user),
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
  if (savedKey) io.stdout(`Saved your WireGuard private key in ${keyPath}.\n`);
  if (data === 'created') {
    io.stdout(`Created ${answers.dataPath} for your downloads and media.\n`);
  }
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

/** What init asks for: the starter's answers, and a WireGuard key pasted on a terminal. */
interface Answers {
  starter: StarterAnswers;
  /** Held in memory until it is written to secrets/wg.key: never printed or logged. */
  wireguardKey: string | undefined;
}

async function gatherAnswers(
  options: InitOptions,
  io: Io,
  host: HostFacts,
): Promise<Answers | string> {
  const ask = options.json === true ? undefined : io.ask;
  const askSecret = ask === undefined ? undefined : io.askSecret;
  const defaultBind: Bind = host.cloud === undefined ? 'lan' : 'localhost';
  // Every flag that needs no question is checked first, so a typo costs no answers.
  const flags = await readFlags(options, host, defaultBind, ask !== undefined);
  if (typeof flags === 'string') return flags;
  let { mediaServer, dataPath, vpnProvider, vpnAddresses, bind, lanSubnet } = flags;
  let { adminUser, adminPasswordFile } = flags;
  let loginOnLan = options.loginOnLan;
  let wireguardKey: string | undefined;
  if (ask !== undefined) {
    if (mediaServer === undefined) {
      explain(io, NOTES.mediaServer);
      mediaServer = await askUntil(
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
    }
    if (dataPath === undefined) {
      explain(io, NOTES.dataPath);
      dataPath = await askUntil(
        ask,
        io,
        'Data folder for downloads and media [/srv/data]: ',
        (answer) =>
          schemaCheck({ dataPath: answer || '/srv/data' }, answer || '/srv/data'),
      );
    }
    if (vpnProvider === undefined) {
      explain(io, NOTES.vpnProvider);
      const answer = (
        await ask('VPN provider for qBittorrent, e.g. mullvad (empty for none): ')
      ).trim();
      vpnProvider = answer === '' ? undefined : answer;
    }
    if (vpnProvider === undefined && vpnAddresses !== undefined) {
      return '--vpn-addresses needs --vpn-provider';
    }
    if (vpnProvider !== undefined && vpnAddresses === undefined) {
      explain(io, NOTES.vpnAddresses);
      vpnAddresses = await askUntil<string | undefined>(
        ask,
        io,
        "Your provider's WireGuard address, if its config file has one, e.g. 10.64.0.2/32 (empty to skip): ",
        (answer) => (answer === '' ? { value: undefined } : addressesCheck(answer)),
      );
    }
    // Pasted, never shown: the key stays off the screen, the scrollback and the logs.
    if (
      vpnProvider !== undefined &&
      askSecret !== undefined &&
      !(await exists(join(resolve(options.home), WG_KEY_FILE)))
    ) {
      explain(io, NOTES.wireguardKey);
      wireguardKey = await askUntil<string | undefined>(
        askSecret,
        io,
        'Paste your WireGuard private key (nothing shows as you paste; Enter to do it later): ',
        (answer) =>
          answer === ''
            ? { value: undefined }
            : isWireguardKey(answer)
              ? { value: answer }
              : {
                  problem:
                    'That is not a WireGuard private key, which is 44 characters of base64 ending in "=". Paste it again, or press Enter to do it later.',
                },
      );
    }
    if (bind === undefined) {
      explain(io, NOTES.bind);
      bind = await askUntil(
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
    }
    if (bind === 'lan' && lanSubnet === undefined) {
      explain(io, NOTES.lanSubnet);
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
      explain(io, NOTES.loginOnLan);
      loginOnLan = !/^n/i.test(
        (await ask('Ask for a login from your own network too? [Y/n] ')).trim(),
      );
    }
    if (adminUser === undefined) {
      explain(io, NOTES.adminUser);
      adminUser = await askUntil(
        ask,
        io,
        'Admin user name for the apps [admin]: ',
        (answer) => schemaCheck({ adminUser: answer || 'admin' }, answer || 'admin'),
      );
    }
    if (adminPasswordFile === undefined) {
      explain(io, NOTES.adminPassword);
      if (/^n/i.test((await ask('Generate the admin password? [Y/n] ')).trim())) {
        explain(io, NOTES.passwordFile);
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
  }
  if (mediaServer === undefined || dataPath === undefined) {
    return 'init needs --media-server and --data when it cannot ask (with --json, or when not run in a terminal)';
  }
  bind ??= defaultBind;
  if (bind === 'lan' && host.cloud !== undefined && lanSubnet === undefined) {
    return `this looks like a VM on ${host.cloud}, where bind: lan needs your LAN subnet: add --lan-subnet, or use --bind localhost`;
  }
  return {
    starter: {
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
    },
    wireguardKey,
  };
}

/**
 * What each question is for, shown on a terminal just before it is first asked, at most
 * 60 columns a line. The question line itself, with its [default], follows.
 */
export const NOTES = {
  mediaServer: [
    'Media server: jellyfin needs no account. plex needs a Plex',
    "account; Mediaplane can't claim it for you until Slice 6.",
  ],
  dataPath: [
    'Data folder: one folder for downloads and your library,',
    'so finished downloads move instantly.',
  ],
  vpnProvider: [
    "VPN provider: Gluetun's name for yours, such as mullvad or",
    'surfshark. Leave it empty for no VPN.',
  ],
  vpnAddresses: [
    "WireGuard address: the Address line of your provider's",
    'WireGuard config file, if it has one.',
  ],
  wireguardKey: [
    'WireGuard key: the PrivateKey line of that same file.',
    'Mediaplane keeps it in secrets/wg.key, for you only.',
  ],
  bind: [
    'Web pages: lan reaches other devices on your home network;',
    'localhost reaches only this machine.',
  ],
  lanSubnet: [
    'Your LAN: the network your other devices are on, as a',
    'subnet such as 192.168.1.0/24.',
  ],
  loginOnLan: [
    'Login: answer n to let devices on your LAN open the apps',
    'without signing in.',
  ],
  adminUser: ["Admin user: one login for every app's web page."],
  adminPassword: [
    'Admin password: Mediaplane can generate a strong one, or',
    'use your own, from a file in the Mediaplane home.',
  ],
  passwordFile: [
    'Your password file: at least 12 characters. Put it there',
    'before you run plan.',
  ],
} as const satisfies Record<string, readonly string[]>;

/** Say what a question is for, on the terminal, just before it is asked. */
function explain(io: Io, lines: readonly string[]): void {
  io.stdout(`${lines.join('\n')}\n`);
}

/** Where init saves a WireGuard key pasted on a terminal; stack.yaml's vpn.private_key. */
const WG_KEY_FILE = 'secrets/wg.key';

/** A WireGuard key as wg and providers write it: 32 bytes in base64, 44 characters. */
function isWireguardKey(text: string): boolean {
  return (
    /^[A-Za-z0-9+/]{43}=$/.test(text) &&
    Buffer.from(text, 'base64').toString('base64') === text
  );
}

/**
 * The flags that need no question, checked before the first one is asked: what is wrong
 * with them, named by flag, or what they decide. The home (--home, or its default) is
 * one of them: answers are no use if init can't write stack.yaml there.
 */
async function readFlags(
  options: InitOptions,
  host: HostFacts,
  defaultBind: Bind,
  canAsk: boolean,
): Promise<Flags | string> {
  const unwritable = await homeProblem(resolve(options.home));
  if (unwritable !== undefined) return unwritable;
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
    ...(options.vpnAddresses === undefined
      ? {}
      : { vpnProvider: ANY_PROVIDER, vpnAddresses: options.vpnAddresses }),
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

/** A provider for checking a WireGuard address: the starter writes it only in a vpn: block. */
const ANY_PROVIDER = 'custom';

/** The schema's verdict on a typed WireGuard address. */
function addressesCheck(answer: string): Check<string> {
  return schemaCheck({ vpnProvider: ANY_PROVIDER, vpnAddresses: answer }, answer);
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
 * cloud VM's private network is not a LAN, so there it is never offered, the question
 * asks for the private network to publish on, as plan's hint says, and an answer is
 * needed. A host with no private address can't publish on a LAN at all, so no answer
 * works there: the problem says how to stop.
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
      // An empty answer leaves the subnet to plan, except on a cloud VM.
      if (
        host.privateAddresses.length === 0 &&
        (typed !== '' || host.cloud !== undefined)
      ) {
        return {
          problem:
            "This host has no private (RFC 1918) IPv4 address, so lan can't work here. Press Ctrl-C, then run init again and answer localhost.",
        };
      }
      if (typed === '') {
        return host.cloud === undefined
          ? { value: undefined }
          : {
              problem: `This looks like a VM on ${host.cloud}, where lan needs the private network to publish on. Type a subnet this host is on.`,
            };
      }
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
