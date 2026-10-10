import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import type { Catalog } from '../catalog/types';
import { loadConfigFile } from '../config/load';
import { error, withHint, type Diagnostic } from '../diagnostics';
import type { HostFacts } from '../host/facts';
import { dockerUnavailable, hostFactsOrFailure } from '../host/failure';
import { STACK_PATH } from '../paths';
import { startedBefore } from '../plan/stranded';
import { resolveStack, type ResolvedApp } from '../resolver/resolve';
import { runbookUrl } from '../runbooks';
import { RuntimeError, type ContainerState, type Runtime } from '../runtime/types';
import { readSecretStore } from '../secrets/store';
import { secretValues } from '../secrets/values';
import { egressAddress, isEgressUrl, type EgressResult } from './egress';
import {
  httpAnswer,
  parseProbe,
  probeCommand,
  routeDevice,
  type ProbeCheck,
  type ProbeLine,
  type ProbeOutput,
} from './probe';

/** Where a failed check sends you. */
export const VPN_RUNBOOK = runbookUrl('vpn-down');

/** The checks the probe always runs; it runs `egress` only when it is given a URL. */
const PROBE_CHECKS: readonly ProbeCheck[] = ['route', 'anonymous', 'status', 'publicip'];

/**
 * The name Compose gives a service's first container in `project`. Mediaplane never sets
 * `container_name`, so this is the name to give `docker restart` or `docker logs`.
 */
function containerName(project: string, service: string): string {
  return `${project}-${service}-1`;
}

export interface VpnCheckOptions {
  home: string;
  catalog: Catalog;
  /** Facts about the host, or how to get them (the host helper, in the image). */
  host: HostFacts | (() => Promise<HostFacts>);
  env: NodeJS.ProcessEnv;
  runtime: Runtime;
  /**
   * The Compose project `runtime` manages ("mediaplane", or MEDIAPLANE_COMPOSE_PROJECT's
   * "mediaplane-<name>"). Hints name its containers as Compose does: `<project>-<service>-1`.
   */
  project: string;
  /**
   * Compare the addresses qBittorrent and this host come from, as the IP-echo service at
   * `url` sees them. `fromHost` asks it from the host. Leave it out to check the
   * structure only (`--no-egress`).
   */
  egress?: { url: string; fromHost: (url: string) => Promise<EgressResult> };
}

/** pass: qBittorrent gets out only through the tunnel. down: the VPN doesn't work. */
export type VpnVerdict = 'pass' | 'leak' | 'down';

/** What one check found. `down` and `leak` fail the check, and say how. */
export interface VpnCheckItem {
  id: 'network' | 'gluetun' | 'control' | 'control-key' | 'route' | 'egress';
  status: 'ok' | 'warning' | 'down' | 'leak';
  message: string;
  hint?: string;
}

/** The addresses the IP-echo service at `url` saw; null where there was none. */
export interface VpnEgress {
  url: string;
  vpn: string | null;
  host: string | null;
}

export type VpnCheckResult =
  | {
      ok: true;
      verdict: VpnVerdict;
      checks: VpnCheckItem[];
      /** The addresses compared; null with --no-egress. */
      egress: VpnEgress | null;
      /** The address Gluetun reports for itself, when its public-IP lookup is on. */
      gluetunPublicIp: string | null;
      /**
       * True only when qBittorrent was shown to be in Gluetun's network, and either Gluetun
       * isn't running (it is exited, dead or created; not paused or restarting), or its
       * route goes into the tunnel or nowhere and nothing answered. Only then may a `down`
       * verdict say that nothing gets out.
       */
      failClosed: boolean;
    }
  | { ok: false; diagnostics: Diagnostic[] };

/**
 * `mediaplane vpn-check` (spec §5.2, §7.2(6)): whether qBittorrent can reach the internet
 * only through Gluetun's tunnel. It looks at the containers, then runs a probe inside
 * qBittorrent's network namespace (a throwaway container of qBittorrent's image, through
 * the runtime), and with `egress` compares where qBittorrent's traffic and the host's
 * come from. It changes nothing.
 */
