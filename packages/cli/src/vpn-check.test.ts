import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  collectHostReport,
  type HostRequest,
  type OneOffCommand,
  type VpnCheckItem,
  type VpnCheckResult,
} from '@mediaplane/engine';
import {
  FAKE_GLUETUN_ID,
  FAKE_QBITTORRENT_ID,
  FIXTURE_HOST,
  fakeContainer,
  fakeProbe,
  fakeProbeRuntime,
  fakeRuntime,
  tempDir,
  type ProbeAnswers,
} from '@mediaplane/engine/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultDeps, run, type CliDeps, type Io } from './run';
import { printVpnCheck } from './vpn-check';

const STACK = `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
vpn: { provider: mullvad, private_key: { file: secrets/wg.key } }
apps:
  qbittorrent: {}
`;
const KEY = '0'.repeat(32);
const TRACE = 'https://1.1.1.1/cdn-cgi/trace';
const RUNBOOK =
  'https://github.com/cyclopsgd/Mediaplane/blob/main/docs/runbooks/vpn-down.md';
const COMPARED = 'Passed: qBittorrent reaches the internet only through the VPN.';
const NOT_COMPARED =
  "Passed: qBittorrent has no way out but the tunnel; its address was not compared with this host's.";
const CLOSED = `VPN down: qBittorrent can't reach the internet, and nothing leaks (fail-closed). See ${RUNBOOK}.`;
const OPEN = `VPN down: the checks marked DOWN say what failed. See ${RUNBOOK}.`;

async function makeHome(): Promise<string> {
  const home = await tempDir('mediaplane-cli-');
  await writeFile(join(home, 'stack.yaml'), STACK);
  await mkdir(join(home, 'state'));
  await writeFile(
    join(home, 'state', 'secrets.json'),
    JSON.stringify({ version: 1, apps: { gluetun: { controlApiKey: KEY } } }),
  );
  return home;
}

const HEALTHY: ProbeAnswers = {
  route: [0, '1.1.1.1 dev tun0  src 10.66.0.2'],
  anonymous: [0, '401'],
  status: [0, '{"status":"running"}\n200'],
  publicip: [0, '{"public_ip":""}\n200'],
  egress: [0, 'ip=203.0.113.7\n'],
};

