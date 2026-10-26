import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeExec, readSecretStore, type ExecResult } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import {
  composeDown,
  docker,
  expectWiringRemoved,
  getJson,
  makeHome,
  qbittorrentForm,
  REPO,
  runTeardown,
  stackFor,
} from './helpers';

const PROJECT = `mediaplane-e2e-${String(process.pid)}-remove`;

const MAIN = join(REPO, 'packages', 'cli', 'src', 'main.ts');

/** Where the apps' web UIs are, on 127.0.0.1. */
const PORTS = { prowlarr: 9696, qbittorrent: 8080, seerr: 5055 } as const;

/** A torrent of no real content: a made-up hash, added stopped, never started. */
const TORRENT = '0123456789abcdef0123456789abcdef01234567';

/** The apps' secrets, once the first apply has made them: no output may hold one. */
let secrets: readonly string[] = [];

/**
 * `mediaplane <args>` as a script runs it (spec §5.2): from source, without a terminal, so
 * it asks nothing; only its exit code and its --json are read.
 */
async function mediaplane(...args: string[]): Promise<{ code: number; json: unknown }> {
  const result: ExecResult = await nodeExec(
    process.execPath,
    ['--import', 'tsx', MAIN, ...args, '--json'],
    {
      cwd: REPO,
      env: { ...process.env, MEDIAPLANE_COMPOSE_PROJECT: PROJECT },
      timeoutMs: 900_000,
    },
  );
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    // Its own text is never shown: it could hold what the command printed of an app.
    throw new Error(
      `mediaplane ${args[0] ?? ''} --json printed no JSON (exit ${String(result.code)}, ${String(result.stdout.length)} characters)`,
    );
  }
  // Every output is checked: a yes or no per secret, which never prints either.
  expectNoSecret(`mediaplane ${args[0] ?? ''}'s JSON`, result.stdout, secrets);
  return { code: result.code, json };
}

interface Applied {
  schema: string;
  outcome: string;
  changed: boolean;
  actions: { step: string; resource?: string; result: string; detail?: string }[];
}

interface Planned {
  schema: string;
  containers: { service: string; action: string }[];
  wiring: { resource: string; action: string }[];
  drift: { resource: string; kind: string; stays?: string }[];
}

/** What apply removed from the apps, by resource. */
function removed(applied: Applied): string[] {
  return applied.actions
    .filter((a) => a.step === 'wire' && a.detail === 'removed')
    .map((a) => a.resource ?? '');
}

/** What the plan would remove from the apps, by resource. */
function toRemove(planned: Planned): string[] {
  return planned.wiring.filter((w) => w.action === 'remove').map((w) => w.resource);
}

/** That none of `secrets` is in `text`: a yes/no check, which never prints either. */
function expectNoSecret(what: string, text: string, secrets: readonly string[]): void {
  for (const secret of secrets.filter((s) => s !== '')) {
    expect(text.includes(secret), `${what} holds a secret`).toBe(false);
  }
}

