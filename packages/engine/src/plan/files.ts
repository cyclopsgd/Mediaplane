import { join } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { readIfExists } from '../util/fs';

export interface RenderedFile {
  /** Relative to the Mediaplane home, e.g. "generated/compose.yaml". */
  path: string;
  content: string;
  /** Holds secret values: compared with what is on disk, never diffed or kept. */
  sensitive?: boolean;
}

export interface FileChange {
  path: string;
  status: 'create' | 'update' | 'unchanged';
  /** Unified diff from the current file; empty when unchanged. Empty for a sensitive file. */
  diff: string;
  /** The content apply will write. Empty for a sensitive file. */
  content: string;
  /** Holds secret values: compared with what is on disk, never diffed or kept. */
  sensitive?: boolean;
  /**
   * A pre-start file (spec §6.4): created before the app's first start when absent, and
   * never updated. Always sensitive.
   */
  prestart?: boolean;
}

export async function diffFiles(
  home: string,
  files: readonly RenderedFile[],
): Promise<FileChange[]> {
  return Promise.all(
    files.map(async (file): Promise<FileChange> => {
      const current = await readIfExists(join(home, file.path));
      if (file.sensitive === true) {
        const status =
          current === undefined
            ? 'create'
            : current === file.content
              ? 'unchanged'
              : 'update';
        return { path: file.path, status, diff: '', content: '', sensitive: true };
      }
      if (current === file.content) {
        return { path: file.path, status: 'unchanged', diff: '', content: file.content };
      }
      const diff = createTwoFilesPatch(
        `a/${file.path}`,
        `b/${file.path}`,
        current ?? '',
        file.content,
        undefined,
        undefined,
        { context: 3 },
      );
      return {
        path: file.path,
        status: current === undefined ? 'create' : 'update',
        diff,
        content: file.content,
      };
    }),
  );
}
