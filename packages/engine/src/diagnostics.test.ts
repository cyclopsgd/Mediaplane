import { describe, expect, it } from 'vitest';
import { error, hasErrors, warning, withHint } from './diagnostics';

describe('diagnostics', () => {
  it('builds errors and warnings with an optional path and hint', () => {
    expect(error('a.b', 'broken', { path: 'apps.x', hint: 'fix it' })).toEqual({
      severity: 'error',
      code: 'a.b',
      message: 'broken',
      path: 'apps.x',
      hint: 'fix it',
    });
    expect(warning('c.d', 'careful')).toEqual({
      severity: 'warning',
      code: 'c.d',
      message: 'careful',
    });
  });

  it('detects whether any diagnostic is an error', () => {
    expect(hasErrors([warning('w', 'w')])).toBe(false);
    expect(hasErrors([warning('w', 'w'), error('e', 'e')])).toBe(true);
  });

  it('adds a hint only when there is one', () => {
    expect(withHint(undefined)).toEqual({});
    expect(withHint('try this')).toEqual({ hint: 'try this' });
  });
});
