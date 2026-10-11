import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { fakeStackApis, freshAppState } from './wiring';

/** One request to the fake apps' port, as the app named in the Host header. */
function send(
  port: number,
  host: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          host,
          ...(body === undefined
            ? {}
            : { 'content-type': 'application/x-www-form-urlencoded' }),
          ...headers,
        },
      },
      (reply) => {
        const chunks: Buffer[] = [];
        reply.on('data', (chunk: Buffer) => chunks.push(chunk));
        reply.on('end', () => {
          resolve({
            status: reply.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    sent.on('error', reject);
    sent.end(body);
  });
}

const BEARER = { authorization: `Bearer qbt_${'0'.repeat(28)}` };

describe("fakeStackApis' qBittorrent", () => {
  it('refuses X-Api-Key, with or without a key set, as qBittorrent does', async () => {
    const apis = await fakeStackApis();
    const version = '/api/v2/app/version';
    const call = (headers: Record<string, string>) =>
      send(apis.app.port, 'gluetun:8080', version, headers);
    expect((await call({ 'x-api-key': 'anything' })).status).toBe(403);
    expect((await call({})).status).toBe(403);
    expect((await call(BEARER)).status).toBe(200);
    // With a key set, only that key, as a Bearer token.
    apis.apps.set('qbittorrent', { ...freshAppState(), key: `qbt_${'0'.repeat(28)}` });
    expect((await call({ 'x-api-key': `qbt_${'0'.repeat(28)}` })).status).toBe(403);
    expect((await call({ authorization: `Bearer qbt_${'1'.repeat(28)}` })).status).toBe(
      403,
    );
    expect((await call(BEARER)).status).toBe(200);
  });

  it("keeps each whitelisted subnet as its network address, as qBittorrent's does", async () => {
    // Set "192.168.1.10/24\n10.1.2.3/8", qBittorrent 5.2 gives "192.168.1.0/24\n10.0.0.0/8".
    const apis = await fakeStackApis();
    const set = await send(
      apis.app.port,
      'qbittorrent:8080',
      '/api/v2/app/setPreferences',
      BEARER,
      new URLSearchParams({
        json: JSON.stringify({
          bypass_auth_subnet_whitelist: '192.168.1.10/24\n10.1.2.3/8',
        }),
      }).toString(),
    );
    expect(set.status).toBe(200);
    const preferences = await send(
      apis.app.port,
      'qbittorrent:8080',
      '/api/v2/app/preferences',
      BEARER,
    );
    expect(
      (JSON.parse(preferences.body) as Record<string, unknown>)
        .bypass_auth_subnet_whitelist,
    ).toBe('192.168.1.0/24\n10.0.0.0/8');
  });
});
