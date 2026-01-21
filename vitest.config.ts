import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // E2E tests must run sequentially to avoid rate limits and conflicts
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Run tests in sequence, not parallel
    sequence: {
      concurrent: false,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['.github/scripts/**/*.ts'],
      exclude: [
        'node_modules',
        'dist',
        'tests',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': '.github/scripts',
    },
  },
});