function capture(env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    env,
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

function deps(
  runtime = fakeProbeRuntime(HEALTHY),
  hostAddress = '198.51.100.2',
  asked: string[] = [],
): Partial<CliDeps> {
  return {
    host: () => Promise.resolve(FIXTURE_HOST),
    runtime: () => runtime,
    probe: () => fakeProbe(),
    egress: () => (url) => {
      asked.push(url);
      return Promise.resolve({ ok: true, address: hostAddress });
    },
  };
}

/** Runs `vpn-check` with `answers` and the host at `hostAddress`; returns what it printed. */
async function check(
  answers: ProbeAnswers,
  hostAddress = '198.51.100.2',
  args: readonly string[] = [],
) {
  const term = capture();
  const asked: string[] = [];
  const home = await makeHome();
  const code = await run(
    ['vpn-check', '--home', home, ...args],
    term.io,
    deps(fakeProbeRuntime(answers), hostAddress, asked),
  );
  return { code, asked, stdout: term.stdout(), stderr: term.stderr() };
}

describe('mediaplane vpn-check', () => {
  it('passes, showing each check and the two addresses', async () => {
    const term = capture();
    const asked: string[] = [];
    const home = await makeHome();
    expect(
      await run(
        ['vpn-check', '--home', home],
        term.io,
        deps(fakeProbeRuntime(HEALTHY), undefined, asked),
      ),
    ).toBe(0);
    expect(term.stdout()).toBe(
      [
        "  ok    qBittorrent uses Gluetun's network, and has none of its own",
        '  ok    Gluetun is running and healthy',
        "  ok    Gluetun's control server says the VPN is running",
        "  ok    Gluetun's control server refuses requests without Mediaplane's key",
        "  ok    qBittorrent's traffic is routed into the tunnel (tun0)",
        "  ok    qBittorrent's traffic leaves from 203.0.113.7, and this host's from 198.51.100.2",
        '',
        COMPARED,
        '',
      ].join('\n'),
    );
    expect(term.stderr()).toBe('');
    expect(asked).toEqual([TRACE]);
  });

  it('shows the address Gluetun reports for itself, never compared', async () => {
    const shown = await check({
      ...HEALTHY,
      publicip: [0, '{"public_ip":"192.0.2.44"}\n200'],
    });
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain('Gluetun reports its public address as 192.0.2.44.\n');
    expect(shown.stdout).toContain(COMPARED);
  });

  it('prints versioned JSON, and exits 1 on a leak', async () => {
    const term = capture();
    const home = await makeHome();
    expect(
      await run(
        ['vpn-check', '--home', home, '--json'],
        term.io,
        deps(fakeProbeRuntime(HEALTHY), '203.0.113.7'),
      ),
    ).toBe(1);
    const shown = JSON.parse(term.stdout()) as Record<string, unknown>;
    expect(shown).toMatchObject({
      schema: 'mediaplane.vpn-check/v1',
      ok: true,
      verdict: 'leak',
      egress: { url: TRACE, vpn: '203.0.113.7', host: '203.0.113.7' },
      gluetunPublicIp: null,
      failClosed: false,
    });
    expect(Object.keys(shown)).toEqual([
      'schema',
      'ok',
      'verdict',
      'checks',
      'egress',
      'gluetunPublicIp',
      'failClosed',
    ]);
    expect(term.stdout()).not.toContain(KEY);
  });

  it('prints a pass as JSON with exit 0, and the egress null with --no-egress', async () => {
    const compared = capture();
    const home = await makeHome();
    expect(await run(['vpn-check', '--home', home, '--json'], compared.io, deps())).toBe(
      0,
    );
    expect(JSON.parse(compared.stdout())).toMatchObject({
      schema: 'mediaplane.vpn-check/v1',
      ok: true,
      verdict: 'pass',
      egress: { url: TRACE, vpn: '203.0.113.7', host: '198.51.100.2' },
      failClosed: false,
    });
    const structure = capture();
    expect(
      await run(
        ['vpn-check', '--home', home, '--json', '--no-egress'],
        structure.io,
        deps(),
      ),
    ).toBe(0);
    expect(JSON.parse(structure.stdout())).toMatchObject({
      ok: true,
      verdict: 'pass',
      egress: null,
    });
  });

  it('asks the URL in MEDIAPLANE_VPN_CHECK_URL, and none with --no-egress', async () => {
    const echo = 'http://192.0.2.10/cgi-bin/ip';
    const sent: OneOffCommand[] = [];
    const asked: string[] = [];
    const home = await makeHome();
    const term = capture({ MEDIAPLANE_VPN_CHECK_URL: echo });
    expect(
      await run(
        ['vpn-check', '--home', home],
        term.io,
        deps(fakeProbeRuntime(HEALTHY, sent), undefined, asked),
      ),
    ).toBe(0);
    expect(sent[0]?.args.at(-1)).toBe(echo);
    expect(asked).toEqual([echo]);

    const structure = capture({ MEDIAPLANE_VPN_CHECK_URL: echo });
    expect(
      await run(
        ['vpn-check', '--home', home, '--no-egress'],
        structure.io,
        deps(fakeProbeRuntime(HEALTHY, sent), undefined, asked),
      ),
    ).toBe(0);
    expect(sent[1]?.args.at(-1)).toBe('');
    expect(asked).toEqual([echo]);
    expect(structure.stdout()).toContain(NOT_COMPARED);
    expect(structure.stdout()).not.toContain(COMPARED);
  });

  it('exits 1, with the runbook, when the VPN is down', async () => {
    const down = await check({
      ...HEALTHY,
      egress: [28, 'curl: (28) Connection timed out after 10001 milliseconds'],
    });
    expect(down.code).toBe(1);
    expect(down.stdout).toContain(
      `  DOWN  qBittorrent's traffic got no answer from ${TRACE}: curl: (28) Connection timed out after 10001 milliseconds\n        hint: the VPN is down, and nothing gets out (fail-closed); see ${RUNBOOK}\n`,
    );
    expect(down.stdout).toContain(`\n${CLOSED}\n`);
    // The host is not asked when the tunnel side got no answer.
    expect(down.asked).toEqual([]);
  });

  it('prints a fail-closed down as JSON, and exits 1: what a cron job reads', async () => {
    const term = capture();
    const home = await makeHome();
    const answers: ProbeAnswers = {
      ...HEALTHY,
      egress: [28, 'curl: (28) Connection timed out after 10001 milliseconds'],
    };
    expect(
      await run(
        ['vpn-check', '--home', home, '--json'],
        term.io,
        deps(fakeProbeRuntime(answers)),
      ),
    ).toBe(1);
    expect(JSON.parse(term.stdout())).toMatchObject({
      schema: 'mediaplane.vpn-check/v1',
      ok: true,
      verdict: 'down',
      egress: { url: TRACE, vpn: null, host: null },
      failClosed: true,
    });
    expect(term.stderr()).toBe('');
  });

  it('never says nothing leaks when the route leaves the tunnel and nothing answers', async () => {
    // Routed by eth0, only Gluetun's firewall stands in the way, and nothing measured it.
    const down = await check({
      ...HEALTHY,
      route: [0, '1.1.1.1 via 172.20.0.1 dev eth0  src 172.20.0.2'],
      egress: [28, 'curl: (28) Connection timed out after 10001 milliseconds'],
    });
    expect(down.code).toBe(1);
    expect(down.stdout).toContain(
      "  DOWN  qBittorrent's traffic is routed to eth0, not into the tunnel (tun0)\n",
    );
    expect(down.stdout).toContain(`        hint: the VPN is down; see ${RUNBOOK}\n`);
    expect(down.stdout).toContain(`\n${OPEN}\n`);
    expect(down.stdout).not.toContain('nothing leaks');
    expect(down.stdout).not.toContain('nothing gets out');
    expect(down.stdout).not.toContain('fail-closed');
  });

  it('says a leak is a leak, with its hint', async () => {
    const leak = await check(HEALTHY, '203.0.113.7');
    expect(leak.code).toBe(1);
    expect(leak.stdout).toContain(
      `  LEAK  qBittorrent's traffic leaves from 203.0.113.7, which is this host's own address: it does not go through the VPN\n        hint: see ${RUNBOOK}\n`,
    );
    expect(leak.stdout).toContain(
      `\nLEAK: qBittorrent's traffic does not go through the VPN. See ${RUNBOOK}.\n`,
    );
    expect(leak.stdout).not.toContain('Passed');
    expect(leak.stdout).not.toContain('nothing leaks');
  });

  it('claims no more than the checks found', async () => {
    const home = await makeHome();
    // The host could not ask: the addresses were never compared.
    const uncompared = capture();
    const noHost: Partial<CliDeps> = {
      ...deps(),
      egress: () => () => Promise.resolve({ ok: false, error: 'fake: no answer' }),
    };
    expect(await run(['vpn-check', '--home', home], uncompared.io, noHost)).toBe(0);
    expect(uncompared.stdout()).toContain(
      "  warn  qBittorrent's traffic leaves from 203.0.113.7, but this host could not ask https://1.1.1.1/cdn-cgi/trace for its own address (fake: no answer), so the two were not compared\n",
    );
    expect(uncompared.stdout()).toContain(`\n${NOT_COMPARED}\n`);
    expect(uncompared.stdout()).not.toContain(COMPARED);
    // Gluetun unhealthy while traffic still got through: down, but not "nothing leaks".
    const unhealthy = fakeProbeRuntime(HEALTHY, [], {
      containers: [
        fakeContainer('gluetun', FAKE_GLUETUN_ID, { health: 'unhealthy' }),
        fakeContainer('qbittorrent', FAKE_QBITTORRENT_ID),
      ],
      details: { [FAKE_QBITTORRENT_ID]: { networkMode: `container:${FAKE_GLUETUN_ID}` } },
    });
    const down = capture();
    expect(await run(['vpn-check', '--home', home], down.io, deps(unhealthy))).toBe(1);
    expect(down.stdout()).toContain(`\n${OPEN}\n`);
    expect(down.stdout()).not.toContain('nothing leaks');
    expect(down.stdout()).not.toContain('fail-closed');
  });

  it('does not say the addresses were compared when the answer gave none to compare', async () => {
    // The echo answered without an address: the host is not asked.
    const noAddress = await check({
      ...HEALTHY,
      egress: [0, 'fl=1\nvisit_scheme=https\n'],
    });
    expect(noAddress.code).toBe(0);
    expect(noAddress.stdout).toContain(
      `  warn  ${TRACE} answered qBittorrent without an address, so the addresses were not compared\n        hint: set MEDIAPLANE_VPN_CHECK_URL to an IP-echo service, or unset it\n`,
    );
    expect(noAddress.stdout).toContain(`\n${NOT_COMPARED}\n`);
    expect(noAddress.stdout).not.toContain(COMPARED);
    expect(noAddress.asked).toEqual([]);
    // curl got an answer it could not finish reading.
    const unread = await check({
      ...HEALTHY,
      egress: [63, 'curl: (63) Maximum file size exceeded'],
    });
    expect(unread.code).toBe(0);
    expect(unread.stdout).toContain(
      `  warn  ${TRACE} answered qBittorrent, but its answer could not be read (curl exited 63), so the addresses were not compared\n`,
    );
    expect(unread.stdout).toContain(`\n${NOT_COMPARED}\n`);
    expect(unread.stdout).not.toContain(COMPARED);
    expect(unread.asked).toEqual([]);
  });

  it('does not say the addresses were compared when one is IPv4 and the other IPv6', async () => {
    // Both addresses are known, but an IPv4 and an IPv6 address prove nothing.
    const mixed = await check(HEALTHY, '2001:db8::1');
    expect(mixed.code).toBe(0);
    expect(mixed.stdout).toContain(
      "  warn  qBittorrent's traffic leaves from 203.0.113.7, and this host's from 2001:db8::1: one IPv4 and one IPv6 address, so the two were not compared\n",
    );
    expect(mixed.stdout).toContain(`\n${NOT_COMPARED}\n`);
    expect(mixed.stdout).not.toContain(COMPARED);
  });

  it("names the stack's own containers in a hint, as MEDIAPLANE_COMPOSE_PROJECT sets them", async () => {
    // Gluetun started again after qBittorrent: qBittorrent holds the network it had.
    const stranded = fakeProbeRuntime(HEALTHY, [], {
      containers: [
        fakeContainer('gluetun', FAKE_GLUETUN_ID),
        fakeContainer('qbittorrent', FAKE_QBITTORRENT_ID),
      ],
      details: {
        [FAKE_GLUETUN_ID]: { startedAt: '2026-10-10T10:05:00.000000001Z' },
        [FAKE_QBITTORRENT_ID]: { networkMode: `container:${FAKE_GLUETUN_ID}` },
      },
    });
    const home = await makeHome();
    const term = capture({ MEDIAPLANE_COMPOSE_PROJECT: 'mediaplane-dev' });
    expect(await run(['vpn-check', '--home', home], term.io, deps(stranded))).toBe(1);
    expect(term.stdout()).toContain(
      '        hint: run "mediaplane apply", which restarts it (or "docker restart mediaplane-dev-qbittorrent-1")\n',
    );
    // Not fail-closed: the traffic still got out.
    expect(term.stdout()).toContain(`\n${OPEN}\n`);

    // The default project.
    const plain = capture();
    expect(await run(['vpn-check', '--home', home], plain.io, deps(stranded))).toBe(1);
    expect(plain.stdout()).toContain(
      '        hint: run "mediaplane apply", which restarts it (or "docker restart mediaplane-qbittorrent-1")\n',
    );
  });

  it('explains what it cannot check, as an error', async () => {
    const home = await makeHome();
    const term = capture();
    expect(await run(['vpn-check', '--home', home], term.io, deps(fakeRuntime()))).toBe(
      1,
    );
    expect(term.stdout()).toBe('');
    expect(term.stderr()).toBe(
      'error: qBittorrent has no container in this stack yet\n  hint: run "mediaplane apply" first\n',
    );
    const asJson = capture();
    expect(
      await run(['vpn-check', '--home', home, '--json'], asJson.io, deps(fakeRuntime())),
    ).toBe(1);
    expect(JSON.parse(asJson.stdout())).toMatchObject({
      schema: 'mediaplane.error/v1',
      ok: false,
      error: { message: 'qBittorrent has no container in this stack yet' },
    });
    expect(asJson.stderr()).toBe('');
  });

  it('refuses a bad URL without printing it, in either form', async () => {
    const home = await makeHome();
    const urls = [
      'file:///etc/passwd',
      'https://admin:fake-pass-0123@192.0.2.10/ip',
      'not a url',
    ];
    for (const url of urls) {
      const human = capture({ MEDIAPLANE_VPN_CHECK_URL: url });
      expect(await run(['vpn-check', '--home', home], human.io, deps())).toBe(1);
      expect(human.stdout()).toBe('');
      expect(human.stderr()).toBe(
        "error: the egress check's URL must be an http or https URL with no user name or password\n  hint: set MEDIAPLANE_VPN_CHECK_URL to an IP-echo service such as https://1.1.1.1/cdn-cgi/trace, or unset it\n",
      );

      const json = capture({ MEDIAPLANE_VPN_CHECK_URL: url });
      expect(await run(['vpn-check', '--home', home, '--json'], json.io, deps())).toBe(1);
      expect(JSON.parse(json.stdout())).toEqual({
        schema: 'mediaplane.error/v1',
        ok: false,
        error: {
          message:
            "the egress check's URL must be an http or https URL with no user name or password",
        },
      });
      expect(json.stderr()).toBe('');
      for (const output of [human.stdout() + human.stderr(), json.stdout()]) {
        expect(output).not.toContain('fake-pass-0123');
        expect(output).not.toContain('192.0.2.10');
        expect(output).not.toContain('passwd');
      }
    }
    // With --no-egress the URL is never used, so it is never checked.
    const structure = capture({ MEDIAPLANE_VPN_CHECK_URL: urls[1] });
    expect(
      await run(['vpn-check', '--home', home, '--no-egress'], structure.io, deps()),
    ).toBe(0);
  });

  it('asks for the host address through the host helper when it runs from its image', async () => {
    const seen: HostRequest[] = [];
    const runtime = fakeProbeRuntime(HEALTHY, [], {
      hostHelper: async (request) => {
        seen.push(request);
        const report = await collectHostReport(
          request,
          fakeProbe(),
          () => FIXTURE_HOST,
          () => Promise.resolve({ ok: true, address: '198.51.100.2' }),
        );
        return { ok: true, stdout: JSON.stringify(report) };
      },
    });
    const term = capture({ MEDIAPLANE_IMAGE: 'mediaplane:test' });
    const home = await makeHome();
    // No egress override: the image's own, through the host helper.
    expect(
      await run(['vpn-check', '--home', home, '--json'], term.io, {
        runtime: () => runtime,
        probe: () => fakeProbe(),
      }),
    ).toBe(0);
    expect(seen.map((r) => r.egress)).toEqual([undefined, TRACE]);
    expect(JSON.parse(term.stdout())).toMatchObject({
      egress: { url: TRACE, vpn: '203.0.113.7', host: '198.51.100.2' },
    });
  });
});

describe('where the host address comes from', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('asks the service itself when run from source, and never the host helper', async () => {
    vi.stubEnv('NODE_USE_ENV_PROXY', '');
    vi.stubEnv('NODE_OPTIONS', '');
    const requested: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      requested.push(url);
      return Promise.resolve(new Response('fl=1\nip=198.51.100.2\n'));
    });
    const seen: HostRequest[] = [];
    const runtime = fakeRuntime({
      hostHelper: (request) => {
        seen.push(request);
        return { ok: false, error: 'fake: the helper must not be used' };
      },
    });
    // No MEDIAPLANE_IMAGE: the CLI is run from source.
    expect(await defaultDeps({}).egress(runtime)(TRACE)).toEqual({
      ok: true,
      address: '198.51.100.2',
    });
    expect(requested).toEqual([TRACE]);
    expect(seen).toEqual([]);
  });

  it("reads the CLI's own environment for a Node proxy setting, not only the process's", async () => {
    vi.stubEnv('NODE_USE_ENV_PROXY', '');
    vi.stubEnv('NODE_OPTIONS', '');
    const requested: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      requested.push(url);
      return Promise.resolve(new Response('ip=198.51.100.2\n'));
    });
    const egress = defaultDeps({ NODE_USE_ENV_PROXY: '1' }).egress(fakeRuntime());
    expect(await egress(TRACE)).toEqual({
      ok: false,
      error:
        "the request would go through a proxy (NODE_USE_ENV_PROXY), so it can't see this host's own address",
    });
    expect(requested).toEqual([]);
  });

  it('does not measure this machine when DOCKER_HOST names Docker on another', async () => {
    vi.stubEnv('NODE_USE_ENV_PROXY', '');
    vi.stubEnv('NODE_OPTIONS', '');
    const requested: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      requested.push(url);
      return Promise.resolve(new Response('ip=198.51.100.2\n'));
    });
    const remote = {
      ok: false,
      error:
        "Docker runs on another host (DOCKER_HOST), so this machine's address is not the one to compare",
    };
    for (const host of [
      'tcp://192.0.2.10:2375',
      'ssh://fake-user@192.0.2.10',
      'unix-not://x',
      'fd://',
    ]) {
      const egress = defaultDeps({ DOCKER_HOST: host }).egress(fakeRuntime());
      expect(await egress(TRACE), host).toEqual(remote);
    }
    expect(requested).toEqual([]);
    // A local socket, or none set, is this machine's Docker.
    for (const env of [
      { DOCKER_HOST: 'unix:///var/run/docker.sock' },
      { DOCKER_HOST: '' },
    ]) {
      expect(await defaultDeps(env).egress(fakeRuntime())(TRACE)).toEqual({
        ok: true,
        address: '198.51.100.2',
      });
    }
    expect(requested).toEqual([TRACE, TRACE]);
  });

  it('warns, and compares nothing, when run from source against a remote Docker', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('fake: must not fetch')));
    const term = capture({ DOCKER_HOST: 'tcp://192.0.2.10:2375' });
    const home = await makeHome();
    // No egress override: the source's own, from defaultDeps.
    expect(
      await run(['vpn-check', '--home', home], term.io, {
        host: () => Promise.resolve(FIXTURE_HOST),
        runtime: () => fakeProbeRuntime(HEALTHY),
        probe: () => fakeProbe(),
      }),
    ).toBe(0);
    expect(term.stdout()).toContain(
      `  warn  qBittorrent's traffic leaves from 203.0.113.7, but this host could not ask ${TRACE} for its own address (Docker runs on another host (DOCKER_HOST), so this machine's address is not the one to compare), so the two were not compared\n`,
    );
    expect(term.stdout()).toContain(`\n${NOT_COMPARED}\n`);
    expect(term.stdout()).not.toContain(COMPARED);
  });

  it('asks the host helper in the image, and never fetches itself', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      requested.push(url);
      return Promise.reject(new Error('fake: the image must not fetch'));
    });
    const seen: HostRequest[] = [];
    const runtime = fakeRuntime({
      hostHelper: async (request) => {
        seen.push(request);
        const report = await collectHostReport(
          request,
          fakeProbe(),
          () => FIXTURE_HOST,
          () => Promise.resolve({ ok: true, address: '198.51.100.2' }),
        );
        return { ok: true, stdout: JSON.stringify(report) };
      },
    });
    // DOCKER_HOST points at the socket proxy there, and the helper still runs on the host.
    const image = defaultDeps({
      MEDIAPLANE_IMAGE: 'mediaplane:test',
      DOCKER_HOST: 'tcp://socket-proxy:2375',
    });
    expect(await image.egress(runtime)(TRACE)).toEqual({
      ok: true,
      address: '198.51.100.2',
    });
    expect(seen.map((r) => r.egress)).toEqual([TRACE]);
    expect(requested).toEqual([]);
  });
});

