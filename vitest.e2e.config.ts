import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    // After each file: what its tests left in Docker, removed.
    setupFiles: ['test/e2e/setup.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
