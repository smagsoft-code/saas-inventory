import { integrationTestsEnabled, resetAndMigrate } from './helpers';

/**
 * Vitest globalSetup — runs exactly ONCE for the whole `test:integration` run, before any test
 * file's own beforeAll hooks, in a separate process/context from the test files themselves.
 *
 * Each of the 3 integration test files previously called resetAndMigrate() in its own beforeAll
 * — meaning a single `test:integration` run dropped and recreated the entire database schema AND
 * all 5 Postgres roles three separate times. Beyond being wasteful, this created a real race: one
 * file's teardown (DROP ROLE app_tenant) could interleave with another file's already-open
 * app_tenant connection, surfacing as "role app_tenant does not exist" — confirmed by running the
 * full suite for real against a live PostgreSQL instance (PROMPT 03-A). Resetting once, here,
 * before any file runs, removes that race entirely: every test file now runs against the same
 * already-migrated database and only touches tenant-scoped rows it creates itself.
 */
export default async function setup(): Promise<void> {
  if (!integrationTestsEnabled) {
    return;
  }
  await resetAndMigrate();
}
