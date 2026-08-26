import { getOptionalEnvVar } from '@saas-inventory/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from '../../src/database/schema';

/**
 * Shared setup for the database integration suite (test/database/*.integration.test.ts).
 *
 * Deliberately reads TEST_-prefixed env vars, distinct from the app's own DATABASE_URL /
 * MIGRATOR_DATABASE_URL — this suite drops and recreates the target database's entire `public`
 * schema and its five roles between runs, so it must never be pointed at a real dev/staging
 * database by accident. If these are unset, every test in the suite is skipped (not failed) —
 * see `integrationTestsEnabled` below — so `pnpm test` (unit tests only) and CI runs that don't
 * provision a Postgres instance are unaffected.
 *
 * TEST_MIGRATOR_DATABASE_URL: a bootstrap connection with CREATEROLE + ownership of the target
 * database (matches migration 0000's requirement — e.g. the docker-compose.dev.yml Postgres
 * superuser, pointed at a disposable database).
 * TEST_APP_TENANT_DATABASE_URL: connects as app_tenant. Its password must already be set (e.g.
 * via `db:bootstrap-dev-roles` with TEST_MIGRATOR_DATABASE_URL) before running this suite the
 * first time against a fresh Postgres instance — role passwords are not migration-managed data
 * (CLAUDE.md §7.4).
 */
const TEST_MIGRATOR_DATABASE_URL = getOptionalEnvVar('TEST_MIGRATOR_DATABASE_URL', '');
const TEST_APP_TENANT_DATABASE_URL = getOptionalEnvVar('TEST_APP_TENANT_DATABASE_URL', '');
/** Needed by every suite that boots the full app (`buildApp()`) — DatabaseModule
 * (database.module.ts) eagerly wires up app_platform (Prompt 04) and, as of Prompt 09,
 * app_public_resolver alongside app_tenant, so `buildApp()` throws immediately if either of these
 * two is unset, regardless of whether the specific suite exercises that role's endpoints. Kept as
 * one combined `appPlatformIntegrationTestsEnabled` gate (not a second, separate flag) since every
 * existing consumer of it already means exactly "can I call buildApp()", not "does this suite test
 * app_platform specifically". */
const TEST_APP_PLATFORM_DATABASE_URL = getOptionalEnvVar('TEST_APP_PLATFORM_DATABASE_URL', '');
const TEST_APP_PUBLIC_RESOLVER_DATABASE_URL = getOptionalEnvVar('TEST_APP_PUBLIC_RESOLVER_DATABASE_URL', '');
/** Only needed by test/import/import-worker.integration.test.ts (the app_import_worker connection,
 * migration 0019/0020, ADR-0029) — every other suite, including the rest of the IMPORT suite that
 * only exercises the synchronous HTTP path, is unaffected if this is unset. */
const TEST_APP_IMPORT_WORKER_DATABASE_URL = getOptionalEnvVar('TEST_APP_IMPORT_WORKER_DATABASE_URL', '');
/** Needed by test/events/event-processor.integration.test.ts (the app_event_processor connection,
 * migrations 0000/0010, FASE 14) — the transactional-outbox suites that only WRITE events go
 * through buildApp() and gate on appPlatformIntegrationTestsEnabled instead. tools/pg-verify DOES
 * set this, so the Event Processor claim/retry/stale suite runs as part of the standard pass
 * (0 skipped). */
const TEST_APP_EVENT_PROCESSOR_DATABASE_URL = getOptionalEnvVar('TEST_APP_EVENT_PROCESSOR_DATABASE_URL', '');

export const integrationTestsEnabled = TEST_MIGRATOR_DATABASE_URL !== '' && TEST_APP_TENANT_DATABASE_URL !== '';
export const appPlatformIntegrationTestsEnabled =
  integrationTestsEnabled && TEST_APP_PLATFORM_DATABASE_URL !== '' && TEST_APP_PUBLIC_RESOLVER_DATABASE_URL !== '';
export const importWorkerIntegrationTestsEnabled = appPlatformIntegrationTestsEnabled && TEST_APP_IMPORT_WORKER_DATABASE_URL !== '';
export const eventProcessorIntegrationTestsEnabled = appPlatformIntegrationTestsEnabled && TEST_APP_EVENT_PROCESSOR_DATABASE_URL !== '';

const APP_ROLES = ['app_migrator', 'app_tenant', 'app_platform', 'app_event_processor', 'app_public_resolver', 'app_import_worker'];

/** Tears the database down to a genuinely empty state — validates database.md §19's "una base
 * vacía pueda inicializarse" requirement isn't just true the first time a Postgres volume is
 * created, but on every re-run.
 *
 * Must also drop the `drizzle` schema, not just `public` — confirmed by running this for real
 * (PROMPT 03-A): Drizzle Kit's own migration-bookkeeping table (drizzle.__drizzle_migrations)
 * lives in a separate schema untouched by `DROP SCHEMA public CASCADE`. Without dropping it too,
 * a second resetAndMigrate() call against the same Postgres instance leaves that table falsely
 * reporting every migration as already applied — runMigrations() then applies nothing, and
 * `public` (including every role migration 0000 creates) stays empty. */
