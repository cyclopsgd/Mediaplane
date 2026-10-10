import { z } from 'zod';
import type { ApiSpec, AppDefinition, Catalog } from '../catalog/types';
import { parseConfig } from '../config/load';
import type { StackConfig } from '../config/schema';
import { error } from '../diagnostics';
import type { HostFacts } from '../host/facts';

/**
 * A small, stable catalog for engine tests. It is deliberately NOT the real catalog,
 * so version bumps in catalog/ never change engine golden files.
 */

export const FAKE_DIGEST = `sha256:${'0'.repeat(64)}`;

export const FIXTURE_HOST: HostFacts = {
  arch: 'amd64',
  privateAddresses: [{ address: '192.168.1.10', cidr: '192.168.1.10/24' }],
};

/**
 * An API shaped like the real Servarr apps'. No fixture app has one, so plan never calls
 * an app in the tests that don't ask it to: give it to an app in a catalog of the test's.
 */
export const FIXTURE_API: ApiSpec = {
  port: 'web',
  ready: '/ping',
  key: { secret: 'apiKey', scheme: 'x-api-key' },
  check: '/api/v3/system/status',
};

export function fixtureApp<Options = Record<string, unknown>>(
  definition: Partial<AppDefinition<Options>> & { id: string },
): AppDefinition<Options> {
  return {
    name: definition.id,
    category: 'pvr',
    image: { repo: `registry.test/${definition.id}`, tag: '1.0.0', digest: FAKE_DIGEST },
    arch: ['amd64', 'arm64'],
    ports: [],
    volumes: { appdata: '/config' },
    runAs: 'puid-env',
    provides: [],
    requires: [],
    secrets: {},
    credentials: [],
    health: 'none',
    experimental: false,
    ...definition,
  };
}

export const fixtureCatalog: Catalog = [
  fixtureApp({
    id: 'byparr',
    category: 'indexer',
    provides: ['cloudflare-solver'],
    exclusive: ['cloudflare-solver'],
    volumes: {},
    runAs: 'user-directive',
  }),
  fixtureApp({
    id: 'flaresolverr',
    category: 'indexer',
    arch: ['amd64'],
    provides: ['cloudflare-solver'],
    exclusive: ['cloudflare-solver'],
    volumes: {},
    runAs: 'image-default',
  }),
  fixtureApp({
    id: 'gluetun',
    category: 'network',
    provides: ['vpn'],
    ports: [{ name: 'control', container: 8000, publish: false }],
    runAs: 'image-default',
    health: 'image',
    secrets: { wireguardKey: { userProvided: 'vpn.private_key' } },
    credentials: [{ step: 'env', var: 'WIREGUARD_PRIVATE_KEY', secret: 'wireguardKey' }],
    extras: () => ({ cap_add: ['NET_ADMIN'] }),
    validate: (ctx) => (ctx.config.vpn ? [] : [error('vpn.missing', 'no vpn: block')]),
  }),
  fixtureApp({
    id: 'jellyfin',
    category: 'media-server',
    provides: ['media-server'],
    exclusive: ['media-server'],
    ports: [{ name: 'web', container: 8096 }],
  }),
  fixtureApp({
    id: 'plex',
    category: 'media-server',
    provides: ['media-server'],
    exclusive: ['media-server'],
    ports: [{ name: 'web', container: 32400 }],
  }),
  fixtureApp({
    id: 'prowlarr',
    category: 'indexer',
    ports: [{ name: 'web', container: 9696 }],
    implies: () => ['byparr'],
  }),
  fixtureApp({
    id: 'qbittorrent',
    category: 'download',
    provides: ['download-client:torrent'],
    ports: [
      { name: 'web', container: 8080, hostEqualsContainer: { env: 'WEBUI_PORT' } },
      { name: 'peer', container: 6881, publish: false },
    ],
    options: z.strictObject({ vpn: z.boolean().default(true) }),
    implies: (options) => (options.vpn ? ['gluetun'] : []),
    networkVia: (options) => (options.vpn ? 'gluetun' : undefined),
  }),
  fixtureApp({
    id: 'sonarr',
    ports: [{ name: 'web', container: 8989 }],
    volumes: { appdata: '/config', data: '/data' },
    provides: ['pvr:tv'],
    requires: [{ capability: 'download-client', min: 1 }],
    secrets: { apiKey: { generate: 'hex32' } },
    credentials: [{ step: 'env', var: 'SONARR__AUTH__APIKEY', secret: 'apiKey' }],
    health: { test: ['CMD', 'true'] },
    env: () => ({ STATIC: 'a$b' }),
  }),
];

/** Parse stack.yaml text that the test knows is valid. */
export function fixtureConfig(source: string): StackConfig {
  const result = parseConfig(source);
  if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join('\n'));
  return result.config;
}
