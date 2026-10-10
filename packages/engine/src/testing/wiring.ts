import { z } from 'zod';
import type { Catalog } from '../catalog/types';
import type { WiringSeams } from '../integrations/wiring';
import type { ResourceSpec } from '../integrations/types';
import { resolveStack, type ResolvedStack } from '../resolver/resolve';
import { fakeContainer } from './fakes';
import { FIXTURE_API, FIXTURE_HOST, fixtureCatalog, fixtureConfig } from './fixtures';
import { fakeHttpApp, type FakeApp } from './http';

/** The stack of the wiring tests: Sonarr, and qBittorrent behind Gluetun. */
export const WIRING_STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  sonarr: {}
  qbittorrent: {}
`;

/** `source` resolved against `catalog`, WIRED_CATALOG by default. */
export function wiringStack(
  catalog: Catalog = WIRED_CATALOG,
  source = WIRING_STACK,
): ResolvedStack {
  const result = resolveStack(
    fixtureConfig(source),
    catalog,
    FIXTURE_HOST,
    '/opt/mediaplane',
  );
  if (result.stack === undefined) throw new Error(JSON.stringify(result.diagnostics));
  return result.stack;
}

/** WIRING_STACK's containers, running and healthy, with the fakes' IDs (fake-<service>). */
export const WIRING_RUNNING = ['gluetun', 'jellyfin', 'qbittorrent', 'sonarr'].map(
  (service) => fakeContainer(service, `fake-${service}`),
);

/**
 * Where the fake apps' containers are on the wiring network, by the fakes' container IDs
 * (fake-<service>): pass it as fakeRuntime's or fakeDocker's `addresses`. The seams send
 * the calls to the fake app whatever the address.
 */
function onWiring(services: readonly string[]): Record<string, string> {
  return Object.fromEntries(services.map((service) => [`fake-${service}`, '127.0.0.1']));
}

/**
 * A resource for engine tests, shaped like the Servarr admin: "sonarr.login", whose `user`
 * is a managed field and whose `password` is a secret, checked by signing in.
 */
export const FAKE_LOGIN: ResourceSpec = {
  name: 'login',
  fields: ['user'],
  secrets: ['password'],
  desired: ({ admin }) => ({
    name: 'login',
    fields: { user: admin.username },
    secrets: { password: admin.password },
  }),
  async observe(api) {
    const { user } = await api.get('/api/v3/login', z.looseObject({ user: z.string() }));
    return user === '' ? undefined : { id: null, name: 'login', fields: { user } };
  },
  async verify(api, desired) {
    const answer = await api.login('/login', {
      password: desired.secrets.password ?? '',
    });
    return answer.location === '/';
  },
  async create(api, desired) {
    await api.put('/api/v3/login', { user: desired.fields.user, ...desired.secrets });
    return { id: null };
  },
  async update(api, desired) {
    await api.put('/api/v3/login', { user: desired.fields.user, ...desired.secrets });
  },
};

/** The fixture catalog, with an API and FAKE_LOGIN for Sonarr. */
export const WIRED_CATALOG: Catalog = fixtureCatalog.map((def) =>
  def.id === 'sonarr'
    ? { ...def, api: FIXTURE_API, integration: { after: [], resources: [FAKE_LOGIN] } }
    : def,
);

/** What one fake app of the real catalog holds; a test may change it between calls. */
export interface FakeAppState {
  /** Its admin user name and password (Servarr); empty before there is one. */
  user: string;
  password: string;
  /** false: its readiness path answers 503, as while it starts. */
  up: boolean;
}

/**
 * The APIs of the real catalog's apps, as far as Mediaplane uses them, all on one port
 * of 127.0.0.1: told apart by their Host header ("sonarr:8989", "gluetun:8080"). Sonarr,
 * Radarr and Prowlarr have /ping, system/status, config/host and /login; qBittorrent has
 * / and app/version. Any key is taken. `seams` send every app's calls there.
 */
export async function fakeStackApis(): Promise<{
  app: FakeApp;
  apps: Map<string, FakeAppState>;
  seams: WiringSeams;
  addresses: Record<string, string>;
}> {
  const apps = new Map<string, FakeAppState>();
  const stateOf = (service: string) => {
    const known = apps.get(service);
    if (known !== undefined) return known;
    const fresh: FakeAppState = { user: '', password: '', up: true };
    apps.set(service, fresh);
    return fresh;
  };
  const app = await fakeHttpApp((request) => {
    const { method, path, headers } = request;
    const service = (headers.host ?? '').split(':')[0] ?? '';
    const state = stateOf(service);
    const keyed =
      headers['x-api-key'] !== undefined || headers.authorization !== undefined;
    if (service === 'qbittorrent' || service === 'gluetun') {
      if (path === '/') return { status: state.up ? 200 : 503, body: 'login page' };
      if (path === '/api/v2/app/version') {
        return keyed ? { status: 200, body: 'v5.2.4' } : { status: 403 };
      }
      return { status: 404 };
    }
    if (path === '/ping') return { status: state.up ? 200 : 503, body: { status: 'OK' } };
    if (path === '/login' && method === 'POST') {
      const form = new URLSearchParams(request.body);
      const ok =
        state.user !== '' &&
        form.get('username') === state.user &&
        form.get('password') === state.password;
      return {
        status: 302,
        headers: { Location: ok ? '/' : '/login?returnUrl=&loginFailed=true' },
      };
    }
    if (!keyed) return { status: 401 };
    if (/^\/api\/v[13]\/system\/status$/.test(path)) {
      return { status: 200, body: { version: '1.0.0' } };
    }
    if (/^\/api\/v[13]\/config\/host$/.test(path) && method === 'GET') {
      return { status: 200, body: { id: 1, username: state.user, password: '' } };
    }
    if (/^\/api\/v[13]\/config\/host\/1$/.test(path) && method === 'PUT') {
      const sent = JSON.parse(request.body) as { username: string; password: string };
      state.user = sent.username;
      state.password = sent.password;
      return { status: 202, body: {} };
    }
    return { status: 404 };
  });
  return {
    app,
    apps,
    seams: {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: { deadlineMs: 0 },
    },
    addresses: onWiring(['gluetun', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr']),
  };
}

/** What the fake Sonarr holds; a test may change it between calls. */
export interface FakeSonarrState {
  user: string;
  password: string;
  /** Its API key: anything else gets 401. Empty: any key will do. */
  key: string;
  /** false: /ping answers 503, as while it starts. */
  up: boolean;
}

/**
 * A fake Sonarr for WIRED_CATALOG: /ping, its key check, and the FAKE_LOGIN resource. The
 * seams send every app's calls to it, and never wait. It answers a key it refuses by
 * repeating it, so a test sees whether the key is kept out of what Mediaplane says.
 */
export async function fakeSonarr(state: Partial<FakeSonarrState> = {}): Promise<{
  app: FakeApp;
  state: FakeSonarrState;
  seams: WiringSeams;
  addresses: Record<string, string>;
}> {
  const held: FakeSonarrState = { user: '', password: '', key: '', up: true, ...state };
  const keyed = (headers: Record<string, unknown>) =>
    held.key === ''
      ? headers['x-api-key'] !== undefined
      : headers['x-api-key'] === held.key;
  const app = await fakeHttpApp((request) => {
    const { method, path, headers } = request;
    if (path === '/ping') return { status: held.up ? 200 : 503 };
    if (path === '/login' && method === 'POST') {
      const password = new URLSearchParams(request.body).get('password');
      const ok = held.user !== '' && password === held.password;
      return { status: 302, headers: { Location: ok ? '/' : '/login?loginFailed=true' } };
    }
    if (!keyed(headers)) {
      return { status: 401, body: `Unauthorized: ${String(headers['x-api-key'])}` };
    }
    if (path === '/api/v3/system/status') return { status: 200, body: { version: '4' } };
    if (path === '/api/v3/login' && method === 'GET') {
      return { status: 200, body: { user: held.user } };
    }
    if (path === '/api/v3/login' && method === 'PUT') {
      const sent = JSON.parse(request.body) as { user: string; password: string };
      held.user = sent.user;
      held.password = sent.password;
      return { status: 202, body: {} };
    }
    return { status: 404 };
  });
  return {
    app,
    state: held,
    seams: {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: { deadlineMs: 0 },
    },
    addresses: onWiring(['sonarr']),
  };
}
