import { defineApp } from '@mediaplane/engine';

export default defineApp({
  id: 'jellyfin',
  name: 'Jellyfin',
  category: 'media-server',
  image: {
    repo: 'lscr.io/linuxserver/jellyfin',
    tag: '12.2ubu2604-ls53',
    digest: 'sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 8096 }],
  volumes: { appdata: '/config', data: '/data' },
  runAs: 'puid-env',
  provides: ['media-server'],
  requires: [],
  exclusive: ['media-server'],
  secrets: { apiKey: { createdBy: 'app' } },
  credentials: [
    { step: 'bootstrap-api', action: 'startup-wizard' },
    { step: 'bootstrap-api', action: 'create-api-key' },
  ],
  health: {
    test: ['CMD', 'curl', '-fsS', 'http://localhost:8096/health'],
    startPeriod: '120s',
  },
  login: { comingIn: 'Slice 6' },
  experimental: false,
});
