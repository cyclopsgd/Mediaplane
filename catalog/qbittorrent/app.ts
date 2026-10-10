import { defineApp, warning } from '@mediaplane/engine';
import { z } from 'zod';
import { qbittorrentConf } from './conf';

export default defineApp({
  id: 'qbittorrent',
  name: 'qBittorrent',
  category: 'download',
  image: {
    repo: 'lscr.io/linuxserver/qbittorrent',
    tag: '5.2.4_v2.0.15-ls479',
    digest: 'sha256:b522f9f4b769f8f36d49d22d5eb6a92e9aa18904c6a1830b1439df511ec21983',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 8080, hostEqualsContainer: { env: 'WEBUI_PORT' } }],
  volumes: { appdata: '/config', data: '/data' },
  runAs: 'puid-env',
  provides: ['download-client:torrent'],
  requires: [],
  secrets: { apiKey: { generate: 'qbt' } },
  credentials: [],
  health: {
    test: ['CMD-SHELL', 'curl -fsS "http://localhost:$${WEBUI_PORT}/" > /dev/null'],
  },
  options: z.strictObject({
    vpn: z
      .boolean()
      .default(true)
      .describe(
        "Route qBittorrent through Gluetun's VPN, so it has no network when the VPN is down. true needs a vpn: block; false makes plan warn every time.",
      ),
  }),
  implies: (options) => (options.vpn ? ['gluetun'] : []),
  networkVia: (options) => (options.vpn ? 'gluetun' : undefined),
  validate: (ctx) => [
    ...(ctx.options.vpn
      ? []
      : [
          warning(
            'qbittorrent.no-vpn',
            'qBittorrent is running without a VPN (apps.qbittorrent.vpn: false)',
            {
              path: 'apps.qbittorrent.vpn',
              hint: 'peers will see your real IP address; add a vpn: block and remove vpn: false',
            },
          ),
        ]),
    // Behind the VPN, Gluetun's warning of the same code covers it: the LAN can't reach
    // the web UI through Gluetun's firewall, so who must log in is moot.
    ...(!ctx.options.vpn &&
    !ctx.config.security.login_on_lan &&
    ctx.publishesOnLan &&
    ctx.lanClientSubnets.length === 0
      ? [
          warning(
            'network.no-lan-subnet',
            'security.login_on_lan is false, but Mediaplane knows no LAN subnet, so qBittorrent asks your LAN for a login too',
            {
              path: 'network.lan_subnet',
              hint: 'set network.lan_subnet to your LAN, such as 192.168.1.0/24',
            },
          ),
        ]
      : []),
  ],
  // The shared login and the key, before the image's default can set a temporary password.
  configFiles: (ctx) => [
    {
      path: 'qBittorrent/qBittorrent.conf',
      content: qbittorrentConf(ctx),
      seeded: /^WebUI\\APIKey=.+$/m,
    },
  ],
  login: 'shared',
  experimental: false,
});
