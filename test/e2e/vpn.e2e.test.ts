import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeExec,
  nodeProbe,
  readSecretStore,
  type ExecResult,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { BUSYBOX, composeDown, makeHome } from './helpers';
import { startWireGuard, TUNNEL, type WireGuardServer } from './wireguard';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-vpn`;
/** qBittorrent's web UI port, moved off the default to check WEBUI_PORT behind Gluetun. */
const QBT_PORT = 8090;
/** Two documentation subnets (RFC 5737), to check Gluetun takes a comma-separated list. */
const OUTBOUND = ['192.0.2.0/24', '198.51.100.0/24'];

/**
 * qBittorrent behind Gluetun, Gluetun on the test's WireGuard server (Gluetun's `custom`
 * provider), and the media server every stack has. Gluetun's health checks aim at the
 * echo server, and its own DNS, public-IP and version lookups are off, so it needs no
 * internet. Values are JSON strings, which are valid YAML.
 */
function vpnStack(data: string, wg: WireGuardServer): string {
  const q = (value: string | number) => JSON.stringify(String(value));
  return `version: 1
user: { uid: ${String(process.getuid?.() ?? 1000)}, gid: ${String(process.getgid?.() ?? 1000)} }
paths: { data: ${q(data)} }
network: { bind: localhost }
media_server: jellyfin
vpn:
  provider: custom
  private_key: { file: secrets/wg.key }
  addresses: ${q(TUNNEL.client)}
apps:
  qbittorrent: { port: ${String(QBT_PORT)} }
  gluetun:
    env:
      WIREGUARD_ENDPOINT_IP: ${q(wg.gateway)}
      WIREGUARD_ENDPOINT_PORT: ${q(wg.endpointPort)}
      WIREGUARD_PUBLIC_KEY: ${q(wg.serverPublicKey)}
      HEALTH_TARGET_ADDRESSES: ${q(`${wg.echo}:80`)}
      HEALTH_ICMP_TARGET_IPS: ${q(wg.echo)}
      DNS_SERVER: "off"
      PUBLICIP_ENABLED: "off"
      VERSION_INFORMATION: "off"
      FIREWALL_OUTBOUND_SUBNETS: ${q(OUTBOUND.join(','))}
