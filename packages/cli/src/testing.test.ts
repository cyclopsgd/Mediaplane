import { describe, expect, it } from 'vitest';
import { checkPrinted } from './testing';

describe('checkPrinted', () => {
  const error = { schema: 'mediaplane.error/v1', ok: false, error: { message: 'no' } };

  it('passes each document the contract documents, and a human output', () => {
    expect(() => {
      checkPrinted(`${JSON.stringify(error, null, 2)}\n`);
      checkPrinted('Wrote stack.yaml.\n');
      checkPrinted(`${JSON.stringify({ schema: 'mediaplane.plex-tv/v1' }, null, 2)}\n`);
    }).not.toThrow();
  });

  it('fails a document with a field the contract does not name, or of no schema it knows', () => {
    expect(() => {
      checkPrinted(`${JSON.stringify({ ...error, extra: 1 }, null, 2)}\n`);
    }).toThrow('mediaplane.error/v1 does not match its documented schema');
    expect(() => {
      checkPrinted(`${JSON.stringify({ schema: 'mediaplane.bogus/v1' }, null, 2)}\n`);
    }).toThrow('no documented --json schema');
  });
});