export async function vpnCheck(options: VpnCheckOptions): Promise<VpnCheckResult> {
  try {
    return await check(options);
  } catch (cause) {
    if (cause instanceof RuntimeError) {
      return { ok: false, diagnostics: [dockerUnavailable(cause, options.env)] };
    }
    throw cause;
  }
}

async function check(options: VpnCheckOptions): Promise<VpnCheckResult> {
  const { egress, runtime, project } = options;
  // The URL isn't repeated: one with a password in it would show the password.
  if (egress !== undefined && !isEgressUrl(egress.url)) {
    return failure(
      'vpn-check.bad-url',
      "the egress check's URL must be an http or https URL with no user name or password",
      'set MEDIAPLANE_VPN_CHECK_URL to an IP-echo service such as https://1.1.1.1/cdn-cgi/trace, or unset it',
    );
  }
  const home = resolve(options.home);
  const loaded = await loadConfigFile(join(home, STACK_PATH));
  if (!loaded.ok) return { ok: false, diagnostics: loaded.diagnostics };
  const facts = await hostFactsOrFailure(options.host, options);
  if (!facts.ok) return { ok: false, diagnostics: [facts.diagnostic] };
  const resolved = resolveStack(loaded.config, options.catalog, facts.host, home);
  const stack = resolved.stack;
  if (stack === undefined) {
    return {
      ok: false,
      diagnostics: resolved.diagnostics.filter((d) => d.severity === 'error'),
    };
  }
  const app = (id: string) => stack.apps.find((a) => a.def.id === id);
  const qbittorrentApp = app('qbittorrent');
  const gluetunApp = app('gluetun');
  if (qbittorrentApp === undefined) {
    return failure(
      'vpn-check.no-qbittorrent',
      'this stack has no qBittorrent, so there is no VPN to check',
    );
  }
  if (qbittorrentApp.networkVia !== 'gluetun' || gluetunApp === undefined) {
    return verdictOf(
      [
        {
          id: 'network',
          status: 'leak',
          message:
            "qBittorrent runs without the VPN (apps.qbittorrent.vpn: false): peers see this host's own address",
          hint: 'add a vpn: block to stack.yaml, remove apps.qbittorrent.vpn: false, and run mediaplane apply',
        },
      ],
      null,
      null,
      false,
    );
  }
  const store = await readSecretStore(home);
  const key = store.apps.gluetun?.controlApiKey;
  if (key === undefined) {
    return failure(
      'vpn-check.no-key',
      "Mediaplane has no key to Gluetun's control server yet",
      'run "mediaplane apply": it generates the key before Gluetun first starts',
    );
  }

  const containers = await runtime.containers();
  const qbittorrent = containers.find((c) => c.service === 'qbittorrent');
  const gluetun = containers.find((c) => c.service === 'gluetun');
  if (qbittorrent === undefined) {
    return failure(
      'vpn-check.not-applied',
      'qBittorrent has no container in this stack yet',
      'run "mediaplane apply" first',
    );
  }
  const network = await networkCheck(runtime, project, containers, qbittorrent, gluetun);
  // Only a qBittorrent shown to be in Gluetun's network is shut in when Gluetun's way out
  // is: one in any other network may still get out (the "fail-closed" claim).
  const behindGluetun = network.status === 'ok' || network.status === 'warning';
  const checks: VpnCheckItem[] = [network, gluetunCheck(gluetun, behindGluetun)];
  // A Gluetun that isn't running is not probed: a stopped one leaves qBittorrent with
  // loopback only, and a paused one's control server can't answer.
  if (gluetun === undefined || gluetun.state !== 'running') {
    const unmeasured =
      egress === undefined ? null : { url: egress.url, vpn: null, host: null };
    return verdictOf(checks, unmeasured, null, behindGluetun && gluetunStopped(gluetun));
  }

  // compose run loads generated/.env, so every secret in it is replaced in the output.
  const values = await secretValues(stack, store, options.env);
  const command = probeCommand(
    key,
    gluetunApp.containerPorts.control ?? 8000,
    egress?.url,
    values,
  );
  const result = await runtime.run('qbittorrent', command);
  // The script prints a line for every check it runs, whatever the check found. One that
  // is missing was never run, and a check can't be judged on what it never asked.
  const probe = parseProbe(result.stdout, command.values);
  const expected: readonly ProbeCheck[] =
    egress === undefined ? PROBE_CHECKS : [...PROBE_CHECKS, 'egress'];
  const missing = expected.find((name) => probe[name] === undefined);
  if (missing !== undefined) {
    const why = lastLine(result.stderr);
    return Object.keys(probe).length === 0
      ? failure(
          'vpn-check.probe-failed',
          `the probe in qBittorrent's network could not run: ${why}`,
          'check that the qBittorrent image is present ("docker image ls"), then run vpn-check again',
        )
      : failure(
          'vpn-check.probe-failed',
          `the probe in qBittorrent's network stopped before its ${missing} check: ${why}`,
          `run vpn-check again; if it keeps stopping, look at qBittorrent's log ("docker logs ${containerName(project, 'qbittorrent')}")`,
        );
  }
  const tunnel = tunnelInterface(gluetunApp);
  checks.push(...controlChecks(probe, project), routeCheck(probe, tunnel));
  const publicIp = gluetunPublicIp(probe);
  if (egress === undefined || probe.egress === undefined) {
    return verdictOf(checks, null, publicIp, false);
  }
  // A request routed into the tunnel, or with no route at all, can't get out around the
  // VPN, whatever the service does. One routed elsewhere has only Gluetun's firewall in
  // its way, and one service's silence doesn't show that the firewall holds: so no answer
  // proves the way out shut only for the first two.
  const shut =
    behindGluetun && (routeDevice(probe.route) === tunnel || noRoute(probe.route));
  const compared = await egressCheck(probe.egress, egress, shut);
  checks.push(compared.item);
  return verdictOf(
    checks,
    compared.egress,
    publicIp,
    shut && compared.item.status === 'down',
  );
}

