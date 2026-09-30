import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/live/**'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 15_000,
  },
});
