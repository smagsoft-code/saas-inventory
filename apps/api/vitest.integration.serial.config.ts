import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The serial phase of the integration suite — see vitest.integration.config.ts (same SWC transform,
 * same real PostgreSQL, same global setup). It runs ONLY the `*.serial.integration.test.ts` files:
 * the ones that replay migration SQL over the whole shared database (a backfill `INSERT … SELECT`
 * across every user, an `UPDATE` across every confirmed order). Run in parallel with the other files
 * those statements deadlock with them; run alone, one file at a time, they cannot.
 *
 * Run it after the parallel phase: `pnpm test:integration:all` does both, in order. The database is
 * reset and re-migrated from empty by the global setup at the start of each phase.
 */
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    environment: 'node',
    include: ['test/**/*.serial.integration.test.ts'],
    root: './',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    globalSetup: ['test/database/global-setup.ts'],
    fileParallelism: false,
  },
});
