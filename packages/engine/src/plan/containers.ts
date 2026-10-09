import { portKey } from '../preflight/checks';
import type { ContainerState } from '../runtime/types';
import { compare } from '../util/sort';

export type ContainerAction = 'create' | 'recreate' | 'start' | 'remove' | 'unchanged';

export interface ContainerChange {
  service: string;
  action: ContainerAction;
}

/**
 * What `docker compose up` will do to each service, given the config hash Compose
 * computes for the new configuration and the hash label on the existing containers.
 */
export function planContainers(
  desired: Record<string, string>,
  current: readonly ContainerState[],
): ContainerChange[] {
  const byService = new Map(current.map((container) => [container.service, container]));
  const changes: ContainerChange[] = Object.keys(desired)
    .sort(compare)
    .map((service): ContainerChange => {
      const container = byService.get(service);
      if (container === undefined) return { service, action: 'create' };
      if (container.configHash !== desired[service])
        return { service, action: 'recreate' };
      if (container.state !== 'running') return { service, action: 'start' };
      return { service, action: 'unchanged' };
    });
  const removed = [...byService.keys()]
    .filter((service) => !Object.hasOwn(desired, service))
    .sort(compare)
    .map((service): ContainerChange => ({ service, action: 'remove' }));
  return [...changes, ...removed];
}

/** portKey()s the project's containers publish now. */
export function ownPorts(containers: readonly ContainerState[]): Set<string> {
  return new Set(
    containers.flatMap((container) =>
      container.published.map((p) => portKey(p.protocol, p.address, p.port)),
    ),
  );
}
