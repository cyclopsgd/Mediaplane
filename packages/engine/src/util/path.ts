import { isAbsolute, relative } from 'node:path';

/** Whether `path` is `folder` or inside it. */
export function isInside(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel));
}
