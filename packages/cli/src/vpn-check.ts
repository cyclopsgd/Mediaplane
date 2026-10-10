import { VPN_RUNBOOK, type VpnCheckItem, type VpnCheckResult } from '@mediaplane/engine';
import { printDiagnostics } from './output';
import type { Io } from './run';

export const VPN_CHECK_JSON_SCHEMA = 'mediaplane.vpn-check/v1';

const MARKS: Record<VpnCheckItem['status'], string> = {
  ok: 'ok',
  warning: 'warn',
  down: 'DOWN',
  leak: 'LEAK',
};

/**
 * `mediaplane vpn-check` (spec §5.2): each check, then the verdict. With --json, the
 * result as `mediaplane.vpn-check/v1`, where `ok` says the check ran and `verdict` what
 * it found. Returns the exit code: 0 only for a pass. An error result is printed as
 * diagnostics, which never repeat the egress URL.
 */
export function printVpnCheck(
  result: VpnCheckResult,
  options: { json: boolean },
  io: Io,
): number {
  if (!result.ok) {
    printDiagnostics(result.diagnostics, options, io);
    return 1;
  }
  const code = result.verdict === 'pass' ? 0 : 1;
  if (options.json) {
    const shown = {
      schema: VPN_CHECK_JSON_SCHEMA,
      ok: result.ok,
      verdict: result.verdict,
      checks: result.checks,
      egress: result.egress,
      gluetunPublicIp: result.gluetunPublicIp,
      failClosed: result.failClosed,
    };
    io.stdout(`${JSON.stringify(shown, null, 2)}\n`);
    return code;
  }
  for (const check of result.checks) {
    io.stdout(`  ${MARKS[check.status].padEnd(4)}  ${check.message}\n`);
    if (check.status !== 'ok' && check.hint !== undefined) {
      io.stdout(`        hint: ${check.hint}\n`);
    }
  }
  if (result.gluetunPublicIp !== null) {
    io.stdout(`Gluetun reports its public address as ${result.gluetunPublicIp}.\n`);
  }
  io.stdout(`\n${summary(result)}\n`);
  return code;
}

/** The summary line: never more than the checks found. */
function summary(result: Extract<VpnCheckResult, { ok: true }>): string {
  switch (result.verdict) {
    case 'pass':
      return compared(result)
        ? 'Passed: qBittorrent reaches the internet only through the VPN.'
        : "Passed: qBittorrent has no way out but the tunnel; its address was not compared with this host's.";
    case 'down':
      // Only a result that shows the way out shut may say that nothing leaks.
      return result.failClosed
        ? `VPN down: qBittorrent can't reach the internet, and nothing leaks (fail-closed). See ${VPN_RUNBOOK}.`
        : `VPN down: the checks marked DOWN say what failed. See ${VPN_RUNBOOK}.`;
    case 'leak':
      return `LEAK: qBittorrent's traffic does not go through the VPN. See ${VPN_RUNBOOK}.`;
  }
}

/**
 * Whether the two addresses were compared, and differed. Having both is not enough: an
 * IPv4 and an IPv6 address are both known, but prove nothing, and the egress check says
 * so with a warning. So the check itself must also be `ok`.
 */
function compared(result: Extract<VpnCheckResult, { ok: true }>): boolean {
  const { egress } = result;
  return (
    egress !== null &&
    egress.vpn !== null &&
    egress.host !== null &&
    result.checks.some((c) => c.id === 'egress' && c.status === 'ok')
  );
}
