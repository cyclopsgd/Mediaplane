import { defineApp } from '@mediaplane/engine';
import { servarrApi, servarrConfigFiles, servarrEnv } from '../_shared/servarr';

export default defineApp({
  id: 'radarr',
  name: 'Radarr',
  category: 'pvr',
  image: {
    repo: 'lscr.io/linuxserver/radarr',
    tag: '6.4.4.10685-ls319',
    digest: 'sha256:7dfd049e79c00b16fbc29c3f5d96a9e7b9e73a23930b4c5b3c4541d60b366814',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 7878 }],
  volumes: { appdata: '/config', data: '/data' },
  runAs: 'puid-env',
  provides: ['pvr:movies'],
  requires: [{ capability: 'download-client', min: 1 }],
  secrets: { apiKey: { generate: 'hex32' } },
  credentials: [
    { step: 'env', var: 'RADARR__AUTH__APIKEY', secret: 'apiKey' },
    { step: 'bootstrap-api', action: 'create-admin' },
  ],
  health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:7878/ping'] },
  api: servarrApi('v3'),
  env: (ctx) => servarrEnv('RADARR', ctx),
  configFiles: servarrConfigFiles,
  login: { comingIn: 'Slice 3b' },
  experimental: false,
});
