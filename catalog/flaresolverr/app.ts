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
  // Its image declares a volume at /config, and keeps nothing there (probed: its code
  // never reads or writes it). A folder of its own is mounted there, so that no container
  // of it leaves an anonymous volume behind when it is removed. The image runs as uid
  // 1000, so the folder is that user's.
  volumes: { appdata: '/config' },
  runAs: 'fixed:1000',
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
