import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import type { AppDefinition } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from '../root';
import {
  catalogImages,
  ignoreEntriesFor,
  ignoreFileFor,
  pinnedImage,
  readIgnoreEntries,
  type IgnoreEntry,
} from './catalog-images';

describe('catalogImages', () => {
  it('lists every catalog image once, pinned by tag and digest, sorted', () => {
    const images = catalogImages(catalog, 'arm64');
    expect(images).toHaveLength(catalog.length);
    expect(new Set(images).size).toBe(images.length);
    expect(images).toEqual([...images].sort());
    for (const image of images) {
      expect(image).toMatch(/^[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}$/);
    }
    expect(images).toContain(
      pinnedImage(catalog.find((def) => def.id === 'sonarr') as AppDefinition),
    );
  });

  it("leaves out an app that doesn't run on the architecture", () => {
    const sonarr = catalog.find((def) => def.id === 'sonarr') as AppDefinition;
    const amd64Only = {
      ...sonarr,
      id: 'amd64-only',
      image: { ...sonarr.image, repo: 'registry.test/amd64-only' },
      arch: ['amd64' as const],
    };
    expect(catalogImages([sonarr, amd64Only], 'arm64')).toEqual([pinnedImage(sonarr)]);
    expect(catalogImages([sonarr, amd64Only], 'amd64')).toHaveLength(2);
  });

  it('writes a pin as Docker takes it', () => {
    const def = {
      image: {
        repo: 'registry.test/app',
        tag: '1.0.0',
        digest: `sha256:${'0'.repeat(64)}`,
      },
    } as AppDefinition;
    expect(pinnedImage(def)).toBe(`registry.test/app:1.0.0@sha256:${'0'.repeat(64)}`);
  });
});

describe('catalog-ignore.yaml', () => {
  const { vulnerabilities } = parse(
    readFileSync(join(ROOT, 'scripts/ci/catalog-ignore.yaml'), 'utf8'),
  ) as { vulnerabilities: Record<string, unknown>[] };

  it('gives each finding it lets pass the app it is in, and a date it stops counting', () => {
    expect(vulnerabilities.length).toBeGreaterThan(0);
    for (const entry of vulnerabilities) {
      // Never paths or packages: which app an entry is for is read from its statement
      // (ignoreEntriesFor), and scan-catalog.sh gives each image only its own app's.
      expect(Object.keys(entry).sort()).toEqual(['expired_at', 'id', 'statement']);
      expect(entry.id).toMatch(/^(?:CVE-\d{4}-\d+|GHSA(?:-[0-9a-z]{4}){3})$/);
      expect(entry.statement).toMatch(/ in \S/);
      expect(entry.expired_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('lists each finding once', () => {
    const ids = vulnerabilities.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('the ignore list, app by app', () => {
  const app = (id: string) => catalog.find((def) => def.id === id) as AppDefinition;
  const entries = readIgnoreEntries();
  const ids = (def: AppDefinition) => ignoreEntriesFor(entries, def).map((e) => e.id);

  it('names, in every entry, an app of the catalog', () => {
    for (const entry of entries) {
      const apps = catalog.filter((def) => ignoreEntriesFor([entry], def).length > 0);
      expect(apps.length, `${entry.id}: ${entry.statement}`).toBeGreaterThan(0);
    }
  });

  it("gives an app only the entries that name it, and no other app's", () => {
    // handlebars is in Seerr, and in no other app.
    expect(ids(app('seerr'))).toContain('CVE-2026-33937');
    for (const other of catalog.filter((def) => def.id !== 'seerr')) {
      expect(ids(other)).not.toContain('CVE-2026-33937');
    }
    // The ASP.NET Core runtime finding is Prowlarr's and Radarr's, not Sonarr's.
    expect(ids(app('prowlarr'))).toContain('CVE-2026-70188');
    expect(ids(app('radarr'))).toContain('CVE-2026-70188');
    expect(ids(app('sonarr'))).not.toContain('CVE-2026-70188');
    // Chromium is FlareSolverr's; certifi is Byparr's and FlareSolverr's.
    expect(ids(app('byparr'))).toEqual(['GHSA-6q48-6c7w-9gw2']);
    expect(ids(app('jellyfin'))).toEqual([]);
  });

  it('matches the app as a whole word, as the catalog writes it', () => {
    const entry: IgnoreEntry = {
      id: 'CVE-2026-0001',
      statement: 'zlib in Radarr 1.0.0 and Sonarr-extra 2.0',
      expired_at: '2026-12-01',
    };
    const named = (name: string) => ignoreEntriesFor([entry], { name }).length;
    expect(named('Radarr')).toBe(1);
    expect(named('radarr')).toBe(1);
    expect(named('Rad')).toBe(0);
    expect(named('Sonarr')).toBe(0);
    expect(named('zlib')).toBe(0); // what it is in, not where.
    expect(
      ignoreEntriesFor([{ ...entry, statement: 'no place named' }], { name: 'no' }),
    ).toEqual([]);
  });

  it("writes an image's ignore file from its own app's entries", () => {
    const text = ignoreFileFor(pinnedImage(app('seerr')), catalog, entries);
    const written = (parse(text) as { vulnerabilities: IgnoreEntry[] }).vulnerabilities;
    expect(written).toEqual(ignoreEntriesFor(entries, app('seerr')));
    expect(written.length).toBeGreaterThan(0);
    expect(text).not.toContain('CVE-2026-70188');
    expect(parse(ignoreFileFor(pinnedImage(app('jellyfin')), catalog, entries))).toEqual({
      vulnerabilities: [],
    });
  });

  it('refuses an image no app runs', () => {
    expect(() =>
      ignoreFileFor('registry.test/none:1@sha256:0', catalog, entries),
    ).toThrow('no catalog app runs registry.test/none:1@sha256:0');
  });
});

describe('catalog-images.ts, run as a script', () => {
  const run = (...args: string[]) =>
    spawnSync(
      join(ROOT, 'node_modules/.bin/tsx'),
      ['scripts/ci/catalog-images.ts', ...args],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );

  it('refuses an architecture it does not know, or none', () => {
    for (const args of [['riscv64'], [], ['ignore']]) {
      const result = run(...args);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('usage: catalog-images.ts');
      expect(result.stdout).toBe('');
    }
  });

  it('refuses to write an ignore file for an image no app runs', () => {
    const result = run('ignore', 'registry.test/none:1@sha256:0');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('error: no catalog app runs');
    expect(result.stdout).toBe('');
  });

  it("lists an arch's images, and writes an image's ignore file", () => {
    const images = run('arm64');
    expect(images.status).toBe(0);
    expect(images.stdout.trim().split('\n')).toEqual(catalogImages(catalog, 'arm64'));
    const flaresolverr = catalog.find(
      (def) => def.id === 'flaresolverr',
    ) as AppDefinition;
    const ignore = run('ignore', pinnedImage(flaresolverr));
    expect(ignore.status).toBe(0);
    expect(ignore.stdout).toContain('Chromium in FlareSolverr');
    expect(ignore.stdout).not.toContain('handlebars');
  });
});
