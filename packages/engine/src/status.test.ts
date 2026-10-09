import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGE_SCHEMA, writeRecord, type ChangeRecord } from './history/records';
import { status } from './status';
import { fakeRuntime, running } from './testing/fakes';

describe('status', () => {
  it('lists containers by service and the newest change record', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-status-'));
    const record: Omit<ChangeRecord, 'id'> = {
      schema: CHANGE_SCHEMA,
      trigger: 'cli',
      startedAt: '2026-10-09T09:43:12.000Z',
      finishedAt: '2026-10-09T09:44:12.000Z',
      durationMs: 60_000,
      outcome: 'success',
      stackSha256: '0'.repeat(64),
      plan: { files: [], containers: [], secrets: { generate: [] } },
      actions: [],
    };
    await writeRecord(home, { ...record, id: '20261009T094312Z-00000001' });
    await writeRecord(home, { ...record, id: '20261010T094312Z-00000002' });
    const runtime = fakeRuntime({ containers: running({ sonarr: 'a', jellyfin: 'b' }) });
    const result = await status(home, runtime);
    expect(result.containers.map((c) => c.service)).toEqual(['jellyfin', 'sonarr']);
    expect(result.lastApply?.id).toBe('20261010T094312Z-00000002');
  });

  it('has no last apply before the first one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'mediaplane-status-'));
    expect(await status(home, fakeRuntime())).toEqual({
      containers: [],
      lastApply: undefined,
    });
  });
});
