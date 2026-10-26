import { defineApp } from '@mediaplane/engine';
import { z } from 'zod';
import { gpuExtras, hardwareTranscoding } from '../_shared/hardware-transcoding';
import { jellyfinBootstrap, KEY_NAME } from './bootstrap';
import integration from './integration';

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
  // The newest key named Mediaplane, as its setup takes it from Jellyfin's list (spec
  // §6.1, key recovery), in Jellyfin's database: WAL mode, so reading it read-only stops
  // none of Jellyfin's writes, and sees each as soon as it is made (probed).
  keyFiles: {
    apiKey: {
      path: 'data/data/jellyfin.db',
      sqlite: {
        query: `SELECT AccessToken FROM ApiKeys WHERE Name = '${KEY_NAME}' ORDER BY DateCreated DESC, Id ASC LIMIT 1`,
        column: 'AccessToken',
      },
    },
  },
  credentials: [
    { step: 'bootstrap-api', action: 'startup-wizard' },
    { step: 'bootstrap-api', action: 'create-api-key' },
  ],
  // /health answers 200 with "Degraded" for the first seconds of every start, while the
  // server itself answers 503: only "Healthy" means it is up.
  health: {
    test: ['CMD-SHELL', 'curl -fsS http://localhost:8096/health | grep -qx Healthy'],
    startPeriod: '120s',
  },
  // Its key goes in its MediaBrowser header: Jellyfin 12 turns the legacy ones off.
  api: {
    port: 'web',
    ready: '/System/Info/Public',
    key: { secret: 'apiKey', scheme: 'mediabrowser' },
    check: '/System/Info',
  },
  integration,
  bootstrap: jellyfinBootstrap,
  options: z.strictObject({ hardware_transcoding: hardwareTranscoding('Jellyfin', '') }),
  extras: (ctx) => gpuExtras(ctx.options.hardware_transcoding),
  login: 'shared',
  experimental: false,
});
