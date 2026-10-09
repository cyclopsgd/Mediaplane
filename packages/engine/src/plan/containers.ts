import { ownPortKey } from '../preflight/checks';
import type { ContainerState } from '../runtime/types';
import { compare } from '../util/sort';

export type ContainerAction = 'create' | 'recreate' | 'start' | 'remove' | 'unchanged';

export interface ContainerChange {
  service: string;
  action: ContainerAction;
}

/** The project's containers by service. A service can have several (scale, leftovers). */
export function groupByService(
  current: readonly ContainerState[],
): Map<string, ContainerState[]> {
  const groups = new Map<string, ContainerState[]>();
  for (const container of current) {
    const group = groups.get(container.service) ?? [];
    group.push(container);
    groups.set(container.service, group);
  }
  return groups;
}

/**
 * What `docker compose up` will do to each service, given the config hash Compose
 * computes for the new configuration and the hash labels on the existing containers.
 * Compose reconciles every container of a service, so a service is unchanged only when
 * all of its containers are current and running.
 */
export function planContainers(
  desired: Record<string, string>,
  current: readonly ContainerState[],
): ContainerChange[] {
  const groups = groupByService(current);
  const changes: ContainerChange[] = Object.keys(desired)
    .sort(compare)
    .map((service): ContainerChange => {
      const containers = groups.get(service) ?? [];
      if (containers.length === 0) return { service, action: 'create' };
      if (containers.some((c) => c.configHash !== desired[service]))
        return { service, action: 'recreate' };
      if (containers.some((c) => c.state !== 'running'))
        return { service, action: 'start' };
      return { service, action: 'unchanged' };
    });
  const removed = [...groups.keys()]
    .filter((service) => !Object.hasOwn(desired, service))
    .sort(compare)
    .map((service): ContainerChange => ({ service, action: 'remove' }));
  return [...changes, ...removed];
}

/** ownPortKey()s the project's containers publish now, at any address. */
export function ownPorts(containers: readonly ContainerState[]): Set<string> {
  return new Set(
    containers.flatMap((container) =>
      container.published.map((p) => ownPortKey(p.protocol, p.port)),
    ),
  );
}
