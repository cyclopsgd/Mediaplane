import { defineApp, type KeyFile } from '@mediaplane/engine';
import { z } from 'zod';
import { seerrBootstrap } from './bootstrap';
import integration from './integration';

const settingsFile = z.looseObject({
  main: z.looseObject({ apiKey: z.string().optional() }).optional(),
});

/**
 * Seerr's key in its settings.json (spec §6.1, key recovery): `main.apiKey`, which Seerr
 * writes from API_KEY at its first start. It takes API_KEY again at every start, and its
 * web UI can't make another key while API_KEY is set (probed).
 */
const keyFile: KeyFile = {
  path: 'settings.json',
  // Throws on a file that isn't JSON, or whose main.apiKey isn't text: readKeyFile says
  // it can't be read (fail closed), rather than that it holds no key.
  read: (text) => settingsFile.parse(JSON.parse(text)).main?.apiKey,
};

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
  keyFiles: { apiKey: keyFile },
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
  integration,
  options: z.strictObject({
    sonarr_profile: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The Sonarr quality profile Seerr requests with, by name. Unset: HD-1080p, else Any, else Sonarr's first.",
      ),
    radarr_profile: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The Radarr quality profile Seerr requests with, by name. Unset: HD-1080p, else Any, else Radarr's first.",
      ),
  }),
  env: () => ({ LOG_LEVEL: 'info' }),
  extras: () => ({ init: true }),
  // Through the media server: the shared admin is Jellyfin's; with Plex, your account.
  login: (config) => (config.media_server === 'plex' ? { own: 'Plex' } : 'shared'),
  experimental: false,
});