async function networkCheck(
  runtime: Runtime,
  project: string,
  containers: readonly ContainerState[],
  qbittorrent: ContainerState,
  gluetun: ContainerState | undefined,
): Promise<VpnCheckItem> {
  const restart = `docker restart ${containerName(project, 'qbittorrent')}`;
  const ids = gluetun === undefined ? [qbittorrent.id] : [qbittorrent.id, gluetun.id];
  const details = await runtime.inspect(ids);
  const of = (id: string) => details.find((d) => d.id === id);
  const mode = of(qbittorrent.id)?.networkMode ?? '';
  if (gluetun !== undefined && mode === `container:${gluetun.id}`) {
    if (qbittorrent.state !== 'running') {
      return {
        id: 'network',
        status: 'warning',
        message: `qBittorrent is ${qbittorrent.state}: it uses Gluetun's network, but sends nothing until it runs`,
        hint: 'run "mediaplane apply" to start it, then run vpn-check again',
      };
    }
    // A container joins another's namespace when it starts. Gluetun started again on its
    // own, after qBittorrent, has a new one; qBittorrent keeps the old, which is gone.
    const before = startedBefore(of(qbittorrent.id), of(gluetun.id));
    // A time that can't be read must not read as "not before".
    if (gluetun.state === 'running' && before === undefined) {
      return {
        id: 'network',
        status: 'down',
        message:
          "Mediaplane can't read qBittorrent's or Gluetun's start time, so it can't tell whether qBittorrent holds Gluetun's current network",
        hint: `see ${VPN_RUNBOOK}`,
      };
    }
    if (gluetun.state === 'running' && before === true) {
      return {
        id: 'network',
        status: 'down',
        message:
          'qBittorrent started before Gluetun last did, so it still holds the network Gluetun had then, which is gone: it has none',
        // Apply restarts it (strandedGuests), which says what it does; docker as well.
        hint: `run "mediaplane apply", which restarts it (or "${restart}")`,
      };
    }
    return {
      id: 'network',
      status: 'ok',
      message: "qBittorrent uses Gluetun's network, and has none of its own",
    };
  }
  const joined = /^container:(.+)$/.exec(mode)?.[1];
  if (joined !== undefined) {
    // Another running app of the stack has a way out of its own.
    const other = containers.find((c) => c.id === joined && c.state === 'running');
    if (other !== undefined) {
      return {
        id: 'network',
        status: 'leak',
        message: `qBittorrent uses ${other.service}'s network, not Gluetun's: its traffic does not go through the VPN`,
        hint: 'look for a network_mode under qbittorrent in compose.override.yaml, take it out, and run "mediaplane apply"',
      };
    }
    // Usually a Gluetun that has gone, but it may be a container outside the stack, which
    // has a network: so it says only what it knows. Docker keeps the ID, not the name, so
    // a restart can't rejoin a Gluetun that has gone: only a recreate can, as apply does.
    return {
      id: 'network',
      status: 'down',
      message: `qBittorrent uses the network of a container that isn't a running part of this stack (${joined.slice(0, 12)}), not Gluetun's`,
      hint: `run "mediaplane apply": it recreates qBittorrent in Gluetun's current network. If compose.override.yaml gives qbittorrent a network_mode, take it out first`,
    };
  }
  return {
    id: 'network',
    status: 'leak',
    message: `qBittorrent has a network of its own ("${mode}"), not Gluetun's: its traffic does not go through the VPN`,
    hint: 'run "mediaplane apply" to recreate it behind Gluetun, and check compose.override.yaml for a network_mode of its own',
  };
}

