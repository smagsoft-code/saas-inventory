import { defineConfig } from 'vitest/config';

/**
 * Separate from vitest.config.ts (unit tests, `src/**\/*.spec.ts`) on purpose — these tests need
 * a real, reachable PostgreSQL instance (see test/database/helpers.ts) and destructively reset
 * a dedicated test database's schema, so they must never run as part of the default `test` task
 * that CI/every contributor runs unconditionally. Run explicitly via `pnpm test:integration`
 * once TEST_MIGRATOR_DATABASE_URL / TEST_APP_TENANT_DATABASE_URL are set (see that file) —
 * typically against the docker-compose.dev.yml Postgres instance.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    root: './',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The database is reset/migrated exactly once, here, before any test file runs — see
    // global-setup.ts for why per-file reset was a real (not just wasteful) bug.
    globalSetup: ['test/database/global-setup.ts'],
    // All test files now run against the same already-migrated database — no schema-level
    // mutation happens per file, only tenant-scoped row inserts each file creates and scopes to
    // its own generated ids, so parallel files no longer contend on the same DDL/role state.
    fileParallelism: true,
  },
});
