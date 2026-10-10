import { redact } from '../runtime/redact';
import type { OneOffCommand } from '../runtime/types';
import { EGRESS_MAX_BYTES, EGRESS_TIMEOUT_MS } from './egress';

/** A public address to ask the namespace's route to. Only the route is read: no traffic. */
export const ROUTE_TARGET = '1.1.1.1';

/** The probe runs as nobody: it reads, and writes nothing. */
export const PROBE_USER = { uid: 65534, gid: 65534 } as const;

/**
 * What vpn-check runs inside qBittorrent's network namespace, with `sh` from qBittorrent's
 * own image (busybox `ip` and `base64`, and curl). Its arguments are Gluetun's control
 * port and the egress URL ("" for none); Mediaplane's key to the control server comes on
 * stdin and goes to curl as a header file on stdin, so it is never on a command line.
 * Every curl starts with -q and --noproxy '*': it reads no .curlrc (qBittorrent's
 * appdata is its HOME) and no proxy setting, so neither can see the key or fake an answer.
 * Every answer it reads is capped at EGRESS_MAX_BYTES (curl's --max-filesize), and the
 * egress URL follows --url, so a value that starts with "-" is never read as an option.
 * No curl has -f: an answer with any HTTP status still proves the path. The variables it
 * assigns are unset first, so one the environment exported can't carry the key to a child.
 * Each check prints one line: its name, its exit status, and its output in base64. The
 * line ends in a space when a check printed nothing.
 */
export const PROBE_SCRIPT = [
  'unset key url base name out code',
  'IFS= read -r key || true',
  'base="http://127.0.0.1:$1"',
  'url=$2',
  'anonymous() {',
  `  curl -q -s --noproxy '*' -o /dev/null --max-time 5 -w '%{http_code}' "$base/v1/vpn/status"`,
  '}',
  'withkey() {',
  `  printf 'X-API-Key: %s\\n' "$key" |`,
  `    curl -q -s --noproxy '*' --max-time 5 --max-filesize ${String(EGRESS_MAX_BYTES)} -H @- -w '\\n%{http_code}' "$base$1"`,
  '}',
  'report() {',
  '  name=$1',
  '  shift',
  '  out=$("$@" 2>&1)',
  '  code=$?',
  `  printf '%s %s %s\\n' "$name" "$code" "$(printf '%s' "$out" | base64 | tr -d '\\n')"`,
  '}',
  `report route ip route get ${ROUTE_TARGET}`,
  'report anonymous anonymous',
  'report status withkey /v1/vpn/status',
  'report publicip withkey /v1/publicip/ip',
  `[ -z "$url" ] || report egress curl -q -sS --noproxy '*' --max-time ${String(EGRESS_TIMEOUT_MS / 1000)} --max-filesize ${String(EGRESS_MAX_BYTES)} --url "$url"`,
  '',
].join('\n');

/** The probe's checks, in the order it runs them. */
export type ProbeCheck = 'route' | 'anonymous' | 'status' | 'publicip' | 'egress';

/** One check's exit status, and what it printed. */
export interface ProbeLine {
  exit: number;
  output: string;
}

export type ProbeOutput = Partial<Record<ProbeCheck, ProbeLine>>;

/**
 * The one-off command for `runtime.run`: the probe, given the key and what to ask.
 * `values` are the stack's secret values, which `compose run` loads from .env as apply's
 * helpers do: they are replaced with `***` in what it prints, and so is the key.
 */
export function probeCommand(
  key: string,
  controlPort: number,
  url: string | undefined,
  values: Record<string, string> = {},
): OneOffCommand {
  return {
    user: PROBE_USER,
    entrypoint: 'sh',
    args: ['-c', PROBE_SCRIPT, 'vpn-check', String(controlPort), url ?? ''],
    input: `${key}\n`,
    values: { ...values, controlApiKey: key },
  };
}

// A check that printed nothing ends in a space, which trim() removes: the output is optional.
const LINE = /^(route|anonymous|status|publicip|egress) (\d+)(?: ([A-Za-z0-9+/=]*))?$/;

/**
 * The probe's lines, by check. Anything else it printed is ignored. Each output is
 * decoded from base64, which `run()` can't see into, so `secrets` (the values given to
 * `run()`) are replaced with `***` here, in what was decoded.
 */
export function parseProbe(
  stdout: string,
  secrets: Readonly<Record<string, string>>,
): ProbeOutput {
  const found: ProbeOutput = {};
  for (const line of stdout.split('\n')) {
    const match = LINE.exec(line.trim());
    if (match?.[1] === undefined) continue;
    found[match[1] as ProbeCheck] = {
      exit: Number(match[2]),
      output: redact(Buffer.from(match[3] ?? '', 'base64').toString('utf8'), secrets),
    };
  }
  return found;
}

/** The device a route goes through: "tun0" in `1.1.1.1 dev tun0 src 10.66.0.2`. */
export function routeDevice(line: ProbeLine | undefined): string | undefined {
  if (line === undefined || line.exit !== 0) return undefined;
  return /\bdev (\S+)/.exec(line.output)?.[1];
}

/**
 * An HTTP answer the probe's curl printed: the body, then the status code on the last
 * line. Status 0 means no answer at all.
 */
export function httpAnswer(line: ProbeLine | undefined): {
  status: number;
  body: string;
} {
  if (line === undefined) return { status: 0, body: '' };
  const lines = line.output.split('\n');
  const status = Number(lines.pop());
  return { status: Number.isInteger(status) ? status : 0, body: lines.join('\n') };
}
