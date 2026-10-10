import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { APPDATA_NOT_PRIVATE_HINT, ownerClause, runningUid } from '../apply/ownership';
import { warning, type Diagnostic } from '../diagnostics';
import { APPDATA_DIR } from '../paths';

/**
 * What apply will do to an existing appdata/ (it makes it private, 0700, on every run),
 * as warnings, so that plan doesn't say "No changes" about a folder apply then changes or
 * can't change. They are notes, not changes: apply does this even when nothing else
 * changes, and without a change record. Looks with stat() only; writes nothing. A missing
 * appdata/ is apply's to create, and anything stat() can't read is left for apply to
 * report when it tries.
 */
export async function planAppdata(home: string): Promise<Diagnostic[]> {
  const path = join(home, APPDATA_DIR);
  const found = await stat(path).catch(() => undefined);
  if (found === undefined || !found.isDirectory()) return [];
  const me = runningUid();
  // Root can change any folder's mode; anyone else, only their own folders'.
  if (me !== undefined && me !== 0 && found.uid !== me) {
    return [
      warning(
        'appdata.not-owned',
        `${path} belongs to ${ownerClause(found.uid)}, so apply will fail to make it private (0700)`,
        { hint: APPDATA_NOT_PRIVATE_HINT },
      ),
    ];
  }
  const mode = found.mode & 0o777;
  if (mode === 0o700) return [];
  return [
    warning(
      'appdata.not-private',
      `${path} has mode ${mode.toString(8).padStart(4, '0')}, not 0700; apply will make it private (0700)`,
      {
        hint: 'nothing to do: apply makes appdata/ itself private on every run; the app folders in it keep the modes their apps give them',
      },
    ),
  ];
}
