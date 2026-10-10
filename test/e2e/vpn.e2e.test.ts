import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import {
  apply,
  createDockerRuntime,
  detectHostFacts,
  nodeExec,
  nodeProbe,
  readSecretStore,
  type ApplyOptions,
  type ExecResult,
} from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  BUSYBOX,
  composeDown,
  deployMediaplane,
  expectWiringRemoved,
  makeHome,
  REPO,
  wiringMembers,
  type DeployedMediaplane,
} from './helpers';
import { startWireGuard, TUNNEL, type WireGuardServer } from './wireguard';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-vpn`;
/** qBittorrent's web UI port, moved off the default to check WEBUI_PORT behind Gluetun. */
const QBT_PORT = 8090;
/** Two documentation subnets (RFC 5737), to check Gluetun takes a comma-separated list. */
const OUTBOUND = ['192.0.2.0/24', '198.51.100.0/24'];
/** Verify's detail when it ran vpn-check's checks and found the VPN up. */
const VPN_UP =
  "no changes remain, and qBittorrent's network is Gluetun's, with the VPN up";

/** The ID of `service`'s container in `containers`. */
function idOf(containers: readonly { service: string; id: string }[], service: string) {
  return containers.find((c) => c.service === service)?.id ?? 'missing';
}

/** The network a container runs in: `container:<id>` for one in another's namespace. */
async function networkModeOf(container: string): Promise<string> {
  const inspect = await nodeExec(
    'docker',
    ['container', 'inspect', '--format', '{{.HostConfig.NetworkMode}}', container],
    { cwd: '/' },
  );
  expect(inspect.code, inspect.stderr).toBe(0);
  return inspect.stdout.trim();
}

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

const MAIN = join(REPO, 'packages', 'cli', 'src', 'main.ts');

/** `mediaplane vpn-check <args>`, run from source as a user would. */
function runVpnCheck(
  home: string,
  env: Record<string, string>,
  args: string[],
): Promise<ExecResult> {
  return nodeExec(
    process.execPath,
    ['--import', 'tsx', MAIN, 'vpn-check', '--home', home, ...args],
    {
      cwd: REPO,
      env: { ...process.env, MEDIAPLANE_COMPOSE_PROJECT: PROJECT, ...env },
      timeoutMs: 120_000,
    },
  );
}

/** `vpn-check --json <args>`: the checks and the verdict, for the test to read. */
function vpnCheck(
  home: string,
  env: Record<string, string>,
  ...args: string[]
): Promise<ExecResult> {
  return runVpnCheck(home, env, ['--json', ...args]);
}

/** `vpn-check <args>` as a person reads it: each check, then the summary line. */
function vpnCheckText(
  home: string,
  env: Record<string, string>,
  ...args: string[]
): Promise<ExecResult> {
  return runVpnCheck(home, env, args);
}

/** One check in `vpn-check --json`'s answer. */
interface CheckItem {
  id: string;
  status: string;
  message: string;
  hint?: string;
}

/** Each check vpn-check made, in the order it made them. */
function itemsOf(result: ExecResult): CheckItem[] {
  return (JSON.parse(result.stdout) as { checks: CheckItem[] }).checks;
}

/** Each check vpn-check made, as "<id> <status>". */
function checksOf(result: ExecResult): string[] {
  return itemsOf(result).map((c) => `${c.id} ${c.status}`);
}

/** The check with `id`, or an object saying there was none, so a test fails readably. */
function itemOf(result: ExecResult, id: string): CheckItem {
  return (
    itemsOf(result).find((c) => c.id === id) ?? {
      id,
      status: 'missing',
      message: `vpn-check made no ${id} check`,
    }
  );
}

describe('the VPN kill switch, against a local WireGuard server', () => {
  it('sends qBittorrent through the tunnel, and lets nothing out once the tunnel or Gluetun is down', async () => {
    const home = await makeHome();
    const wg = await startWireGuard(PROJECT);
    let deployed: DeployedMediaplane | undefined;
    /**
     * Every removal, each whether or not the one before it worked; what failed. Seven
     * commands, each bounded by TEARDOWN_MS (120 s): the test's timeout leaves room for
     * them after the body's 20 minutes.
     */
    const removeAll = async (): Promise<unknown[]> => {
      const failures: unknown[] = [];
      const attempt = async (removal: () => Promise<unknown>) => {
        try {
          await removal();
        } catch (failure) {
          failures.push(failure);
        }
      };
      await attempt(() => deployed?.remove() ?? Promise.resolve());
      await attempt(async () => {
        const down = await composeDown(PROJECT);
        expect(down.code, down.stderr).toBe(0);
      });
      // The deployed Mediaplane joined the wiring network, and went down first so the
      // stack's down could remove it.
      await attempt(() => expectWiringRemoved(PROJECT));
      await attempt(() => wg.remove());
      return failures;
    };
    try {
      await writeFile(join(home, 'stack.yaml'), vpnStack(join(home, 'data'), wg));
      await mkdir(join(home, 'secrets'), { mode: 0o700 });
      await writeFile(join(home, 'secrets', 'wg.key'), `${wg.clientPrivateKey}\n`, {
        mode: 0o600,
      });
      const runtime = createDockerRuntime({ home, project: PROJECT });
      const options: ApplyOptions = {
        home,
        catalog,
        host: detectHostFacts(),
        env: process.env,
        runtime,
        probe: nodeProbe,
        project: PROJECT,
        confirm: () => Promise.resolve(true),
      };
      const applied = await apply(options);
      expect(applied.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(applied.outcome).toBe('success');
      // Verify checked qBittorrent's key through Gluetun, from the host, on the wiring
      // network, and ran vpn-check's checks.
      expect(applied.actions.find((a) => a.step === 'verify')?.detail).toBe(VPN_UP);
      expect(await wiringMembers(PROJECT)).toEqual({
        internal: true,
        members: [`${PROJECT}-gluetun-1`],
      });

      // Gluetun's own health check gates qBittorrent (depends_on: service_healthy).
      const containers = await runtime.containers();
      expect(containers.map((c) => `${c.service} ${c.state} ${c.health}`).sort()).toEqual(
        [
          'gluetun running healthy',
          'jellyfin running healthy',
          'qbittorrent running healthy',
        ],
      );
      // Read again after the apply from the image, which can recreate them.
      let gluetun = idOf(containers, 'gluetun');
      let qbittorrent = idOf(containers, 'qbittorrent');
      let inGluetun = `container:${gluetun}`;
      expect(await networkModeOf(qbittorrent)).toBe(inGluetun);
      // vpn-check's hints name containers as <project>-<service>-1: these are the real names.
      const names = await nodeExec(
        'docker',
        ['container', 'inspect', '--format', '{{.Name}}', gluetun, qbittorrent],
        { cwd: '/' },
      );
      expect(names.stdout.trim().split('\n')).toEqual([
        `/${PROJECT}-gluetun-1`,
        `/${PROJECT}-qbittorrent-1`,
      ]);

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

      // vpn-check passes from source, and sees the two addresses.
      const toEcho = { MEDIAPLANE_VPN_CHECK_URL: echo };
      const compared = {
        verdict: 'pass',
        failClosed: false,
        egress: { url: echo, vpn: wg.exit, host: wg.gateway },
      };
      const bothAddresses = `qBittorrent's traffic leaves from ${wg.exit}, and this host's from ${wg.gateway}`;
      const passedJson = await vpnCheck(home, toEcho);
      expect(passedJson.code, passedJson.stdout + passedJson.stderr).toBe(0);
      expect(JSON.parse(passedJson.stdout)).toMatchObject(compared);
      expect(checksOf(passedJson)).toEqual([
        'network ok',
        'gluetun ok',
        'control ok',
        'control-key ok',
        'route ok',
        'egress ok',
      ]);
      expect(itemOf(passedJson, 'egress').message).toBe(bothAddresses);
      const passedText = await vpnCheckText(home, toEcho);
      expect(passedText.code, passedText.stdout + passedText.stderr).toBe(0);
      expect(passedText.stdout).toContain(
        'Passed: qBittorrent reaches the internet only through the VPN.',
      );

      // The owner's trial: Gluetun stopped by hand, then apply. Compose would only start
      // Gluetun, leaving qBittorrent with the network the old one had; apply restarts
      // qBittorrent into the new one, and verify finds the VPN up.
      const stoppedByHand = await nodeExec('docker', ['stop', '-t', '5', gluetun], {
        cwd: '/',
      });
      expect(stoppedByHand.code, stoppedByHand.stderr).toBe(0);
      const restarted = await apply(options);
      expect(restarted.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(restarted.outcome).toBe('success');
      expect(restarted.plan.containers).toEqual(
        expect.arrayContaining([
          { service: 'gluetun', action: 'start' },
          { service: 'qbittorrent', action: 'restart' },
        ]),
      );
      expect(restarted.actions.find((a) => a.step === 'start')?.detail).toBe(
        'every app is running and healthy; restarted qbittorrent',
      );
      expect(restarted.actions.find((a) => a.step === 'verify')?.result).toBe('done');
      // Started again, not recreated: every container is the one the first apply made.
      expect((await runtime.containers()).map((c) => c.id).sort()).toEqual(
        containers.map((c) => c.id).sort(),
      );
      const rejoined = await vpnCheck(home, {}, '--no-egress');
      expect(rejoined.code, rejoined.stdout + rejoined.stderr).toBe(0);
      expect(checksOf(rejoined)).toEqual([
        'network ok',
        'gluetun ok',
        'control ok',
        'control-key ok',
        'route ok',
      ]);
      expect((await apply(options)).outcome).toBe('no-changes');

      // From the image, behind the socket proxy. Its first apply recreates Jellyfin, for
      // a setting changed, so its verify always runs vpn-check's checks behind the proxy.
      // Where the host's Compose isn't the image's (CI's is 2.38), it recreates Gluetun
      // and qBittorrent too: the two hash the apps' bind volumes differently (ADR 0010).
      // Then the plan from the image has nothing to change, and the IDs are read again.
      deployed = await deployMediaplane({ home, stack: PROJECT });
      await writeFile(
        join(home, 'stack.yaml'),
        vpnStack(join(home, 'data'), wg).replace(
          'apps:\n',
          'apps:\n  jellyfin: { env: { FAKE_SETTING: "1" } }\n',
        ),
      );
      const inImageApply = await deployed.mediaplane(['apply', '--yes', '--json']);
      expect(inImageApply.code, inImageApply.stdout + inImageApply.stderr).toBe(0);
      const appliedInImage = JSON.parse(inImageApply.stdout) as {
        plan: { containers: { service: string; action: string }[] };
        actions: { step: string; detail?: string }[];
      };
      expect(appliedInImage.plan.containers).toContainEqual({
        service: 'jellyfin',
        action: 'recreate',
      });
      expect(appliedInImage.actions.find((a) => a.step === 'verify')?.detail).toBe(
        VPN_UP,
      );
      expect(await wiringMembers(PROJECT)).toEqual({
        internal: true,
        members: [`${PROJECT}-gluetun-1`, `${PROJECT}-mediaplane`],
      });
      const current = await runtime.containers();
      gluetun = idOf(current, 'gluetun');
      qbittorrent = idOf(current, 'qbittorrent');
      inGluetun = `container:${gluetun}`;
      expect(await networkModeOf(qbittorrent)).toBe(inGluetun);
      // vpn-check from the image sees the same two addresses as from source: its own
      // network has no route to the stack, so its probe runs inside qBittorrent's
      // namespace, and the host helper asks for the host's own address.
      const inImage = await deployed.mediaplane(['vpn-check', '--json'], toEcho);
      expect(inImage.code, inImage.stdout + inImage.stderr).toBe(0);
      expect(JSON.parse(inImage.stdout)).toMatchObject(compared);
      expect(checksOf(inImage)).toEqual(checksOf(passedJson));
      expect(itemOf(inImage, 'egress').message).toBe(bothAddresses);
      // Gluetun's firewall lets the wiring network reach qBittorrent's port: from its
      // image, behind the proxy, Mediaplane checks qBittorrent's key through Gluetun.
      const planned = await deployed.mediaplane(['plan', '--json']);
      expect(planned.code, planned.stdout + planned.stderr).toBe(0);
      expect(JSON.parse(planned.stdout)).toMatchObject({
        changed: false,
        wiring: [{ resource: 'qbittorrent', action: 'unchanged' }],
      });
      // Cleared first, so the teardown below doesn't try a failed removal again.
      const done = deployed;
      deployed = undefined;
      await done.remove();

      // The tunnel goes down. At once, with the route still into tun0, vpn-check finds the
      // VPN down, and that nothing leaks: a route into the tunnel can't get out around it.
      // Gluetun's health check restarts the dead tunnel every few seconds, and for a moment
      // in each restart the route can leave by Gluetun's own network. That is not the
      // state under test, so a `route down` caught in it is asked again; a leak never is.
      await wg.stop();
      let deadTunnel = await vpnCheck(home, toEcho);
      for (
        let again = 0;
        itemOf(deadTunnel, 'route').status === 'down' && again < 2;
        again++
      ) {
        deadTunnel = await vpnCheck(home, toEcho);
      }
      expect(deadTunnel.code, deadTunnel.stdout + deadTunnel.stderr).toBe(1);
      expect(itemOf(deadTunnel, 'route').message).toBe(
        "qBittorrent's traffic is routed into the tunnel (tun0)",
      );
      expect(JSON.parse(deadTunnel.stdout)).toMatchObject({
        verdict: 'down',
        failClosed: true,
        egress: { url: echo, vpn: null, host: null },
      });
      expect(checksOf(deadTunnel).at(-1)).toBe('egress down');
      expect(itemOf(deadTunnel, 'egress').hint).toContain('(fail-closed)');

      // Nothing gets out of Gluetun's namespace, while an ordinary container on the
      // stack's network still reaches the same target.
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
      // leaves by one of Gluetun's own networks (the control), and only Gluetun's
      // firewall stands in the way. Gluetun is on two, the stack's and the wiring one,
      // and Docker names their interfaces (eth0, eth1) in no fixed order.
      const deleted = await busyboxWith(
        { flags: ['--cap-add', 'NET_ADMIN'] },
        inGluetun,
        'ip',
        'link',
        'del',
        'tun0',
      );
      expect(deleted.code, deleted.stderr).toBe(0);
      const viaEth = await busybox(inGluetun, 'ip', 'route', 'get', wg.gateway);
      expect(viaEth.stdout, viaEth.stderr).toMatch(/ dev eth\d+ /);
      expect((await fetchFrom(inGluetun, leak)).code).not.toBe(0);

      // vpn-check finds the VPN down: nothing answers, so no address is known. Gluetun's
      // health check may have rebuilt tun0 by now, so it says that nothing leaks only as
      // the route it reports allows: into the tunnel or nowhere, yes; by Gluetun's own
      // network, where only the firewall stands in the way and nothing measured it, no.
      const tunnelDown = await vpnCheck(home, toEcho);
      expect(tunnelDown.code, tunnelDown.stdout + tunnelDown.stderr).toBe(1);
      const reported = itemOf(tunnelDown, 'route');
      const shut =
        reported.status === 'ok' ||
        reported.message === "qBittorrent's network has no route out";
      expect(JSON.parse(tunnelDown.stdout)).toMatchObject({
        verdict: 'down',
        failClosed: shut,
        egress: { url: echo, vpn: null, host: null },
      });
      expect(checksOf(tunnelDown).at(-1)).toBe('egress down');
      expect(itemOf(tunnelDown, 'egress').hint?.includes('(fail-closed)')).toBe(shut);
      // The same in text: the summary follows the route line of its own run.
      const tunnelDownText = await vpnCheckText(home, toEcho);
      expect(tunnelDownText.code, tunnelDownText.stdout).toBe(1);
      const shutText =
        tunnelDownText.stdout.includes(
          "  ok    qBittorrent's traffic is routed into the tunnel (tun0)\n",
        ) || tunnelDownText.stdout.includes("qBittorrent's network has no route out\n");
      expect(tunnelDownText.stdout).toContain('\nVPN down: ');
      expect(tunnelDownText.stdout.includes('nothing leaks (fail-closed)')).toBe(
        shutText,
      );

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
      const gluetunDown = await vpnCheck(home, {}, '--no-egress');
      expect(gluetunDown.code, gluetunDown.stdout + gluetunDown.stderr).toBe(1);
      expect(checksOf(gluetunDown)).toEqual(['network ok', 'gluetun down']);
      expect(JSON.parse(gluetunDown.stdout)).toMatchObject({
        verdict: 'down',
        failClosed: true,
      });
      expect(itemOf(gluetunDown, 'gluetun').message).toBe(
        'Gluetun is exited, so qBittorrent has no network: nothing gets out',
      );

      // Gluetun starts again on its own, without Mediaplane's key file, as one from before
      // Slice 3a that was never restarted. vpn-check says that its control server answers
      // without a key, and that qBittorrent, which kept running, still holds the network
      // the old Gluetun had: it has none.
      const auth = join(home, 'appdata', 'gluetun', 'auth', 'config.toml');
      await rename(auth, `${auth}.aside`);
      const started = await nodeExec('docker', ['start', gluetun], { cwd: '/' });
      expect(started.code, started.stderr).toBe(0);
      for (
        let attempt = 0;
        statusOf(await control('/v1/vpn/status', false)) !== 200;
        attempt++
      ) {
        expect(attempt, "Gluetun's control server never answered").toBeLessThan(30);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const open = await vpnCheck(home, {}, '--no-egress');
      expect(open.code, open.stdout + open.stderr).toBe(1);
      expect(JSON.parse(open.stdout)).toMatchObject({ verdict: 'down' });
      expect(checksOf(open)).toContain('network down');
      expect(checksOf(open)).toContain('control-key warning');
      expect(itemOf(open, 'network').hint).toBe(
        `run "mediaplane apply", which restarts it (or "docker restart ${PROJECT}-qbittorrent-1")`,
      );
      expect(itemOf(open, 'control-key').hint).toContain(
        `"docker restart ${PROJECT}-gluetun-1", then "docker restart ${PROJECT}-qbittorrent-1"`,
      );
    } catch (failure) {
      // The body's own failure is the one to show: a removal that fails too is only logged.
      for (const removal of await removeAll())
        console.error('teardown failed too:', removal);
      throw failure;
    }
    const failures = await removeAll();
    if (failures.length > 0) throw new AggregateError(failures, 'teardown failed');
  }, 2_040_000);
});
