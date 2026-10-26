import { readdir, readFile } from 'node:fs/promises';
import {
  checkOverrides,
  overrideTarget,
  SENDS_A_KEY,
  SHARED_LOGIN,
  stackJsonSchema,
} from '@mediaplane/engine';
import {
  undocumented,
  wiringStack,
  type DescribedSchema,
} from '@mediaplane/engine/testing';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { catalog } from './index';

const appFolders = (await readdir(new URL('.', import.meta.url), { withFileTypes: true }))
  .filter((e) => e.isDirectory() && !e.name.startsWith('_') && e.name !== 'node_modules')
  .map((e) => e.name)
  .sort();

const NO_OPTIONS = z.strictObject({});

/** Every app whose integration `id`'s comes after, through "after", directly or not. */
function comesAfter(id: string, seen = new Set<string>()): string[] {
  for (const other of catalog.find((app) => app.id === id)?.integration?.after ?? []) {
    if (seen.has(other)) continue;
    seen.add(other);
    comesAfter(other, seen);
  }
  return [...seen];
}

/**
 * Every managed field that says where an app sends a key: the stack's keys go only to its
 * own addresses (spec §11, Slice 6), so none of them can be kept or overridden.
 */
const SENDS_KEYS = [
  ...['sonarr', 'radarr'].flatMap((arr) => [
    `${arr}.download_client.host`,
    `${arr}.download_client.port`,
    `${arr}.download_client.useSsl`,
    `${arr}.connection_jellyfin.host`,
    `${arr}.connection_jellyfin.port`,
    `${arr}.connection_plex.host`,
    `${arr}.connection_plex.port`,
    `prowlarr.application_${arr}.baseUrl`,
    `prowlarr.application_${arr}.prowlarrUrl`,
    `seerr.server_${arr}.hostname`,
    `seerr.server_${arr}.port`,
  ]),
  'seerr.media_server.hostname',
  'seerr.media_server.port',
  'seerr.media_server_plex.hostname',
  'seerr.media_server_plex.port',
];

