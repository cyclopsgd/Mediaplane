import { generateKeyPairSync } from 'node:crypto';
import { access, chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeExec } from '@mediaplane/engine';
import { BUSYBOX, removeAsRoot } from './helpers';

/**
 * The WireGuard server that stands in for a VPN provider in the kill-switch test (spec
 * §8.1(4)). It needs the host's wireguard kernel module: it has no userspace fallback.
 */
export const WIREGUARD =
  'lscr.io/linuxserver/wireguard:1.0.20260223-r0-ls123@sha256:33c5e4260f5ddf9376fcb6f1ff90c0ccc3c63d2ab469595e33d178ecf8a4c4c6';

/** The tunnel: the server's address on it, and Gluetun's (`vpn.addresses`). */
export const TUNNEL = { server: '10.66.0.1/24', client: '10.66.0.2/32' } as const;

/**
 * A stand-in for the internet: a network of its own, outside the stack, holding the
 * WireGuard server and an echo server that answers `ip=<the caller's address>`, as
 * Cloudflare's /cdn-cgi/trace does. The host reaches the echo directly, and the stack
 * reaches it only through the tunnel, so the echo sees a different address for each.
 */
export interface WireGuardServer {
  /** The network's gateway: an address of the host, where the two ports are published. */
  gateway: string;
  /** The server's UDP port on the gateway: Gluetun's endpoint. */
  endpointPort: number;
  serverPublicKey: string;
  /** Gluetun's private key, for `vpn.private_key`. */
  clientPrivateKey: string;
  /** The echo server's own address, reachable from the host and through the tunnel. */
  echo: string;
  /** The echo, published on the gateway: a target any container on the host reaches. */
  leakPort: number;
  /** The server's address on the network: what the echo sees for traffic from the tunnel. */
  exit: string;
  /** Stop the server, as a VPN provider going away would. */
  stop(): Promise<void>;
  /** Remove both containers, the network and the files. Safe to call more than once. */
  remove(): Promise<void>;
}

/** An X25519 key pair in WireGuard's base64, from Node alone: no `wg` tool needed. */
export function wireguardKeys(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const base64 = (field: string | undefined) =>
    Buffer.from(field ?? '', 'base64url').toString('base64');
  return {
    privateKey: base64(privateKey.export({ format: 'jwk' }).d),
    publicKey: base64(publicKey.export({ format: 'jwk' }).x),
  };
}

async function docker(...args: string[]): Promise<string> {
  const result = await nodeExec('docker', args, { cwd: '/', timeoutMs: 120_000 });
  if (result.code !== 0) {
    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed:\n${result.stderr}`);
  }
  return result.stdout.trim();
}

/** The host port Docker chose for a container's `port` (such as "51820/udp"). */
async function publishedPort(container: string, port: string): Promise<number> {
  const output = await docker('port', container, port);
  const [first] = output.split('\n');
  const published = Number(first?.split(':').at(-1));
  if (!Number.isInteger(published) || published < 1 || published > 65535) {
    throw new Error(`docker port ${container} ${port} gave no host port:\n${output}`);
  }
  return published;
}

/**
 * A removal that must not fail silently: a non-zero exit is an error, unless stderr says
 * the thing was already gone ("No such container", or "network … not found").
 */
async function removeOrIgnoreMissing(...args: string[]): Promise<void> {
  const result = await nodeExec('docker', args, { cwd: '/', timeoutMs: 120_000 });
  if (result.code !== 0 && !/No such|not found/.test(result.stderr)) {
    throw new Error(`docker ${args.slice(0, 2).join(' ')} failed:\n${result.stderr}`);
  }
}

async function addressOn(container: string, network: string): Promise<string> {
  return docker(
    'inspect',
    '--format',
    `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
    container,
  );
}

/** Fail, never skip, when the host can't run the server: CI loads the module first. */
async function requireWireGuardModule(): Promise<void> {
  try {
    await access('/sys/module/wireguard');
  } catch {
    throw new Error(
      'the wireguard kernel module is not loaded, and the test WireGuard server needs it: run "sudo modprobe wireguard" (CI does this in its e2e job)',
    );
  }
}

