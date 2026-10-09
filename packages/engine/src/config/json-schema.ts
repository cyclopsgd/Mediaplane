import { z } from 'zod';
import type { AppDefinition, Catalog } from '../catalog/types';
import { compare } from '../util/sort';
import { appSettingsSchema, stackConfigSchema } from './schema';

/** Where the published JSON Schema for stack.yaml lives (spec §9). */
export const STACK_SCHEMA_URL =
  'https://raw.githubusercontent.com/cyclopsgd/Mediaplane/main/docs/reference/stack.schema.json';

type JsonSchema = Record<string, unknown>;

/** What stack.yaml takes under apps.<id>: the settings every app takes, and its own. */
export function appEntrySchema(def: AppDefinition): z.ZodType {
  const own = def.options instanceof z.ZodObject ? def.options.shape : {};
  return z
    .strictObject({ ...appSettingsSchema.shape, ...own })
    .describe(`${def.name}. Listing it runs it.`);
}

/**
 * The published JSON Schema for stack.yaml, for editors (spec §9). It is the Zod schema's
 * input form, with apps: spelled out per catalog app, so an editor can complete app names
 * and their options. Validation itself stays with the Zod schema and the resolver.
 */
export function stackJsonSchema(catalog: Catalog): JsonSchema {
  const { $schema, ...base } = z.toJSONSchema(stackConfigSchema, {
    io: 'input',
  }) as JsonSchema & { properties: Record<string, JsonSchema | undefined> };
  const apps = [...catalog]
    .sort((a, b) => compare(a.id, b.id))
    .map((def): [string, JsonSchema] => {
      const { $schema: _, ...entry } = z.toJSONSchema(appEntrySchema(def), {
        io: 'input',
      });
      // `sonarr:` with nothing after it is YAML null, which stack.yaml reads as {}.
      return [def.id, { anyOf: [{ type: 'null' }, entry] }];
    });
  return {
    $schema,
    $id: STACK_SCHEMA_URL,
    title: 'Mediaplane stack.yaml, version 1',
    ...base,
    properties: {
      ...base.properties,
      apps: {
        description: base.properties.apps?.description,
        default: {},
        type: 'object',
        properties: Object.fromEntries(apps),
        additionalProperties: false,
      },
    },
  };
}
