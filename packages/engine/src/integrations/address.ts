import type { ResolvedApp } from '../resolver/resolve';

/**
 * The service whose container serves `app` on the stack's networks: the app's own, or for
 * one in another app's network namespace, that app's (Gluetun's, for qBittorrent).
 */
export function serviceOf(app: ResolvedApp): string {
  return app.networkVia ?? app.def.id;
}

/**
 * How the stack's other apps reach `app`'s port `port` (by name), as one app is told of
 * another (spec §6.2): its service, and its container port, after `apps.<id>.port`.
 * Undefined when the stack doesn't run the app, or the app has no such port.
 */
export function serviceAddress(
  app: ResolvedApp | undefined,
  port: string,
): { host: string; port: number } | undefined {
  const container = app?.containerPorts[port];
  return app === undefined || container === undefined
    ? undefined
    : { host: serviceOf(app), port: container };
}