describe('an app removed from the stack, by a script (spec §8.1(3) step 4)', () => {
  it('takes its container and what Mediaplane made for it in the other apps, keeps its appdata and what is yours, and changes nothing after', async () => {
    const home = await makeHome();
    secrets = [];
    const removeAll = () =>
      runTeardown([
        async () => {
          const down = await composeDown(PROJECT);
          expect(down.code, down.stderr).toBe(0);
        },
        () => expectWiringRemoved(PROJECT),
      ]);
    try {
      // Deployed, then applied again: nothing to change (spec §2.3, criterion 3).
      const first = await mediaplane('apply', '--home', home, '--yes');
      expect(first.code).toBe(0);
      expect(first.json).toMatchObject({
        schema: 'mediaplane.apply/v1',
        outcome: 'success',
        changed: true,
      });
      const again = await mediaplane('apply', '--home', home, '--yes');
      expect([again.code, again.json]).toMatchObject([0, { changed: false }]);

      const store = await readSecretStore(home);
      const key = (app: string) => store.apps[app]?.apiKey ?? '';
      secrets = [
        ...Object.values(store.apps).flatMap((s) => Object.values(s)),
        store.shared?.adminPassword ?? '',
      ];
      // The first two outputs came before the secrets were known.
      expectNoSecret("apply's JSON", JSON.stringify([first.json, again.json]), secrets);
      // A torrent of yours, filed under Radarr's category: it keeps the category.
      await qbittorrentForm(
        PORTS.qbittorrent,
        '/api/v2/torrents/add',
        key('qbittorrent'),
        {
          urls: `magnet:?xt=urn:btih:${TORRENT}&dn=fake`,
          category: 'movies',
          stopped: 'true',
        },
      );

      // Radarr out of the stack, and Prowlarr's Cloudflare solver too.
      const data = join(home, 'data');
      await writeFile(
        join(home, 'stack.yaml'),
        `${stackFor(data).replace('  radarr: {}\n', '')}  byparr: { enabled: false }\n`,
      );
      const shown = await mediaplane('plan', '--home', home);
      expect(shown.code).toBe(2);
      const planned = shown.json as Planned;
      expect(planned.schema).toBe('mediaplane.plan/v1');
      expect(planned.containers.filter((c) => c.action === 'remove')).toEqual([
        { service: 'byparr', action: 'remove' },
        { service: 'radarr', action: 'remove' },
      ]);
      expect(toRemove(planned)).toEqual([
        'prowlarr.application_radarr',
        'prowlarr.indexer_proxy',
        'seerr.server_radarr',
      ]);
      expect(planned.drift).toContainEqual({
        resource: 'qbittorrent.category_movies',
        kind: 'left',
        stays:
          'it holds a torrent, which removing it would move to /data/torrents: move it to another category first, or keep it',
      });

      const applied = await mediaplane('apply', '--home', home, '--yes');
      expect(applied.code).toBe(0);
      const result = applied.json as Applied;
      expect(result.outcome).toBe('success');
      expect(removed(result)).toEqual(toRemove(planned));

      // Gone from the apps, as each app's own API says; the rest stays.
      const keyed = (app: keyof typeof PORTS) => ({ 'X-Api-Key': key(app) });
      const links = await getJson<{ name: string }[]>(
        PORTS.prowlarr,
        '/api/v1/applications',
        keyed('prowlarr'),
      );
      expect(links.map((l) => l.name)).toEqual(['Sonarr (Mediaplane)']);
      // Names only: Seerr's server holds the arr's key, which no failure may print.
      const proxies = await getJson<{ name: string }[]>(
        PORTS.prowlarr,
        '/api/v1/indexerproxy',
        keyed('prowlarr'),
      );
      expect(proxies.map((p) => p.name)).toEqual([]);
      const servers = await getJson<{ name: string }[]>(
        PORTS.seerr,
        '/api/v1/settings/radarr',
        keyed('seerr'),
      );
      expect(servers.map((s) => s.name)).toEqual([]);
      const categories = () =>
        getJson<Record<string, unknown>>(
          PORTS.qbittorrent,
          '/api/v2/torrents/categories',
          { Authorization: `Bearer ${key('qbittorrent')}` },
        );
      expect(Object.keys(await categories()).sort()).toEqual(['movies', 'tv']);
      // Radarr's container is gone; its appdata stays, a manual step to delete (§4.2).
      const services = await docker(
        'ps',
        '-a',
        '--filter',
        `label=com.docker.compose.project=${PROJECT}`,
        '--format',
        '{{.Label "com.docker.compose.service"}}',
      );
      expect(services.split('\n').sort()).not.toContain('radarr');
      expect(services.split('\n')).not.toContain('byparr');
      expect((await stat(join(home, 'appdata', 'radarr', 'config.xml'))).isFile()).toBe(
        true,
      );
      // What it removed is forgotten; what it left is still recorded.
      const known = JSON.parse(
        await readFile(join(home, 'state', 'resources.json'), 'utf8'),
      ) as { resources: Record<string, unknown> };
      expect(Object.keys(known.resources)).toContain('qbittorrent.category_movies');
      // Radarr's own records stay with its appdata.
      expect(Object.keys(known.resources)).toContain('radarr.download_client');
      for (const resource of toRemove(planned)) {
        expect(Object.keys(known.resources)).not.toContain(resource);
      }

      // The torrent moved to another category: Radarr's category goes too.
      await qbittorrentForm(
        PORTS.qbittorrent,
        '/api/v2/torrents/setCategory',
        key('qbittorrent'),
        { hashes: TORRENT, category: 'tv' },
      );
      const later = await mediaplane('plan', '--home', home);
      expect([later.code, toRemove(later.json as Planned)]).toEqual([
        2,
        ['qbittorrent.category_movies'],
      ]);
      const last = await mediaplane('apply', '--home', home, '--yes');
      expect([last.code, removed(last.json as Applied)]).toEqual([
        0,
        ['qbittorrent.category_movies'],
      ]);
      expect(Object.keys(await categories())).toEqual(['tv']);

      // Nothing left to change, and nothing drifted.
      const settled = await mediaplane('apply', '--home', home, '--yes');
      expect([settled.code, settled.json]).toMatchObject([0, { changed: false }]);
      const drift = await mediaplane('drift', '--home', home);
      expect([drift.code, drift.json]).toMatchObject([
        0,
        { schema: 'mediaplane.drift/v1', clear: true, drift: [] },
      ]);
    } catch (failure) {
      // The body's own failure is the one to show: a removal that fails too is logged.
      await removeAll().catch((also: unknown) => {
        console.error('teardown failed too:', also);
      });
      throw failure;
    }
    await removeAll();
  }, 1_800_000);
});
