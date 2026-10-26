import { defineApp, error, warning, type KeyFile } from '@mediaplane/engine';
import { appendSection } from '../_shared/text';

/** Mediaplane's own role in auth/config.toml: an apikey line alone could be yours. */
const MEDIAPLANE_ROLE = /^name = "mediaplane"$/m;

/**
 * Mediaplane's role in auth/config.toml, with `key`: the routes vpn-check reads, and no
 * other (spec §11, Slice 3a).
 */
function mediaplaneRole(key: string): string {
  return [
    '[[roles]]',
    'name = "mediaplane"',
    'routes = ["GET /v1/vpn/status", "GET /v1/publicip/ip"]',
    'auth = "apikey"',
    `apikey = "${key}"`,
    '',
  ].join('\n');
}

/** auth/config.toml's roles, each from its [[roles]] line, after what comes before them. */
const roles = (text: string) => text.split(/^(?=\[\[roles\]\][ \t]*$)/m);

/**
 * Mediaplane's key to Gluetun's control server (spec §6.1, key recovery): the apikey of
 * Mediaplane's own role in auth/config.toml, which its pre-start file writes. Gluetun
 * reads the file when it starts, and never writes it. Put back, Mediaplane's role is
 * written whole, in its place or after yours, which stay as they are.
 */
const controlKeyFile: KeyFile = {
  path: 'auth/config.toml',
  read: (text) =>
    roles(text)
      .filter((role) => MEDIAPLANE_ROLE.test(role))
      .map((role) => /^apikey = "([^"]*)"[ \t]*$/m.exec(role)?.[1])
      .find((key) => key !== undefined),
  write: (text, key) => {
    const parts = roles(text);
    const at = parts.findIndex((role) => MEDIAPLANE_ROLE.test(role));
    if (at < 0) {
      return appendSection(text, mediaplaneRole(key));
    }
    // Its own lines run to its last that is neither blank nor a comment: the blank lines
    // and comments after them, before the next role, stay.
    const lines = (parts[at] ?? '').split('\n');
    const last = lines.findLastIndex((line) => !/^\s*(#.*)?$/.test(line));
    parts[at] = `${mediaplaneRole(key)}${lines.slice(last + 1).join('\n')}`;
    return parts.join('');
  },
};

export default defineApp({
  id: 'gluetun',
  name: 'Gluetun',
  category: 'network',
  image: {
    repo: 'qmcgaw/gluetun',
    tag: 'v3.41.3',
    digest: 'sha256:fa19cc76b2af13d57a8d3dc3066f2ada061b1c761b8aecf989b3877c0486e027',
  },
  arch: ['amd64', 'arm64'],
  // Gluetun's HTTP control server; apps in its network namespace must not use this port.
  ports: [{ name: 'control', container: 8000, publish: false }],
  volumes: { appdata: '/gluetun' },
  runAs: 'image-default',
  provides: ['vpn'],
  requires: [],
  secrets: {
    // Mediaplane's key to the control server: vpn-check reads the VPN's status with it.
    controlApiKey: { generate: 'hex32' },
    wireguardKey: { userProvided: 'vpn.private_key' },
  },
  keyFiles: { controlApiKey: controlKeyFile },
  credentials: [{ step: 'env', var: 'WIREGUARD_PRIVATE_KEY', secret: 'wireguardKey' }],
  health: 'image',
  env: (ctx) => ({
    VPN_SERVICE_PROVIDER: ctx.config.vpn?.provider ?? '',
    VPN_TYPE: 'wireguard',
    ...(ctx.config.vpn?.addresses === undefined
      ? {}
      : { WIREGUARD_ADDRESSES: ctx.config.vpn.addresses }),
    // Only LAN clients need a way back out: empty unless the web UIs are on the LAN.
    ...(ctx.lanClientSubnets.length > 0
      ? { FIREWALL_OUTBOUND_SUBNETS: ctx.lanClientSubnets.join(',') }
      : {}),
  }),
  extras: () => ({ cap_add: ['NET_ADMIN'], devices: ['/dev/net/tun:/dev/net/tun'] }),
  validate: (ctx) => [
    ...(ctx.config.vpn
      ? []
      : [
          error('vpn.missing', 'Gluetun is enabled but stack.yaml has no vpn: block', {
            path: 'vpn',
            hint: 'add vpn: { provider: …, private_key: { file: secrets/wg.key } }, or set apps.qbittorrent.vpn: false',
          }),
        ]),
    ...(ctx.publishesOnLan && ctx.lanClientSubnets.length === 0
      ? [
          warning(
            'network.no-lan-subnet',
            "the web UIs are published on the LAN, but Mediaplane knows no LAN subnet, so Gluetun's firewall keeps your LAN out of qBittorrent's web UI",
            {
              path: 'network.lan_subnet',
              hint: 'set network.lan_subnet to your LAN, such as 192.168.1.0/24',
            },
          ),
        ]
      : []),
  ],
  // Without this file, Gluetun's control server answers anyone on the stack's network.
  configFiles: (ctx) => [
    {
      path: 'auth/config.toml',
      content: mediaplaneRole(ctx.secret('controlApiKey')),
      seeded: MEDIAPLANE_ROLE,
    },
  ],
  experimental: false,
});
