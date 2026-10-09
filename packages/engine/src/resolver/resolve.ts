import { z } from 'zod';
import type { AppContext, AppDefinition, Catalog, PortSpec } from '../catalog/types';
import type { AppSettings, StackConfig } from '../config/schema';
import { error, hasErrors, warning, withHint, type Diagnostic } from '../diagnostics';
import { inSubnet, networkOf, type HostFacts } from '../host/facts';
import { didYouMean } from '../util/did-you-mean';
import { compare, unique } from '../util/sort';

export interface PublishedPort {
  app: string;
  name: string;
  host: number;
  container: number;
  protocol: 'tcp' | 'udp';
}

export interface ResolvedApp {
  def: AppDefinition;
  settings: AppSettings;
  context: AppContext;
  /** repo:tag@digest, or repo:version when the user overrides the version. */
  image: string;
  /** The app whose network namespace this one shares, if any. */
  networkVia: string | undefined;
  /** Ports published for this app, on its own service or on networkVia's. */
  ports: PublishedPort[];
  /** Port name → container port, after overrides. */
  containerPorts: Record<string, number>;
}

export interface ResolvedStack {
  config: StackConfig;
  /** Absolute Mediaplane home directory. */
  home: string;
  /** Enabled apps, sorted by id. */
  apps: ResolvedApp[];
  bindAddresses: string[];
  lanSubnets: string[];
}

export interface ResolveResult {
  /** Undefined whenever any diagnostic is an error. */
  stack: ResolvedStack | undefined;
  diagnostics: Diagnostic[];
}

interface EnabledApp {
  def: AppDefinition;
  options: Record<string, unknown>;
}

const NO_OPTIONS = z.strictObject({});
const DEFAULT_SETTINGS: AppSettings = { enabled: true, env: {} };

/** "download-client:torrent" satisfies "download-client". */
export function provides(def: AppDefinition, capability: string): boolean {
  return def.provides.some((p) => p === capability || p.startsWith(`${capability}:`));
}

export function resolveStack(
  config: StackConfig,
  catalog: Catalog,
  host: HostFacts,
  home: string,
): ResolveResult {
  const byId = new Map(catalog.map((def) => [def.id, def]));
  const diagnostics = checkListedApps(config, byId);
  const lanSubnets =
    config.network.lan_subnet === undefined
      ? unique(host.privateAddresses.map((a) => networkOf(a.cidr)))
      : [config.network.lan_subnet];

  const { enabled, unparsed } = enableApps(
    requestedApps(config, byId),
    config,
    byId,
    diagnostics,
  );
  const apps = enabled.map(({ def, options }): ResolvedApp => {
    const settings = config.apps[def.id] ?? DEFAULT_SETTINGS;
    const context: AppContext = { config, settings, options, lanSubnets };
    diagnostics.push(...checkApp(def, settings, context, host));
    return {
      def,
      settings,
      context,
      image: imageRef(def, settings, diagnostics),
      networkVia: def.networkVia?.(options),
      ...resolvePorts(def, settings, diagnostics),
    };
  });

  diagnostics.push(
    ...checkCapabilities(
      apps.map((a) => a.def),
      unparsed,
      catalog,
    ),
    ...checkNetworkVia(apps, unparsed),
    ...checkPortConflicts(apps),
    ...checkNamespacePorts(apps),
  );
  const bind = bindAddresses(config, host);
  diagnostics.push(...bind.diagnostics);

  if (hasErrors(diagnostics)) return { stack: undefined, diagnostics };
  return {
    stack: { config, home, apps, bindAddresses: bind.addresses, lanSubnets },
    diagnostics,
  };
}

function checkListedApps(
  config: StackConfig,
  byId: ReadonlyMap<string, AppDefinition>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ids = [...byId.keys()];
  for (const [id, settings] of Object.entries(config.apps)) {
    const def = byId.get(id);
    if (def === undefined) {
      const suggestion = didYouMean(id, ids);
      diagnostics.push(
        error('app.unknown', `unknown app "${id}"`, {
          path: `apps.${id}`,
          ...withHint(
            suggestion === undefined ? undefined : `did you mean "${suggestion}"?`,
          ),
        }),
      );
    } else if (
      def.category === 'media-server' &&
      id !== config.media_server &&
      settings.enabled
    ) {
      diagnostics.push(
        error(
          'app.media-server-conflict',
          `apps.${id} is listed, but media_server is "${config.media_server}"`,
          {
            path: `apps.${id}`,
            hint: `Mediaplane runs one media server: change media_server or remove apps.${id}`,
          },
        ),
      );
    }
  }
  if (config.apps[config.media_server]?.enabled === false) {
    diagnostics.push(
      error(
        'app.media-server-disabled',
        `media_server is "${config.media_server}" but apps.${config.media_server}.enabled is false`,
        { path: `apps.${config.media_server}.enabled` },
      ),
    );
  }
  return diagnostics;
}