describe('catalog', () => {
  it("refuses an override of every field that says where a key goes, as Keep mine's", () => {
    for (const key of SENDS_KEYS) {
      const named = overrideTarget(catalog, key);
      expect(named.ok, key).toBe(false);
      if (named.ok) continue;
      expect(named.diagnostic).toMatchObject({
        code: 'overrides.locked',
        message: `${key} can't be kept: ${SENDS_A_KEY}`,
      });
    }
    // Prowlarr's indexer proxy, which your indexers' requests go through, is fixed too.
    expect(overrideTarget(catalog, 'prowlarr.indexer_proxy.host')).toMatchObject({
      ok: false,
      diagnostic: { code: 'overrides.locked' },
    });
  });

  it('locks each field that names where a resource sends a key, whatever resource gives one', () => {
    // Every resource that gives where it sends a key (`sendsTo`), in a stack of every
    // wired app, with either media server: each field named so, or holding one of its
    // addresses, can't be overridden.
    const keys = Object.fromEntries(
      ['sonarr', 'radarr', 'prowlarr', 'qbittorrent', 'jellyfin', 'seerr'].map((id) => [
        id,
        { apiKey: `fake-${id}-key` },
      ]),
    );
    const admin = { username: 'admin', password: 'fake-admin-password' };
    const looked: string[] = [];
    for (const server of [
      'media_server: jellyfin',
      'media_server: plex\nplex: { token: { env: PLEX_TOKEN } }',
    ]) {
      const stack = wiringStack(
        catalog,
        `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
${server}
apps:
  sonarr: {}
  radarr: {}
  prowlarr: {}
  byparr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`,
      );
      for (const app of stack.apps) {
        for (const spec of app.def.integration?.resources ?? []) {
          const desired = spec.desired({
            stack,
            app,
            admin,
            keys: { ...keys, plex: { token: 'fake-plex-token' } },
          });
          const to = desired?.sendsTo;
          if (desired === undefined || to === undefined) continue;
          const where = Object.values(to).filter(
            (v) => typeof v === 'string' && v !== '',
          );
          const naming = spec.fields.filter((field) => {
            const value = desired.fields[field];
            return (
              Object.hasOwn(to, field) || (value !== undefined && where.includes(value))
            );
          });
          const address = `${app.def.id}.${spec.name}`;
          looked.push(address);
          expect(naming.length, address).toBeGreaterThan(0);
          expect(
            naming.filter((field) => spec.locked?.[field] === undefined),
            address,
          ).toEqual([]);
        }
      }
    }
    expect([...new Set(looked)].sort()).toEqual([
      'prowlarr.application_radarr',
      'prowlarr.application_sonarr',
      'prowlarr.indexer_proxy',
      'radarr.connection_jellyfin',
      'radarr.connection_plex',
      'radarr.download_client',
      'seerr.media_server',
      'seerr.media_server_plex',
      'seerr.server_radarr',
      'seerr.server_sonarr',
      'sonarr.connection_jellyfin',
      'sonarr.connection_plex',
      'sonarr.download_client',
    ]);
  });

  it("refuses an override of an app's admin user name, and of who may skip qBittorrent's login", () => {
    for (const app of ['sonarr', 'radarr', 'prowlarr', 'jellyfin', 'qbittorrent']) {
      expect(overrideTarget(catalog, `${app}.admin.username`), app).toMatchObject({
        ok: false,
        diagnostic: {
          code: 'overrides.locked',
          message: `${app}.admin.username can't be kept: ${SHARED_LOGIN}`,
        },
      });
    }
    for (const field of ['authSubnetWhitelistEnabled', 'authSubnetWhitelist']) {
      expect(overrideTarget(catalog, `qbittorrent.preferences.${field}`)).toMatchObject({
        ok: false,
        diagnostic: {
          code: 'overrides.locked',
          message: `qbittorrent.preferences.${field} can't be kept: it says who may skip qBittorrent's login, a security setting: set security.login_on_lan in stack.yaml instead`,
        },
      });
    }
    // Its other preferences are yours to keep.
    expect(overrideTarget(catalog, 'qbittorrent.preferences.savePath').ok).toBe(true);
  });

  it("refuses an override whose value its field can't take, saying why", () => {
    const stack = (overrides: string) =>
      wiringStack(
        catalog,
        `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
media_server: jellyfin
apps:
  sonarr: {}
  prowlarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
overrides:
${overrides}`,
      );
    const wiring = {
      admin: { username: 'admin', password: 'fake-admin-password' },
      keys: {
        sonarr: { apiKey: 'fake-sonarr-key' },
        prowlarr: { apiKey: 'fake-prowlarr-key' },
        qbittorrent: { apiKey: 'fake-qbittorrent-key' },
        jellyfin: { apiKey: 'fake-jellyfin-key' },
      },
    };
    const refused = (line: string) =>
      checkOverrides(stack(`  ${line}\n`), catalog, wiring).map(
        (d) => `${d.code}: ${d.message}`,
      );
    // A category qBittorrent saves under /data/torrents/<category>: a subcategory too.
    for (const fine of ['television', 'tv/anime', '"tv shows"']) {
      expect(refused(`sonarr.download_client.category: ${fine}`), fine).toEqual([]);
    }
    for (const [bad, why] of [
      ['""', 'it is empty'],
      [
        '..',
        'it has a "." or ".." folder, which would take the downloads out of /data/torrents',
      ],
      [
        'tv/../../etc',
        'it has a "." or ".." folder, which would take the downloads out of /data/torrents',
      ],
      [
        './tv',
        'it has a "." or ".." folder, which would take the downloads out of /data/torrents',
      ],
      ['/srv', 'it has a "/" at either end, or two together'],
      ['tv//anime', 'it has a "/" at either end, or two together'],
      ['tv/', 'it has a "/" at either end, or two together'],
      ['"tv\\\\anime"', 'it holds a "\\"'],
      ['"tv\\tanime"', 'it holds a control character'],
    ] as const) {
      expect(refused(`sonarr.download_client.category: ${bad}`), bad).toEqual([
        `overrides.value: sonarr.download_client.category can't be used: qBittorrent saves the category's downloads in /data/torrents/<category>, so it must be a folder name, or several joined by "/", such as tv/anime, and ${why}`,
      ]);
    }
    expect(refused('jellyfin.library_shows.paths: " , "')).toEqual([
      `overrides.value: jellyfin.library_shows.paths can't be used: a library holds at least one folder: name each one, separated by ","`,
    ]);
    expect(refused('prowlarr.application_sonarr.syncCategories: "5000, tv"')).toEqual([
      `overrides.value: prowlarr.application_sonarr.syncCategories can't be used: each category Prowlarr syncs is a number, such as 5000, separated by ","`,
    ]);
    expect(refused('prowlarr.application_sonarr.syncCategories: "5000, 5010"')).toEqual(
      [],
    );
    expect(refused('seerr.server_sonarr.activeProfile: 4')).toEqual([
      "overrides.value: seerr.server_sonarr.activeProfile can't be used: it is the name of one of Sonarr's quality profiles, which is text",
    ]);
    expect(refused('seerr.server_sonarr.activeProfile: HD-1080p')).toEqual([]);
  });

  it('registers every app folder exactly once, sorted by id', () => {
    expect(catalog.map((app) => app.id)).toEqual(appFolders);
  });

  it("describes every app's own options, for the reference and the JSON Schema", () => {
    expect(undocumented(stackJsonSchema(catalog) as DescribedSchema)).toEqual([]);
  });

  it('gives an API to the apps Mediaplane wires', () => {
    expect(catalog.filter((app) => app.api !== undefined).map((app) => app.id)).toEqual([
      'jellyfin',
      'plex',
      'prowlarr',
      'qbittorrent',
      'radarr',
      'seerr',
      'sonarr',
    ]);
  });

  describe.each(
    catalog.flatMap((app) =>
      app.api === undefined ? [] : [[app.id, app, app.api] as const],
    ),
  )("%s's API", (_id, app, api) => {
    it('is served on a port it declares, with a key it declares', () => {
      expect(app.ports.map((port) => port.name)).toContain(api.port);
      expect(Object.keys(app.secrets)).toContain(api.key.secret);
      expect(api.ready).toMatch(/^\//);
      expect(api.check).toMatch(/^\//);
      // The check needs the key; the ready path mustn't.
      expect(api.check).not.toBe(api.ready);
    });
  });

  it('gives a first-run setup to the apps that open one to anyone, each with the key its API carries', () => {
    const set = catalog.filter((app) => app.bootstrap !== undefined);
    expect(set.map((app) => app.id)).toEqual(['jellyfin', 'plex', 'seerr']);
    for (const app of set) {
      const key = app.api?.key.secret ?? '';
      const made = app.bootstrap?.secret;
      // One whose setup makes its key names it; one that makes none has a key of
      // Mediaplane's (Seerr's), or yours (Plex's token), which its done file can't stand
      // in for.
      if (made === undefined) {
        expect([{ generate: 'hex32' }, { userProvided: 'plex.token' }]).toContainEqual(
          app.secrets[key],
        );
      } else {
        expect(made).toBe(key);
        expect(app.secrets[made]).toEqual({ createdBy: 'app' });
      }
      expect(app.bootstrap?.done.path).not.toMatch(/^\/|\.\./);
    }
  });

  it('wires Seerr with Plex as with Jellyfin, and you sign in to it with your own Plex account there', () => {
    const seerr = (server: string) =>
      wiringStack(
        catalog,
        `version: 1
paths: { data: /srv/data }
network: { bind: localhost }
${server}
apps:
  sonarr: {}
  qbittorrent: { vpn: false }
  seerr: {}
`,
      ).apps.find((app) => app.def.id === 'seerr');
    const plex = seerr('media_server: plex\nplex: { token: { env: PLEX_TOKEN } }');
    const jellyfin = seerr('media_server: jellyfin');
    for (const app of [plex, jellyfin]) {
      expect(app?.def.api).toBeDefined();
      expect(app?.def.integration).toBeDefined();
      expect(app?.def.bootstrap).toBeDefined();
    }
    const loginIn = (app: typeof plex) =>
      typeof app?.def.login === 'function'
        ? app.def.login(app.context.config)
        : app?.def.login;
    expect(loginIn(plex)).toEqual({ own: 'Plex' });
    expect(loginIn(jellyfin)).toBe('shared');
  });

  it("waits for Jellyfin's server itself: its /health says 200 Degraded at every start", () => {
    // In its first seconds the server answers 503 to everything else (probed on 12.2).
    const jellyfin = catalog.find((app) => app.id === 'jellyfin');
    expect(jellyfin?.health).toEqual({
      test: ['CMD-SHELL', 'curl -fsS http://localhost:8096/health | grep -qx Healthy'],
      startPeriod: '120s',
    });
  });

  it('orders the integrations with no loop in their "after"', () => {
    const after = new Map(catalog.map((app) => [app.id, app.integration?.after ?? []]));
    const visit = (id: string, path: readonly string[]): void => {
      expect(path, `a loop: ${[...path, id].join(' → ')}`).not.toContain(id);
      for (const next of after.get(id) ?? []) visit(next, [...path, id]);
    };
    for (const app of catalog) visit(app.id, []);
  });

  it("has no login still to come, and Plex's is your own Plex account, at /web", () => {
    expect(
      catalog.filter((app) => typeof app.login === 'object' && 'comingIn' in app.login),
    ).toEqual([]);
    const plex = catalog.find((app) => app.id === 'plex');
    expect(plex?.login).toEqual({ own: 'Plex' });
    expect(plex?.webPath).toBe('/web');
    expect(
      catalog.filter((app) => app.webPath !== undefined).map((app) => app.id),
    ).toEqual(['plex']);
  });

  it("mounts a folder of FlareSolverr's own where its image declares a volume, as the image's user", () => {
    // Without it, every FlareSolverr container leaves an anonymous volume when removed.
    const flaresolverr = catalog.find((app) => app.id === 'flaresolverr');
    expect(flaresolverr?.volumes).toEqual({ appdata: '/config' });
    expect(flaresolverr?.runAs).toBe('fixed:1000');
  });

  it("gives each Cloudflare solver a health check, and its API on the port Prowlarr's proxy names", () => {
    // Prowlarr tests a new indexer proxy as it saves it: up --wait must wait until the
    // solver answers, or the wire step's create would race its start.
    const solvers = catalog.filter((app) => app.provides.includes('cloudflare-solver'));
    expect(solvers.map((app) => app.id)).toEqual(['byparr', 'flaresolverr']);
    for (const solver of solvers) {
      expect(typeof solver.health, `${solver.id}'s health check`).toBe('object');
      expect(solver.ports).toEqual([{ name: 'api', container: 8191, publish: false }]);
    }
  });

  it('gives an admin of its own to every app that can hold the shared admin password, which sets it there', () => {
    // An app named in shared.adminPasswordNotIn leaves it once its own admin is set
    // through its key: each app that a setup signs in to as the shared admin, or that a
    // pre-start file gives the password, has that way out.
    const own = catalog.flatMap((app) =>
      (app.integration?.resources ?? [])
        .filter((resource) => resource.ownAdmin === true)
        .map((resource) => [app.id, resource.name, resource.secrets] as const),
    );
    expect(own).toEqual(
      ['jellyfin', 'prowlarr', 'qbittorrent', 'radarr', 'sonarr'].map(
        (id) => [id, 'admin', ['password']] as const,
      ),
    );
    const signsIn = catalog.filter(
      (app) =>
        app.bootstrap?.secret !== undefined &&
        app.bootstrap.secret === app.api?.key.secret,
    );
    expect(signsIn.map((app) => app.id)).toEqual(['jellyfin']);
    for (const app of signsIn) expect(own.map(([id]) => id)).toContain(app.id);
    expect(own.map(([id]) => id)).toContain('qbittorrent');
  });

  it('gives an integration to the apps Mediaplane wires so far', () => {
    expect(
      catalog.filter((app) => app.integration !== undefined).map((app) => app.id),
    ).toEqual([
      'jellyfin',
      'plex',
      'prowlarr',
      'qbittorrent',
      'radarr',
      'seerr',
      'sonarr',
    ]);
  });

  describe.each(
    catalog.flatMap((app) =>
      app.integration === undefined ? [] : [[app.id, app, app.integration] as const],
    ),
  )("%s's integration", (_id, app, integration) => {
    it('wires itself only through an API, with resources named and checked as the contract says', () => {
      expect(app.api).toBeDefined();
      for (const other of integration.after) {
        expect(catalog.map((def) => def.id)).toContain(other);
      }
      const addresses = catalog.flatMap((def) =>
        (def.integration?.resources ?? []).map((r) => `${def.id}.${r.name}`),
      );
      for (const resource of integration.resources) {
        expect(resource.name).toMatch(/^[a-z][a-z0-9_]*$/);
        for (const field of resource.fields) expect(field).toMatch(/^[a-z][A-Za-z0-9]*$/);
        // A secret is applied and checked, never compared: something must check it.
        if (resource.secrets.length > 0) expect(typeof resource.verify).toBe('function');
        // resources.json keeps the fields, and only the secrets' names: none is both.
        expect(resource.fields.filter((f) => resource.secrets.includes(f))).toEqual([]);
        for (const needed of resource.requires ?? []) expect(addresses).toContain(needed);
        // What an override can't change, and what is held as a list, are managed fields.
        for (const field of [
          ...Object.keys(resource.locked ?? {}),
          ...(resource.lists ?? []),
        ]) {
          expect(resource.fields, `${app.id}.${resource.name}.${field}`).toContain(field);
        }
      }
      const names = integration.resources.map((r) => r.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('requires only what is wired before it: its own earlier resources, or those of an app it comes after', () => {
      // plan and the wire step see a requirement only once they have visited it: one
      // visited later counts as in place, and the arr's test could make a missing
      // qBittorrent category during plan. The order of the ids must not be what saves it.
      const before = comesAfter(app.id);
      for (const [index, resource] of integration.resources.entries()) {
        for (const needed of resource.requires ?? []) {
          const [owner, name] = needed.split('.');
          const what = `${app.id}.${resource.name} requires ${needed}`;
          if (owner === app.id) {
            const earlier = integration.resources.slice(0, index).map((r) => r.name);
            expect(earlier, what).toContain(name);
          } else {
            expect(before, `${what}, so it must come after ${String(owner)}`).toContain(
              owner,
            );
          }
        }
      }
    });
  });

  describe.each(catalog.map((app) => [app.id, app] as const))('%s', (_id, app) => {
    it('is pinned by exact tag and multi-arch digest', () => {
      expect(app.image.tag).not.toBe('latest');
      expect(app.image.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('supports amd64 and arm64', () => {
      expect(app.arch).toEqual(expect.arrayContaining(['amd64', 'arm64']));
    });

    it('has unique port names', () => {
      const names = app.ports.map((port) => port.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it('has unique container ports per protocol', () => {
      const listeners = app.ports.map(
        (port) => `${port.protocol ?? 'tcp'}/${port.container}`,
      );
      expect(new Set(listeners).size).toBe(listeners.length);
    });

    it('writes pre-start files only into its own appdata volume', () => {
      expect(app.configFiles === undefined || app.volumes.appdata !== undefined).toBe(
        true,
      );
    });

    it('says how you sign in, exactly when it publishes a web UI', () => {
      const published = app.ports.some((port) => port.publish !== false);
      expect(app.login !== undefined).toBe(published);
    });

    it('names its web UI port "web", which `mediaplane credentials` lists', () => {
      if (app.login === undefined) return;
      expect(
        app.ports.filter((port) => port.name === 'web' && port.publish !== false),
      ).toHaveLength(1);
    });

    it('only injects secrets it declares', () => {
      for (const step of app.credentials) {
        if (step.step === 'env') expect(Object.keys(app.secrets)).toContain(step.secret);
      }
    });

    it('names no secret env<Name>, which would collide with apps.<id>.env', () => {
      // secretEnvName(id, 'envToken') is MP_<ID>_ENV_TOKEN, the same variable as
      // apps.<id>.env.TOKEN (appEnvSecretName).
      for (const name of Object.keys(app.secrets)) expect(name).not.toMatch(/^env[A-Z]/);
    });

    it('has options that are an object, or none, so the JSON Schema can list them', () => {
      expect(app.options === undefined || app.options instanceof z.ZodObject).toBe(true);
    });

    it('has a README with a block for the generated facts', async () => {
      const readme = await readFile(
        new URL(`./${app.id}/README.md`, import.meta.url),
        'utf8',
      );
      expect(readme).toContain(
        '<!-- BEGIN GENERATED by "pnpm docs:generate" from app.ts.',
      );
      expect(readme).toContain('<!-- END GENERATED -->');
    });

    it('accepts empty options and implies only catalog apps', () => {
      const options = (app.options ?? NO_OPTIONS).parse({});
      for (const implied of app.implies?.(options) ?? []) {
        expect(catalog.map((other) => other.id)).toContain(implied);
      }
    });
  });
});
