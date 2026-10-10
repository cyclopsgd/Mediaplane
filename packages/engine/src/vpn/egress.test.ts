import { createServer, type RequestListener, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { egressAddress, fetchEgress, isEgressUrl } from './egress';

/** A local web server whose every request `handler` answers. */
async function serving(
  handler: RequestListener,
): Promise<{ url: string; server: Server }> {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { url: `http://127.0.0.1:${String(port)}/cdn-cgi/trace`, server };
}

/** A local web server answering every request with `status` and `body`. */
function answering(
  status: number,
  body: string,
): Promise<{ url: string; server: Server }> {
  return serving((_request, response) => {
    response.writeHead(status, { 'content-type': 'text/plain' });
    response.end(body);
  });
}

function close(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((done) => {
    server.close(() => {
      done();
    });
  });
}

describe('egressAddress', () => {
  it("reads the ip= line of Cloudflare's trace", () => {
    expect(egressAddress('fl=1f1\nh=1.1.1.1\nip=203.0.113.7\nts=1.2\n')).toBe(
      '203.0.113.7',
    );
    expect(egressAddress('ip=2001:db8::7\n')).toBe('2001:db8::7');
  });

  it('reads an answer that is only the address', () => {
    expect(egressAddress('198.51.100.2\n')).toBe('198.51.100.2');
  });

  it('finds nothing in an answer without a valid address', () => {
    for (const answer of ['', 'ip=\n', 'ip=203.0.113.999\n', '<html>blocked</html>']) {
      expect(egressAddress(answer), answer).toBeUndefined();
    }
  });
});

describe('isEgressUrl', () => {
  it('takes http and https URLs only', () => {
    expect(isEgressUrl('https://1.1.1.1/cdn-cgi/trace')).toBe(true);
    expect(isEgressUrl('http://192.0.2.10/cgi-bin/ip')).toBe(true);
    for (const url of ['', 'not a url', 'file:///etc/passwd', 'ftp://192.0.2.10/']) {
      expect(isEgressUrl(url), url).toBe(false);
    }
  });

  it('refuses a URL with a user name or a password in it', () => {
    for (const url of [
      'https://fake-user@192.0.2.10/ip',
      'https://fake-user:fake-pass@192.0.2.10/ip',
      'http://:fake-pass@192.0.2.10/ip',
    ]) {
      expect(isEgressUrl(url), url).toBe(false);
    }
  });
});

describe('fetchEgress', () => {
  it('asks the service, and reads the address it saw', async () => {
    const { url, server } = await answering(200, 'h=x\nip=127.0.0.1\n');
    try {
      expect(await fetchEgress(url)).toEqual({ ok: true, address: '127.0.0.1' });
    } finally {
      await close(server);
    }
  });

  it('stops reading after 16 KiB, so an answer that never ends still gets an answer', async () => {
    const { url, server } = await serving((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('x'.repeat(20_000));
    });
    try {
      expect(await fetchEgress(url, fetch, 1_000)).toEqual({
        ok: false,
        error: `${url} answered without an address`,
      });
    } finally {
      await close(server);
    }
  });

  it('never follows a redirect, even to a service that would answer', async () => {
    const target = await answering(200, 'ip=127.0.0.1\n');
    const { url, server } = await serving((_request, response) => {
      response.writeHead(302, { location: target.url });
      response.end();
    });
    try {
      expect(await fetchEgress(url)).toEqual({
        ok: false,
        error: `no answer from ${url}: unexpected redirect`,
      });
    } finally {
      await close(server);
      await close(target.server);
    }
  });

  it('gives up on an answer that drips in too slowly, whatever it has sent so far', async () => {
    const { url, server } = await serving((request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      const drip = setInterval(() => response.write('x'), 100);
      request.on('close', () => {
        clearInterval(drip);
      });
    });
    try {
      expect(await fetchEgress(url, fetch, 400)).toEqual({
        ok: false,
        error: `no answer from ${url}: nothing within 0.4 s`,
      });
    } finally {
      await close(server);
    }
  });

  it('reports an HTTP error, or an answer without an address', async () => {
    const refused = await answering(503, 'ip=127.0.0.1\n');
    const empty = await answering(200, 'nothing here\n');
    try {
      expect(await fetchEgress(refused.url)).toEqual({
        ok: false,
        error: `${refused.url} answered HTTP 503`,
      });
      expect(await fetchEgress(empty.url)).toEqual({
        ok: false,
        error: `${empty.url} answered without an address`,
      });
    } finally {
      await close(refused.server);
      await close(empty.server);
    }
  });

  it('reports no answer, with the network error or how long it waited', async () => {
    const url = 'http://192.0.2.10/';
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: new Error('connect ECONNREFUSED 192.0.2.10:80'),
    });
    expect(await fetchEgress(url, () => Promise.reject(refused))).toEqual({
      ok: false,
      error: `no answer from ${url}: connect ECONNREFUSED 192.0.2.10:80`,
    });
    const timeout = new DOMException('The operation was aborted', 'TimeoutError');
    expect(await fetchEgress(url, () => Promise.reject(timeout), 10_000)).toEqual({
      ok: false,
      error: `no answer from ${url}: nothing within 10 s`,
    });
    const other = new Error('fake: refused');
    expect(await fetchEgress(url, () => Promise.reject(other))).toEqual({
      ok: false,
      error: `no answer from ${url}: fake: refused`,
    });
    // Not even an Error: whatever it was, it is named.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    expect(await fetchEgress(url, () => Promise.reject('fake: not an error'))).toEqual({
      ok: false,
      error: `no answer from ${url}: fake: not an error`,
    });
  });

  it('reports an answer that has no body at all as one without an address', async () => {
    const url = 'http://192.0.2.10/';
    const empty = () => Promise.resolve(new Response(null, { status: 204 }));
    expect(await fetchEgress(url, empty)).toEqual({
      ok: false,
      error: `${url} answered without an address`,
    });
  });

  it("refuses to ask when Node's fetch would go through a proxy, and does not ask", async () => {
    const url = 'http://192.0.2.10/';
    const asked: string[] = [];
    const answer = () => {
      asked.push(url);
      return Promise.resolve(new Response('ip=198.51.100.2\n'));
    };
    expect(await fetchEgress(url, answer, 1_000, { NODE_USE_ENV_PROXY: '1' })).toEqual({
      ok: false,
      error:
        "the request would go through a proxy (NODE_USE_ENV_PROXY), so it can't see this host's own address",
    });
    expect(
      await fetchEgress(url, answer, 1_000, {
        NODE_OPTIONS: '--max-old-space-size=512 --use-env-proxy',
      }),
    ).toEqual({
      ok: false,
      error:
        "the request would go through a proxy (--use-env-proxy), so it can't see this host's own address",
    });
    expect(asked).toEqual([]);
    // Off, empty, or unrelated settings do not stop it.
    for (const env of [
      {},
      { NODE_USE_ENV_PROXY: '0' },
      { NODE_USE_ENV_PROXY: '' },
      { NODE_OPTIONS: '--max-old-space-size=512', HTTPS_PROXY: 'http://192.0.2.1:3128' },
    ]) {
      expect(await fetchEgress(url, answer, 1_000, env), JSON.stringify(env)).toEqual({
        ok: true,
        address: '198.51.100.2',
      });
    }
    expect(asked).toHaveLength(4);
  });
});
