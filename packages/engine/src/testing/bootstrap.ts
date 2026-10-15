import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Bootstrap, Catalog } from '../catalog/types';
import type { AppApi } from '../http/client';
import type { WiringSeams } from '../integrations/wiring';
import { FIXTURE_API, fixtureCatalog } from './fixtures';
import { fakeHttpApp, type FakeApp } from './http';

/** The key the fake setup makes. */
export const SET_UP_KEY = '9'.repeat(32);

/** Whether FAKE_SETUP's app can still be claimed. */
async function open(api: AppApi): Promise<boolean> {
  return !(await api.get('/setup', z.looseObject({ done: z.boolean() }))).done;
}

/**
 * A first-run setup shaped like Jellyfin's: open until a POST of /setup finishes it, as
 * the admin, which makes the app's key (GET /key) and writes setup.txt in its appdata.
 */
export const FAKE_SETUP: Bootstrap = {
  secret: 'apiKey',
  done: { path: 'setup.txt', pattern: /^done$/m },
  open,
  async run(api, admin) {
    if (await open(api)) await api.submit('POST', '/setup', { user: admin.username });
    return (await api.get('/key', z.looseObject({ key: z.string() }))).key;
  },
};

/** The fixture catalog, with Jellyfin given an API, a key it makes, and FAKE_SETUP. */
export const SET_UP_CATALOG: Catalog = fixtureCatalog.map((def) =>
  def.id === 'jellyfin'
    ? {
        ...def,
        api: { ...FIXTURE_API, ready: '/ready', check: '/check' },
        secrets: { apiKey: { createdBy: 'app' } },
        bootstrap: FAKE_SETUP,
      }
    : def,
);

/** What the app behind FAKE_SETUP holds; a test may change it between calls. */
export interface FakeSetUpState {
  /** Whether its setup is done. */
  done: boolean;
  /** Its key, once its setup made one. */
  key: string;
  /** Refuse the setup's POST with this message (400). Empty: take it. */
  refuse: string;
  /** Fail GET /key, with a 500. */
  keyFails: boolean;
  /** Who the setup was finished as. */
  admin: string;
}

/**
 * The app behind FAKE_SETUP, as Jellyfin of the stack in `home`: /ready, /setup (its
 * state, and a POST that finishes it), /key, and /check, which takes only its key. A
 * finished setup writes appdata/jellyfin/setup.txt, as Jellyfin writes its system.xml.
 * `addresses` put Jellyfin's fake container on the wiring network, and `seams` send its
 * calls here.
 */
export async function fakeSetUpApp(home: string): Promise<{
  app: FakeApp;
  state: FakeSetUpState;
  seams: WiringSeams;
  addresses: Record<string, string>;
}> {
  const state: FakeSetUpState = {
    done: false,
    key: '',
    refuse: '',
    keyFails: false,
    admin: '',
  };
  const app = await fakeHttpApp((request) => {
    const { method, path, headers } = request;
    if (path === '/ready') return { status: 200 };
    if (path === '/setup' && method === 'GET') {
      return { status: 200, body: { done: state.done } };
    }
    if (path === '/setup' && method === 'POST') {
      if (state.refuse !== '') return { status: 400, body: { message: state.refuse } };
      state.admin = (JSON.parse(request.body) as { user: string }).user;
      state.done = true;
      state.key = SET_UP_KEY;
      writeFileSync(join(home, 'appdata', 'jellyfin', 'setup.txt'), 'done\n');
      return { status: 204 };
    }
    if (path === '/key') {
      return state.keyFails
        ? { status: 500, body: { message: 'fake failure' } }
        : { status: 200, body: { key: state.key } };
    }
    if (path === '/check') {
      return {
        status: state.key !== '' && headers['x-api-key'] === state.key ? 200 : 401,
      };
    }
    return { status: 404 };
  });
  return {
    app,
    state,
    seams: {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: { deadlineMs: 0 },
    },
    addresses: { 'fake-jellyfin': '127.0.0.1' },
  };
}
