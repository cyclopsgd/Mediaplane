import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changeRecordSchema } from '@mediaplane/engine';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  applyDocumentJson,
  changeDocumentJson,
  checkDocument,
  CODES,
  credentialsDocumentJson,
  documentsIn,
  DOCUMENTS,
  driftDocumentJson,
  errorDocumentJson,
  historyDocumentJson,
  initDocumentJson,
  keepDocumentJson,
  migrateDocumentJson,
  planDocumentJson,
  plexLoginDocumentJson,
  statusDocumentJson,
  vpnCheckDocumentJson,
} from './contract';
import { credentialsDocument } from './credentials';
import { initDocument } from './init';
import {
  applyDocument,
  driftDocument,
  errorDocument,
  historyDocument,
  keepDocument,
  migrateDocument,
  planDocument,
  recordDocument,
  statusDocument,
} from './output';
import { plexLoginDocument } from './plex-login';
import { vpnCheckDocument } from './vpn-check';

describe('the --json contract', () => {
  // Checked by `pnpm typecheck`: each printer prints exactly the documented fields, of the
  // documented types, so a field added to the engine's results fails here until the
  // contract, and so the generated reference, says what it is.
  it('is what each printer prints, field for field', () => {
    expectTypeOf<ReturnType<typeof planDocument>>().toEqualTypeOf<
      z.infer<typeof planDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof applyDocument>>().toEqualTypeOf<
      z.infer<typeof applyDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof driftDocument>>().toEqualTypeOf<
      z.infer<typeof driftDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof keepDocument>>().toEqualTypeOf<
      z.infer<typeof keepDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof migrateDocument>>().toEqualTypeOf<
      z.infer<typeof migrateDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof statusDocument>>().toEqualTypeOf<
      z.infer<typeof statusDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof historyDocument>>().toEqualTypeOf<
      z.infer<typeof historyDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof recordDocument>>().toEqualTypeOf<
      z.infer<typeof changeDocumentJson>
    >();
    // branded: an app's login is an intersection in the engine, a union here.
    expectTypeOf<ReturnType<typeof credentialsDocument>>().branded.toEqualTypeOf<
      z.infer<typeof credentialsDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof vpnCheckDocument>>().toEqualTypeOf<
      z.infer<typeof vpnCheckDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof plexLoginDocument>>().toEqualTypeOf<
      z.infer<typeof plexLoginDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof initDocument>>().toEqualTypeOf<
      z.infer<typeof initDocumentJson>
    >();
    expectTypeOf<ReturnType<typeof errorDocument>>().toEqualTypeOf<
      z.infer<typeof errorDocumentJson>
    >();
  });

  it('documents the change record as state/history keeps it, with ok', () => {
    /** A JSON Schema without its descriptions: what it accepts, and nothing else. */
    const accepted = (schema: unknown): unknown =>
      JSON.parse(JSON.stringify(schema), (key, value: unknown) =>
        key === 'description' ? undefined : value,
      ) as unknown;
    const { ok: _, ...fields } = changeDocumentJson.shape;
    expect(accepted(z.toJSONSchema(z.strictObject(fields)))).toEqual(
      accepted(z.toJSONSchema(changeRecordSchema)),
    );
  });

  it('names each document once, by its schema, with a file of its own', () => {
    const schemas = DOCUMENTS.map((d) => d.schema);
    expect(new Set(schemas).size).toBe(schemas.length);
    for (const document of DOCUMENTS) {
      expect(document.schema).toMatch(/^mediaplane\.[a-z-]+\/v1$/);
      expect(document.file).toBe(
        `${document.schema.replace(/^mediaplane\./, '').replace(/\/v1$/, '')}.schema.json`,
      );
    }
  });

  it('checks a document by its schema, strictly, and refuses one it does not know', () => {
    const error = errorDocument('fake failure', [
      { severity: 'error', code: 'config.missing', message: 'fake failure' },
    ]);
    expect(checkDocument(error)).toBe('mediaplane.error/v1');
    expect(() => checkDocument({ ...error, extra: true })).toThrow(
      /mediaplane\.error\/v1 does not match its documented schema: .*extra/,
    );
    expect(() => checkDocument({ schema: 'mediaplane.unknown/v1' })).toThrow(
      'no documented --json schema "mediaplane.unknown/v1"',
    );
  });

  it('lists only diagnostic codes that a test pins in the code that gives them', async () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    const tests: string[] = [];
    for (const dir of ['packages', 'catalog']) {
      for (const entry of await readdir(join(root, dir), { recursive: true })) {
        if (entry.endsWith('.test.ts') && !entry.includes('node_modules')) {
          tests.push(await readFile(join(root, dir, entry), 'utf8'));
        }
      }
    }
    for (const { code } of CODES) {
      expect(
        tests.some((test) => test.includes(`'${code}'`)),
        `no test pins ${code}`,
      ).toBe(true);
    }
  });

  it('finds each document a capture printed, one after the other', () => {
    const one = `${JSON.stringify({ schema: 'a' }, null, 2)}\n`;
    const two = `${JSON.stringify({ schema: 'b', nested: { c: 1 } }, null, 2)}\n`;
    expect(documentsIn(one + two)).toEqual([
      { schema: 'a' },
      { schema: 'b', nested: { c: 1 } },
    ]);
    expect(documentsIn('Plan: 1 file to write.\n')).toEqual([]);
  });
});
