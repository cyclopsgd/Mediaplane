import { readdir, readFile } from 'node:fs/promises';
import { stackJsonSchema } from '@mediaplane/engine';
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

describe('catalog', () => {
  it('registers every app folder exactly once, sorted by id', () => {
    expect(catalog.map((app) => app.id)).toEqual(appFolders);
  });

  it("describes every app's own options, for the reference and the JSON Schema", () => {
    expect(undocumented(stackJsonSchema(catalog) as DescribedSchema)).toEqual([]);
  });

  it('gives an API to the apps Mediaplane wires', () => {
    expect(catalog.filter((app) => app.api !== undefined).map((app) => app.id)).toEqual([
      'jellyfin',
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
    expect(set.map((app) => app.id)).toEqual(['jellyfin', 'seerr']);
    for (const app of set) {
      const key = app.api?.key.secret ?? '';
      const made = app.bootstrap?.secret;
      // One whose setup makes its key names it; one that makes none has a key of
      // Mediaplane's, which its done file can't stand in for.
      if (made === undefined) expect(app.secrets[key]).toEqual({ generate: 'hex32' });
      else {
        expect(made).toBe(key);
        expect(app.secrets[made]).toEqual({ createdBy: 'app' });
      }
      expect(app.bootstrap?.done.path).not.toMatch(/^\/|\.\./);
    }
  });

  it("isn't wired with Plex yet, Seerr, whose login there comes with Slice 7", () => {
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
      ).apps.find((app) => app.def.id === 'seerr')?.def;
    const plex = seerr('media_server: plex\nplex: { token: { env: PLEX_TOKEN } }');
    expect([plex?.api, plex?.integration, plex?.bootstrap]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(plex?.login).toEqual({ comingIn: 'Slice 7' });
    const jellyfin = seerr('media_server: jellyfin');
    expect(jellyfin?.api).toBeDefined();
    expect(jellyfin?.bootstrap).toBeDefined();
    expect(jellyfin?.login).toBe('shared');
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

  it('names the slice that brings each login still to come', () => {
    expect(
      Object.fromEntries(
        catalog.flatMap((app) =>
          app.login === undefined || app.login === 'shared'
            ? []
            : [[app.id, app.login.comingIn]],
        ),
      ),
    ).toEqual({ plex: 'Slice 7' });
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

  it('gives an integration to the apps Mediaplane wires so far', () => {
    expect(
      catalog.filter((app) => app.integration !== undefined).map((app) => app.id),
    ).toEqual(['jellyfin', 'prowlarr', 'qbittorrent', 'radarr', 'seerr', 'sonarr']);
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
