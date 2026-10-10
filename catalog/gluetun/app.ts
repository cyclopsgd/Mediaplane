import { defineApp, error, warning } from '@mediaplane/engine';

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
      content: [
        '[[roles]]',
        'name = "mediaplane"',
        'routes = ["GET /v1/vpn/status", "GET /v1/publicip/ip"]',
        'auth = "apikey"',
        `apikey = "${ctx.secret('controlApiKey')}"`,
        '',
      ].join('\n'),
      // Mediaplane's own role: an apikey line alone could be a role of your own.
      seeded: /^name = "mediaplane"$/m,
    },
  ],
  experimental: false,
});
