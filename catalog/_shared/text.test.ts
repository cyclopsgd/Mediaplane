import { describe, expect, it } from 'vitest';
import { appendSection } from './text';

describe('appendSection', () => {
  it('puts the section after a blank line, on a line of its own, or alone', () => {
    expect(appendSection('a = 1\n', '[b]\n')).toBe('a = 1\n\n[b]\n');
    expect(appendSection('a = 1', '[b]\n')).toBe('a = 1\n\n[b]\n');
    expect(appendSection('', '[b]\n')).toBe('[b]\n');
  });
});
