import { listRecords, type ChangeRecord } from './history/records';
import type { ContainerState, Runtime } from './runtime/types';
import { compare } from './util/sort';

export interface StatusResult {
  /** The project's containers, sorted by service. */
  containers: ContainerState[];
  /** The newest change record, if any apply has run. */
  lastApply: ChangeRecord | undefined;
}

/** Each container's state and health, and the last apply (spec §5.2 `status`). */
export async function status(home: string, runtime: Runtime): Promise<StatusResult> {
  const containers = [...(await runtime.containers())].sort((a, b) =>
    compare(a.service, b.service),
  );
  const { records } = await listRecords(home);
  return { containers, lastApply: records[0] };
}