/** The chosen media server plus every listed, enabled, known app. */
function requestedApps(
  config: StackConfig,
  byId: ReadonlyMap<string, AppDefinition>,
): string[] {
  const requested = new Set<string>([config.media_server]);
  for (const [id, settings] of Object.entries(config.apps)) {
    const def = byId.get(id);
    if (def === undefined || !settings.enabled) continue;
    if (def.category === 'media-server' && id !== config.media_server) continue;
    requested.add(id);
  }
  return [...requested].sort(compare);
}

/**
 * Requested apps plus everything they imply, with options parsed. Each app is attempted
 * once. Apps whose options are invalid are returned as `unparsed`: their option errors are
 * reported once, and later checks still know they are enabled.
 */
function enableApps(
  requested: readonly string[],
  config: StackConfig,
  byId: ReadonlyMap<string, AppDefinition>,
  diagnostics: Diagnostic[],
): { enabled: EnabledApp[]; unparsed: AppDefinition[] } {
  const enabled = new Map<string, EnabledApp>();
  const unparsed = new Map<string, AppDefinition>();
  const visited = new Set<string>();
  const pending = [...requested];
  for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
    const def = byId.get(id);
    if (def === undefined || visited.has(id)) continue;
    visited.add(id);
    const options = parseOptions(def, config.apps[id] ?? DEFAULT_SETTINGS, diagnostics);
    if (options === undefined) {
      unparsed.set(id, def);
      continue;
    }
    enabled.set(id, { def, options });
    for (const implied of def.implies?.(options) ?? []) {
      const impliedDef = byId.get(implied);
      if (impliedDef === undefined || config.apps[implied]?.enabled === false) continue;
      const others = unique([...requested, ...enabled.keys()])
        .filter((other) => other !== implied)
        .map((other) => byId.get(other))
        .filter((other): other is AppDefinition => other !== undefined);
      const taken = (impliedDef.exclusive ?? []).some((capability) =>
        others.some((other) => provides(other, capability)),
      );
      if (!taken) pending.push(implied);
    }
  }
  return {
    enabled: [...enabled.values()].sort((a, b) => compare(a.def.id, b.def.id)),
    unparsed: [...unparsed.values()],
  };
}

function parseOptions(
  def: AppDefinition,
  settings: AppSettings,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  const { enabled, port, version, env, ...raw } = settings;
  const schema: z.ZodType<Record<string, unknown>> = def.options ?? NO_OPTIONS;
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const path = ['apps', def.id, ...issue.path.map(String)].join('.');
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        diagnostics.push(
          error('app.unknown-option', `unknown option "${path}.${key}"`, {
            path: `${path}.${key}`,
          }),
        );
      }
    } else {
      diagnostics.push(
        error('app.invalid-option', `${path}: ${issue.message}`, { path }),
      );
    }
  }
  return undefined;
}

function checkApp(
  def: AppDefinition,
  settings: AppSettings,
  context: AppContext,
  host: HostFacts,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!def.arch.includes(host.arch)) {
    diagnostics.push(
      error('app.unsupported-arch', `${def.name} has no ${host.arch} image`, {
        path: `apps.${def.id}`,
        hint: 'disable it, or run Mediaplane on a supported host',
      }),
    );
  }
  // Env vars Mediaplane owns: secrets it injects, and port variables that keep the host
  // and container ports equal (the user's `env` is applied last, so it must not win).
  const secretVars = def.credentials.flatMap((step) =>
    step.step === 'env' ? [step.var] : [],
  );
  const portVars = def.ports.flatMap((port) =>
    port.hostEqualsContainer ? [port.hostEqualsContainer.env] : [],
  );
  const reserved = new Set([...secretVars, ...portVars]);
  for (const key of Object.keys(settings.env)) {
    if (reserved.has(key)) {
      diagnostics.push(
        error(
          'app.env-reserved',
          `apps.${def.id}.env.${key} is managed by Mediaplane and cannot be overridden`,
          {
            path: `apps.${def.id}.env.${key}`,
            ...withHint(
              portVars.includes(key) ? `set apps.${def.id}.port instead` : undefined,
            ),
          },
        ),
      );
    }
  }
  diagnostics.push(...(def.validate?.(context) ?? []));
  return diagnostics;
}