describe('printVpnCheck', () => {
  const item = (
    id: VpnCheckItem['id'],
    status: VpnCheckItem['status'],
    extra: Partial<VpnCheckItem> = {},
  ): VpnCheckItem => ({ id, status, message: `${id} is ${status}`, ...extra });
  const result = (
    verdict: 'pass' | 'down' | 'leak',
    checks: VpnCheckItem[],
    extra: Partial<Extract<VpnCheckResult, { ok: true }>> = {},
  ): VpnCheckResult => ({
    ok: true,
    verdict,
    checks,
    egress: null,
    gluetunPublicIp: null,
    failClosed: false,
    ...extra,
  });
  const compared = { url: TRACE, vpn: '203.0.113.7', host: '198.51.100.2' };

  function summary(value: VpnCheckResult) {
    const term = capture();
    const code = printVpnCheck(value, { json: false }, term.io);
    const lines = term.stdout().split('\n');
    return { code, line: lines.at(-2), stdout: term.stdout(), stderr: term.stderr() };
  }

  it('says the traffic leaves only through the VPN just for addresses that were compared', () => {
    const ok = [item('route', 'ok'), item('egress', 'ok')];
    const passed = summary(result('pass', ok, { egress: compared }));
    expect(passed).toMatchObject({ code: 0, line: COMPARED });

    const others: VpnCheckResult[] = [
      // --no-egress
      result('pass', [item('route', 'ok')]),
      // the host could not ask
      result('pass', [item('egress', 'warning')], {
        egress: { ...compared, host: null },
      }),
      // an answer without an address
      result('pass', [item('egress', 'warning')], {
        egress: { ...compared, vpn: null, host: null },
      }),
      // an answer curl could not read
      result('pass', [item('egress', 'warning')], {
        egress: { ...compared, vpn: null, host: null },
      }),
      // both addresses known, but one IPv4 and one IPv6
      result('pass', [item('egress', 'warning')], {
        egress: { ...compared, host: '2001:db8::1' },
      }),
    ];
    for (const other of others) {
      expect(summary(other)).toMatchObject({ code: 0, line: NOT_COMPARED });
    }
  });

  it('says nothing leaks only for a down that is fail-closed', () => {
    const down = [item('gluetun', 'down', { hint: `see ${RUNBOOK}` })];
    expect(summary(result('down', down, { failClosed: true }))).toMatchObject({
      code: 1,
      line: CLOSED,
    });
    const open = summary(result('down', down));
    expect(open).toMatchObject({ code: 1, line: OPEN });
    expect(open.stdout).not.toContain('leaks');
    expect(open.stdout).not.toContain('fail-closed');
  });

  it('says a leak is a leak, even with a down beside it', () => {
    const leak = summary(
      result('leak', [item('network', 'leak'), item('gluetun', 'down')]),
    );
    expect(leak).toMatchObject({
      code: 1,
      line: `LEAK: qBittorrent's traffic does not go through the VPN. See ${RUNBOOK}.`,
    });
    expect(leak.stdout).not.toContain('nothing leaks');
  });

  it('marks each check, and shows a hint under any that is not ok', () => {
    const shown = summary(
      result('leak', [
        item('network', 'ok', { hint: 'never shown' }),
        item('control', 'warning', { hint: 'a warning hint' }),
        item('gluetun', 'down'),
        item('route', 'leak', { hint: 'a leak hint' }),
      ]),
    );
    expect(shown.stdout.split('\n').slice(0, 5)).toEqual([
      '  ok    network is ok',
      '  warn  control is warning',
      '        hint: a warning hint',
      '  DOWN  gluetun is down',
      '  LEAK  route is leak',
    ]);
    expect(shown.stdout).toContain('        hint: a leak hint\n');
    expect(shown.stdout).not.toContain('never shown');
  });

  it('prints an error result as diagnostics, and exits 1', () => {
    const failed: VpnCheckResult = {
      ok: false,
      diagnostics: [
        { severity: 'error', code: 'vpn-check.no-key', message: 'no key', hint: 'apply' },
      ],
    };
    const human = capture();
    expect(printVpnCheck(failed, { json: false }, human.io)).toBe(1);
    expect(human.stdout()).toBe('');
    expect(human.stderr()).toBe('error: no key\n  hint: apply\n');
    const json = capture();
    expect(printVpnCheck(failed, { json: true }, json.io)).toBe(1);
    expect(JSON.parse(json.stdout())).toMatchObject({
      schema: 'mediaplane.error/v1',
      ok: false,
    });
  });
});
