import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECRETS_PATH } from '../paths';
import {
  RuntimeError,
  type ContainerState,
  type OneOffCommand,
  type Runtime,
} from '../runtime/types';
import {
  FAKE_GLUETUN_ID as GLUETUN_ID,
  FAKE_QBITTORRENT_ID as QBITTORRENT_ID,
  fakeContainer as container,
  fakeProbeRuntime,
  probeOutput,
  type FakeRuntimeOptions,
  type ProbeAnswers as Answers,
} from '../testing/fakes';
import { FIXTURE_HOST, fixtureCatalog } from '../testing/fixtures';
import { tempDir } from '../testing/temp';
import { vpnCheck, type VpnCheckOptions } from './check';
import type { EgressResult } from './egress';

const KEY = '0'.repeat(32);
const TRACE = 'https://1.1.1.1/cdn-cgi/trace';
const SONARR_ID = 'c'.repeat(64);

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: custom, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
`;

async function homeWith({ stack = STACK, key = true } = {}): Promise<string> {
  const home = await tempDir('mediaplane-vpn-check-');
  await writeFile(join(home, 'stack.yaml'), stack);
  await mkdir(join(home, 'state'));
  const apps = key ? { gluetun: { controlApiKey: KEY } } : {};
  await writeFile(join(home, SECRETS_PATH), JSON.stringify({ version: 1, apps }));
  return home;
}

const HEALTHY: Answers = {
  route: [0, '1.1.1.1 dev tun0  src 10.66.0.2 '],
  anonymous: [0, '401'],
  status: [0, '{"status":"running"}\n200'],
  publicip: [0, '{"public_ip":""}\n200'],
  egress: [0, 'fl=1\nip=203.0.113.7\n'],
};

interface Setup {
  answers?: Answers;
  host?: EgressResult;
  egress?: boolean;
  url?: string;
  /** The Compose project; "mediaplane" unless the test says otherwise. */
  project?: string;
  /** For the fake Docker: containers, details, a run of its own… */
  runtime?: FakeRuntimeOptions;
  /** Methods that replace the fake's own. */
  replace?: Partial<Runtime>;
}

/** vpnCheck against a fake Docker; the probe answers `answers` (or HEALTHY). */
async function checkWith(home: string, setup: Setup = {}) {
  const calls: string[] = [];
  const sent: OneOffCommand[] = [];
  const asked: string[] = [];
  const fake = fakeProbeRuntime(setup.answers ?? HEALTHY, sent, {
    calls,
    ...setup.runtime,
  });
  const runtime: Runtime = { ...fake, ...setup.replace };
  const options: VpnCheckOptions = {
    home,
    catalog: fixtureCatalog,
    host: FIXTURE_HOST,
    env: {},
    runtime,
    project: setup.project ?? 'mediaplane',
    ...((setup.egress ?? true)
      ? {
          egress: {
            url: setup.url ?? TRACE,
            fromHost: (url) => {
              asked.push(url);
              return Promise.resolve(setup.host ?? { ok: true, address: '198.51.100.2' });
            },
          },
        }
      : {}),
  };
  return { result: await vpnCheck(options), calls, sent, asked };
}

const statuses = (result: Awaited<ReturnType<typeof vpnCheck>>) =>
  result.ok ? result.checks.map((c) => `${c.id} ${c.status}`) : [];

/** Gluetun and qBittorrent, as `fakeProbeRuntime` has them, changed by `qbittorrent`. */
const withQbittorrent = (qbittorrent: Partial<ContainerState>): ContainerState[] => [
  container('gluetun', GLUETUN_ID),
  container('qbittorrent', QBITTORRENT_ID, qbittorrent),
];

describe('vpnCheck', () => {
  it('passes when qBittorrent gets out only through the tunnel, from another address', async () => {
    const { result, calls, sent, asked } = await checkWith(await homeWith());
    expect(result).toMatchObject({
      ok: true,
      verdict: 'pass',
      egress: { url: TRACE, vpn: '203.0.113.7', host: '198.51.100.2' },
      gluetunPublicIp: null,
      failClosed: false,
    });
    expect(statuses(result)).toEqual([
      'network ok',
      'gluetun ok',
      'control ok',
      'control-key ok',
      'route ok',
      'egress ok',
    ]);
    expect(calls).toEqual([
      'containers',
      `inspect ${QBITTORRENT_ID} ${GLUETUN_ID}`,
      'run qbittorrent sh as 65534:65534',
    ]);
    // The key goes in on stdin, and the probe asks the control port and the URL.
    expect(sent[0]?.input).toBe(`${KEY}\n`);
    expect(sent[0]?.args.slice(2)).toEqual(['vpn-check', '8000', TRACE]);
    expect(sent[0]?.args.join(' ')).not.toContain(KEY);
    expect(asked).toEqual([TRACE]);
  });

  it('hides every secret of the stack in what the probe prints, not just the key', async () => {
    const home = await homeWith();
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key\n');
    const { sent } = await checkWith(home);
    expect(sent[0]?.values).toEqual({
      MP_GLUETUN_WIREGUARD_KEY: 'fake-wireguard-key',
      controlApiKey: KEY,
    });
  });

  it('hides the secrets in what the probe printed in base64, too', async () => {
    // run() can't see into the probe's base64, so vpnCheck has parseProbe replace them.
    const home = await homeWith();
    await mkdir(join(home, 'secrets'));
    await writeFile(join(home, 'secrets', 'wg.key'), 'fake-wireguard-key\n');
    const answers: Answers = {
      ...HEALTHY,
      egress: [7, `curl: (7) ${KEY} fake-wireguard-key`],
    };
    const { result } = await checkWith(home, { answers });
    expect(result.ok && result.checks.at(-1)?.message).toBe(
      `qBittorrent's traffic got no answer from ${TRACE}: curl: (7) *** ***`,
    );
  });

  it('checks the structure only with --no-egress, and asks no one for an address', async () => {
    const answers: Answers = {
      ...HEALTHY,
      publicip: [0, '{"public_ip":"203.0.113.7"}\n200'],
    };
    const { result, sent, asked } = await checkWith(await homeWith(), {
      egress: false,
      answers,
    });
    expect(result).toMatchObject({
      ok: true,
      verdict: 'pass',
      egress: null,
      gluetunPublicIp: '203.0.113.7',
    });
    expect(statuses(result)).toEqual([
      'network ok',
      'gluetun ok',
      'control ok',
      'control-key ok',
      'route ok',
    ]);
    expect(sent[0]?.args.at(-1)).toBe('');
    expect(asked).toEqual([]);
  });

  it("finds a leak when qBittorrent leaves from the host's own address", async () => {
    const { result } = await checkWith(await homeWith(), {
      host: { ok: true, address: '203.0.113.7' },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'leak' });
    expect(result.ok && result.checks.at(-1)).toMatchObject({
      id: 'egress',
      status: 'leak',
      message:
        "qBittorrent's traffic leaves from 203.0.113.7, which is this host's own address: it does not go through the VPN",
      hint: 'see docs/runbooks/vpn-down.md',
    });
  });

  it('finds a leak when the two sides spell the same address differently', async () => {
    for (const [vpn, host] of [
      ['2001:db8::7', '2001:DB8::7'],
      ['2001:db8::7', '2001:db8:0:0::7'],
      ['203.0.113.7', '::ffff:203.0.113.7'],
      ['::FFFF:CB00:7107', '203.0.113.7'],
      // A zone can't go in a URL, so it is compared in lower case.
      ['fe80::1%eth0', 'FE80::1%eth0'],
    ] as const) {
      const { result } = await checkWith(await homeWith(), {
        answers: { ...HEALTHY, egress: [0, `ip=${vpn}\n`] },
        host: { ok: true, address: host },
      });
      expect(result).toMatchObject({ ok: true, verdict: 'leak', egress: { vpn, host } });
      expect(statuses(result).at(-1)).toBe('egress leak');
    }
  });

  it('passes when two IPv6 addresses differ', async () => {
    const { result } = await checkWith(await homeWith(), {
      answers: { ...HEALTHY, egress: [0, 'ip=2001:db8::7\n'] },
      host: { ok: true, address: '2001:db8::2' },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'pass' });
    expect(statuses(result).at(-1)).toBe('egress ok');
  });

  it('finds the VPN down, and closed, when nothing answers through the tunnel; the host is not asked', async () => {
    const answers: Answers = {
      ...HEALTHY,
      egress: [28, 'curl: (28) Connection timed out after 10002 milliseconds'],
    };
    const { result, asked } = await checkWith(await homeWith(), { answers });
    expect(result).toMatchObject({
      ok: true,
      verdict: 'down',
      egress: { url: TRACE, vpn: null, host: null },
      failClosed: true,
    });
    expect(result.ok && result.checks.at(-1)).toMatchObject({
      id: 'egress',
      status: 'down',
      message: `qBittorrent's traffic got no answer from ${TRACE}: curl: (28) Connection timed out after 10002 milliseconds`,
      hint: 'the VPN is down, and nothing gets out (fail-closed); see docs/runbooks/vpn-down.md',
    });
    expect(asked).toEqual([]);
  });

  it('finds no answer when curl could not reach a server, or timed out before it connected', async () => {
    for (const output of [
      'curl: (7) Failed to connect to 1.1.1.1 port 443 after 3 ms: Could not connect to server',
      'curl: (6) Could not resolve host: echo.example',
      'curl: (28) Connection timed out after 10001 milliseconds',
      'curl: (28) Resolving timed out after 10001 milliseconds',
    ]) {
      const exit = Number(/\((\d+)\)/.exec(output)?.[1]);
      const answers: Answers = { ...HEALTHY, egress: [exit, output] };
      const { result } = await checkWith(await homeWith(), { answers });
      expect(result).toMatchObject({ ok: true, verdict: 'down', failClosed: true });
      expect(result.ok && result.checks.at(-1)).toMatchObject({
        id: 'egress',
        status: 'down',
        message: `qBittorrent's traffic got no answer from ${TRACE}: ${output}`,
      });
    }
  });

  /**
   * An answer curl couldn't finish, with the egress check's `exit` and `output`: through the
   * tunnel, a pass that warns and is never closed; with the route out of the tunnel, a leak.
   */
  async function expectUnreadAnswer(exit: number, output: string): Promise<void> {
    const answers: Answers = { ...HEALTHY, egress: [exit, output] };
    const { result, asked } = await checkWith(await homeWith(), { answers });
    expect(result).toMatchObject({
      ok: true,
      verdict: 'pass',
      egress: { url: TRACE, vpn: null, host: null },
      failClosed: false,
    });
    expect(result.ok && result.checks.at(-1)).toMatchObject({
      id: 'egress',
      status: 'warning',
      message: `${TRACE} answered qBittorrent, but its answer could not be read (curl exited ${String(exit)}), so the addresses were not compared`,
    });
    expect(asked).toEqual([]);

    // The same answer, with the route out of the tunnel, left outside the VPN.
    const leaked = await checkWith(await homeWith(), {
      answers: {
        ...answers,
        route: [0, '1.1.1.1 via 172.20.0.1 dev eth0  src 172.20.0.2'],
      },
    });
    expect(leaked.result).toMatchObject({ ok: true, verdict: 'leak', failClosed: false });
    expect(statuses(leaked.result)).toContain('route leak');
  }

  it("counts an answer curl couldn't finish as an answer: something got out", async () => {
    // curl exits 63 for a body over --max-filesize and 52 for an empty reply: each after a
    // server answered, so the tunnel's way out isn't shut.
    await expectUnreadAnswer(63, 'curl: (63) Maximum file size exceeded');
    await expectUnreadAnswer(52, 'curl: (52) Empty reply from server');
  });

  it('counts a timeout once curl was connected as an answer, wherever its error line falls', async () => {
    // The probe merges curl's stderr into its stdout, and curl prints its error line
    // before it flushes the body it buffered (curl 8.5.0, a 20-byte body):
    await expectUnreadAnswer(
      28,
      'curl: (28) Operation timed out after 2002 milliseconds with 20 out of 100 bytes received\nfl=1\nip=203.0.113.7\n',
    );
    // A body larger than stdout's 4096-byte buffer is flushed in part first, so the error
    // line starts in the middle of a line (curl 8.5.0, a 6000-byte body):
    await expectUnreadAnswer(
      28,
      `${'x'.repeat(4096)}curl: (28) Operation timed out after 2002 milliseconds with 6000 bytes received\n${'x'.repeat(1903)}\n`,
    );
    // "Operation timed out" comes only after the connection was up, even with no byte back.
    await expectUnreadAnswer(
      28,
      'curl: (28) Operation timed out after 10001 milliseconds with 0 bytes received',
    );
    await expectUnreadAnswer(
      28,
      'curl: (28) Operation timed out after 10001 milliseconds with 0 out of 900 bytes received',
    );
  });

  it('passes on the structure, with a warning, when the host gets no answer', async () => {
    for (const error of [
      `no answer from ${TRACE}: nothing within 10 s`,
      "the request would go through a proxy (NODE_USE_ENV_PROXY), so it can't see this host's own address",
    ]) {
      const { result } = await checkWith(await homeWith(), {
        host: { ok: false, error },
      });
      expect(result).toMatchObject({
        ok: true,
        verdict: 'pass',
        egress: { url: TRACE, vpn: '203.0.113.7', host: null },
        failClosed: false,
      });
      expect(result.ok && result.checks.at(-1)).toMatchObject({
        id: 'egress',
        status: 'warning',
        message: `qBittorrent's traffic leaves from 203.0.113.7, but this host could not ask ${TRACE} for its own address (${error}), so the two were not compared`,
      });
    }
  });

  it('warns, without comparing, when the tunnel side answers without an address', async () => {
    // An empty answer is still an answer: something got out, so it is not fail-closed.
    for (const output of ['<html>blocked</html>', '']) {
      const answers: Answers = { ...HEALTHY, egress: [0, output] };
      const { result, asked } = await checkWith(await homeWith(), { answers });
      expect(result).toMatchObject({
        ok: true,
        verdict: 'pass',
        egress: { url: TRACE, vpn: null, host: null },
        failClosed: false,
      });
      expect(result.ok && result.checks.at(-1)).toMatchObject({
        id: 'egress',
        status: 'warning',
        message: `${TRACE} answered qBittorrent without an address, so the addresses were not compared`,
      });
      expect(asked).toEqual([]);
    }
  });

  it('warns, without comparing, when one side answered over IPv4 and the other over IPv6', async () => {
    const { result } = await checkWith(await homeWith(), {
      host: { ok: true, address: '2001:db8::2' },
    });
    expect(result).toMatchObject({
      ok: true,
      verdict: 'pass',
      egress: { url: TRACE, vpn: '203.0.113.7', host: '2001:db8::2' },
    });
    expect(result.ok && result.checks.at(-1)).toMatchObject({
      id: 'egress',
      status: 'warning',
      message:
        "qBittorrent's traffic leaves from 203.0.113.7, and this host's from 2001:db8::2: one IPv4 and one IPv6 address, so the two were not compared",
    });
  });

  it('finds a leak when qBittorrent has a network of its own', async () => {
    const { result } = await checkWith(await homeWith(), {
      runtime: { details: { [QBITTORRENT_ID]: { networkMode: 'mediaplane_default' } } },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'leak' });
    expect(statuses(result)[0]).toBe('network leak');
  });

  it("finds a leak when qBittorrent uses another app's network, even with --no-egress", async () => {
    const { result } = await checkWith(await homeWith(), {
      egress: false,
      runtime: {
        containers: [...withQbittorrent({}), container('sonarr', SONARR_ID)],
        details: { [QBITTORRENT_ID]: { networkMode: `container:${SONARR_ID}` } },
      },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'leak', failClosed: false });
    expect(result.ok && result.checks[0]).toMatchObject({
      status: 'leak',
      message:
        "qBittorrent uses sonarr's network, not Gluetun's: its traffic does not go through the VPN",
    });
  });

  it('finds the VPN down when qBittorrent holds the network of an earlier Gluetun', async () => {
    // Gluetun restarted on its own, after qBittorrent: the probe would join Gluetun's new
    // network and pass, while qBittorrent itself has none.
    // In a project of another name, such as MEDIAPLANE_COMPOSE_PROJECT's, the hint names
    // that project's container.
    const { result } = await checkWith(await homeWith(), {
      project: 'mediaplane-dev',
      runtime: {
        details: {
          [QBITTORRENT_ID]: { networkMode: `container:${GLUETUN_ID}` },
          [GLUETUN_ID]: { startedAt: '2026-10-10T10:05:00Z' },
        },
      },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'down', failClosed: false });
    expect(result.ok && result.checks[0]).toMatchObject({
      status: 'down',
      hint: 'restart qBittorrent: "docker restart mediaplane-dev-qbittorrent-1"',
    });
  });

  it("never calls it closed when the probe measured a network qBittorrent doesn't hold", async () => {
    // The probe joins Gluetun's current network; a stranded qBittorrent holds another.
    const { result } = await checkWith(await homeWith(), {
      answers: { ...HEALTHY, egress: [7, 'curl: (7) Failed to connect'] },
      runtime: {
        details: {
          [QBITTORRENT_ID]: { networkMode: `container:${GLUETUN_ID}` },
          [GLUETUN_ID]: { startedAt: '2026-10-10T10:05:00Z' },
        },
      },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'down', failClosed: false });
    expect(result.ok && result.checks.at(-1)).toMatchObject({
      id: 'egress',
      status: 'down',
      hint: 'the VPN is down; see docs/runbooks/vpn-down.md',
    });
    expect(JSON.stringify(result)).not.toContain('nothing gets out');
  });

  it("finds the VPN down when it can't read when qBittorrent or Gluetun started", async () => {
    for (const unreadable of [QBITTORRENT_ID, GLUETUN_ID]) {
      const { result } = await checkWith(await homeWith(), {
        runtime: {
          details: {
            [QBITTORRENT_ID]: { networkMode: `container:${GLUETUN_ID}` },
            [unreadable]: {
              ...(unreadable === QBITTORRENT_ID
                ? { networkMode: `container:${GLUETUN_ID}` }
                : {}),
              startedAt: 'not-a-time',
            },
          },
        },
      });
      expect(result).toMatchObject({ ok: true, verdict: 'down', failClosed: false });
      expect(result.ok && result.checks[0]).toMatchObject({
        id: 'network',
        status: 'down',
        message:
          "Mediaplane can't read qBittorrent's or Gluetun's start time, so it can't tell whether qBittorrent holds Gluetun's current network",
      });
    }
  });

  it('matches what Docker says to each container by its ID, not by its place', async () => {
    const reversed: Runtime['inspect'] = (ids) =>
      Promise.resolve(
        [...ids].reverse().map((id) => ({
          id,
          networkMode: id === QBITTORRENT_ID ? `container:${GLUETUN_ID}` : 'bridge',
          startedAt: '2026-10-10T10:00:00Z',
        })),
      );
    const { result } = await checkWith(await homeWith(), {
      replace: { inspect: reversed },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'pass' });
  });

  it('warns, and passes, when qBittorrent is not running: it sends nothing', async () => {
    for (const state of ['exited', 'created']) {
      const { result } = await checkWith(await homeWith(), {
        runtime: {
          containers: withQbittorrent({ state, health: '' }),
          details: {
            [QBITTORRENT_ID]: {
              networkMode: `container:${GLUETUN_ID}`,
              startedAt: '0001-01-01T00:00:00Z',
            },
          },
        },
      });
      expect(result).toMatchObject({ ok: true, verdict: 'pass' });
      expect(result.ok && result.checks[0]).toMatchObject({
        status: 'warning',
        message: `qBittorrent is ${state}: it uses Gluetun's network, but sends nothing until it runs`,
      });
    }
  });

  it('finds the VPN down, closed and without probing, when Gluetun has stopped', async () => {
    for (const state of ['exited', 'dead', 'created']) {
      const containers = [
        container('gluetun', GLUETUN_ID, { state, health: '' }),
        container('qbittorrent', QBITTORRENT_ID),
      ];
      const { result, calls } = await checkWith(await homeWith(), {
        runtime: { containers },
      });
      expect(result).toMatchObject({
        ok: true,
        verdict: 'down',
        egress: { url: TRACE, vpn: null, host: null },
        failClosed: true,
      });
      expect(statuses(result)).toEqual(['network ok', 'gluetun down']);
      expect(result.ok && result.checks[1]?.message).toBe(
        `Gluetun is ${state}, so qBittorrent has no network: nothing gets out`,
      );
      expect(calls).not.toContain('run qbittorrent sh as 65534:65534');
    }
  });

  it('finds the VPN down, but never closed, when Gluetun is paused or restarting', async () => {
    // A paused Gluetun's tunnel and firewall are the kernel's, and keep working: whether
    // anything gets out isn't shown.
    for (const state of ['paused', 'restarting']) {
      const containers = [
        container('gluetun', GLUETUN_ID, { state }),
        container('qbittorrent', QBITTORRENT_ID),
      ];
      const { result, calls } = await checkWith(await homeWith(), {
        runtime: { containers },
      });
      expect(result).toMatchObject({
        ok: true,
        verdict: 'down',
        egress: { url: TRACE, vpn: null, host: null },
        failClosed: false,
      });
      expect(statuses(result)).toEqual(['network ok', 'gluetun down']);
      expect(result.ok && result.checks[1]).toEqual({
        id: 'gluetun',
        status: 'down',
        message: `Gluetun is ${state}`,
        hint: 'see docs/runbooks/vpn-down.md',
      });
      expect(JSON.stringify(result)).not.toContain('nothing gets out');
      expect(calls).not.toContain('run qbittorrent sh as 65534:65534');
    }
  });

  it('finds the VPN down when Gluetun has no container, or one that has gone', async () => {
    // qBittorrent's network is a container that isn't there: not shown to be Gluetun's.
    const containers = [container('qbittorrent', QBITTORRENT_ID)];
    const { result } = await checkWith(await homeWith(), { runtime: { containers } });
    expect(statuses(result)).toEqual(['network down', 'gluetun down']);
    expect(result).toMatchObject({ ok: true, verdict: 'down', failClosed: false });
    expect(result.ok && result.checks[1]?.message).toBe(
      'Gluetun has no container, so the VPN is down',
    );
  });

  it('never calls a leak closed: qBittorrent with a network of its own gets out without Gluetun', async () => {
    const { result } = await checkWith(await homeWith(), {
      runtime: {
        containers: [
          container('gluetun', GLUETUN_ID, { state: 'exited', health: '' }),
          container('qbittorrent', QBITTORRENT_ID),
        ],
        details: { [QBITTORRENT_ID]: { networkMode: 'mediaplane_default' } },
      },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'leak', failClosed: false });
    expect(statuses(result)).toEqual(['network leak', 'gluetun down']);
    expect(result.ok && result.checks.map((c) => c.message)).toEqual([
      'qBittorrent has a network of its own ("mediaplane_default"), not Gluetun\'s: its traffic does not go through the VPN',
      'Gluetun is exited, so the VPN is down',
    ]);
  });

  it('claims nothing about what gets out when qBittorrent is in an unknown network', async () => {
    // A container outside the stack, say: Gluetun being stopped shuts nothing.
    const { result } = await checkWith(await homeWith(), {
      runtime: {
        containers: [
          container('gluetun', GLUETUN_ID, { state: 'exited', health: '' }),
          container('qbittorrent', QBITTORRENT_ID),
        ],
        details: { [QBITTORRENT_ID]: { networkMode: `container:${'d'.repeat(64)}` } },
      },
    });
    expect(result).toMatchObject({ ok: true, verdict: 'down', failClosed: false });
    expect(statuses(result)).toEqual(['network down', 'gluetun down']);
    expect(result.ok && result.checks[0]).toEqual({
      id: 'network',
      status: 'down',
      message:
        "qBittorrent uses the network of a container that isn't a running part of this stack (dddddddddddd), not Gluetun's",
      hint: 'restart qBittorrent ("docker restart mediaplane-qbittorrent-1") so it rejoins Gluetun\'s network, or take out a network_mode under qbittorrent in compose.override.yaml that points elsewhere',
    });
    expect(JSON.stringify(result)).not.toContain('nothing gets out');
  });

  it('finds the VPN down, but not closed, when Gluetun is unhealthy; it still probes', async () => {
    for (const health of ['unhealthy', '']) {
      const containers = [
        container('gluetun', GLUETUN_ID, { health }),
        container('qbittorrent', QBITTORRENT_ID),
      ];
      const { result, calls } = await checkWith(await homeWith(), {
        runtime: { containers },
      });
      expect(result).toMatchObject({ ok: true, verdict: 'down', failClosed: false });
      expect(statuses(result)[1]).toBe('gluetun down');
      expect(calls).toContain('run qbittorrent sh as 65534:65534');
    }
  });

  it('warns when the control server answers without the key: Gluetun has not been restarted', async () => {
    const answers: Answers = { ...HEALTHY, anonymous: [0, '200'] };
    const { result } = await checkWith(await homeWith(), {
      answers,
      project: 'mediaplane-e2e-1234-vpn',
    });
    expect(result).toMatchObject({ ok: true, verdict: 'pass' });
    expect(result.ok && result.checks.find((c) => c.id === 'control-key')).toMatchObject({
      status: 'warning',
      hint: 'restart Gluetun, then qBittorrent: "docker restart mediaplane-e2e-1234-vpn-gluetun-1", then "docker restart mediaplane-e2e-1234-vpn-qbittorrent-1" (Gluetun\'s README, "Set up before Slice 3a")',
    });
  });

  it('leaves the keyless check out when the control server does not answer at all', async () => {
    const answers: Answers = { ...HEALTHY, anonymous: [7, '000'] };
    const { result } = await checkWith(await homeWith(), { answers });
    expect(statuses(result)).toEqual([
      'network ok',
      'gluetun ok',
      'control ok',
      'route ok',
      'egress ok',
    ]);
  });

  it('warns when the control server refuses the key or does not answer', async () => {
    for (const [status, message] of [
      ['\n401', "Gluetun's control server refused Mediaplane's key"],
      ['\n000', "Gluetun's control server did not answer"],
      ['oops\n500', "Gluetun's control server answered HTTP 500"],
      ['<html>not json</html>\n200', "Gluetun's control server answered HTTP 200"],
      ['{"state":"running"}\n200', "Gluetun's control server answered HTTP 200"],
    ]) {
      const answers: Answers = { ...HEALTHY, status: [0, status ?? ''] };
      const { result } = await checkWith(await homeWith(), { answers });
      expect(result).toMatchObject({ ok: true, verdict: 'pass' });
      expect(result.ok && result.checks.find((c) => c.id === 'control')).toMatchObject({
        status: 'warning',
        message,
      });
    }
  });

  it("does not read a keyed answer that curl couldn't finish, such as one over the cap", async () => {
    // curl exits 63 when the body is over --max-filesize, and still writes the status.
    const answers: Answers = {
      ...HEALTHY,
      status: [63, '{"status":"stopped"}\n200'],
      publicip: [63, '{"public_ip":"203.0.113.9"}\n200'],
    };
    const { result } = await checkWith(await homeWith(), { answers });
    expect(result).toMatchObject({ ok: true, verdict: 'pass', gluetunPublicIp: null });
    expect(result.ok && result.checks.find((c) => c.id === 'control')).toMatchObject({
      status: 'warning',
      message: "Gluetun's control server's answer could not be read (curl exited 63)",
    });
  });

  it('finds the VPN down when the control server says it is stopped', async () => {
    const answers: Answers = { ...HEALTHY, status: [0, '{"status":"stopped"}\n200'] };
    const { result } = await checkWith(await homeWith(), { answers });
    expect(result).toMatchObject({ ok: true, verdict: 'down' });
    expect(statuses(result)).toContain('control down');
  });

  it('finds the VPN down when the route does not go into the tunnel and nothing answers', async () => {
    for (const route of [
      [0, '1.1.1.1 via 172.20.0.1 dev eth0  src 172.20.0.2'],
      [2, 'RTNETLINK answers: Network is unreachable'],
    ] as [number, string][]) {
      const { result } = await checkWith(await homeWith(), {
        egress: false,
        answers: { ...HEALTHY, route },
      });
      expect(result).toMatchObject({ ok: true, verdict: 'down', failClosed: false });
      expect(statuses(result)).toContain('route down');
    }
  });

  it('finds a leak when the route does not go into the tunnel, yet an answer came back', async () => {
    const answers: Answers = {
      ...HEALTHY,
      route: [0, '1.1.1.1 via 172.20.0.1 dev eth0  src 172.20.0.2'],
    };
    const { result } = await checkWith(await homeWith(), { answers });
    expect(result).toMatchObject({ ok: true, verdict: 'leak' });
    expect(result.ok && result.checks.find((c) => c.id === 'route')).toMatchObject({
      status: 'leak',
      message:
        "qBittorrent's traffic is routed to eth0, not into the tunnel (tun0), and it still got an answer from outside: it leaves outside the VPN",
    });
  });

  it('counts an empty answer from outside as an answer, when the route leaves the tunnel', async () => {
    const answers: Answers = {
      ...HEALTHY,
      route: [0, '1.1.1.1 via 172.20.0.1 dev eth0  src 172.20.0.2'],
      egress: [0, ''],
    };
    const { result } = await checkWith(await homeWith(), { answers });
    expect(result).toMatchObject({ ok: true, verdict: 'leak', failClosed: false });
    expect(statuses(result)).toContain('route leak');
  });

  it("takes Gluetun's tunnel from VPN_INTERFACE when apps.gluetun.env sets it", async () => {
    const stack = `${STACK}  gluetun: { env: { VPN_INTERFACE: wg0 } }\n`;
    const answers: Answers = { ...HEALTHY, route: [0, '1.1.1.1 dev wg0  src 10.66.0.2'] };
    const { result } = await checkWith(await homeWith({ stack }), { answers });
    expect(result).toMatchObject({ ok: true, verdict: 'pass' });
  });

  it('finds a leak, without asking Docker, when qBittorrent runs without the VPN', async () => {
    const stack = STACK.replace('qbittorrent: {}', 'qbittorrent: { vpn: false }');
    const { result, calls } = await checkWith(await homeWith({ stack }));
    expect(result).toMatchObject({ ok: true, verdict: 'leak', egress: null });
    expect(statuses(result)).toEqual(['network leak']);
    expect(calls).toEqual([]);
  });

  it('never repeats an egress URL it refuses: it could hold a password', async () => {
    for (const url of ['file:///etc/passwd', 'https://user:fake-pass-0123@192.0.2.1/']) {
      const { result, calls } = await checkWith(await homeWith(), { url });
      expect(result).toEqual({
        ok: false,
        diagnostics: [
          {
            severity: 'error',
            code: 'vpn-check.bad-url',
            message:
              "the egress check's URL must be an http or https URL with no user name or password",
            hint: 'set MEDIAPLANE_VPN_CHECK_URL to an IP-echo service such as https://1.1.1.1/cdn-cgi/trace, or unset it',
          },
        ],
      });
      expect(calls).toEqual([]);
    }
  });

  it('fails the probe, rather than guess, when it stopped before its last check', async () => {
    const partial: Answers = { ...HEALTHY };
    delete partial.egress;
    const { result } = await checkWith(await homeWith(), {
      runtime: {
        run: () => ({
          code: 137,
          stdout: probeOutput(partial),
          stderr: 'fake: killed\n',
        }),
      },
    });
    expect(result.ok ? 'passed' : result.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'vpn-check.probe-failed',
        message:
          "the probe in qBittorrent's network stopped before its egress check: fake: killed",
        hint: 'run vpn-check again; if it keeps stopping, look at qBittorrent\'s log ("docker logs mediaplane-qbittorrent-1")',
      },
    ]);
  });

  it('points to the image when the probe printed nothing at all', async () => {
    const { result } = await checkWith(await homeWith(), {
      runtime: {
        run: () => ({ code: 125, stdout: '', stderr: 'fake: no such image\n' }),
      },
    });
    expect(result.ok ? 'passed' : result.diagnostics).toEqual([
      {
        severity: 'error',
        code: 'vpn-check.probe-failed',
        message: "the probe in qBittorrent's network could not run: fake: no such image",
        hint: 'check that the qBittorrent image is present ("docker image ls"), then run vpn-check again',
      },
    ]);
  });

  it('explains what it cannot check', async () => {
    const noQbittorrent = STACK.replace('apps:\n  qbittorrent: {}\n', 'apps: {}\n');
    const cases: [Promise<{ result: Awaited<ReturnType<typeof vpnCheck>> }>, string][] = [
      [checkWith(await tempDir('mediaplane-vpn-check-')), 'config.missing'],
      [checkWith(await homeWith({ stack: `${STACK}  sonar: {}\n` })), 'app.unknown'],
      [checkWith(await homeWith({ stack: noQbittorrent })), 'vpn-check.no-qbittorrent'],
      [checkWith(await homeWith(), { url: 'file:///etc/passwd' }), 'vpn-check.bad-url'],
      [checkWith(await homeWith({ key: false })), 'vpn-check.no-key'],
      [
        checkWith(await homeWith(), { runtime: { containers: [] } }),
        'vpn-check.not-applied',
      ],
      [
        checkWith(await homeWith(), {
          runtime: {
            run: () => ({
              code: 1,
              stdout: '',
              stderr: 'Error response from daemon: cannot join network namespace\n',
            }),
          },
        }),
        'vpn-check.probe-failed',
      ],
      [
        checkWith(await homeWith(), {
          replace: {
            containers: () => Promise.reject(new RuntimeError('fake: no Docker')),
          },
        }),
        'docker.unavailable',
      ],
    ];
    for (const [pending, code] of cases) {
      const { result } = await pending;
      expect(result.ok ? 'passed' : result.diagnostics.map((d) => d.code)).toEqual([
        code,
      ]);
    }
  });

  it('throws what is not a Docker failure: that is a bug, not a result', async () => {
    await expect(
      checkWith(await homeWith(), {
        replace: { containers: () => Promise.reject(new Error('fake bug')) },
      }),
    ).rejects.toThrow('fake bug');
  });
});
