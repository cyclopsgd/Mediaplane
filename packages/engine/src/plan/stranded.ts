import type { ResolvedStack } from '../resolver/resolve';
import type { ContainerDetails, ContainerState, Runtime } from '../runtime/types';
import { compare } from '../util/sort';
import type { ContainerChange } from './containers';

/**
 * Whether `guest`, which shares `host`'s network namespace, last started before `host`
 * did: it then holds the namespace the host had, which is gone, so it has no network.
 * Undefined when either start time can't be read.
 */
export function startedBefore(
  guest: ContainerDetails | undefined,
  host: ContainerDetails | undefined,
): boolean | undefined {
  const started = (details: ContainerDetails | undefined) =>
    Date.parse(details?.startedAt ?? '');
  const [ours, theirs] = [started(guest), started(host)];
  if (Number.isNaN(ours) || Number.isNaN(theirs)) return undefined;
  return ours < theirs;
}

/**
 * The guests apply must restart (spec §6.4): an app such as qBittorrent, running in
 * another app's network namespace and otherwise unchanged, whose host, Gluetun, apply
 * starts again, or which started before its host's current run. Compose restarts a guest
 * when it recreates its host (depends_on restart), but not when it starts a stopped host
 * again (verified with Compose 5.5.1), so a guest would be left with no network.
 */
export async function strandedGuests(
  stack: ResolvedStack,
  current: readonly ContainerState[],
  changes: readonly ContainerChange[],
  runtime: Runtime,
): Promise<string[]> {
  const action = (service: string) => changes.find((c) => c.service === service)?.action;
  const runningOne = (service: string) =>
    current.find((c) => c.service === service && c.state === 'running');
  const stranded: string[] = [];
  const pairs: { service: string; guest: ContainerState; host: ContainerState }[] = [];
  for (const app of stack.apps) {
    const hostService = app.networkVia;
    const guest = runningOne(app.def.id);
    if (hostService === undefined || guest === undefined) continue;
    if (action(app.def.id) !== 'unchanged') continue;
    if (action(hostService) === 'start') {
      stranded.push(app.def.id);
      continue;
    }
    const host = runningOne(hostService);
    if (host !== undefined && action(hostService) === 'unchanged') {
      pairs.push({ service: app.def.id, guest, host });
    }
  }
  if (pairs.length > 0) {
    const details = await runtime.inspect(pairs.flatMap((p) => [p.guest.id, p.host.id]));
    const of = (id: string) => details.find((d) => d.id === id);
    for (const { service, guest, host } of pairs) {
      if (startedBefore(of(guest.id), of(host.id)) === true) stranded.push(service);
    }
  }
  return stranded.sort(compare);
}
