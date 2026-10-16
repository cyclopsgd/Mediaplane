import { defineApp } from '@mediaplane/engine';
import { z } from 'zod';
import { seerrBootstrap } from './bootstrap';

export default defineApp({
  id: 'seerr',
  name: 'Seerr',
  category: 'requests',
  image: {
    repo: 'ghcr.io/seerr-team/seerr',
    tag: 'v3.5.0',
    digest: 'sha256:27602401178d54f1964442287b9f23f67a3fa2252645ee8065839ea1c3f69e45',
  },
  arch: ['amd64', 'arm64'],
  ports: [{ name: 'web', container: 5055 }],
  volumes: { appdata: '/app/config' },
  runAs: 'fixed:1000',
  provides: ['requests'],
  requires: [
    { capability: 'media-server', min: 1 },
    { capability: 'pvr', min: 1 },
  ],
  secrets: { apiKey: { generate: 'hex32' } },
  credentials: [
    { step: 'env', var: 'API_KEY', secret: 'apiKey' },
    { step: 'bootstrap-api', action: 'first-sign-in' },
  ],
  health: {
    test: [
      'CMD-SHELL',
      'wget -qO- http://localhost:5055/api/v1/status > /dev/null || exit 1',
    ],
  },
  // Its key does nothing until its first sign-in has made its admin (probed).
  api: {
    port: 'web',
    ready: '/api/v1/settings/public',
    key: { secret: 'apiKey', scheme: 'x-api-key' },
    check: '/api/v1/auth/me',
  },
  bootstrap: seerrBootstrap,
  // With Plex, it signs in with your Plex account, which comes in Slice 7.
  notWiredYet: (config) =>
    config.media_server === 'jellyfin' ? undefined : { comingIn: 'Slice 7' },
  options: z.strictObject({
    sonarr_profile: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The Sonarr quality profile Seerr requests with. Not used yet (Slice 6).',
      ),
    radarr_profile: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The Radarr quality profile Seerr requests with. Not used yet (Slice 6).',
      ),
  }),
  env: () => ({ LOG_LEVEL: 'info' }),
  extras: () => ({ init: true }),
  login: 'shared',
  experimental: false,
});
