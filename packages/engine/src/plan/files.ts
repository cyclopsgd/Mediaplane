import { join } from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { readIfExists } from '../util/fs';

export interface RenderedFile {
  /** Relative to the Mediaplane home, e.g. "generated/compose.yaml". */
  path: string;
  content: string;
}

export interface FileChange {
  path: string;
  status: 'create' | 'update' | 'unchanged';
  /** Unified diff from the current file; empty when unchanged. */
  diff: string;
  /** The content apply will write. */
  content: string;
}

export async function diffFiles(
  home: string,
  files: readonly RenderedFile[],
): Promise<FileChange[]> {
  return Promise.all(
    files.map(async (file): Promise<FileChange> => {
      const current = await readIfExists(join(home, file.path));
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
