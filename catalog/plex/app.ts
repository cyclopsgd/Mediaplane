import { defineApp } from '@mediaplane/engine';
import { z } from 'zod';
import { plexBootstrap } from './bootstrap';
import integration from './integration';

/**
 * Whether Plex has started: /identity answers as soon as Plex listens, with a `startState`
 * while it still starts its plugins, and Plex refuses a new library until it has none
 * ("the server is still starting up", probed).
 */
function started(answer: unknown): boolean {
  const parsed = z
    .looseObject({
      MediaContainer: z.looseObject({ startState: z.unknown().optional() }),
    })
    .safeParse(answer);
  return parsed.success && parsed.data.MediaContainer.startState === undefined;
}

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
  // Your token is its key: Plex takes a token of the account that claimed it.
  api: {
    port: 'web',
    ready: '/identity',
    key: { secret: 'token', scheme: 'x-plex-token' },
    check: '/library/sections',
    started: { path: '/identity', done: started },
  },
  bootstrap: plexBootstrap,
  integration,
  options: z.strictObject({
    server_name: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe(
        'The name Plex shows for this server, in its apps and your plex.tv account. Default Mediaplane.',
      ),
  }),
  env: () => ({ VERSION: 'docker' }),
  // Your own plex.tv account: never the shared admin (spec §6.1).
  login: { own: 'Plex' },
  webPath: '/web',
  experimental: false,
});