function imageRef(
  def: AppDefinition,
  settings: AppSettings,
  diagnostics: Diagnostic[],
): string {
  const { repo, tag, digest } = def.image;
  if (settings.version === undefined || settings.version === tag) {
    return `${repo}:${tag}@${digest}`;
  }
  diagnostics.push(
    warning(
      'app.untested-version',
      `${def.name} ${settings.version} is an untested combination; this Mediaplane release tests ${tag}`,
      { path: `apps.${def.id}.version` },
    ),
  );
  return `${repo}:${settings.version}`;
}

function resolvePorts(
  def: AppDefinition,
  settings: AppSettings,
  diagnostics: Diagnostic[],
): { ports: PublishedPort[]; containerPorts: Record<string, number> } {
  const published = def.ports.filter((spec) => spec.publish !== false);
  if (settings.port !== undefined && published.length === 0) {
    diagnostics.push(
      error(
        'app.port-not-published',
        `${def.name} publishes no port, so apps.${def.id}.port cannot be used`,
        { path: `apps.${def.id}.port` },
      ),
    );
  }
  const ports: PublishedPort[] = [];
  const containerPorts: Record<string, number> = {};
  for (const spec of def.ports) {
    const isPrimary = spec === published[0];
    const host =
      isPrimary && settings.port !== undefined ? settings.port : spec.container;
    const container = spec.hostEqualsContainer ? host : spec.container;
    containerPorts[spec.name] = container;
    if (spec.publish !== false) {
      ports.push({
        app: def.id,
        name: spec.name,
        host,
        container,
        protocol: spec.protocol ?? 'tcp',
      });
    }
  }
  return { ports, containerPorts };
}

/**
 * Requirements are checked for `enabled` apps only, but `unparsed` apps (listed with
 * invalid options) still count as providers, so their option error is the only report.
 */
function checkCapabilities(
  enabled: readonly AppDefinition[],
  unparsed: readonly AppDefinition[],
  catalog: Catalog,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const available = [...enabled, ...unparsed];
  for (const def of enabled) {
    for (const requirement of def.requires) {
      const count = available.filter((other) =>
        provides(other, requirement.capability),
      ).length;
      if (count >= requirement.min) continue;
      const candidates = catalog
        .filter((other) => provides(other, requirement.capability))
        .map((other) => other.id);
      diagnostics.push(
        error(
          'app.missing-capability',
          `${def.name} needs a ${requirement.capability}, but none is enabled`,
          {
            path: `apps.${def.id}`,
            ...withHint(
              candidates.length > 0
                ? `enable one of: ${candidates.join(', ')}`
                : undefined,
            ),
          },
        ),
      );
    }
  }
  const exclusive = unique(enabled.flatMap((def) => def.exclusive ?? [])).sort(compare);
  for (const capability of exclusive) {
    const providers = enabled.filter((def) => provides(def, capability));
    if (providers.length > 1) {
      diagnostics.push(
        error(
          'app.conflict',
          `${providers.map((p) => p.name).join(' and ')} each provide ${capability}; enable only one`,
        ),
      );
    }
  }
  return diagnostics;
}

/** `unparsed` apps are enabled (their option errors are reported separately). */
function checkNetworkVia(
  apps: readonly ResolvedApp[],
  unparsed: readonly AppDefinition[],
): Diagnostic[] {
  const ids = new Set([
    ...apps.map((app) => app.def.id),
    ...unparsed.map((def) => def.id),
  ]);
  return apps.flatMap((app) =>
    app.networkVia === undefined || ids.has(app.networkVia)
      ? []
      : [
          error(
            'app.network-via-missing',
            `${app.def.name} runs inside ${app.networkVia}'s network, but ${app.networkVia} is not enabled`,
            { path: `apps.${app.networkVia}.enabled` },
          ),
        ],
  );
}

