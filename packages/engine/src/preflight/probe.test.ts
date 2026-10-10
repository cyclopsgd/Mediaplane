import { createSocket } from 'node:dgram';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { nodeProbe } from './probe';
import { tempDir } from '../testing/temp';

describe('nodeProbe.stat', () => {
  it('describes a directory', async () => {
    const dir = await tempDir('mediaplane-probe-');
    expect(await nodeProbe.stat(dir)).toMatchObject({
      isDirectory: true,
      isCharacterDevice: false,
    });
  });

  it('recognises a character device', async () => {
    expect(await nodeProbe.stat('/dev/null')).toMatchObject({ isCharacterDevice: true });
  });

  it('is undefined for a missing path', async () => {
    expect(await nodeProbe.stat('/nonexistent/mediaplane')).toBeUndefined();
  });
});

describe('nodeProbe.freeBytes', () => {
  it('reports free space, or undefined for a missing path', async () => {
    expect(await nodeProbe.freeBytes(tmpdir())).toBeGreaterThan(0);
    expect(await nodeProbe.freeBytes('/nonexistent/mediaplane')).toBeUndefined();
  });
});

describe('nodeProbe.portFree', () => {
  it('sees a TCP port another listener holds, and sees it free again after', async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    expect(await nodeProbe.portFree('127.0.0.1', port, 'tcp')).toBe(false);
    await new Promise<void>((done) => {
      server.close(() => {
        done();
      });
    });
    expect(await nodeProbe.portFree('127.0.0.1', port, 'tcp')).toBe(true);
  });

  it('sees a UDP port another socket holds', async () => {
    const socket = createSocket('udp4');
    await new Promise<void>((done) => socket.bind(0, '127.0.0.1', done));
    const { port } = socket.address();
    expect(await nodeProbe.portFree('127.0.0.1', port, 'udp')).toBe(false);
    await new Promise<void>((done) => {
      socket.close(() => {
        done();
      });
    });
  });

  it("can't tell for an address that is not on this host", async () => {
    expect(await nodeProbe.portFree('203.0.113.77', 8989, 'tcp')).toBeUndefined();
  });
});
