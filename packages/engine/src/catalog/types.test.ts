import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { defineApp, type AppDefinition, type Catalog } from './types';

const base = {
  name: 'Example',
  category: 'download',
  image: {
    repo: 'registry.test/example',
    tag: '1.0.0',
    digest: `sha256:${'0'.repeat(64)}`,
  },
  arch: ['amd64', 'arm64'],
  ports: [],
  volumes: {},
  runAs: 'image-default',
  provides: [],
  requires: [],
  secrets: {},
  credentials: [],
  health: 'none',
  experimental: false,
} satisfies Omit<AppDefinition, 'id'>;

describe('defineApp', () => {
  it('returns the definition unchanged', () => {
    const definition = { id: 'example', ...base };
    expect(defineApp(definition)).toBe(definition);
  });

  it('types hook arguments from the options schema, and fits in a Catalog', () => {
    const definition = defineApp({
      id: 'example',
      ...base,
      options: z.strictObject({ vpn: z.boolean().default(true) }),
      implies: (options) => (options.vpn ? ['gluetun'] : []),
    });
    expectTypeOf<typeof definition.implies>().toEqualTypeOf<
      ((options: { vpn: boolean }) => string[]) | undefined
    >();
    const catalog: Catalog = [definition];
    expect(catalog).toHaveLength(1);
  });
});