/**
 * The states of a Gluetun with no process, and so no network to share. A paused Gluetun's
 * tunnel and firewall are the kernel's, and keep working; a restarting one, or a state
 * Mediaplane doesn't know, isn't shown to have shut anything either.
 */
const STOPPED: ReadonlySet<string> = new Set(['exited', 'dead', 'created']);

/** Whether Gluetun has no container, or one with no process (STOPPED). */
function gluetunStopped(gluetun: ContainerState | undefined): boolean {
  return gluetun === undefined || STOPPED.has(gluetun.state);
}

/**
 * Whether Gluetun runs, healthy. `behindGluetun`: qBittorrent was shown to be in Gluetun's
 * network, so a stopped Gluetun shuts it in. Only then does it say that nothing gets out.
 */
function gluetunCheck(
  gluetun: ContainerState | undefined,
  behindGluetun: boolean,
): VpnCheckItem {
  if (gluetun === undefined || gluetun.state !== 'running') {
    const state = gluetun === undefined ? 'has no container' : `is ${gluetun.state}`;
    return {
      id: 'gluetun',
      status: 'down',
      message: gluetunStopped(gluetun)
        ? behindGluetun
          ? `Gluetun ${state}, so qBittorrent has no network: nothing gets out`
          : `Gluetun ${state}, so the VPN is down`
        : `Gluetun ${state}`,
      // A Gluetun with no process is started again by apply; a paused or restarting one
      // needs looking at.
      hint: gluetunStopped(gluetun)
        ? `run "mediaplane apply" to start Gluetun again, then see ${VPN_RUNBOOK} if it stops again`
        : `see ${VPN_RUNBOOK}`,
    };
  }
  if (gluetun.health !== 'healthy') {
    return {
      id: 'gluetun',
      status: 'down',
      message: `Gluetun is running, but ${gluetun.health === '' ? 'has no health status' : gluetun.health}: its health check needs a working tunnel`,
      hint: `see ${VPN_RUNBOOK}`,
    };
  }
  return { id: 'gluetun', status: 'ok', message: 'Gluetun is running and healthy' };
}