async function dropEverything(): Promise<void> {
  const bootstrap = postgres(TEST_MIGRATOR_DATABASE_URL, { max: 1 });
  try {
    await bootstrap.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await bootstrap.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await bootstrap.unsafe('CREATE SCHEMA public');
    // A freshly initdb'd database's `public` schema has USAGE granted to PUBLIC (the pseudo-role
    // meaning "everyone") by default — but a schema we manually recreate here does not inherit
    // that. Without it, every non-owner role (app_tenant included) loses the ability to even see
    // objects in `public`, regardless of correct per-table GRANTs from the migrations — surfaces
    // as "relation ... does not exist" for a role that very much has SELECT on that table.
    // Confirmed by running the full integration suite for real (PROMPT 03-A). Real deployments
    // never hit this: they never drop/recreate `public`, so its original default grant survives.
    await bootstrap.unsafe('GRANT USAGE ON SCHEMA public TO PUBLIC');
    for (const role of APP_ROLES) {
      try {
        await bootstrap.unsafe(`DROP OWNED BY "${role}" CASCADE`);
      } catch {
        // role doesn't exist yet on a genuinely fresh database — fine.
      }
      try {
        await bootstrap.unsafe(`DROP ROLE IF EXISTS "${role}"`);
      } catch {
        // ignore — best-effort teardown between test runs.
      }
    }
  } finally {
    await bootstrap.end();
  }
}

/** Runs every migration in database/migrations/, in order, against a freshly emptied database —
 * exercises exactly the same path db:migrate uses in real environments. */
async function runMigrations(): Promise<void> {
  const migrationClient = postgres(TEST_MIGRATOR_DATABASE_URL, { max: 1 });
  try {
    const db = drizzle(migrationClient);
    await migrate(db, { migrationsFolder: '../../database/migrations' });
  } finally {
    await migrationClient.end();
  }
}

/** Sets a password for app_tenant so TEST_APP_TENANT_DATABASE_URL can authenticate — mirrors
 * db:bootstrap-dev-roles, scoped to what this test suite itself needs. Reads the password out of
 * TEST_APP_TENANT_DATABASE_URL rather than requiring a second env var. */
async function bootstrapAppTenantPassword(): Promise<void> {
  const parsed = new URL(TEST_APP_TENANT_DATABASE_URL);
  const password = decodeURIComponent(parsed.password);
  const bootstrap = postgres(TEST_MIGRATOR_DATABASE_URL, { max: 1 });
  try {
    // ALTER ROLE ... WITH PASSWORD does not accept a bind parameter in the password position —
    // PostgreSQL's parser rejects `$1` there (DDL, not preparable DML). Confirmed against a real
    // PostgreSQL instance, PROMPT 03-A — same bug/fix as bootstrap-dev-roles.ts. Bind the
    // password normally in a SELECT (immune to injection), let Postgres's own quote_literal()
    // produce a correctly-escaped literal, then splice that already-safe literal into the DDL.
    const [quoted] = await bootstrap<{ quoted_password: string }[]>`select quote_literal(${password}) as quoted_password`;
    if (!quoted) {
      throw new Error('quote_literal() returned no row for app_tenant password');
    }
    await bootstrap.unsafe(`ALTER ROLE app_tenant WITH PASSWORD ${quoted.quoted_password}`);
  } finally {
    await bootstrap.end();
  }
}

/** Mirrors bootstrapAppTenantPassword() for app_platform — only runs when
 * TEST_APP_PLATFORM_DATABASE_URL is actually set, so the existing (pre-Prompt-04) integration
 * suites are unaffected on a checkout that hasn't configured it. */
async function bootstrapAppPlatformPassword(): Promise<void> {
  if (!appPlatformIntegrationTestsEnabled) {
    return;
  }
  const parsed = new URL(TEST_APP_PLATFORM_DATABASE_URL);
  const password = decodeURIComponent(parsed.password);
  const bootstrap = postgres(TEST_MIGRATOR_DATABASE_URL, { max: 1 });
  try {
    const [quoted] = await bootstrap<{ quoted_password: string }[]>`select quote_literal(${password}) as quoted_password`;
    if (!quoted) {
      throw new Error('quote_literal() returned no row for app_platform password');
    }
    await bootstrap.unsafe(`ALTER ROLE app_platform WITH PASSWORD ${quoted.quoted_password}`);
  } finally {
    await bootstrap.end();
  }
}

/** Mirrors bootstrapAppTenantPassword() for app_public_resolver — only runs when
 * TEST_APP_PUBLIC_RESOLVER_DATABASE_URL is actually set, so pre-Prompt-09 checkouts that haven't
 * configured it don't fail here (buildApp() itself is what actually enforces the requirement, via
 * appPlatformIntegrationTestsEnabled above). */
