import { defineApp, error } from '@mediaplane/engine';

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
  secrets: { wireguardKey: { userProvided: 'vpn.private_key' } },
  credentials: [{ step: 'env', var: 'WIREGUARD_PRIVATE_KEY', secret: 'wireguardKey' }],
  health: 'image',
  env: (ctx) => ({
    VPN_SERVICE_PROVIDER: ctx.config.vpn?.provider ?? '',
    VPN_TYPE: 'wireguard',
    ...(ctx.config.vpn?.addresses === undefined
      ? {}
      : { WIREGUARD_ADDRESSES: ctx.config.vpn.addresses }),
    ...(ctx.lanSubnets.length === 0
      ? {}
      : { FIREWALL_OUTBOUND_SUBNETS: ctx.lanSubnets.join(',') }),
  }),
  extras: () => ({ cap_add: ['NET_ADMIN'], devices: ['/dev/net/tun:/dev/net/tun'] }),
  validate: (ctx) =>
    ctx.config.vpn
      ? []
      : [
          error('vpn.missing', 'Gluetun is enabled but stack.yaml has no vpn: block', {
            path: 'vpn',
            hint: 'add vpn: { provider: …, private_key: { file: secrets/wg.key } }, or set apps.qbittorrent.vpn: false',
          }),
        ],
  experimental: false,
});
