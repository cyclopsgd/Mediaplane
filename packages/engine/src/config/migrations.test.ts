import { describe, expect, it } from 'vitest';
import { RENAME_MEDIA } from '../testing/migrations';
import {
  MIGRATIONS,
  migrateData,
  migrateSource,
  STACK_VERSION,
  type Migration,
} from './migrations';

/** A version 0 file, as someone wrote it: comments lined up, a blank line, CRLF. */
const OLD = [
  '# My media stack.',
  'version: 0          # the format',
  'paths: { data: /srv/data }',
  'media: jellyfin     # or plex',
  '',
  'apps:',
  '  sonarr: {}',
  '',
].join('\r\n');

describe('the stack.yaml versions Mediaplane has', () => {
  it('is version 1, the only one so far: no migration exists yet', () => {
    expect(STACK_VERSION).toBe(1);
    expect(MIGRATIONS).toEqual([]);
  });
});

describe('migrateData', () => {
  it('leaves the current version as it is', () => {
    expect(migrateData({ version: 1, a: 1 })).toEqual({
      ok: true,
      data: { version: 1, a: 1 },
      from: 1,
      applied: [],
    });
  });

  it('migrates an older version in memory, one step after another', () => {
    expect(migrateData({ version: 0, media: 'plex' }, [RENAME_MEDIA], 1)).toEqual({
      ok: true,
      data: { version: 1, media_server: 'plex' },
      from: 0,
      applied: ['media is now media_server'],
    });
  });

  it('refuses a version newer than this Mediaplane reads', () => {
    expect(migrateData({ version: 2 })).toEqual({
      ok: false,
      code: 'config.newer-version',
      message:
        'stack.yaml is version 2, newer than this Mediaplane reads (1): it was written for a later Mediaplane',
    });
  });

  it('refuses an older version it has no migration for', () => {
    expect(migrateData({ version: 0 })).toMatchObject({
      ok: false,
      code: 'config.unknown-version',
    });
  });

  it('leaves a version that is not a whole number to the schema to refuse', () => {
    expect(migrateData({ version: '1' })).toMatchObject({ ok: true, applied: [] });
  });
});

describe('migrateSource', () => {
  it('rewrites only what the migration changes, and the version', () => {
    const migrated = migrateSource(OLD, [RENAME_MEDIA], 1);
    expect(migrated).toEqual({
      ok: true,
      from: 0,
      to: 1,
      applied: ['media is now media_server'],
      text: [
        '# My media stack.',
        'version: 1          # the format',
        'paths: { data: /srv/data }',
        'media_server: jellyfin     # or plex',
        '',
        'apps:',
        '  sonarr: {}',
        '',
      ].join('\r\n'),
    });
  });

  it('changes nothing in a file at the current version', () => {
    const current = OLD.replace('version: 0', 'version: 1');
    expect(migrateSource(current, [RENAME_MEDIA], 1)).toEqual({
      ok: true,
      from: 1,
      to: 1,
      applied: [],
      text: current,
    });
  });

  it('refuses a rewrite that would not read as the migration says', () => {
    const wrong: Migration = { ...RENAME_MEDIA, text: () => [] };
    expect(migrateSource(OLD, [wrong], 1)).toEqual({
      ok: false,
      reason:
        "migrating it from version 0 (media is now media_server) would change more than the migration does, or less, so Mediaplane can't rewrite it",
    });
  });

  it.each([
    ['flow style', '{ version: 1, paths: { data: /srv/data } }\n'],
    ['JSON', '{"version": 1, "paths": {"data": "/srv/data"}}\n'],
  ])('has nothing to rewrite in a current version written as %s', (_what, current) => {
    expect(migrateSource(current, [RENAME_MEDIA], 1)).toEqual({
      ok: true,
      from: 1,
      to: 1,
      applied: [],
      text: current,
    });
  });

  it('refuses edits that overlap the version', () => {
    const overlapping: Migration = {
      ...RENAME_MEDIA,
      text: (source) => [{ start: 0, end: source.length, text: 'version: 1\n' }],
    };
    expect(migrateSource(OLD, [overlapping], 1).ok).toBe(false);
  });

  it.each([
    ['not YAML', 'version: [0\n', 'it is not valid YAML'],
    ['no version', 'paths: {}\n', 'it has no version: line of its own'],
    [
      'a flow file',
      '{ version: 0, media: plex }\n',
      'not a YAML block of keys, one per line',
    ],
    ['a newer one', 'version: 2\n', 'newer than this Mediaplane reads'],
  ])('refuses %s', (_what, source, said) => {
    const migrated = migrateSource(source, [RENAME_MEDIA], 1);
    expect(migrated.ok).toBe(false);
    expect(migrated.ok ? '' : migrated.reason).toContain(said);
  });
});
