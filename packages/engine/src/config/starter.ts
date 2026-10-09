export interface StarterAnswers {
  mediaServer: 'jellyfin' | 'plex';
  /** The data folder for downloads and media (absolute). */
  dataPath: string;
  /** Gluetun VPN provider, e.g. "mullvad"; undefined for no VPN. */
  vpnProvider: string | undefined;
  loginOnLan: boolean;
  timezone: string;
  /** The user and group the apps run as. */
  user: { uid: number; gid: number };
  bind: 'lan' | 'localhost';
}

/** A YAML scalar for any user-supplied string: JSON strings are valid YAML. */
const scalar = (value: string) => JSON.stringify(value);

/** A commented starter stack.yaml (spec §5.2 `init`). */
export function starterStack(answers: StarterAnswers): string {
  const vpn = answers.vpnProvider;
  return [
    '# Mediaplane stack: the one file that describes your media stack.',
    '# Reference: https://github.com/cyclopsgd/Mediaplane',
    'version: 1',
    `timezone: ${scalar(answers.timezone)}`,
    '# The apps run as this user and group. Make sure they can write to the data folder.',
    `user: { uid: ${String(answers.user.uid)}, gid: ${String(answers.user.gid)} }`,
    'paths:',
    `  data: ${scalar(answers.dataPath)}`,
    'network:',
    answers.bind === 'localhost'
      ? '  # localhost keeps the web UIs on this machine; lan publishes them on your network.'
      : "  # lan publishes the web UIs on this machine's private address; localhost keeps them local.",
    `  bind: ${answers.bind}`,
    'security:',
    '  # Ask for a login even from your own network.',
    `  login_on_lan: ${String(answers.loginOnLan)}`,
    `media_server: ${answers.mediaServer}`,
    ...(answers.mediaServer === 'plex'
      ? ['plex:', '  token: { file: secrets/plex-token }']
      : []),
    ...(vpn === undefined
      ? []
      : [
          'vpn:',
          `  provider: ${scalar(vpn)}`,
          '  private_key: { file: secrets/wg.key }',
        ]),
    'apps:',
    '  sonarr: {}',
    '  radarr: {}',
    '  prowlarr: {}',
    vpn === undefined ? '  qbittorrent: { vpn: false }' : '  qbittorrent: {}',
    '  seerr: {}',
    '',
  ].join('\n');
}

/**
 * The user `init` writes into the starter: whoever runs it. Inside the Mediaplane
 * container that is the user that owns the home. Root, or a platform without POSIX ids,
 * gets 1000 instead, because the apps should never run as root.
 */
export function invokingUser(
  ids: { uid: number | undefined; gid: number | undefined } = {
    uid: process.getuid?.(),
    gid: process.getgid?.(),
  },
): { uid: number; gid: number } {
  if (ids.uid === undefined || ids.gid === undefined || ids.uid === 0) {
    return { uid: 1000, gid: 1000 };
  }
  return { uid: ids.uid, gid: ids.gid };
}
