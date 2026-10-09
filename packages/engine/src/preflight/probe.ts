import { createSocket } from 'node:dgram';
import { stat, statfs } from 'node:fs/promises';
import { createServer } from 'node:net';

export interface PathStat {
  isDirectory: boolean;
  isCharacterDevice: boolean;
  uid: number;
  gid: number;
  mode: number;
  /** Filesystem (device) id: equal for paths on the same filesystem. */
  dev: number;
}

/** What preflight needs to know about the host. Tests swap in fakeProbe(). */
export interface HostProbe {
  stat(path: string): Promise<PathStat | undefined>;
  freeBytes(path: string): Promise<number | undefined>;
  /** true = free, false = in use, undefined = can't tell (e.g. not an address of this host). */
  portFree(
    address: string,
    port: number,
    protocol: 'tcp' | 'udp',
  ): Promise<boolean | undefined>;
}

export const nodeProbe: HostProbe = {
  async stat(path) {
    try {
      const s = await stat(path);
      return {
        isDirectory: s.isDirectory(),
        isCharacterDevice: s.isCharacterDevice(),
        uid: s.uid,
        gid: s.gid,
        mode: s.mode,
        dev: s.dev,
      };
    } catch {
      return undefined;
    }
  },
  async freeBytes(path) {
    try {
      const s = await statfs(path);
      return s.bavail * s.bsize;
    } catch {
      return undefined;
    }
  },
  portFree(address, port, protocol) {
    return protocol === 'udp' ? udpPortFree(address, port) : tcpPortFree(address, port);
  },
};

function tcpPortFree(address: string, port: number): Promise<boolean | undefined> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolvePromise(error.code === 'EADDRINUSE' ? false : undefined);
    });
    server.listen({ host: address, port, exclusive: true }, () => {
      server.close(() => {
        resolvePromise(true);
      });
    });
  });
}

function udpPortFree(address: string, port: number): Promise<boolean | undefined> {
  return new Promise((resolvePromise) => {
    const socket = createSocket('udp4');
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.close();
      resolvePromise(error.code === 'EADDRINUSE' ? false : undefined);
    });
    socket.bind({ address, port, exclusive: true }, () => {
      socket.close(() => {
        resolvePromise(true);
      });
    });
  });
}
