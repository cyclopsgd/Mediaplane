import type { ComposeFile, ComposeService } from '../render/compose';
import { composeToYaml } from '../render/yaml';
import type { ContainerState, Runtime } from '../runtime/types';
import { planContainers, type ContainerAction, type ContainerChange } from './containers';

export type PredictResult =
  { ok: true; changes: ContainerChange[] } | { ok: false; error: string };

/** A service in another service's network namespace (`network_mode: service:<host>`). */
interface Guest {
  service: string;
  host: string;
  config: ComposeService;
}

/**
 * What `docker compose up` will do to each service of `compose`, given the project's
 * containers now, from the config hashes Compose computes (ADR 0010). Writes nothing.
 *
 * Before Compose hashes a guest, it rewrites `service:<host>` to `container:<the host's
 * full container ID>`; `config --hash` does not. So a guest of a host that is created or
 * recreated is recreated with it, and any other guest is planned from a second hash of
 * the compose with its host's container ID filled in.
 */
export async function predictContainers(
  compose: ComposeFile,
  values: Record<string, string>,
  runtime: Runtime,
  current: readonly ContainerState[],
): Promise<PredictResult> {
  const first = await runtime.configHashes(composeToYaml(compose), values);
  if (!first.ok) return first;
  const changes = planContainers(first.hashes, current);

  const planned = new Map(changes.map((change) => [change.service, change.action]));
  const byService = new Map(current.map((container) => [container.service, container]));
  const guestActions = new Map<string, ContainerAction>();
  const rehash: Record<string, ComposeService> = {};
  for (const guest of guestsOf(compose)) {
    const host = byService.get(guest.host);
    if (host === undefined || planned.get(guest.host) === 'recreate') {
      // A new host container means a new network namespace: Compose recreates the guest.
      guestActions.set(
        guest.service,
        byService.has(guest.service) ? 'recreate' : 'create',
      );
    } else if (byService.has(guest.service)) {
      rehash[guest.service] = { ...guest.config, network_mode: `container:${host.id}` };
    }
  }

  if (Object.keys(rehash).length > 0) {
    const second = await runtime.configHashes(
      composeToYaml({ ...compose, services: { ...compose.services, ...rehash } }),
      values,
    );
    if (!second.ok) return second;
    for (const change of planContainers(second.hashes, current)) {
      if (Object.hasOwn(rehash, change.service))
        guestActions.set(change.service, change.action);
    }
  }

  return {
    ok: true,
    changes: changes.map((change) => ({
      service: change.service,
      action: guestActions.get(change.service) ?? change.action,
    })),
  };
}

function guestsOf(compose: ComposeFile): Guest[] {
  return Object.entries(compose.services).flatMap(([service, config]) => {
    const host = /^service:(.+)$/.exec(config.network_mode ?? '')?.[1];
    return host === undefined ? [] : [{ service, host, config }];
  });
}