/** What Gluetun's control server says with Mediaplane's key, and without it. */
function controlChecks(probe: ProbeOutput, project: string): VpnCheckItem[] {
  const checks: VpnCheckItem[] = [];
  const status = httpAnswer(probe.status);
  const exit = probe.status?.exit ?? 0;
  const vpn =
    exit === 0 && status.status === 200 ? jsonField(status.body, 'status') : undefined;
  if (vpn === 'running') {
    checks.push({
      id: 'control',
      status: 'ok',
      message: "Gluetun's control server says the VPN is running",
    });
  } else if (vpn !== undefined) {
    checks.push({
      id: 'control',
      status: 'down',
      message: `Gluetun's control server says the VPN is ${vpn}`,
      hint: `see ${VPN_RUNBOOK}`,
    });
  } else {
    checks.push(controlWarning(status.status, exit));
  }
  const anonymous = httpAnswer(probe.anonymous).status;
  if (anonymous === 401) {
    checks.push({
      id: 'control-key',
      status: 'ok',
      message: "Gluetun's control server refuses requests without Mediaplane's key",
    });
  } else if (anonymous >= 200 && anonymous < 300) {
    checks.push({
      id: 'control-key',
      status: 'warning',
      message:
        "Gluetun's control server answers anyone on the stack's network, without a key: Gluetun has not read its key file since Mediaplane wrote it",
      hint: `restart Gluetun, then qBittorrent: "docker restart ${containerName(project, 'gluetun')}", then "docker restart ${containerName(project, 'qbittorrent')}" (Gluetun's README, "Set up before Slice 3a")`,
    });
  }
  return checks;
}

/**
 * The control server gave no status to read. curl exits non-zero when it could not
 * finish, such as for a body over the cap (63), even after it saw an HTTP status: what it
 * printed then is no answer.
 */
function controlWarning(status: number, exit: number): VpnCheckItem {
  const refused = exit === 0 && (status === 401 || status === 403);
  return {
    id: 'control',
    status: 'warning',
    message:
      status === 0
        ? "Gluetun's control server did not answer"
        : exit !== 0
          ? `Gluetun's control server's answer could not be read (curl exited ${String(exit)})`
          : refused
            ? "Gluetun's control server refused Mediaplane's key"
            : `Gluetun's control server answered HTTP ${String(status)}`,
    hint: refused
      ? 'appdata/gluetun/auth/config.toml holds another key than state/secrets.json: see Gluetun\'s README, "Set up before Slice 3a"'
      : `see ${VPN_RUNBOOK}`,
  };
}

function routeCheck(probe: ProbeOutput, tunnel: string): VpnCheckItem {
  const device = routeDevice(probe.route);
  if (device === tunnel) {
    return {
      id: 'route',
      status: 'ok',
      message: `qBittorrent's traffic is routed into the tunnel (${tunnel})`,
    };
  }
  const where =
    device === undefined
      ? `not routed into the tunnel (${tunnel})`
      : `routed to ${device}, not into the tunnel (${tunnel})`;
  // An answer from outside, with no route into the tunnel, came the other way.
  if (answered(probe.egress)) {
    return {
      id: 'route',
      status: 'leak',
      message: `qBittorrent's traffic is ${where}, and it still got an answer from outside: it leaves outside the VPN`,
      hint: `stop qBittorrent, then see ${VPN_RUNBOOK}`,
    };
  }
  return {
    id: 'route',
    status: 'down',
    message:
      device !== undefined
        ? `qBittorrent's traffic is ${where}`
        : noRoute(probe.route)
          ? "qBittorrent's network has no route out"
          : `Mediaplane could not read qBittorrent's route: ${lastLine(probe.route?.output ?? '')}`,
    hint: `see ${VPN_RUNBOOK}`,
  };
}

/**
 * Whether the route check found no route at all: `ip` failed with the kernel's "Network
 * unreachable" (busybox, as in qBittorrent's image) or "Network is unreachable"
 * (iproute2). Any other failure, such as an image without `ip`, shows nothing about the
 * route.
 */
function noRoute(line: ProbeLine | undefined): boolean {
  return (
    line !== undefined &&
    line.exit !== 0 &&
    /\bNetwork (?:is )?unreachable\b/.test(line.output)
  );
}

/**
 * curl's exit codes that need a server at the other end, so something got out: 1 (an
 * HTTP/0.9 reply), 8 (a reply it can't parse), 16 (HTTP/2 framing), 18 (a partial body),
 * 35 (a TLS handshake that failed), 52 (an empty reply), 55 (a send error once
 * connected), 56 (a receive error), 60 (a certificate it can't trust), 61 (a body in an
 * encoding it doesn't know), 63 (a body over --max-filesize) and 92 (an HTTP/2 stream
 * that broke).
 */
