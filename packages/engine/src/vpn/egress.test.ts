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
      expect(await fetchEgress(url, fetch, 5_000)).toEqual({
        ok: false,
        error: `${url} answered without an address`,
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
  });
});
