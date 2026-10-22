import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';
import { FunctionalSequencer } from './scripts/functional-sequencer.js';

const functionalTimeoutMs = 10_000;
const contentionTimeoutMs = 30_000;
const contentionJobTimeoutMs = 180_000;

export default defineConfig({
  test: {
    sequence: { sequencer: FunctionalSequencer },
    projects: [
      {
        test: {
          name: 'functional',
          // Bundle dependency barrels once; every case still uses the real SQLite/core code.
          deps: {
            optimizer: {
              ssr: {
                enabled: true,
                include: [
                  'zod/mini',
                  '@js-temporal/polyfill',
                  'drizzle-orm',
                  'drizzle-orm/sqlite-core',
                  'drizzle-orm/better-sqlite3',
                ],
                exclude: ['better-sqlite3'],
              },
            },
          },
          include: [
            'tests/unit/**/*.test.ts',
            'tests/integration/**/*.test.ts',
            'tests/contracts/**/*.test.ts',
          ],
          testTimeout: functionalTimeoutMs,
          hookTimeout: functionalTimeoutMs,
          fileParallelism: true,
          maxWorkers: Math.min(6, availableParallelism()),
        },
      },
      {
        test: {
          name: 'contention',
          include: ['tests/contention/**/*.test.ts'],
          testTimeout: contentionTimeoutMs,
          hookTimeout: contentionJobTimeoutMs,
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
    ],
    teardownTimeout: contentionJobTimeoutMs,
    coverage: { enabled: false },
  },
});
