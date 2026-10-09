import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HISTORY_DIR } from '../paths';
import {
  CHANGE_SCHEMA,
  listRecords,
  newRecordId,
  readRecord,
  stackSha256,
  writeRecord,
  type ChangeRecord,
} from './records';

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
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-history-'));
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
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-history-'));
    expect(await listRecords(home)).toEqual({ records: [], unreadable: [] });
  });

  it('lists files it cannot read instead of failing', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-history-'));
    await mkdir(join(home, HISTORY_DIR), { recursive: true });
    await writeFile(join(home, HISTORY_DIR, '20261009T094312Z-00000001.json'), '{"oops"');
    expect(await listRecords(home)).toEqual({
      records: [],
      unreadable: ['20261009T094312Z-00000001.json'],
    });
  });

  it('finds nothing for an unknown or malformed id', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-history-'));
    expect(await readRecord(home, '20261009T094312Z-ffffffff')).toBeUndefined();
    expect(await readRecord(home, '../../etc/passwd')).toBeUndefined();
  });
});