function checkPortConflicts(apps: readonly ResolvedApp[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const owners = new Map<string, string>();
  for (const app of apps) {
    for (const port of app.ports) {
      const key = `${port.protocol}/${port.host}`;
      const owner = owners.get(key);
      if (owner === undefined) {
        owners.set(key, app.def.id);
        continue;
      }
      diagnostics.push(
        error(
          'port.conflict',
          `port ${port.host}/${port.protocol} is used by both ${owner} and ${app.def.id}`,
          {
            path: `apps.${app.def.id}.port`,
            hint: `set apps.${app.def.id}.port to a free port`,
          },
        ),
      );
    }
  }
  return diagnostics;
}

/**
 * Apps sharing a network namespace (qBittorrent inside Gluetun) listen on the same
 * interfaces, so their container ports must differ, published or not. The guest (the app
 * that sets networkVia) is blamed, because it is the one the user can move; with two
 * guests, or none, the later app is blamed.
 */
function checkNamespacePorts(apps: readonly ResolvedApp[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const listeners = new Map<string, { app: ResolvedApp; spec: PortSpec }>();
  for (const app of apps) {
    const namespace = app.networkVia ?? app.def.id;
    for (const spec of app.def.ports) {
      const port = app.containerPorts[spec.name] ?? spec.container;
      const protocol = spec.protocol ?? 'tcp';
      const key = `${namespace}/${protocol}/${port}`;
      const first = listeners.get(key);
      if (first === undefined) {
        listeners.set(key, { app, spec });
        continue;
      }
      // Duplicate ports within one app are a catalog error, caught by the catalog tests.
      if (first.app.def.id === app.def.id) continue;
      const [blamed, other] =
        first.app.networkVia !== undefined && app.networkVia === undefined
          ? [first, { app, spec }]
          : [{ app, spec }, first];
      // apps.<id>.port moves only the first published port, and only if host and
      // container ports must match.
      const primary = blamed.app.def.ports.find((p) => p.publish !== false);
      const movable =
        blamed.spec === primary && blamed.spec.hostEqualsContainer !== undefined;
      diagnostics.push(
        error(
          'port.namespace-conflict',
          `${other.app.def.name} and ${blamed.app.def.name} both listen on port ${port}/${protocol} inside ${namespace}'s network`,
          {
            path: `apps.${blamed.app.def.id}.port`,
            ...withHint(
              movable ? `set apps.${blamed.app.def.id}.port to another port` : undefined,
            ),
          },
        ),
      );
    }
  }
  return diagnostics;
}

function bindAddresses(
  config: StackConfig,
  host: HostFacts,
): { addresses: string[]; diagnostics: Diagnostic[] } {
  switch (config.network.bind) {
    case 'localhost':
      return { addresses: ['127.0.0.1'], diagnostics: [] };
    case 'all':
      return {
        addresses: ['0.0.0.0'],
        diagnostics: [
          warning(
            'network.bind-all',
            'network.bind is "all": app web UIs are published on every host interface',
            {
              path: 'network.bind',
              hint: 'on an internet-facing host this exposes the stack publicly; prefer "lan", or "localhost" with Tailscale',
            },
          ),
        ],
      };
    case 'lan': {
      const subnet = config.network.lan_subnet;
      if (host.cloud !== undefined && subnet === undefined) {
        return {
          addresses: [],
          diagnostics: [
            error(
              'network.cloud-lan',
              `network.bind is "lan", but this host looks like a ${host.cloud} VM, where private addresses are often reachable from the internet`,
              {
                path: 'network.bind',
                hint: 'use bind: localhost and reach the stack through Tailscale or an SSH tunnel; if you are sure, set network.lan_subnet to the private network to publish on',
              },
            ),
          ],
        };
      }
      const addresses = host.privateAddresses
        .filter((a) => subnet === undefined || inSubnet(a.address, subnet))
        .map((a) => a.address)
        .sort(compare);
      if (addresses.length > 0) return { addresses, diagnostics: [] };
      return {
        addresses: [],
        diagnostics: [
          error(
            'network.no-lan-address',
            subnet === undefined
              ? 'network.bind is "lan", but this host has no private (RFC 1918) IPv4 address'
              : `network.bind is "lan", but none of this host's private addresses is inside network.lan_subnet ${subnet}`,
            {
              path: subnet === undefined ? 'network.bind' : 'network.lan_subnet',
              hint: 'use bind: localhost and reach the stack through Tailscale or an SSH tunnel',
            },
          ),
        ],
      };
    }
  }
}
