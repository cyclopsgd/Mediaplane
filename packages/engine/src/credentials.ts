import { join, resolve } from 'node:path';
import type { Catalog } from './catalog/types';
import { loadConfigFile } from './config/load';
import type { SecretRef } from './config/schema';
import { checkSecretRefs } from './config/secrets';
import { error, type Diagnostic } from './diagnostics';
import type { HostFacts } from './host/facts';
import { hostFactsOrFailure } from './host/failure';
import { STACK_PATH } from './paths';
import { resolveStack, type ResolvedApp } from './resolver/resolve';
import type { Runtime } from './runtime/types';
import {
  ADMIN_PASSWORD_PATH,
  adminLogin,
  adminPasswordToGenerate,
} from './secrets/admin';
import { readSecretStore } from './secrets/store';
import { compare } from './util/sort';

export interface CredentialsOptions {
  home: string;
  catalog: Catalog;
  /**
   * Facts about the host, or how to get them once they are needed. In its image,
   * Mediaplane asks the host helper (helperHostFacts), whose failure is an error result.
   */
  host: HostFacts | (() => Promise<HostFacts>);
  env: NodeJS.ProcessEnv;
  /** Only asked to explain a host helper that failed (is Docker reachable at all?). */
  runtime: Runtime;
}

/** The name of the catalog port that serves an app's web UI. */
const WEB_PORT = 'web';

/** One app's web UI, and how you sign in to it. */
export type AppLogin = {
  app: string;
  name: string;
  /** Where its web UI is published: one URL per address. */
  urls: string[];
} & ({ login: 'shared' } | { login: 'not-yet'; comingIn: string });

export type CredentialsResult =
  | {
      ok: true;
      username: string;
      /** In plain text: print it only where the user asked to see it. */
      password: string;
      /** generated: Mediaplane's, in state/secrets.json. yours: from admin.password. */
      source: { kind: 'generated' } | { kind: 'yours'; ref: string };
      apps: AppLogin[];
    }
  | { ok: false; diagnostics: Diagnostic[] };

/** The shared admin login, and the web address of each app that has a login (spec §5.2). */
export async function credentials(
  options: CredentialsOptions,
): Promise<CredentialsResult> {
  const home = resolve(options.home);
  const loaded = await loadConfigFile(join(home, STACK_PATH));
  if (!loaded.ok) return { ok: false, diagnostics: loaded.diagnostics };
  const { config } = loaded;
  // Only the admin password matters here: a missing VPN key doesn't hide the login.
  const problems = (await checkSecretRefs(config, home, options.env)).filter(
    (diagnostic) => diagnostic.path === ADMIN_PASSWORD_PATH,
  );
  if (problems.length > 0) return { ok: false, diagnostics: problems };
  const store = await readSecretStore(home);
  if (adminPasswordToGenerate(config, store)) {
    return {
      ok: false,
      diagnostics: [
        error('credentials.not-yet', 'the admin password has not been generated yet', {
          hint: 'run "mediaplane apply": it generates the password before it starts any app',
        }),
      ],
    };
  }
  const hostFacts = await hostFactsOrFailure(options.host, options);
  if (!hostFacts.ok) return { ok: false, diagnostics: [hostFacts.diagnostic] };
  const host = hostFacts.host;
  const resolved = resolveStack(config, options.catalog, host, home);
  if (resolved.stack === undefined) {
    return {
      ok: false,
      diagnostics: resolved.diagnostics.filter((d) => d.severity === 'error'),
    };
  }
  const login = await adminLogin(config, home, store, options.env);
  const addresses = webAddresses(resolved.stack.bindAddresses, host);
  return {
    ok: true,
    username: login.username,
    password: login.password,
    source:
      config.admin.password === undefined
        ? { kind: 'generated' }
        : { kind: 'yours', ref: describeRef(config.admin.password) },
    apps: resolved.stack.apps.flatMap((app) => appLogin(app, addresses)),
  };
}

function describeRef(ref: SecretRef): string {
  return 'file' in ref ? ref.file : `the environment variable ${ref.env}`;
}

/**
 * Where a browser reaches the web UIs. bind: all publishes on every interface, so name
 * this host's own addresses rather than 0.0.0.0.
 */
function webAddresses(bindAddresses: readonly string[], host: HostFacts): string[] {
  if (!bindAddresses.includes('0.0.0.0')) return [...bindAddresses];
  return ['127.0.0.1', ...host.privateAddresses.map((a) => a.address).sort(compare)];
}

function appLogin(app: ResolvedApp, addresses: readonly string[]): AppLogin[] {
  const { login, id, name } = app.def;
  if (login === undefined) return [];
  // The web UI only: an app may publish other ports, such as a peer or an API port.
  const urls = app.ports
    .filter((port) => port.name === WEB_PORT)
    .flatMap((port) => addresses.map((address) => `http://${address}:${port.host}`));
  return [
    login === 'shared'
      ? { app: id, name, urls, login: 'shared' }
      : { app: id, name, urls, login: 'not-yet', comingIn: login.comingIn },
  ];
}