`;
}

/**
 * A command in a throwaway busybox container on `network`: a network name, or
 * `container:<id>` for a container's own namespace. `--init`, because busybox as PID 1
 * never stops a wget that hangs.
 */
function busybox(network: string, ...args: string[]): Promise<ExecResult> {
  return busyboxWith({}, network, ...args);
}

/**
 * `busybox` with extra `docker run` flags (`flags`) and the command's standard input
 * (`input`). Anything secret goes in `input`: arguments show in `ps` to every user.
 */
function busyboxWith(
  options: { flags?: string[]; input?: string },
  network: string,
  ...args: string[]
): Promise<ExecResult> {
  const { flags = [], input } = options;
  return nodeExec(
    'docker',
    [
      'run',
      '--rm',
      '--init',
      ...(input === undefined ? [] : ['-i']),
      ...flags,
      '--network',
      network,
      BUSYBOX,
      ...args,
    ],
    { cwd: '/', timeoutMs: 60_000, input },
  );
}

/** `wget` of `url` from `network`, giving up after 5 seconds. */
function fetchFrom(network: string, url: string): Promise<ExecResult> {
  return busybox(network, 'wget', '-T', '5', '-q', '-O', '-', url);
}

/** A raw HTTP/1.0 GET, for `nc`; `key` becomes the `X-API-Key` header. */
function rawGet(path: string, key?: string): string {
  const header = key === undefined ? [] : [`X-API-Key: ${key}`];
  return [`GET ${path} HTTP/1.0`, ...header, '', ''].join('\r\n');
}

/** The status in the raw HTTP answer `nc` printed, or 0 when there was no answer. */
function statusOf(result: ExecResult): number {
  return Number(/^HTTP\/1\.[01] (\d{3})/.exec(result.stdout)?.[1] ?? 0);
}

/** The body of the raw HTTP answer `nc` printed. */
function bodyOf(result: ExecResult): string {
  return result.stdout.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
}

describe('the VPN kill switch, against a local WireGuard server', () => {
  it('sends qBittorrent through the tunnel, and lets nothing out once the tunnel or Gluetun is down', async () => {
    const home = await makeHome();
    const wg = await startWireGuard(PROJECT);
    try {
      await writeFile(join(home, 'stack.yaml'), vpnStack(join(home, 'data'), wg));
      await mkdir(join(home, 'secrets'), { mode: 0o700 });
      await writeFile(join(home, 'secrets', 'wg.key'), `${wg.clientPrivateKey}\n`, {
        mode: 0o600,
      });
      const runtime = createDockerRuntime({ home, project: PROJECT });
      const applied = await apply({
        home,
        catalog,
        host: detectHostFacts(),
        env: process.env,
        runtime,
        probe: nodeProbe,
        confirm: () => Promise.resolve(true),
      });
      expect(applied.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(applied.outcome).toBe('success');

      // Gluetun's own health check gates qBittorrent (depends_on: service_healthy).
      const containers = await runtime.containers();
      expect(containers.map((c) => `${c.service} ${c.state} ${c.health}`).sort()).toEqual(
        [
          'gluetun running healthy',
          'jellyfin running healthy',
          'qbittorrent running healthy',
        ],
      );
      const gluetun = containers.find((c) => c.service === 'gluetun')?.id ?? 'missing';
      const qbittorrent =
        containers.find((c) => c.service === 'qbittorrent')?.id ?? 'missing';
      const inGluetun = `container:${gluetun}`;
      const inspect = await nodeExec(
        'docker',
        ['container', 'inspect', '--format', '{{.HostConfig.NetworkMode}}', qbittorrent],
        { cwd: '/' },
      );
      expect(inspect.stdout.trim()).toBe(inGluetun);

      // qBittorrent's web UI, on WEBUI_PORT inside Gluetun's namespace, answers on
      // localhost without FIREWALL_OUTBOUND_SUBNETS covering it.
      const ui = await fetch(`http://127.0.0.1:${String(QBT_PORT)}/`, {
        signal: AbortSignal.timeout(10_000),
      });
      expect(ui.status).toBe(200);

      // Gluetun's control server answers only with Mediaplane's key, and only the two
      // routes its role lists. The key goes in on stdin, never on a command line, and
      // never appears in a failure message.
      const key = (await readSecretStore(home)).apps.gluetun?.controlApiKey ?? '';
      expect(key !== '', 'no Gluetun control key stored').toBe(true);
      const control = (path: string, withKey: boolean) =>
        busyboxWith(
          { input: rawGet(path, withKey ? key : undefined) },
          inGluetun,
          'nc',
          '127.0.0.1',
          '8000',
        );
      expect(statusOf(await control('/v1/vpn/status', false))).toBe(401);
      const withKey = await control('/v1/vpn/status', true);
      expect(statusOf(withKey)).toBe(200);
      expect(bodyOf(withKey)).toBe('{"status":"running"}');
      expect(statusOf(await control('/v1/vpn/settings', true))).toBe(401);

      // The tunnel is up: the route is tun0, Gluetun took both outbound subnets, and the
      // echo sees the WireGuard server's address for qBittorrent, and the host's for us.
      const route = await busybox(inGluetun, 'ip', 'route', 'get', wg.echo);
      expect(route.stdout).toMatch(/ dev tun0 /);
      const routes = await busybox(inGluetun, 'ip', 'route', 'show', 'table', 'all');
      for (const subnet of OUTBOUND) expect(routes.stdout).toContain(`${subnet} via `);
      const echo = `http://${wg.echo}/cgi-bin/ip`;
      expect((await fetchFrom(inGluetun, echo)).stdout.trim()).toBe(`ip=${wg.exit}`);
      const fromHost = await fetch(echo, { signal: AbortSignal.timeout(10_000) });
      expect((await fromHost.text()).trim()).toBe(`ip=${wg.gateway}`);

      // The tunnel goes down. At once, nothing gets out of Gluetun's namespace, while an
      // ordinary container on the stack's network still reaches the same target.
      await wg.stop();
      const leak = `http://${wg.gateway}:${String(wg.leakPort)}/cgi-bin/ip`;
      expect((await fetchFrom(inGluetun, echo)).code).not.toBe(0);
      expect((await fetchFrom(inGluetun, leak)).code).not.toBe(0);
      const ordinary = await fetchFrom(`${PROJECT}_default`, leak);
      expect(ordinary.code, ordinary.stderr).toBe(0);
      expect(ordinary.stdout.trim()).toBe(`ip=${wg.gateway}`);
      expect((await busybox(inGluetun, 'ip', 'route', 'get', wg.echo)).stdout).toMatch(
        / dev tun0 /,
      );

      // The dead tunnel above swallows packets by itself, so it can't show the firewall
      // works. Take tun0 away, as if the VPN had lost its interface: the route now
      // leaves by eth0 (the control), and only Gluetun's firewall stands in the way.
      const deleted = await busyboxWith(
        { flags: ['--cap-add', 'NET_ADMIN'] },
        inGluetun,
        'ip',
        'link',
        'del',
        'tun0',
      );
      expect(deleted.code, deleted.stderr).toBe(0);
      const viaEth0 = await busybox(inGluetun, 'ip', 'route', 'get', wg.gateway);
      expect(viaEth0.stdout, viaEth0.stderr).toMatch(/ dev eth0 /);
      expect((await fetchFrom(inGluetun, leak)).code).not.toBe(0);

      // Gluetun stops: qBittorrent keeps running, with nothing but loopback.
      const stopped = await nodeExec('docker', ['stop', '-t', '5', gluetun], {
        cwd: '/',
      });
      expect(stopped.code, stopped.stderr).toBe(0);
      const inQbittorrent = `container:${qbittorrent}`;
      const links = await busybox(inQbittorrent, 'ip', '-o', 'link');
      expect(
        links.stdout
          .trim()
          .split('\n')
          .map((l) => l.split(':')[1]?.trim()),
      ).toEqual(['lo']);
      const unreachable = await fetchFrom(inQbittorrent, leak);
      expect(unreachable.code).not.toBe(0);
      expect(unreachable.stderr).toContain('Network is unreachable');
    } finally {
      const down = await composeDown(PROJECT);
      await wg.remove();
      expect(down.code, down.stderr).toBe(0);
    }
  }, 600_000);
});
