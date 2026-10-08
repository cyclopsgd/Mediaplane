import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'catalog/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/{resolver,render,plan}/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
