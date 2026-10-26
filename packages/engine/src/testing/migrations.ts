import { isMap, isScalar } from 'yaml';
import type { Migration } from '../config/migrations';

/**
 * A made-up migration, for the tests only: no stack.yaml was ever version 0. Version 0
 * called the media server `media`; version 1 calls it `media_server`.
 */
export const RENAME_MEDIA: Migration = {
  from: 0,
  summary: 'media is now media_server',
  data: ({ media, ...rest }) =>
    media === undefined ? rest : { ...rest, media_server: media },
  text: (_source, doc) => {
    const root = doc.contents;
    if (!isMap(root)) return [];
    const pair = root.items.find((p) => isScalar(p.key) && p.key.value === 'media');
    if (pair === undefined || !isScalar(pair.key)) return [];
    const [start, end] = pair.key.range;
    return [{ start, end, text: 'media_server' }];
  },
};
