import { describe, expect, it } from 'vitest';
import { splitKey } from './key-name';

describe('splitKey', () => {
  it('splits a key into its app and its name, at the first "."', () => {
    expect(splitKey('sonarr.apiKey')).toEqual({ app: 'sonarr', name: 'apiKey' });
    expect(splitKey('gluetun.controlApiKey')).toEqual({
      app: 'gluetun',
      name: 'controlApiKey',
    });
    expect(splitKey('sonarr.a.b')).toEqual({ app: 'sonarr', name: 'a.b' });
    expect(splitKey('sonarr')).toEqual({ app: 'sonarr', name: '' });
  });
});
