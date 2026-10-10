import { defineApp } from '@mediaplane/engine';
import { servarrConfigFiles, servarrEnv } from '../_shared/servarr';

export default defineApp({
  id: 'prowlarr',
  name: 'Prowlarr',
  category: 'indexer',
  image: {
    repo: 'lscr.io/linuxserver/prowlarr',
    tag: '2.6.5.5623-ls163',
    digest: 'sha256:f9151e5bc1025c6d0a630d503210cdcb6bb55a7cc098562609d96a408d838902',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 9696 }],
  volumes: { appdata: '/config' },
  runAs: 'puid-env',
  provides: ['indexer-manager'],
  requires: [],
  secrets: { apiKey: { generate: 'hex32' } },
  credentials: [
    { step: 'env', var: 'PROWLARR__AUTH__APIKEY', secret: 'apiKey' },
    { step: 'bootstrap-api', action: 'create-admin' },
  ],
  health: { test: ['CMD', 'curl', '-fsS', 'http://localhost:9696/ping'] },
  implies: () => ['byparr'],
  env: (ctx) => servarrEnv('PROWLARR', ctx),
  configFiles: servarrConfigFiles,
  experimental: false,
});