async function bootstrapAppPublicResolverPassword(): Promise<void> {
  if (TEST_APP_PUBLIC_RESOLVER_DATABASE_URL === '') {
    return;
  }
  const parsed = new URL(TEST_APP_PUBLIC_RESOLVER_DATABASE_URL);
  const password = decodeURIComponent(parsed.password);
  const bootstrap = postgres(TEST_MIGRATOR_DATABASE_URL, { max: 1 });
  try {
    const [quoted] = await bootstrap<{ quoted_password: string }[]>`select quote_literal(${password}) as quoted_password`;
    if (!quoted) {
      throw new Error('quote_literal() returned no row for app_public_resolver password');
    }
    await bootstrap.unsafe(`ALTER ROLE app_public_resolver WITH PASSWORD ${quoted.quoted_password}`);
  } finally {
    await bootstrap.end();
  }
}

/** Mirrors bootstrapAppTenantPassword() for app_import_worker — only runs when
 * TEST_APP_IMPORT_WORKER_DATABASE_URL is actually set. */
async function bootstrapAppImportWorkerPassword(): Promise<void> {
  if (TEST_APP_IMPORT_WORKER_DATABASE_URL === '') {
    return;
  }
  const parsed = new URL(TEST_APP_IMPORT_WORKER_DATABASE_URL);
  const password = decodeURIComponent(parsed.password);
  const bootstrap = postgres(TEST_MIGRATOR_DATABASE_URL, { max: 1 });
  try {
    const [quoted] = await bootstrap<{ quoted_password: string }[]>`select quote_literal(${password}) as quoted_password`;
    if (!quoted) {
      throw new Error('quote_literal() returned no row for app_import_worker password');
    }
    await bootstrap.unsafe(`ALTER ROLE app_import_worker WITH PASSWORD ${quoted.quoted_password}`);
  } finally {
    await bootstrap.end();
  }
}

/** Mirrors bootstrapAppTenantPassword() for app_event_processor — only runs when
 * TEST_APP_EVENT_PROCESSOR_DATABASE_URL is actually set (migration 0000 creates the role). */
async function bootstrapAppEventProcessorPassword(): Promise<void> {
  if (TEST_APP_EVENT_PROCESSOR_DATABASE_URL === '') {
    return;
  }
  const parsed = new URL(TEST_APP_EVENT_PROCESSOR_DATABASE_URL);
  const password = decodeURIComponent(parsed.password);
  const bootstrap = postgres(TEST_MIGRATOR_DATABASE_URL, { max: 1 });
  try {
    const [quoted] = await bootstrap<{ quoted_password: string }[]>`select quote_literal(${password}) as quoted_password`;
    if (!quoted) {
      throw new Error('quote_literal() returned no row for app_event_processor password');
    }
    await bootstrap.unsafe(`ALTER ROLE app_event_processor WITH PASSWORD ${quoted.quoted_password}`);
  } finally {
    await bootstrap.end();
  }
}

/** Resets the target database to empty and applies every migration — call once per test file in
 * beforeAll(), never inside individual `it`s (each migration run is relatively expensive). */
export async function resetAndMigrate(): Promise<void> {
  await dropEverything();
  await runMigrations();
  await bootstrapAppTenantPassword();
  await bootstrapAppPlatformPassword();
  await bootstrapAppPublicResolverPassword();
  await bootstrapAppImportWorkerPassword();
  await bootstrapAppEventProcessorPassword();
}

export function getMigratorDb() {
  const client = postgres(TEST_MIGRATOR_DATABASE_URL, { max: 1 });
  return { client, db: drizzle(client, { schema }) };
}

export function getAppTenantClient() {
  return postgres(TEST_APP_TENANT_DATABASE_URL, { max: 1 });
}

export function getAppPlatformDatabaseUrl(): string {
  return TEST_APP_PLATFORM_DATABASE_URL;
}

export function getAppPublicResolverDatabaseUrl(): string {
  return TEST_APP_PUBLIC_RESOLVER_DATABASE_URL;
}

export function getAppImportWorkerDatabaseUrl(): string {
  return TEST_APP_IMPORT_WORKER_DATABASE_URL;
}

export function getAppEventProcessorDatabaseUrl(): string {
  return TEST_APP_EVENT_PROCESSOR_DATABASE_URL;
}

/** The exact SET LOCAL / set_config pattern the running API uses (tenant-context.ts) — opens an
 * explicit transaction, sets app.tenant_id via a bound parameter, runs fn, and lets the caller
 * commit/rollback by returning/throwing. */
export async function withTenantSql<T>(
  client: postgres.Sql,
  tenantId: string | undefined,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await client.begin(async (tx) => {
    if (tenantId !== undefined) {
      await tx.unsafe(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    }
    return fn(tx);
  });
  return result as T;
}
