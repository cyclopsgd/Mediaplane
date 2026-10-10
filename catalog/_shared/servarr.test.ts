import { createAppApi, type DesiredResource } from '@mediaplane/engine';
import { fakeHttpApp, type FakeRequest } from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { servarrAdmin } from './servarr';

const KEY = '0'.repeat(32);
const PASSWORD = 'fake-admin-password';

/**
 * Part of what Sonarr 4.0.20 answers to GET /api/v3/config/host, with fake values: the
 * key in clear, and the password as a hash once there is a user.
 */
const HOST = {
  id: 1,
  bindAddress: '*',
  port: 8989,
  urlBase: '',
  authenticationMethod: 'forms',
  authenticationRequired: 'enabled',
  analyticsEnabled: true,
  username: '',
  password: '',
  passwordConfirmation: '',
  apiKey: KEY,
  trustedNetworks: '',
  allowedHosts: '',
};

const DESIRED: DesiredResource = {
  name: 'admin',
  fields: { username: 'admin' },
  secrets: { password: PASSWORD },
};

/** A fake Sonarr whose host settings start as `host`, and whose login takes `password`. */
async function sonarr(host: Record<string, unknown> = HOST) {
  let settings = { ...host };
  const app = await fakeHttpApp((request: FakeRequest) => {
    if (request.path === '/api/v3/config/host' && request.method === 'GET') {
      return { status: 200, body: settings };
    }
    if (request.path === '/api/v3/config/host/1' && request.method === 'PUT') {
      const sent = JSON.parse(request.body) as Record<string, unknown>;
      settings = { ...sent, password: 'fake-hash==', passwordConfirmation: '' };
      return { status: 202, body: settings };
    }
    if (request.path === '/login' && request.method === 'POST') {
      const form = new URLSearchParams(request.body);
      const ok =
        form.get('username') === settings.username && form.get('password') === PASSWORD;
      return {
        status: 302,
        headers: { Location: ok ? '/' : '/login?returnUrl=&loginFailed=true' },
      };
    }
    return { status: 404 };
  });
  const api = createAppApi({
    name: 'Sonarr',
    service: 'sonarr',
    port: 8989,
    endpoint: { host: '127.0.0.1', port: app.port },
    key: { scheme: 'x-api-key', value: KEY },
    secrets: [KEY, PASSWORD],
    retry: { deadlineMs: 0 },
  });
  return { api, app };
}

describe('servarrAdmin', () => {
  const admin = servarrAdmin('v3');

  it('manages the user name, and keeps the password a secret', () => {
    expect(admin).toMatchObject({
      name: 'admin',
      fields: ['username'],
      secrets: ['password'],
    });
  });

  it('finds no admin while the app has no user', async () => {
    const { api } = await sonarr();
    expect(await admin.observe(api, undefined)).toBeUndefined();
  });

  it('sets the login through the host settings, sending the rest back as it came', async () => {
    const { api, app } = await sonarr();
    expect(await admin.create(api, DESIRED)).toEqual({ id: null });
    const put = app.requests.find((r) => r.method === 'PUT');
    expect(put?.path).toBe('/api/v3/config/host/1');
    expect(JSON.parse(put?.body ?? '{}')).toEqual({
      ...HOST,
      username: 'admin',
      password: PASSWORD,
      passwordConfirmation: PASSWORD,
    });
    expect(await admin.observe(api, undefined)).toEqual({
      id: null,
      name: 'admin',
      fields: { username: 'admin' },
    });
  });

  it('checks the password by signing in with it, without the API key', async () => {
    const { api, app } = await sonarr({ ...HOST, username: 'admin' });
    expect(await admin.verify?.(api, DESIRED)).toBe(true);
    expect(
      await admin.verify?.(api, { ...DESIRED, secrets: { password: 'other' } }),
    ).toBe(false);
    const login = app.requests.find((r) => r.path === '/login');
    expect(login?.headers['x-api-key']).toBeUndefined();
  });

  it('does not take a refusal for a sign-in when the client redacted the redirect', async () => {
    // The client redacts the password wherever it appears in the Location, so a password
    // that is part of "loginFailed" turns the refusal's redirect into
    // /login?returnUrl=&login***ed=true: a redirect that no longer says it failed.
    const { api } = await sonarr({ ...HOST, username: 'admin' });
    expect(await admin.verify?.(api, { ...DESIRED, secrets: { password: 'Fail' } })).toBe(
      false,
    );
  });

  it('changes a user name that differs', async () => {
    const { api } = await sonarr({ ...HOST, username: 'someone' });
    const observed = await admin.observe(api, undefined);
    expect(observed?.fields).toEqual({ username: 'someone' });
    if (observed === undefined) throw new Error('no admin observed');
    await admin.update(api, DESIRED, observed);
    expect((await admin.observe(api, undefined))?.fields).toEqual({ username: 'admin' });
  });

  it("uses Prowlarr's /api/v1", async () => {
    const app = await fakeHttpApp((request) =>
      request.path === '/api/v1/config/host'
        ? { status: 200, body: { ...HOST, username: 'admin' } }
        : { status: 404 },
    );
    const api = createAppApi({
      name: 'Prowlarr',
      service: 'prowlarr',
      port: 9696,
      endpoint: { host: '127.0.0.1', port: app.port },
      key: { scheme: 'x-api-key', value: KEY },
      secrets: [KEY],
    });
    expect((await servarrAdmin('v1').observe(api, undefined))?.fields).toEqual({
      username: 'admin',
    });
  });

  it('wants the shared admin login', () => {
    expect(
      admin.desired({
        admin: { username: 'media-admin', password: PASSWORD },
      } as Parameters<typeof admin.desired>[0]),
    ).toEqual({
      name: 'admin',
      fields: { username: 'media-admin' },
      secrets: { password: PASSWORD },
    });
  });
});
