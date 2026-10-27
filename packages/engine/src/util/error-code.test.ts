import { describe, expect, it } from 'vitest';
import { codeOf, couldNotRead } from './error-code';

describe('codeOf', () => {
  it('is the code of a system error', () => {
    expect(codeOf(Object.assign(new Error('gone'), { code: 'ENOENT' }))).toBe('ENOENT');
  });

  it('is a string even when the code is not', () => {
    expect(codeOf(Object.assign(new Error('odd'), { code: 13 }))).toBe('13');
  });

  it('is undefined for an error without a code', () => {
    expect(codeOf(new Error('plain'))).toBeUndefined();
  });

  it('is undefined for anything that is not an error', () => {
    expect(codeOf({ code: 'ENOENT' })).toBeUndefined();
    expect(codeOf('ENOENT')).toBeUndefined();
    expect(codeOf(undefined)).toBeUndefined();
  });
});

describe('couldNotRead', () => {
  it('says why a read failed by its code alone', () => {
    expect(couldNotRead('ENOENT')).toBe('it could not be read (ENOENT)');
  });

  it('says only that it could not be read without a code', () => {
    expect(couldNotRead(undefined)).toBe('it could not be read');
  });
});
