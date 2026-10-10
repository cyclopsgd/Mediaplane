import { defineApp } from '@mediaplane/engine';

export default defineApp({
  id: 'plex',
  name: 'Plex',
  category: 'media-server',
  image: {
    repo: 'lscr.io/linuxserver/plex',
    tag: '1.43.4.10903-e5521bd8c-ls327',
    digest: 'sha256:06e07af2851e6a822e89062b148435495dd794d6d5aaf36247dee05fb3dcc4b8',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 32400 }],
  volumes: { appdata: '/config', data: '/data' },
  runAs: 'puid-env',
  provides: ['media-server'],
  requires: [],
  exclusive: ['media-server'],
  secrets: { token: { userProvided: 'plex.token' } },
  credentials: [{ step: 'bootstrap-api', action: 'claim-server' }],
  health: {
    test: ['CMD', 'curl', '-fsS', 'http://localhost:32400/identity'],
    startPeriod: '120s',
  },
  env: () => ({ VERSION: 'docker' }),
  login: { comingIn: 'Slice 6' },
  experimental: false,
});
