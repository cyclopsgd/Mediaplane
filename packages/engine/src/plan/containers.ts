import { warning, type Diagnostic } from '../diagnostics';
import { ownPortKey } from '../preflight/checks';
import type { ContainerState } from '../runtime/types';
import { compare, unique } from '../util/sort';

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

/**
 * Apps whose health check has not passed yet ("starting" or "unhealthy"), as
 * "<service> (<health>)", sorted. `up --wait` waits for them again, so they are part of
 * the plan (ADR 0004). Only services the plan leaves unchanged are listed, so all their
 * containers are running: one that is stopped, out of date or unwanted is already in
 * `changes` as a start, recreate or remove.
 */
export function notYetHealthy(
  current: readonly ContainerState[],
  changes: readonly ContainerChange[],
): string[] {
  const unchanged = new Set(
    changes.filter((change) => change.action === 'unchanged').map((c) => c.service),
  );
  const waiting = current
    .filter((c) => unchanged.has(c.service) && c.health !== '' && c.health !== 'healthy')
    .map((c) => `${c.service} (${c.health})`);
  return [...new Set(waiting)].sort(compare);
}

/** ownPortKey()s the project's containers publish now, at any address. */
export function ownPorts(containers: readonly ContainerState[]): Set<string> {
  return new Set(
    containers.flatMap((container) =>
      container.published.map((p) => ownPortKey(p.protocol, p.port)),
    ),
  );
}

/**
 * A warning when the project's containers were created from a folder other than this home
 * (roadmap S2c). Usually another Mediaplane home manages a Compose project with the same
 * name, and apply would take its containers over.
 */
export function otherHomes(
  current: readonly ContainerState[],
  home: string,
): Diagnostic[] {
  const others = unique(
    current.flatMap((c) =>
      c.workingDir === undefined || c.workingDir === home ? [] : [c.workingDir],
    ),
  ).sort(compare);
  if (others.length === 0) return [];
  return [
    warning(
      'project.other-home',
      `this stack's containers were created from ${others.join(', ')}, not from this Mediaplane home (${home})`,
      {
        hint: 'if another Mediaplane home still manages them, apply would take them over: check which home is in use before applying',
      },
    ),
  ];
}
