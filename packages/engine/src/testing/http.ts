import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { onTestFinished } from 'vitest';

/** A request the fake app received. */
export interface FakeRequest {
  method: string;
  /** With the query string. */
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/** What the fake app answers: a status, a body (an object is sent as JSON), headers. */
export interface FakeReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** Answers a request, or 'hang' to never answer it. */
export type FakeHandler = (
  request: FakeRequest,
) => FakeReply | 'hang' | Promise<FakeReply | 'hang'>;

/** A fake app, listening on 127.0.0.1. It stops when the test that made it finishes. */
export interface FakeApp {
  port: number;
  /** Every request, in order. */
  requests: FakeRequest[];
}

/**
 * Start a fake app on a free port of 127.0.0.1, answering with `handler`. Call it while a
 * test runs, from the test or a helper it calls.
 */
export async function fakeHttpApp(handler: FakeHandler): Promise<FakeApp> {
  const requests: FakeRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request: FakeRequest = {
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(request);
      void Promise.resolve(handler(request)).then((reply) => {
        if (reply === 'hang') return;
        const text =
          reply.body === undefined
            ? ''
            : typeof reply.body === 'string'
              ? reply.body
              : JSON.stringify(reply.body);
        res.writeHead(reply.status, {
          ...(typeof reply.body === 'object'
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...reply.headers,
        });
        res.end(text);
      });
    });
  });
  await new Promise<void>((listening) => {
    server.listen(0, '127.0.0.1', listening);
  });
  onTestFinished(
    () =>
      new Promise<void>((closed) => {
        server.closeAllConnections();
        server.close(() => {
          closed();
        });
      }),
  );
  return { port: (server.address() as AddressInfo).port, requests };
}

/** A port on 127.0.0.1 where nothing listens: connecting to it is refused. */
export async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((listening) => {
    server.listen(0, '127.0.0.1', listening);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((closed) => {
    server.close(() => {
      closed();
    });
  });
  return port;
}

/**
 * One call to a fake app of fakeStackApis, as `init.host` (its Host header, which tells
 * the apps apart): its status, its body (as JSON when it is), and the first cookie it set,
 * if any. A body given is sent as JSON.
 */
export function callFake(
  port: number,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    host?: string;
  } = {},
): Promise<{ status: number; body: unknown; cookie: string | undefined }> {
  const text = init.body === undefined ? undefined : JSON.stringify(init.body);
  return new Promise((resolve, reject) => {
    const sent = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: init.method ?? (text === undefined ? 'GET' : 'POST'),
        headers: {
          host: init.host ?? 'localhost',
          ...(text === undefined ? {} : { 'content-type': 'application/json' }),
          ...init.headers,
        },
      },
      (reply) => {
        const chunks: Buffer[] = [];
        reply.on('data', (chunk: Buffer) => chunks.push(chunk));
        reply.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let body: unknown = raw;
          try {
            body = JSON.parse(raw) as unknown;
          } catch {
            // Plain text, as some apps' refusals are.
          }
          const cookie = reply.headers['set-cookie']?.[0];
          resolve({ status: reply.statusCode ?? 0, body, cookie });
        });
      },
    );
    sent.on('error', reject);
    sent.end(text);
  });
}
