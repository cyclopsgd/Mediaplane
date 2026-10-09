import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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

describe('the stack.yaml schema', () => {
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
