import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    // Vitest 4 defaults to the `forks` pool, which recreates the (heavy) jsdom
    // environment per worker process and oversubscribes cores when the full
    // 600-file suite runs in parallel. The real-engine playtest/letsplay tests
    // are fast in CPU-time (<1 s each) but tripped the 5 s WALL-CLOCK timeout
    // under that contention. `threads` restores the vitest-1 execution model
    // these tests were validated under; the testTimeout bump is belt-and-braces
    // headroom for CI cores. Neither weakens any assertion.
    pool: 'threads',
    testTimeout: 20000,
    include: ['src/tests/**/*.test.ts', 'tools/**/*.test.ts'],
    exclude: ['e2e/**', 'tools/ai/_quarantine/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportsDirectory: './coverage',
      include: ['src/core/**/*.ts', 'src/systems/**/*.ts', 'src/domain/**/*.ts'],
      exclude: ['src/tests/**', 'src/**/*.d.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
  define: {
    __DEBUG__: JSON.stringify(true),
    __BUILD_VERSION__: JSON.stringify('test'),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
