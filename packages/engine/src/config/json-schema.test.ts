import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AppDefinition } from '../catalog/types';
import { fixtureApp, fixtureCatalog } from '../testing/fixtures';
import { undocumented, type DescribedSchema as Schema } from '../testing/schema';
import { appEntrySchema, STACK_SCHEMA_URL, stackJsonSchema } from './json-schema';
import { stackConfigSchema } from './schema';

describe('stackJsonSchema', () => {
  const schema = stackJsonSchema(fixtureCatalog) as Schema & {
    properties: Record<string, Schema & { properties?: Record<string, Schema> }>;
  };

  it('names itself, and keeps the required fields', () => {
    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: STACK_SCHEMA_URL,
      required: ['version', 'paths', 'media_server'],
    });
  });

  it('spells out every catalog app under apps, and allows no other', () => {
    const apps = schema.properties.apps;
    expect(Object.keys(apps?.properties ?? {})).toEqual(
      fixtureCatalog.map((def) => def.id).sort(),
    );
    expect(apps?.additionalProperties).toBe(false);
  });

  it('gives each app the shared settings and its own options, and allows it empty', () => {
    const qbittorrent = schema.properties.apps?.properties?.qbittorrent;
    expect(qbittorrent?.anyOf?.[0]).toEqual({ type: 'null' });
    expect(qbittorrent?.anyOf?.[1]?.properties).toMatchObject({
      enabled: { type: 'boolean', default: true },
      port: { type: 'integer', minimum: 1, maximum: 65535 },
      vpn: { type: 'boolean', default: true },
    });
    expect(qbittorrent?.anyOf?.[1]?.additionalProperties).toBe(false);
  });
});

describe('appEntrySchema', () => {
  const descriptionOf = (def: Partial<AppDefinition> & { id: string }) =>
    z.toJSONSchema(appEntrySchema(fixtureApp(def)), { io: 'input' }).description;

  it('names the app, and says which media_server a media server needs', () => {
    expect(descriptionOf({ id: 'sonarr' })).toBe('sonarr.');
    expect(descriptionOf({ id: 'plex', category: 'media-server' })).toBe(
      'plex. Can only be enabled when media_server is plex.',
    );
  });

  it("refuses options that aren't an object, which would reject valid settings", () => {
    const def = fixtureApp({ id: 'odd', options: z.record(z.string(), z.unknown()) });
    expect(() => appEntrySchema(def)).toThrow(/odd.*options.*object/);
  });
});

describe('the stack.yaml schema', () => {
  it('says what runs an app: listing it, unless disabled, and the chosen media server', () => {
    const { description } = z.toJSONSchema(stackConfigSchema, { io: 'input' }).properties
      ?.apps as Schema;
    expect(description).toContain(
      'Listing an app runs it, unless it sets enabled: false.',
    );
    expect(description).toContain('media server that media_server names runs');
    expect(description).toContain('no other media server can be enabled');
  });

  it('describes every field', () => {
    expect(
      undocumented(z.toJSONSchema(stackConfigSchema, { io: 'input' }) as Schema),
    ).toEqual([]);
  });

  it('describes every setting every app takes', () => {
    const entry = z.toJSONSchema(appEntrySchema(fixtureApp({ id: 'x' })), {
      io: 'input',
    });
    expect(undocumented(entry as Schema)).toEqual([]);
  });
});
