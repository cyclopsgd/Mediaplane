import { defineApp } from '@mediaplane/engine';

export default defineApp({
  id: 'byparr',
  name: 'Byparr',
  category: 'indexer',
  image: {
    repo: 'ghcr.io/thephaseless/byparr',
    tag: '3.0.4',
    digest: 'sha256:874f719518f617d03a60e03411fc5d090647e1a877041e81f8dc965927c7deb6',
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
  // The image's own HEALTHCHECK runs every 15 minutes. If its first check fires before
  // the server listens, the container stays "starting" until the next one, so `up --wait`
  // runs into apply's ten-minute limit and fails. Check every 30 s instead.
  health: {
    test: ['CMD', 'curl', '-fsS', '-o', '/dev/null', 'http://127.0.0.1:8191/health'],
  },
  experimental: false,
});
