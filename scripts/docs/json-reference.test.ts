import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DOCUMENTS } from '../../packages/cli/src/contract';
import { errorDocument } from '../../packages/cli/src/output';
import { EXIT_CODES } from '../../packages/cli/src/run';
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

  it("doesn't say that ok and the exit code always agree, and names each command where the exit code says more", () => {
    const intro = text.split('## Documents')[0] ?? '';
    expect(intro).not.toContain('exit code says the same');
    // A command whose exit code can be 2 says more than ok does.
    const exits2 = Object.entries(EXIT_CODES).filter(([, lines]) =>
      lines.some((line) => line.startsWith('2:')),
    );
    expect(exits2.map(([command]) => command)).toEqual(['plan', 'drift']);
    for (const [command] of exits2) {
      expect(intro).toContain(`\`${command}\` prints \`ok: true\` and exits 2 when`);
    }
    expect(intro).toContain('`vpn-check` prints `ok: true` and exits 1 when');
    expect(intro).toContain(
      'Every other command exits 0 when `ok` is true, and 1 when not',
    );
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