const AFTER_AN_ANSWER: ReadonlySet<number> = new Set([
  1, 8, 16, 18, 35, 52, 55, 56, 60, 61, 63, 92,
]);

/**
 * curl's message for a timeout once it was connected, whatever it received ("Operation
 * timed out after 2002 milliseconds with 0 bytes received"). One while it resolved or
 * connected says "Resolving timed out" or "Connection timed out".
 *
 * An accepted limit: curl 8 does the TLS handshake while it connects, so a TCP connection
 * that is up but whose handshake stalls also says "Connection timed out", and counts as
 * no answer. With the route into the tunnel, a working tunnel then reads as a `down` that
 * is fail-closed, and "nothing leaks" still holds: that route can't get out around the
 * VPN. With the route outside the tunnel, a leak reads as a `down`, which is then never
 * fail-closed. Both still exit 1, and neither can give a false pass. Telling them apart
 * (curl's `-w %{time_connect}`) would need a change to the probe's script.
 */
const TIMED_OUT_CONNECTED = /Operation timed out after \d+ milliseconds with /;

/** The same timeout, with nothing received at all: not even the headers' body size. */
const TIMED_OUT_EMPTY =
  /Operation timed out after \d+ milliseconds with 0 bytes received/;

/**
 * Whether the egress check got an answer from a server, even one curl couldn't finish.
 * This is inferred from curl's exit code: 0, one of AFTER_AN_ANSWER, or a timeout (28)
 * once curl was connected. Anything else (6, 7, a timeout while resolving or
 * connecting…) is no answer. curl's error line is looked for anywhere in the output: the
 * probe merges it into the body, which curl flushes after it, or around it for a body over
 * stdout's buffer.
 */
function answered(line: ProbeLine | undefined): boolean {
  if (line === undefined) return false;
  if (line.exit === 0 || AFTER_AN_ANSWER.has(line.exit)) return true;
  return line.exit === 28 && TIMED_OUT_CONNECTED.test(line.output);
}

/**
 * What the probe's egress check (`tunnel`) and the host saw, compared. `shut`:
 * qBittorrent is in Gluetun's network, and its route goes into the tunnel or nowhere, so
 * no answer means nothing of qBittorrent's gets out.
 */
async function egressCheck(
  tunnel: ProbeLine,
  egress: NonNullable<VpnCheckOptions['egress']>,
  shut: boolean,
): Promise<{ item: VpnCheckItem; egress: VpnEgress }> {
  const { url } = egress;
  if (!answered(tunnel)) {
    return {
      item: {
        id: 'egress',
        status: 'down',
        message: `qBittorrent's traffic got no answer from ${url}: ${lastLine(tunnel.output)}`,
        hint: shut
          ? `the VPN is down, and nothing gets out (fail-closed); see ${VPN_RUNBOOK}`
          : `the VPN is down; see ${VPN_RUNBOOK}`,
      },
      egress: { url, vpn: null, host: null },
    };
  }
  if (tunnel.exit !== 0) {
    const silent = tunnel.exit === 28 && TIMED_OUT_EMPTY.test(tunnel.output);
    return {
      item: {
        id: 'egress',
        status: 'warning',
        message: silent
          ? `qBittorrent connected to ${url}, but got no answer in time (curl exited 28), so the addresses were not compared`
          : `${url} answered qBittorrent, but its answer could not be read (curl exited ${String(tunnel.exit)}), so the addresses were not compared`,
        hint: 'set MEDIAPLANE_VPN_CHECK_URL to an IP-echo service, or unset it',
      },
      egress: { url, vpn: null, host: null },
    };
  }
  const vpn = egressAddress(tunnel.output) ?? null;
  if (vpn === null) {
    return {
      item: {
        id: 'egress',
        status: 'warning',
        message: `${url} answered qBittorrent without an address, so the addresses were not compared`,
        hint: 'set MEDIAPLANE_VPN_CHECK_URL to an IP-echo service, or unset it',
      },
      egress: { url, vpn, host: null },
    };
  }
  const host = await egress.fromHost(url);
  if (!host.ok) {
    return {
      item: {
        id: 'egress',
        status: 'warning',
        message: `qBittorrent's traffic leaves from ${vpn}, but this host could not ask ${url} for its own address (${host.error}), so the two were not compared`,
      },
      egress: { url, vpn, host: null },
    };
  }
  const [ours, theirs] = [canonicalAddress(vpn), canonicalAddress(host.address)];
  // An IPv4 and an IPv6 address always differ, and prove nothing.
  if (isIP(ours) !== isIP(theirs)) {
    return {
      item: {
        id: 'egress',
        status: 'warning',
        message: `qBittorrent's traffic leaves from ${vpn}, and this host's from ${host.address}: one IPv4 and one IPv6 address, so the two were not compared`,
        hint: 'set MEDIAPLANE_VPN_CHECK_URL to a service named by its IP address, such as https://1.1.1.1/cdn-cgi/trace, or unset it',
      },
      egress: { url, vpn, host: host.address },
    };
  }
  if (ours === theirs) {
    return {
      item: {
        id: 'egress',
        status: 'leak',
        message: `qBittorrent's traffic leaves from ${vpn}, which is this host's own address: it does not go through the VPN`,
        hint: `see ${VPN_RUNBOOK}`,
      },
      egress: { url, vpn, host: host.address },
    };
  }
  return {
    item: {
      id: 'egress',
      status: 'ok',
      message: `qBittorrent's traffic leaves from ${vpn}, and this host's from ${host.address}`,
    },
    egress: { url, vpn, host: host.address },
  };
}

