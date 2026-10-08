import { describe, expect, it } from 'vitest';
import { didYouMean, editDistance } from './did-you-mean';

describe('editDistance', () => {
  it.each([
    ['', '', 0],
    ['a', '', 1],
    ['sonar', 'sonarr', 1],
    ['kitten', 'sitting', 3],
  ])('%s → %s is %i', (a, b, distance) => {
    expect(editDistance(a, b)).toBe(distance);
  });
});

describe('didYouMean', () => {
  it('suggests a close match', () => {
    expect(didYouMean('sonar', ['sonarr', 'radarr'])).toBe('sonarr');
  });
  it('ignores case', () => {
    expect(didYouMean('SONARR', ['radarr', 'sonarr'])).toBe('sonarr');
  });
  it('prefers the closest candidate', () => {
    expect(didYouMean('plex', ['plexes', 'plexx'])).toBe('plexx');
  });
  it('breaks ties in favour of the first candidate', () => {
    expect(didYouMean('plex', ['plea', 'plez'])).toBe('plea');
  });
  it('returns undefined when nothing is close', () => {
    expect(didYouMean('kodi', ['sonarr', 'radarr'])).toBeUndefined();
  });
});
