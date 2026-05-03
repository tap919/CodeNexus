import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['integration/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['control-plane/src/**/*.ts'],
    },
    testTimeout: 30000,
  },
});