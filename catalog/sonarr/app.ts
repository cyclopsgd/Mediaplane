import { defineApp } from '@mediaplane/engine';
import { servarrApi, servarrConfigFiles, servarrEnv } from '../_shared/servarr';

export default defineApp({
  id: 'sonarr',
  name: 'Sonarr',
  category: 'pvr',
  image: {
    repo: 'lscr.io/linuxserver/sonarr',
    tag: '4.0.20.3014-ls326',
    digest: 'sha256:f247545d23ba8b233d6604575347e48a623fe6ad75dda02348bf81917f3b5c06',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 8989 }],
  volumes: { appdata: '/config', data: '/data' },
  runAs: 'puid-env',
  provides: ['pvr:tv'],
  requires: [{ capability: 'download-client', min: 1 }],
  secrets: { apiKey: { generate: 'hex32' } },
  credentials: [{ step: 'env', var: 'SONARR__AUTH__APIKEY', secret: 'apiKey' }],
  health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:8989/ping'] },
  api: servarrApi('v3'),
  env: (ctx) => servarrEnv('SONARR', ctx),
  configFiles: servarrConfigFiles,
  login: { comingIn: 'Slice 3b' },
  experimental: false,
});
