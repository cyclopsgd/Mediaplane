import { describe, expect, it } from 'vitest';
import { fieldReader } from './read';

describe('fieldReader', () => {
  it('reads each kind of field, a list of numbers sorted', () => {
    const read = fieldReader();
    expect(
      read.observed(1, 'client', {
        host: read.text('host', 'gluetun'),
        port: read.number('port', 8080),
        on: read.flag('on', false),
        categories: read.numbers('categories', [5010, 5000]),
      }),
    ).toEqual({
      id: 1,
      name: 'client',
      fields: {
        host: 'gluetun',
        port: 8080,
        on: false,
        categories: '5000,5010',
      },
    });
  });

  it("says what it found in place of each field it can't read, and leaves it out", () => {
    const read = fieldReader();
    expect(
      read.observed(null, 'odd', {
        host: read.text('host', { at: 'x' }),
        port: read.number('port', '8080'),
        on: read.flag('on', null),
        categories: read.numbers('categories', [5000, '5010']),
        tags: read.refuse('tags', 'not a list of tag ids'),
        name: read.text('name', ['a']),
        enabled: read.flag('enabled', 1),
        missing: read.text('missing', undefined),
        yes: read.number('yes', true),
      }),
    ).toEqual({
      id: null,
      name: 'odd',
      fields: {},
      unreadable: {
        categories: 'a list, not a list of numbers',
        enabled: 'a number, not true or false',
        host: 'an object, not text',
        missing: 'nothing, not text',
        name: 'a list, not text',
        on: 'nothing, not true or false',
        port: 'text, not a number',
        tags: 'not a list of tag ids',
        yes: 'true or false, not a number',
      },
    });
  });
});
