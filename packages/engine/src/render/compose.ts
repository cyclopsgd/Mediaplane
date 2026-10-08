import type { PublishedPort, ResolvedApp, ResolvedStack } from '../resolver/resolve';
import { compare } from '../util/sort';

export interface ComposeHealthcheck {
  test: string[];
  interval: string;
  timeout: string;
  retries: number;
  start_period: string;
}

/** The subset of the Compose spec Mediaplane emits. Key order here is output order. */
export interface ComposeService {
  image: string;
  restart: 'unless-stopped';
  user?: string;
  init?: boolean;
  cap_add?: string[];
  devices?: string[];
  network_mode?: string;
  depends_on?: Record<string, { condition: 'service_healthy'; restart: boolean }>;
  environment?: Record<string, string>;
  volumes?: string[];
  ports?: string[];
  labels: Record<string, string>;
  healthcheck?: ComposeHealthcheck;
}

export interface ComposeFile {
  name: string;
  services: Record<string, ComposeService>;
}

export const PROJECT_NAME = 'mediaplane';

/** Name of the .env variable carrying an app's secret, e.g. MP_SONARR_API_KEY. */
export function secretEnvName(appId: string, secret: string): string {
  const snake = secret.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return `MP_${appId}_${snake}`.replace(/-/g, '_').toUpperCase();
}

/** Escape a literal value so Compose does not interpolate it. */
export function literal(value: string): string {
  return value.replaceAll('$', () => '$$');
}

export function renderCompose(stack: ResolvedStack): ComposeFile {
  // Ports of an app that shares another app's network namespace are published there.
  const portsByService = new Map<string, string[]>();
  for (const app of stack.apps) {
    const target = app.networkVia ?? app.def.id;
    const ports = portsByService.get(target) ?? [];
    for (const port of app.ports) {
      for (const address of stack.bindAddresses) ports.push(portMapping(address, port));
    }
    portsByService.set(target, ports);
  }
  const services: Record<string, ComposeService> = {};
  for (const app of stack.apps) {
    services[app.def.id] = renderService(
      app,
      stack,
      portsByService.get(app.def.id) ?? [],
    );
  }
  return { name: PROJECT_NAME, services };
}

function portMapping(address: string, port: PublishedPort): string {
  const suffix = port.protocol === 'udp' ? '/udp' : '';
  return `${address}:${port.host}:${port.container}${suffix}`;
}

function renderService(
  app: ResolvedApp,
  stack: ResolvedStack,
  ports: string[],
): ComposeService {
  const { def, context, networkVia } = app;
  const extras = def.extras?.(context) ?? {};
  const environment = renderEnvironment(app, stack);
  const volumes = renderVolumes(app, stack);
  const { uid, gid } = stack.config.user;
  return {
    image: app.image,
    restart: 'unless-stopped',
    ...(def.runAs === 'user-directive' ? { user: `${uid}:${gid}` } : {}),
    ...(extras.init === undefined ? {} : { init: extras.init }),
    ...(extras.cap_add === undefined ? {} : { cap_add: extras.cap_add }),
    ...(extras.devices === undefined ? {} : { devices: extras.devices }),
    ...(networkVia === undefined
      ? {}
      : {
          network_mode: `service:${networkVia}`,
          depends_on: {
            [networkVia]: { condition: 'service_healthy' as const, restart: true },
          },
        }),
    ...(Object.keys(environment).length === 0 ? {} : { environment }),
    ...(volumes.length === 0 ? {} : { volumes }),
    ...(ports.length === 0 ? {} : { ports }),
    labels: { 'io.mediaplane.app': def.id, 'io.mediaplane.managed': 'true' },
    ...(typeof def.health === 'object'
      ? { healthcheck: healthcheck(def.health.test, def.health.startPeriod) }
      : {}),
  };
}

function healthcheck(test: string[], startPeriod = '60s'): ComposeHealthcheck {
  return { test, interval: '30s', timeout: '10s', retries: 5, start_period: startPeriod };
}

function renderEnvironment(
  app: ResolvedApp,
  stack: ResolvedStack,
): Record<string, string> {
  const { def, context, settings } = app;
  const env: Record<string, string> = { TZ: literal(stack.config.timezone) };
  if (def.runAs === 'puid-env') {
    env.PUID = String(stack.config.user.uid);
    env.PGID = String(stack.config.user.gid);
  }
  for (const [key, value] of Object.entries(def.env?.(context) ?? {})) {
    env[key] = literal(value);
  }
  for (const port of def.ports) {
    if (port.hostEqualsContainer) {
      env[port.hostEqualsContainer.env] = String(
        app.containerPorts[port.name] ?? port.container,
      );
    }
  }
  for (const step of def.credentials) {
    if (step.step === 'env') env[step.var] = `\${${secretEnvName(def.id, step.secret)}}`;
  }
  for (const [key, value] of Object.entries(settings.env)) env[key] = literal(value);
  return Object.fromEntries(Object.entries(env).sort(([a], [b]) => compare(a, b)));
}

function renderVolumes(app: ResolvedApp, stack: ResolvedStack): string[] {
  const { appdata, data } = app.def.volumes;
  const volumes: string[] = [];
  if (appdata !== undefined) {
    volumes.push(literal(`${stack.home}/appdata/${app.def.id}:${appdata}`));
  }
  if (data !== undefined) volumes.push(literal(`${stack.config.paths.data}:${data}`));
  return volumes;
}
