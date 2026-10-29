import { defineConfig } from 'vitest/config';

/**
 * The migration-wrapper harness (ADR-0041, D-7.2): runs the wrapper (`src/database/migrate.ts`'s
 * `runMigrations`) against a DISPOSABLE PostgreSQL cluster that the tests themselves create with
 * `initdb`/`pg_ctl` in a new temp directory and destroy afterwards.
 *
 * It is separate from `tools/pg-verify` and from the integration suites on purpose: it does not use
 * `TEST_*_DATABASE_URL`, never connects to a server it did not start, and is skipped (not failed)
 * unless MIGRATION_HARNESS_PG_BIN names the `bin` directory of a PostgreSQL install (reference: 16.15).
 *
 *   MIGRATION_HARNESS_PG_BIN="C:\Program Files\PostgreSQL\16\bin" pnpm --filter @saas-inventory/api test:migration-harness
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/migration-harness/**/*.harness.test.ts'],
    root: './',
    testTimeout: 240_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
