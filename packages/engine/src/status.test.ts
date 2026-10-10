import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHANGE_SCHEMA, writeRecord, type ChangeRecord } from './history/records';
import { HISTORY_DIR } from './paths';
import { status } from './status';
import { fakeRuntime, running } from './testing/fakes';
import { tempDir } from './testing/temp';

describe('status', () => {
  it('lists containers by service and the newest change record', async () => {
    const home = await tempDir('mediaplane-status-');
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

  it('still lists the containers when the change history cannot be read', async () => {
    const home = await tempDir('mediaplane-status-');
    // A file where the history folder should be: listing it fails (ENOTDIR).
    await mkdir(join(home, 'state'));
    await writeFile(join(home, HISTORY_DIR), 'not a folder');
    const runtime = fakeRuntime({ containers: running({ sonarr: 'a' }) });
    const result = await status(home, runtime);
    expect(result.containers.map((c) => c.service)).toEqual(['sonarr']);
    expect(result.lastApply).toBeUndefined();
    expect(result.historyError).toMatch(/^ENOTDIR: not a directory/);
  });

  it('has no last apply before the first one', async () => {
    const home = await tempDir('mediaplane-status-');
    expect(await status(home, fakeRuntime())).toEqual({
      containers: [],
      lastApply: undefined,
    });
  });
});
