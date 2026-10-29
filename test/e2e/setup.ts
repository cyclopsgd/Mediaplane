import { afterAll } from 'vitest';
import { removeLeftovers, TEARDOWN_MS } from './helpers';

// Every end-to-end file, once its tests are done: whatever they left in Docker is
// removed, and named, so a teardown that missed something fails the file. A test that
// times out leaves its body running, and its own teardown never runs.
afterAll(async () => {
  const left = await removeLeftovers();
  if (left.length > 0) {
    throw new Error(`the tests left these behind, now removed: ${left.join(', ')}`);
  }
}, 6 * TEARDOWN_MS);
