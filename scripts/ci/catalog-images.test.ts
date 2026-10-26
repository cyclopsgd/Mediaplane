import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalog } from '@mediaplane/catalog';
import type { AppDefinition } from '@mediaplane/engine';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROOT } from '../root';
import { catalogImages, pinnedImage } from './catalog-images';

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
      // Never paths or packages: Trivy would then ignore it in every image.
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
