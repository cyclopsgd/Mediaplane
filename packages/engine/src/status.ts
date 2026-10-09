import { listRecords, type ChangeRecord } from './history/records';
import type { ContainerState, Runtime } from './runtime/types';
import { compare } from './util/sort';

export interface StatusResult {
  /** The project's containers, sorted by service. */
  containers: ContainerState[];
  /** The newest change record, if any apply has run (and the history could be read). */
  lastApply: ChangeRecord | undefined;
  /** Why state/history could not be read; the containers are listed all the same. */
  historyError?: string;
}

/** Each container's state and health, and the last apply (spec §5.2 `status`). */
export async function status(home: string, runtime: Runtime): Promise<StatusResult> {
  const containers = [...(await runtime.containers())].sort((a, b) =>
    compare(a.service, b.service),
  );
  try {
    const { records } = await listRecords(home);
    return { containers, lastApply: records[0] };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { containers, lastApply: undefined, historyError: message };
  }
}
