import { describe, expect, it } from 'vitest';
import { isInside } from './path';

describe('isInside', () => {
  it.each([
    ['/srv/data', '/srv/data', true],
    ['/srv/data/media', '/srv/data', true],
    ['/srv/data/..x', '/srv/data', true],
    ['/srv/data-2', '/srv/data', false],
    ['/srv', '/srv/data', false],
  ])('%s in %s is %s', (path, folder, expected) => {
    expect(isInside(path, folder)).toBe(expected);
  });
});