/**
 * A leak beats down, and down beats a pass. `closed` says whether the VPN's way out is shut
 * (Gluetun STOPPED, or no answer with the route into the tunnel or nowhere); with a leak
 * elsewhere, such as a network of qBittorrent's own, something still gets out, so it is
 * never fail-closed.
 */
function verdictOf(
  checks: VpnCheckItem[],
  egress: VpnEgress | null,
  gluetunPublicIp: string | null,
  closed: boolean,
): VpnCheckResult {
  const verdict: VpnVerdict = checks.some((c) => c.status === 'leak')
    ? 'leak'
    : checks.some((c) => c.status === 'down')
      ? 'down'
      : 'pass';
  const failClosed = closed && verdict === 'down';
  return { ok: true, verdict, checks, egress, gluetunPublicIp, failClosed };
}

/** Gluetun's tunnel interface: tun0, unless apps.gluetun.env sets VPN_INTERFACE. */
function tunnelInterface(gluetun: ResolvedApp): string {
  const set = gluetun.settings.env.VPN_INTERFACE;
  return typeof set === 'string' && set !== '' ? set : 'tun0';
}

/**
 * An address in one spelling: IPv6 as the URL standard writes it (lower case, the longest
 * run of zeros shortened), and an IPv4 address mapped into IPv6 as plain IPv4. So the two
 * sides compare equal for one address, whichever way each was written.
 */
function canonicalAddress(address: string): string {
  if (isIP(address) !== 6) return address;
  let text: string;
  try {
    text = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    // A zone ("fe80::1%eth0") is valid to isIP, but not in a URL.
    return address.toLowerCase();
  }
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(text);
  if (mapped?.[1] === undefined || mapped[2] === undefined) return text;
  const [high, low] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)];
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

function gluetunPublicIp(probe: ProbeOutput): string | null {
  const answer = httpAnswer(probe.publicip);
  // As with the status: after a non-zero exit, what curl printed is no answer.
  if (probe.publicip?.exit !== 0 || answer.status !== 200) return null;
  // Only an address is shown: anything else, such as a control character, never reaches
  // the terminal.
  const address = jsonField(answer.body, 'public_ip');
  return address !== undefined && isIP(address) !== 0 ? address : null;
}

/** A string field of a JSON object, or undefined. */
function jsonField(body: string, field: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const value = (parsed as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function lastLine(text: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .at(-1) ?? 'no output'
  );
}

function failure(code: string, message: string, hint?: string): VpnCheckResult {
  return { ok: false, diagnostics: [error(code, message, withHint(hint))] };
}
