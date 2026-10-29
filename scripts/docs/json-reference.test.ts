import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DOCUMENTS } from '../../packages/cli/src/contract';
import { errorDocument } from '../../packages/cli/src/output';
import { documentJsonSchema, renderJsonReference } from './json-reference';

describe('renderJsonReference', () => {
  const text = renderJsonReference();

  it('documents every document, its fields and their types, nested', () => {
    for (const { schema, file } of DOCUMENTS) {
      expect(text).toContain(`## \`${schema}\``);
      expect(text).toContain(`[\`json/${file}\`](json/${file})`);
    }
    expect(text).toContain(
      '- `wiring` (list of objects): what apply does to each managed resource\n  - `resource` (string)',
    );
    expect(text).toContain('- `recordId` (string or null)');
    expect(text).toContain('- `startedAt` (string (an ISO 8601 date and time))');
    expect(text).toContain('- With `login` `"own"`:');
    expect(text).toContain('- `again` (boolean, optional)');
  });

  it('says how v1 grows, and which codes a script acts on', () => {
    expect(text).toContain('**Within v1 a shape only grows.**');
    expect(text).toContain('- `keep.record`:');
  });
});

describe('documentJsonSchema', () => {
  it('is published at its own address, and accepts exactly what the CLI prints', () => {
    const error = DOCUMENTS.find((d) => d.schema === 'mediaplane.error/v1');
    if (error === undefined) throw new Error('no mediaplane.error/v1');
    const published = documentJsonSchema(error);
    expect(published).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://raw.githubusercontent.com/cyclopsgd/Mediaplane/main/docs/reference/json/error.schema.json',
      title: 'mediaplane.error/v1',
    });
    // As a script reads it: the file itself, in any JSON Schema validator.
    const validator = z.fromJSONSchema(
      JSON.parse(JSON.stringify(published)) as Parameters<typeof z.fromJSONSchema>[0],
    );
    const printed = errorDocument('fake failure');
    expect(validator.safeParse(printed).success).toBe(true);
    expect(validator.safeParse({ ...printed, extra: 1 }).success).toBe(false);
    expect(validator.safeParse({ ...printed, ok: true }).success).toBe(false);
  });
});
