import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    testTimeout: 900_000,
    hookTimeout: 120_000,
    pool: 'forks',
    reporters: ['default'],
  },
});
