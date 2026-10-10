import { chmod, mkdir } from 'node:fs/promises';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import {
  invokingUser,
  networkOf,
  parseConfig,
  STACK_PATH,
  starterStack,
  writeFileExclusive,
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

async function gatherAnswers(
  options: InitOptions,
  io: Io,
  host: HostFacts,
): Promise<StarterAnswers | string> {
  let mediaServer = options.mediaServer;
  let dataPath = options.data;
  let vpnProvider = options.vpnProvider;
  let vpnAddresses = options.vpnAddresses;
  let bind = options.bind;
  let lanSubnet = options.lanSubnet;
  let loginOnLan = options.loginOnLan;
  let adminUser = options.adminUser;
  let adminPasswordFile = options.adminPasswordFile;
  const defaultBind = host.cloud === undefined ? 'lan' : 'localhost';
  const ask = options.json === true ? undefined : io.ask;
  if (ask !== undefined) {
    mediaServer ??=
      (await ask('Media server, jellyfin or plex [jellyfin]: ')).trim() || 'jellyfin';
    dataPath ??=
      (await ask('Data folder for downloads and media [/srv/data]: ')).trim() ||
      '/srv/data';
    if (vpnProvider === undefined) {
      const answer = (
        await ask('VPN provider for qBittorrent, e.g. mullvad (empty for none): ')
      ).trim();
      vpnProvider = answer === '' ? undefined : answer;
    }
    if (vpnProvider !== undefined && vpnAddresses === undefined) {
      const answer = (
        await ask(
          "Your provider's WireGuard address, if its config file has one, e.g. 10.64.0.2/32 (empty to skip): ",
        )
      ).trim();
      vpnAddresses = answer === '' ? undefined : answer;
    }
    bind ??=
      (
        await ask(
          `Publish the web UIs on your LAN, or keep them on this machine? lan or localhost [${defaultBind}]: `,
        )
      ).trim() || defaultBind;
    if (bind === 'lan' && lanSubnet === undefined)
      lanSubnet = await askLanSubnet(ask, host);
    if (loginOnLan) {
      loginOnLan = !/^n/i.test(
        (await ask('Ask for a login from your own network too? [Y/n] ')).trim(),
      );
    }
    adminUser ??= (await ask('Admin user name for the apps [admin]: ')).trim() || 'admin';
    if (
      adminPasswordFile === undefined &&
      /^n/i.test((await ask('Generate the admin password? [Y/n] ')).trim())
    ) {
      adminPasswordFile =
        (
          await ask(
            `File holding your password, inside the Mediaplane home [${DEFAULT_PASSWORD_FILE}]: `,
          )
        ).trim() || DEFAULT_PASSWORD_FILE;
    }
  }
  if (mediaServer === undefined || dataPath === undefined) {
    return 'init needs --media-server and --data when it cannot ask (with --json, or when not run in a terminal)';
  }
  if (mediaServer !== 'jellyfin' && mediaServer !== 'plex') {
    return `--media-server must be jellyfin or plex, not "${mediaServer}"`;
  }
  bind ??= defaultBind;
  if (bind !== 'lan' && bind !== 'localhost') {
    return `--bind must be lan or localhost, not "${bind}"`;
  }
  if (bind === 'lan' && host.cloud !== undefined && lanSubnet === undefined) {
    return `this looks like a VM on ${host.cloud}, where bind: lan needs your LAN subnet: add --lan-subnet, or use --bind localhost`;
  }
  if (adminPasswordFile !== undefined && !insideHome(adminPasswordFile)) {
    return `--admin-password-file must be a path inside the Mediaplane home, such as ${DEFAULT_PASSWORD_FILE}`;
  }
  // The starter writes the address only in a vpn: block, so say so rather than drop it.
  if (vpnAddresses !== undefined && vpnProvider === undefined) {
    return '--vpn-addresses needs --vpn-provider';
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
 * The LAN subnet: the one this host is on, if there is exactly one and you agree. A cloud
 * VM's private network is not a LAN, so there you always type it.
 */
async function askLanSubnet(ask: Ask, host: HostFacts): Promise<string | undefined> {
  const seen = [...new Set(host.privateAddresses.map((a) => networkOf(a.cidr)))];
  const [only] = seen;
  if (host.cloud === undefined && seen.length === 1 && only !== undefined) {
    const answer = (await ask(`Your LAN looks like ${only}. Use it? [Y/n] `)).trim();
    if (!/^n/i.test(answer)) return only;
  }
  const typed = (await ask('Your LAN subnet, e.g. 192.168.1.0/24: ')).trim();
  return typed === '' ? undefined : typed;
}

/** Whether `path` names a file inside the home, which is all the container sees. */
function insideHome(path: string): boolean {
  return !isAbsolute(path) && normalize(path).split('/')[0] !== '..';
}
