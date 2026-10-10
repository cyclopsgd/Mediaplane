import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HISTORY_DIR, STATE_DIR } from '../paths';
import {
  CHANGE_SCHEMA,
  listRecords,
  newRecordId,
  readRecord,
  stackSha256,
  writeRecord,
  type ChangeRecord,
} from './records';
import { tempDir } from '../testing/temp';

function record(id: string, outcome: ChangeRecord['outcome'] = 'success'): ChangeRecord {
  return {
    schema: CHANGE_SCHEMA,
    id,
    trigger: 'cli',
    startedAt: '2026-10-09T09:43:12.000Z',
    finishedAt: '2026-10-09T09:44:02.500Z',
    durationMs: 50_500,
    outcome,
    stackSha256: stackSha256('version: 1\n'),
    plan: {
      files: [{ path: 'generated/compose.yaml', status: 'create' }],
      containers: [{ service: 'sonarr', action: 'create' }],
      secrets: { generate: ['sonarr.apiKey'] },
    },
    actions: [
      { step: 'keys', result: 'done', detail: 'generated sonarr.apiKey' },
      { step: 'pull', result: 'failed', error: 'fake registry unreachable' },
      { step: 'start', result: 'skipped' },
    ],
  };
}

describe('newRecordId', () => {
  it('sorts by time and adds random hex', () => {
    const id = newRecordId(new Date('2026-10-09T09:43:12.345Z'), (size) =>
      Buffer.alloc(size, 0xab),
    );
    expect(id).toBe('20261009T094312Z-abababab');
  });
});

describe('stackSha256', () => {
  it('is the hex SHA-256 of the text', () => {
    expect(stackSha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

describe('history records', () => {
  it('writes private records and reads them back, newest first', async () => {
    const home = await tempDir('mediaplane-history-');
    await writeRecord(home, record('20261009T094312Z-00000001'));
    await writeRecord(home, record('20261010T080000Z-00000002', 'failed'));
    const { records, unreadable } = await listRecords(home);
    expect(records.map((r) => r.id)).toEqual([
      '20261010T080000Z-00000002',
      '20261009T094312Z-00000001',
    ]);
    expect(unreadable).toEqual([]);
    expect(await readRecord(home, '20261009T094312Z-00000001')).toEqual(
      record('20261009T094312Z-00000001'),
    );
    expect((await stat(join(home, HISTORY_DIR))).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(home, HISTORY_DIR, '20261009T094312Z-00000001.json'))).mode &
        0o777,
    ).toBe(0o600);
  });

  it('has no records before the first apply', async () => {
    const home = await tempDir('mediaplane-history-');
    expect(await listRecords(home)).toEqual({ records: [], unreadable: [] });
  });

  it('lists files it cannot read instead of failing', async () => {
    const home = await tempDir('mediaplane-history-');
    await mkdir(join(home, HISTORY_DIR), { recursive: true });
    await writeFile(join(home, HISTORY_DIR, '20261009T094312Z-00000001.json'), '{"oops"');
    expect(await listRecords(home)).toEqual({
      records: [],
      unreadable: ['20261009T094312Z-00000001.json'],
    });
  });

  it('lists an entry it cannot read as unreadable, and still lists the rest', async () => {
    const home = await tempDir('mediaplane-history-');
    await writeRecord(home, record('20261009T094312Z-00000001'));
    // Reading a directory fails (EISDIR); it must not take the whole listing down.
    await mkdir(join(home, HISTORY_DIR, '20261009T094312Z-00000003.json'));
    const { records, unreadable } = await listRecords(home);
    expect(records.map((r) => r.id)).toEqual(['20261009T094312Z-00000001']);
    expect(unreadable).toEqual(['20261009T094312Z-00000003.json']);
  });

  it('lists a JSON file that is not a change record as unreadable', async () => {
    const home = await tempDir('mediaplane-history-');
    await writeRecord(home, record('20261009T094312Z-00000001'));
    await writeFile(join(home, HISTORY_DIR, '20261009T094312Z-00000002.json'), '{}\n');
    const { records, unreadable } = await listRecords(home);
    expect(records.map((r) => r.id)).toEqual(['20261009T094312Z-00000001']);
    expect(unreadable).toEqual(['20261009T094312Z-00000002.json']);
  });

  it('fails when the history folder itself cannot be read', async () => {
    const home = await tempDir('mediaplane-history-');
    await mkdir(join(home, 'state'));
    await writeFile(join(home, HISTORY_DIR), 'not a folder');
    await expect(listRecords(home)).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('finds nothing for an unknown id', async () => {
    const home = await tempDir('mediaplane-history-');
    expect(await readRecord(home, '20261009T094312Z-ffffffff')).toBeUndefined();
  });

  it('does not follow an id out of the history folder', async () => {
    const home = await tempDir('mediaplane-history-');
    // A valid record just outside state/history: only the id check keeps it unreachable.
    await mkdir(join(home, STATE_DIR), { recursive: true });
    await writeFile(
      join(home, STATE_DIR, 'stray.json'),
      JSON.stringify(record('20261009T094312Z-00000001')),
    );
    expect(await readRecord(home, '../stray')).toBeUndefined();
    expect(
      await readRecord(home, '20261009T094312Z-abababab/../../stray'),
    ).toBeUndefined();
    expect(await readRecord(home, '../../etc/passwd')).toBeUndefined();
  });

  describe('writeRecord validation', () => {
    it.each([
      ['an id that is not a record id', { id: '../x' }, /id/],
      ['a fractional duration', { durationMs: 50.5 }, /durationMs/],
      [
        'a timestamp with an offset',
        { startedAt: '2026-10-09T09:43:12+02:00' },
        /startedAt/,
      ],
    ])('rejects %s before writing anything', async (_label, change, message) => {
      const home = await tempDir('mediaplane-history-');
      const bad = { ...record('20261009T094312Z-00000001'), ...change };
      await expect(writeRecord(home, bad)).rejects.toThrow(message);
      expect(await readdir(home)).toEqual([]);
    });
  });
});
