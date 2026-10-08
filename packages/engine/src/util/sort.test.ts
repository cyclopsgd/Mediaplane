import { describe, expect, it } from 'vitest';
import { compare, unique } from './sort';

describe('compare', () => {
  it('orders by UTF-16 code unit, whatever the locale', () => {
    expect(['b', 'B', 'a', 'A'].sort(compare)).toEqual(['A', 'B', 'a', 'b']);
  });
});

describe('unique', () => {
  it('keeps the first occurrence of each value, in order', () => {
    expect(unique(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });
});
