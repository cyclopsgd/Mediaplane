import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { SetupWaiting } from '../apply/bootstrap';
import type { Bootstrap, Catalog } from '../catalog/types';
import { AppApiError, type AppApi } from '../http/client';
import type { WiringSeams } from '../integrations/wiring';
import { FIXTURE_API, fixtureCatalog } from './fixtures';
import { fakeHttpApp, type FakeApp, type FakeReply, type FakeRequest } from './http';

/** The key the fake setup makes. */
export const SET_UP_KEY = '9'.repeat(32);

/** Whether FAKE_SETUP's app can still be claimed. */
async function open(api: AppApi): Promise<boolean> {
  return !(await api.get('/setup', z.looseObject({ done: z.boolean() }))).done;
}

/**
 * A first-run setup shaped like Jellyfin's: open until a POST of /setup finishes it, as
 * the admin, which makes the app's key (GET /key) and writes setup.txt in its appdata.
 * The admin signs in (POST /signin) before the key: a setup finished as someone else
 * refuses it (401).
 */
export const FAKE_SETUP: Bootstrap = {
  secret: 'apiKey',
  done: { path: 'setup.txt', pattern: /^done$/m },
  open,
  async run(api, admin) {
    if (await open(api)) await api.submit('POST', '/setup', { user: admin.username });
    const session = await api.signIn(
      '/signin',
      { user: admin.username, password: admin.password },
      z.looseObject({ token: z.string() }),
      [admin.password],
    );
    if (session === undefined) {
      throw new AppApiError(
        `${api.name} at ${api.where} refused the shared admin's sign-in (POST /signin)`,
        { kind: 'auth', status: 401 },
      );
    }
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

/** Whether FAKE_SIGN_IN's app can still be claimed. */
async function signInOpen(api: AppApi): Promise<boolean> {
  return !(await api.get('/signed-in', z.looseObject({ done: z.boolean() }))).done;
}

/**
 * Who FAKE_SIGN_IN's app belongs to: the first to sign in, as Seerr's admin is its first
 * user. A later sign-in only adds a user.
 */
async function ownerOf(api: AppApi): Promise<string | null> {
  return (
    await api.get('/signed-in/own', z.looseObject({ owner: z.string().nullable() }))
  ).owner;
}

/**
 * A first-run setup shaped like Seerr's: it makes no key (the app's is Mediaplane's
 * own), and is open until the shared admin signs in through Jellyfin (POST /sign-in,
 * which keeps the session in the cookie `sid` and writes signed-in.txt in its appdata),
 * then signs out. It waits (SetupWaiting) while that sign-in is refused, as Seerr's does
 * while Jellyfin refuses the shared admin. Done already, it is asked who it belongs to,
 * with the key and never the password, as Seerr's is (GET /signed-in/own): the first to
 * sign in has to be the shared admin, else it is refused (`auth`), as an app set up by
 * someone else.
 */
export const FAKE_SIGN_IN: Bootstrap = {
  done: { path: 'signed-in.txt', pattern: /^yes$/m },
  open: signInOpen,
  async run(api, admin, stack) {
    if (!(await signInOpen(api))) {
      if ((await ownerOf(api)) === admin.username) return undefined;
      throw new AppApiError(
        `${api.name} at ${api.where} was set up with another login (GET /signed-in/own)`,
        { kind: 'auth' },
      );
    }
    const through = stack.apps.find((app) => app.def.id === 'jellyfin')?.def.id;
    const session = await api.session(
      '/sign-in',
      { user: admin.username, password: admin.password, through },
      'sid',
      [admin.password],
    );
    if (session === undefined) {
      throw new SetupWaiting(
        `${api.name} at ${api.where} can't sign in yet: Jellyfin refused the shared admin (POST /sign-in)`,
      );
    }
    await session.submit('POST', '/sign-out');
    return undefined;
  },
};

/**
 * SET_UP_CATALOG, with Sonarr given FAKE_SIGN_IN, after Jellyfin, an API of its own and
 * no resource.
 */
export const SIGN_IN_CATALOG: Catalog = SET_UP_CATALOG.map((def) =>
  def.id === 'sonarr'
    ? {
        ...def,
        api: { ...FIXTURE_API, ready: '/ready', check: '/check' },
        integration: { after: ['jellyfin'], resources: [] },
        bootstrap: FAKE_SIGN_IN,
      }
    : def,
);

/** What the app behind FAKE_SIGN_IN holds; a test may change it between calls. */
export interface FakeSignInState {
  /** Whether the shared admin has signed in, which is its setup. */
  done: boolean;
  /** Refuse the sign-in (401), as Jellyfin refusing the shared admin makes Seerr. */
  refuse: boolean;
  /**
   * With `refuse`: someone else signs in first, so the setup is done (signed-in.txt
   * written) by the time the sign-in is refused.
   */
  claimant: boolean;
  /** Answer /ready with 503, as an app that is slow to start does. */
  notReady: boolean;
  /** Who the app belongs to (its admin, the first user): undefined until it is set up. */
  owner?: string;
  /** Its sessions' cookies, until signed out. */
  sessions: string[];
  /** Who signed in, as each sign-in named them, and through what. */
  signedIn: { user: string; through: string }[];
}

/**
 * The app behind FAKE_SIGN_IN, as Sonarr of the stack in `home`: /ready, /signed-in,
 * /sign-in, /sign-out, and /check, which takes any key.
 */
function fakeSignInApp(
  request: FakeRequest,
  state: FakeSignInState,
  home: string,
): FakeReply {
  const { method, path, headers } = request;
  if (path === '/ready') return { status: state.notReady ? 503 : 200 };
  if (path === '/signed-in') return { status: 200, body: { done: state.done } };
  if (path === '/signed-in/own') {
    // Asked with the app's key, as the setup of an app that is set up already is.
    if (headers['x-api-key'] === undefined) return { status: 401 };
    return { status: 200, body: { owner: state.owner ?? null } };
  }
  if (path === '/sign-in' && method === 'POST') {
    if (state.refuse) {
      if (state.claimant) {
        state.done = true;
        state.owner = 'someone';
        writeFileSync(join(home, 'appdata', 'sonarr', 'signed-in.txt'), 'yes\n');
      }
      return { status: 401 };
    }
    const { user, through } = JSON.parse(request.body) as {
      user: string;
      through: string;
    };
    state.signedIn.push({ user, through });
    // The first to sign in is the admin; a later sign-in only adds a user.
    state.owner ??= user;
    state.done = true;
    writeFileSync(join(home, 'appdata', 'sonarr', 'signed-in.txt'), 'yes\n');
    const cookie = `fake-sid-${String(state.signedIn.length)}`;
    state.sessions.push(cookie);
    return {
      status: 200,
      body: {},
      headers: { 'Set-Cookie': `sid=${cookie}; Path=/; HttpOnly` },
    };
  }
  if (path === '/sign-out' && method === 'POST') {
    const cookie = /^sid=(.*)$/.exec(headers.cookie ?? '')?.[1];
    if (cookie === undefined || !state.sessions.includes(cookie)) return { status: 401 };
    state.sessions = state.sessions.filter((s) => s !== cookie);
    return { status: 200 };
  }
  if (path === '/check')
    return { status: headers['x-api-key'] === undefined ? 401 : 200 };
  return { status: 404 };
}

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
  /** Who the setup was finished as: POST /signin refuses anyone else (401). */
  admin: string;
  /** Fail GET /setup, with a 500: the app can't say whether it is open. */
  openFails: boolean;
  /** Take the setup's POST, and make the key, but leave the app open all the same. */
  staysOpen: boolean;
  /** Once it has a key, fail GET /setup with a 500 whose message holds the key. */
  echoKey: boolean;
}

/**
 * The app behind FAKE_SETUP, as Jellyfin of the stack in `home`: /ready, /setup (its
 * state, and a POST that finishes it), /signin, /key, and /check, which takes only its
 * key. A finished setup writes appdata/jellyfin/setup.txt, as Jellyfin writes its
 * system.xml. Called as Sonarr (its Host header), it is the app behind FAKE_SIGN_IN, with
 * `signIn` its state.
 * `addresses` put Jellyfin's and Sonarr's fake containers on the wiring network, and
 * `seams` send their calls here.
 */
export async function fakeSetUpApp(home: string): Promise<{
  app: FakeApp;
  state: FakeSetUpState;
  signIn: FakeSignInState;
  seams: WiringSeams;
  addresses: Record<string, string>;
}> {
  const signIn: FakeSignInState = {
    done: false,
    refuse: false,
    claimant: false,
    notReady: false,
    sessions: [],
    signedIn: [],
  };
  const state: FakeSetUpState = {
    done: false,
    key: '',
    refuse: '',
    keyFails: false,
    admin: '',
    openFails: false,
    staysOpen: false,
    echoKey: false,
  };
  const app = await fakeHttpApp((request) => {
    const { method, path, headers } = request;
    if ((headers.host ?? '').startsWith('sonarr:')) {
      return fakeSignInApp(request, signIn, home);
    }
    if (path === '/ready') return { status: 200 };
    if (path === '/setup' && method === 'GET') {
      if (state.echoKey && state.key !== '') {
        return { status: 500, body: { message: `fake failure with ${state.key}` } };
      }
      return state.openFails
        ? { status: 500, body: { message: 'fake failure' } }
        : { status: 200, body: { done: state.done } };
    }
    if (path === '/setup' && method === 'POST') {
      if (state.refuse !== '') return { status: 400, body: { message: state.refuse } };
      state.admin = (JSON.parse(request.body) as { user: string }).user;
      state.done = !state.staysOpen;
      state.key = SET_UP_KEY;
      writeFileSync(join(home, 'appdata', 'jellyfin', 'setup.txt'), 'done\n');
      return { status: 204 };
    }
    if (path === '/signin' && method === 'POST') {
      const { user } = JSON.parse(request.body) as { user: string };
      return state.admin === '' || state.admin === user
        ? { status: 200, body: { token: 'fake-session' } }
        : { status: 401 };
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
    signIn,
    seams: {
      endpoint: () => ({ host: '127.0.0.1', port: app.port }),
      retry: { deadlineMs: 0 },
    },
    addresses: { 'fake-jellyfin': '127.0.0.1', 'fake-sonarr': '127.0.0.1' },
  };
}
