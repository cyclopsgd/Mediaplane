import { defineApp, warning } from '@mediaplane/engine';
import { z } from 'zod';

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
  credentials: [{ step: 'config-file', path: 'qBittorrent/qBittorrent.conf' }],
  health: {
    test: ['CMD-SHELL', 'curl -fsS "http://localhost:$${WEBUI_PORT}/" > /dev/null'],
  },
  options: z.strictObject({ vpn: z.boolean().default(true) }),
  implies: (options) => (options.vpn ? ['gluetun'] : []),
  networkVia: (options) => (options.vpn ? 'gluetun' : undefined),
  validate: (ctx) =>
    ctx.options.vpn
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
        ],
  experimental: false,
});