/** Start the server and the echo, as `<id>-wgserver` and `<id>-echo` on `<id>-wan`. */
export async function startWireGuard(id: string): Promise<WireGuardServer> {
  await requireWireGuardModule();
  const network = `${id}-wan`;
  const server = `${id}-wgserver`;
  const echoName = `${id}-echo`;
  const dir = await mkdtemp(join(tmpdir(), 'mediaplane-e2e-wg-'));
  let removed = false;
  const remove = async () => {
    if (removed) return;
    removed = true;
    // Every removal runs, even when one before it fails; the failures are reported after.
    const failures: unknown[] = [];
    for (const step of [
      () => removeOrIgnoreMissing('rm', '-f', '-v', server, echoName),
      () => removeOrIgnoreMissing('network', 'rm', network),
      // The server's image writes into its /config as root.
      () => removeAsRoot(dir),
    ]) {
      try {
        await step();
      } catch (failure) {
        failures.push(failure);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `could not remove all of ${id}'s WireGuard server`,
      );
    }
  };
  try {
    const serverKeys = wireguardKeys();
    const clientKeys = wireguardKeys();
    await mkdir(join(dir, 'wg_confs'), { recursive: true });
    await writeFile(
      join(dir, 'wg_confs', 'wg0.conf'),
      [
        '[Interface]',
        `Address = ${TUNNEL.server}`,
        'ListenPort = 51820',
        `PrivateKey = ${serverKeys.privateKey}`,
        `PostUp = iptables -t nat -A POSTROUTING -s ${TUNNEL.server} -j MASQUERADE`,
        `PostDown = iptables -t nat -D POSTROUTING -s ${TUNNEL.server} -j MASQUERADE`,
        '',
        '[Peer]',
        `PublicKey = ${clientKeys.publicKey}`,
        `AllowedIPs = ${TUNNEL.client}`,
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    // Busybox httpd gives REMOTE_ADDR as [::ffff:a.b.c.d]; answer a.b.c.d. The header
    // ends in CRLF, which Node's fetch insists on.
    await mkdir(join(dir, 'www', 'cgi-bin'), { recursive: true });
    const cgi = join(dir, 'www', 'cgi-bin', 'ip');
    await writeFile(
      cgi,
      [
        '#!/bin/sh',
        'addr=${REMOTE_ADDR#[}',
        'addr=${addr%]}',
        'printf \'Content-Type: text/plain\\r\\n\\r\\nip=%s\\n\' "${addr#::ffff:}"',
        '',
      ].join('\n'),
    );
    await chmod(cgi, 0o755);

    await docker('network', 'create', network);
    const gateway = await docker(
      'network',
      'inspect',
      '--format',
      '{{range .IPAM.Config}}{{.Gateway}}{{end}}',
      network,
    );
    // --init: busybox httpd as PID 1 would not stop on SIGTERM.
    await docker(
      'run',
      '-d',
      '--init',
      '--name',
      echoName,
      '--network',
      network,
      '-p',
      `${gateway}::80`,
      '-v',
      `${join(dir, 'www')}:/www:ro`,
      BUSYBOX,
      'httpd',
      '-f',
      '-p',
      '80',
      '-h',
      '/www',
    );
    await docker(
      'run',
      '-d',
      '--name',
      server,
      '--network',
      network,
      '-p',
      `${gateway}::51820/udp`,
      '--cap-add',
      'NET_ADMIN',
      '--sysctl',
      'net.ipv4.ip_forward=1',
      '--sysctl',
      'net.ipv4.conf.all.src_valid_mark=1',
      '-e',
      `PUID=${String(process.getuid?.() ?? 1000)}`,
      '-e',
      `PGID=${String(process.getgid?.() ?? 1000)}`,
      '-e',
      'TZ=Etc/UTC',
      '-v',
      `${dir}:/config`,
      WIREGUARD,
    );
    // The image's init brings wg0 up from /config/wg_confs; wait until it has.
    for (let attempt = 0; ; attempt++) {
      const up = await nodeExec('docker', ['exec', server, 'wg', 'show', 'wg0'], {
        cwd: '/',
      });
      if (up.code === 0) break;
      if (attempt === 60) {
        const logs = await nodeExec('docker', ['logs', '--tail', '30', server], {
          cwd: '/',
        });
        throw new Error(
          `the WireGuard server did not bring wg0 up:\n${logs.stdout}${logs.stderr}`,
        );
      }
      await new Promise((done) => setTimeout(done, 1000));
    }
    return {
      gateway,
      endpointPort: await publishedPort(server, '51820/udp'),
      serverPublicKey: serverKeys.publicKey,
      clientPrivateKey: clientKeys.privateKey,
      echo: await addressOn(echoName, network),
      leakPort: await publishedPort(echoName, '80/tcp'),
      exit: await addressOn(server, network),
      stop: async () => {
        await docker('stop', '-t', '2', server);
      },
      remove,
    };
  } catch (cause) {
    try {
      await remove();
    } catch (cleanup) {
      throw new AggregateError(
        [cause, cleanup],
        'the WireGuard server failed to start, and cleaning up failed too',
        { cause: cleanup },
      );
    }
    throw cause;
  }
}
