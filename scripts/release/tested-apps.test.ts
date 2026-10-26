import { catalog } from '@mediaplane/catalog';
import { describe, expect, it } from 'vitest';
import { testedApps } from './tested-apps';

const IMAGE = `ghcr.io/cyclopsgd/mediaplane:0.1.0@sha256:${'1'.repeat(64)}`;

describe('testedApps', () => {
  const notes = testedApps(catalog, IMAGE);

  it("names Mediaplane's own image first, then every app's, as the catalog pins them", () => {
    const lines = notes.split('\n');
    expect(lines[0]).toBe('## Tested app versions');
    expect(notes).toContain(`- **Mediaplane** \`${IMAGE}\``);
    for (const def of catalog) {
      expect(notes).toContain(
        `- **${def.name}** ${def.image.tag}\n  \`${def.image.repo}@${def.image.digest}\``,
      );
    }
  });

  it('is a list, by name, never a wide table', () => {
    expect(notes).not.toContain('|');
    const names = [...notes.matchAll(/^- \*\*([^*]+)\*\* /gm)].map((m) => m[1] ?? '');
    expect(names[0]).toBe('Mediaplane');
    const apps = names.slice(1);
    expect(apps).toEqual([...apps].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(apps).toHaveLength(catalog.length);
  });

  it('says what was tested, and how Plex is', () => {
    expect(notes).toContain('amd64 and arm64');
    expect(notes).toContain('Plex');
  });
});
