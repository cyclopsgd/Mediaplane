import { chmod, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  invokingUser,
  parseConfig,
  STACK_PATH,
  starterStack,
  writeFileExclusive,
  type HostFacts,
  type StarterAnswers,
} from '@mediaplane/engine';
import { formatDiagnostic, printError } from './output';
import type { Io } from './run';

export const INIT_JSON_SCHEMA = 'mediaplane.init/v1';

export interface InitOptions {
  home: string;
  mediaServer?: string;
  data?: string;
  vpnProvider?: string;
  loginOnLan: boolean;
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
    if (asJson)
      printError(parsed.diagnostics.map((d) => d.message).join('; '), { json: true }, io);
    else
      for (const diagnostic of parsed.diagnostics)
        io.stderr(formatDiagnostic(diagnostic));
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
    `Create ${answers.dataPath} and make sure uid ${String(answers.user.uid)} (gid ${String(answers.user.gid)}) can write to it.`,
    'Run "mediaplane plan" to check everything, then "mediaplane apply".',
  ];
  if (asJson) {
    io.stdout(
      `${JSON.stringify({ schema: INIT_JSON_SCHEMA, ok: true, stackPath, next }, null, 2)}\n`,
    );
    return 0;
  }
  io.stdout(`Wrote ${stackPath}.\n`);
  if (host.cloud !== undefined) {
    io.stdout(
      `This looks like a VM on ${host.cloud}, so the web UIs stay on localhost (network.bind).\n`,
    );
  }
  io.stdout(`\nNext steps:\n${next.map((step) => `  - ${step}\n`).join('')}`);
  return 0;
}

async function gatherAnswers(
  options: InitOptions,
  io: Io,
  host: HostFacts,
): Promise<StarterAnswers | string> {
  let mediaServer = options.mediaServer;
  let dataPath = options.data;
  let vpnProvider = options.vpnProvider;
  let loginOnLan = options.loginOnLan;
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
    if (loginOnLan) {
      loginOnLan = !/^n/i.test(
        (await ask('Ask for a login from your own network too? [Y/n] ')).trim(),
      );
    }
  }
  if (mediaServer === undefined || dataPath === undefined) {
    return 'init needs --media-server and --data when it cannot ask (with --json, or when not run in a terminal)';
  }
  if (mediaServer !== 'jellyfin' && mediaServer !== 'plex') {
    return `--media-server must be jellyfin or plex, not "${mediaServer}"`;
  }
  return {
    mediaServer,
    dataPath,
    vpnProvider,
    loginOnLan,
    timezone: options.timezone,
    user: invokingUser(),
    bind: host.cloud === undefined ? 'lan' : 'localhost',
  };
}
