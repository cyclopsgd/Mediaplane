import { defineApp } from '@mediaplane/engine';

export default defineApp({
  id: 'flaresolverr',
  name: 'FlareSolverr',
  category: 'indexer',
  image: {
    repo: 'ghcr.io/flaresolverr/flaresolverr',
    tag: 'v3.5.2',
    digest: 'sha256:c80ae007ce2ccdcd217a12426e4f039ef763ff90738c808d38810c3e59323767',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'api', container: 8191, publish: false }],
  volumes: {},
  runAs: 'image-default',
  provides: ['cloudflare-solver'],
  requires: [],
  exclusive: ['cloudflare-solver'],
  secrets: {},
  credentials: [],
  // The image has none. Prowlarr tests a new indexer proxy as it saves it, so `up --wait`
  // waits until FlareSolverr answers, before the wire step makes the proxy.
  health: {
    test: ['CMD', 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:8191/health'],
  },
  env: () => ({ LOG_LEVEL: 'info' }),
  experimental: false,
});
