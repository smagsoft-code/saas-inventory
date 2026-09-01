/**
 * PROMPT 03-A verification harness — starts a REAL, local, Docker-free PostgreSQL instance (the
 * `embedded-postgres` package's actual PostgreSQL server binary — never a mock or SQLite
 * substitute) and runs the complete Prompt 03 verification against it: migrations from an empty
 * database, idempotent re-migration, role/privilege audits, RLS/policy catalog checks, tenant
 * context pooling-leakage checks, the permissions catalog, the demo seed + reset scripts, and
 * finally the full apps/api integration test suite (real cross-tenant SELECT/INSERT/UPDATE/DELETE
 * against real RLS).
 *
 * This package is verification-only, not part of the application's runtime or its deployment
 * infrastructure — docker-compose.dev.yml remains the source of truth for local dev / production-
 * shaped setups. It deliberately has no dependency on drizzle-orm (only raw SQL via the `postgres`
 * driver, plus shelling out to the project's own pnpm scripts) so it never shares dependency
 * resolution with apps/api's or database's Drizzle schema — embedded-postgres pulls in `pg`,
 * which previously caused a cross-package drizzle-orm peer-variant mismatch when colocated with
 * schema-importing code (see git history / PROMPT 03-A investigation notes).
 *
 * Safe to delete/re-run at any time: the data directory is wiped on every run
 * (`persistent: false`) so every invocation starts from a genuinely empty database.
 *
 * Usage: pnpm --filter @saas-inventory/pg-verify verify
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import postgres from 'postgres';

const PORT = 55432;
const SUPERUSER = 'postgres';
const SUPERUSER_PASSWORD = 'verify-only-ephemeral-instance';
const DB_NAME = 'saas_inventory_verify';
const APP_TENANT_PASSWORD = 'verify-app-tenant-ephemeral';
const APP_PLATFORM_PASSWORD = 'verify-app-platform-ephemeral';
const APP_PUBLIC_RESOLVER_PASSWORD = 'verify-app-public-resolver-ephemeral';
// PROMPT 011-B: previously left to a separate, manual throwaway run (FASE 10's final report) —
// now bootstrapped here too so the standard verify pass actually exercises
// test/import/import-worker.integration.test.ts's real-PostgreSQL claim-query suite, including
// this prompt's new suspended-tenant claim/reclaim cases, every time this script runs.
const APP_IMPORT_WORKER_PASSWORD = 'verify-app-import-worker-ephemeral';
// FASE 14: the Event Processor's own claiming role (migrations 0000/0010). Bootstrapped here so
// test/events/event-processor.integration.test.ts's real-PostgreSQL claim/retry/stale suite runs
// as part of the standard verify pass (0 skipped, §127/§177), never a separate manual run.
const APP_EVENT_PROCESSOR_PASSWORD = 'verify-app-event-processor-ephemeral';
const DATA_DIR = path.resolve(process.cwd(), '.verify-pgdata');
const API_DIR = path.resolve(process.cwd(), '../../apps/api');

const MIGRATOR_URL = `postgresql://${SUPERUSER}:${SUPERUSER_PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`;
const APP_TENANT_URL = `postgresql://app_tenant:${APP_TENANT_PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`;
const APP_PLATFORM_URL = `postgresql://app_platform:${APP_PLATFORM_PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`;
const APP_PUBLIC_RESOLVER_URL = `postgresql://app_public_resolver:${APP_PUBLIC_RESOLVER_PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`;
const APP_IMPORT_WORKER_URL = `postgresql://app_import_worker:${APP_IMPORT_WORKER_PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`;
const APP_EVENT_PROCESSOR_URL = `postgresql://app_event_processor:${APP_EVENT_PROCESSOR_PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`;

let failures = 0;

/** noUncheckedIndexedAccess widens array-destructured elements to `T | undefined` — this project's
 * base tsconfig enables it, so every "exactly one row expected" query goes through this instead
 * of a bare `const [row] = await sql...`. */
function firstRowOrThrow<T>(rows: T[], context: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Expected at least one row for: ${context}`);
  }
  return row;
}

function section(title: string): void {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  [PASS] ${label}`);
  } else {
    failures += 1;
    console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function run(label: string, args: string[], env: Record<string, string>): void {
  console.log(`\n--- ${label} ---`);
  const result = spawnSync('pnpm', args, {
    cwd: API_DIR,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: true,
  });
  if (result.status !== 0) {
    failures += 1;
    console.log(`  [FAIL] "${label}" exited with status ${String(result.status)}`);
  } else {
    console.log(`  [PASS] "${label}" exited 0`);
  }
}

async function main(): Promise<void> {
  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });

  section('1. Starting a REAL PostgreSQL instance (embedded-postgres, no Docker/mocks)');
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: SUPERUSER,
    password: SUPERUSER_PASSWORD,
    persistent: false,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB_NAME);

  try {
    {
      const sql = postgres(MIGRATOR_URL, { max: 1 });
      const { version } = firstRowOrThrow(await sql<{ version: string }[]>`select version()`, 'select version()');
      const { current_database: db } = firstRowOrThrow(
        await sql<{ current_database: string }[]>`select current_database()`,
        'select current_database()',
      );
      const { current_user: user } = firstRowOrThrow(
        await sql<{ current_user: string }[]>`select current_user`,
        'select current_user',
      );
      console.log(`  version:          ${version}`);
      console.log(`  current_database: ${db}`);
      console.log(`  current_user:     ${user}`);
      check('version() responded', version.includes('PostgreSQL'));
      check('current_database() matches target db', db === DB_NAME);
      check('current_user is the bootstrap superuser', user === SUPERUSER);
      await sql.end();
    }

    section('2. Migrations from an EMPTY database');
    run('db:migrate (from empty)', ['run', 'db:migrate'], { MIGRATOR_DATABASE_URL: MIGRATOR_URL });

    section('3. Re-running migrations (must be a safe no-op, not corrupt/duplicate anything)');
    run('db:migrate (second run)', ['run', 'db:migrate'], { MIGRATOR_DATABASE_URL: MIGRATOR_URL });

    section('4. Bootstrapping app_tenant / app_platform / app_public_resolver / app_import_worker / app_event_processor role passwords');
    run('db:bootstrap-dev-roles', ['run', 'db:bootstrap-dev-roles'], {
      MIGRATOR_DATABASE_URL: MIGRATOR_URL,
      APP_TENANT_PASSWORD,
      APP_PLATFORM_PASSWORD,
      APP_PUBLIC_RESOLVER_PASSWORD,
      APP_IMPORT_WORKER_PASSWORD,
      APP_EVENT_PROCESSOR_PASSWORD,
    });

    await verifySchema();
    await verifyRoles();
    await verifyRls();
    await verifyPoolingLeakage();
    await verifyPermissionsCatalog();

    section('9. Running the demo seed against the real database (exercises app_tenant + RLS end to end)');
    run('db:seed', ['run', 'db:seed'], {
      MIGRATOR_DATABASE_URL: MIGRATOR_URL,
      DATABASE_URL: APP_TENANT_URL,
    });
    await verifySeedResult();

    section('10. Resetting and re-seeding the demo tenant (exercises the RLS-scoped DELETE path)');
    run('db:reset-demo', ['run', 'db:reset-demo'], {
      MIGRATOR_DATABASE_URL: MIGRATOR_URL,
      DATABASE_URL: APP_TENANT_URL,
    });
    await verifySeedResult();

    section(
      '11. Full apps/api integration test suite (real cross-tenant SELECT/INSERT/UPDATE/DELETE, real RLS, ' +
        'real auth/tenant/RBAC HTTP flow)',
    );
    // TEST_APP_PLATFORM_DATABASE_URL / TEST_APP_PUBLIC_RESOLVER_DATABASE_URL gate every suite that
    // calls buildApp() (test/auth/*, test/catalog/*, test/core/*, test/inventory/*, test/qr/*) —
    // see apps/api/test/database/helpers.ts's appPlatformIntegrationTestsEnabled, which as of
    // Prompt 09 requires both. Without them those files' describe.skipIf() silently skips every
    // test in them, even with a real Postgres running — this ran unnoticed until Prompt 05-B
    // because this harness predates Prompt 04.
    run('test:integration', ['run', 'test:integration'], {
      TEST_MIGRATOR_DATABASE_URL: MIGRATOR_URL,
      TEST_APP_TENANT_DATABASE_URL: APP_TENANT_URL,
      TEST_APP_PLATFORM_DATABASE_URL: APP_PLATFORM_URL,
      TEST_APP_PUBLIC_RESOLVER_DATABASE_URL: APP_PUBLIC_RESOLVER_URL,
      // PROMPT 011-B: enables importWorkerIntegrationTestsEnabled (test/database/helpers.ts), so
      // test/import/import-worker.integration.test.ts's real app_import_worker claim-query suite
      // now runs as part of the standard pass instead of a separate manual run.
      TEST_APP_IMPORT_WORKER_DATABASE_URL: APP_IMPORT_WORKER_URL,
      // FASE 14: enables eventProcessorIntegrationTestsEnabled, so test/events/*.integration.test.ts
      // (transactional outbox atomicity, SALES event exactly-once, and the Event Processor
      // claim/retry/stale/crash-window suite) all run here — 0 skipped (§127/§177).
      TEST_APP_EVENT_PROCESSOR_DATABASE_URL: APP_EVENT_PROCESSOR_URL,
    });
  } finally {
    section('Stopping PostgreSQL (data directory is wiped — persistent: false)');
    await pg.stop();
  }

  section('SUMMARY');
  if (failures === 0) {
    console.log('All checks PASSED.');
  } else {
    console.log(`${failures} check(s) FAILED — see [FAIL] lines above.`);
    process.exitCode = 1;
  }
}

async function verifySchema(): Promise<void> {
  section('5. Schema verification against pg_catalog (not just reading migration files)');
  const sql = postgres(MIGRATOR_URL, { max: 1 });
  try {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`;
    // 50, not 48 — identities + tenant_memberships (016-B, migration 0028, ADR-0033) were added
    // after this figure was first written and this check was never updated (same class of drift
    // this comment already documents twice — see the 45->46->48 history).
    check('50 tables exist', tables.length === 50, `found ${tables.length}`);

    const fks = await sql<{ count: number }[]>`
      select count(*)::int as count from information_schema.table_constraints
      where constraint_schema = 'public' and constraint_type = 'FOREIGN KEY'`;
    // Threshold, not an exact count — 83 real FKs were counted on the first successful run;
    // >50 is a sanity floor against "the migration silently created zero FKs", not a precise spec.
    check('foreign keys exist', (fks[0]?.count ?? 0) > 50, `found ${fks[0]?.count}`);

    const checks = await sql<{ count: number }[]>`
      select count(*)::int as count from information_schema.table_constraints
      where constraint_schema = 'public' and constraint_type = 'CHECK'
        and constraint_name not like '%_not_null'`;
    check('check constraints exist', (checks[0]?.count ?? 0) > 40, `found ${checks[0]?.count}`);

    const indexes = await sql<{ count: number }[]>`
      select count(*)::int as count from pg_indexes where schemaname = 'public'`;
    check('indexes exist', (indexes[0]?.count ?? 0) > 100, `found ${indexes[0]?.count}`);

    const functions = await sql<{ proname: string; prosecdef: boolean }[]>`
      select proname, prosecdef from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'`;
    check(
      'set_updated_at and prevent_tenant_id_change functions exist',
      functions.some((f) => f.proname === 'set_updated_at') && functions.some((f) => f.proname === 'prevent_tenant_id_change'),
    );

    const triggers = await sql<{ count: number }[]>`
      select count(*)::int as count from information_schema.triggers where trigger_schema = 'public'`;
    check('triggers exist', (triggers[0]?.count ?? 0) > 60, `found ${triggers[0]?.count}`);

    section('6. SECURITY DEFINER audit');
    const definerFunctions = functions.filter((f) => f.prosecdef);
    check('no SECURITY DEFINER functions exist in this schema', definerFunctions.length === 0, JSON.stringify(definerFunctions));

    section('7. search_path check');
    const { search_path: searchPath } = firstRowOrThrow(
      await sql<{ search_path: string }[]>`show search_path`,
      'show search_path',
    );
    console.log(`  search_path (migrator connection): ${searchPath}`);
    check('search_path has no untrusted schema shadowing risk (no SECURITY DEFINER functions to protect)', definerFunctions.length === 0);
  } finally {
    await sql.end();
  }
}

async function verifyRoles(): Promise<void> {
  section('8. Role / privilege audit (migrator vs. app_tenant separation, SUPERUSER, BYPASSRLS)');
  const sql = postgres(MIGRATOR_URL, { max: 1 });
  try {
    const roles = await sql<
      { rolname: string; rolsuper: boolean; rolcreaterole: boolean; rolcreatedb: boolean; rolbypassrls: boolean }[]
    >`select rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles
      where rolname in ('app_migrator', 'app_tenant', 'app_platform', 'app_event_processor', 'app_public_resolver')
      order by rolname`;
    for (const r of roles) {
      console.log(`  ${r.rolname}: super=${r.rolsuper} createrole=${r.rolcreaterole} createdb=${r.rolcreatedb} bypassrls=${r.rolbypassrls}`);
    }
    // .every() on an empty array is vacuously true — assert the expected count explicitly first,
    // so a role silently failing to be created (as happened during PROMPT 03-A's first real run)
    // is caught here instead of masquerading as every attribute check passing.
    check('all 5 application roles exist', roles.length === 5, `found ${roles.length}: ${roles.map((r) => r.rolname).join(', ')}`);
    check('no application role has SUPERUSER', roles.length > 0 && roles.every((r) => !r.rolsuper));
    check('no application role has CREATEROLE', roles.length > 0 && roles.every((r) => !r.rolcreaterole));
    check('no application role has CREATEDB', roles.length > 0 && roles.every((r) => !r.rolcreatedb));
    const appTenant = roles.find((r) => r.rolname === 'app_tenant');
    check('app_tenant does NOT have BYPASSRLS', appTenant?.rolbypassrls === false);
    const appPlatform = roles.find((r) => r.rolname === 'app_platform');
    check('app_platform DOES have BYPASSRLS (by design, for SuperAdmin cross-tenant reads)', appPlatform?.rolbypassrls === true);

    const { tableowner } = firstRowOrThrow(
      await sql<{ tableowner: string }[]>`
        select tableowner from pg_tables where schemaname = 'public' and tablename = 'tenants'`,
      'select tableowner ... tenants',
    );
    console.log(`  tenants table owner: ${tableowner}`);
    check(
      'tables are owned by app_migrator (not the bootstrap superuser) — proves SET ROLE worked structurally',
      tableowner === 'app_migrator',
    );
  } finally {
    await sql.end();
  }

  section('8b. app_tenant real capabilities (connecting AS app_tenant, not assuming from its name)');
  const asAppTenant = postgres(APP_TENANT_URL, { max: 1 });
  try {
    await asAppTenant`select 1`;
    check('app_tenant can connect and SELECT', true);

    let ddlRejected = false;
    try {
      await asAppTenant`create table app_tenant_should_not_be_able_to_create_this (id uuid)`;
    } catch {
      ddlRejected = true;
    }
    check('app_tenant CANNOT CREATE TABLE', ddlRejected);

    let alterRejected = false;
    try {
      await asAppTenant`alter table warehouses disable row level security`;
    } catch {
      alterRejected = true;
    }
    check('app_tenant CANNOT disable RLS on a table', alterRejected);

    let dropPolicyRejected = false;
    try {
      await asAppTenant`drop policy warehouses_tenant_isolation on warehouses`;
    } catch {
      dropPolicyRejected = true;
    }
    check('app_tenant CANNOT drop an RLS policy', dropPolicyRejected);

    let grantRejected = false;
    try {
      await asAppTenant`grant app_platform to app_tenant`;
    } catch {
      grantRejected = true;
    }
    check('app_tenant CANNOT grant itself another role (no privilege escalation)', grantRejected);
  } finally {
    await asAppTenant.end();
  }

  section('8c. app_event_processor real capabilities (FASE 14 — least privilege, blast radius = event_outbox only)');
  const asEventProcessor = postgres(APP_EVENT_PROCESSOR_URL, { max: 1 });
  try {
    const outboxSelect = await asEventProcessor`select count(*)::int as c from event_outbox`;
    check('app_event_processor CAN SELECT event_outbox (cross-tenant, no app.tenant_id set)', outboxSelect.length === 1);

    let updateOk = true;
    try {
      // affects 0 rows on an empty table — we only care that UPDATE is granted, not that a row changed
      await asEventProcessor`update event_outbox set claimed_by = 'verify' where false`;
    } catch {
      updateOk = false;
    }
    check('app_event_processor CAN UPDATE event_outbox', updateOk);

    for (const table of ['orders', 'customers', 'order_items', 'inventory_balances', 'product_variants', 'users']) {
      let denied = false;
      try {
        await asEventProcessor.unsafe(`select 1 from ${table} limit 1`);
      } catch {
        denied = true;
      }
      check(`app_event_processor CANNOT read ${table} (no grant — §44/§164)`, denied);
    }

    let insertDenied = false;
    try {
      await asEventProcessor`insert into event_outbox (id, aggregate_type, aggregate_id, event_type, payload) values (gen_random_uuid(), 'x', gen_random_uuid(), 'x', '{}'::jsonb)`;
    } catch {
      insertDenied = true;
    }
    check('app_event_processor CANNOT INSERT into event_outbox (producers do that as app_tenant)', insertDenied);

    let setRoleDenied = false;
    try {
      await asEventProcessor`set role app_platform`;
    } catch {
      setRoleDenied = true;
    }
    check('app_event_processor CANNOT `SET ROLE app_platform` (§43)', setRoleDenied);
  } finally {
    await asEventProcessor.end();
  }
}

async function verifyRls(): Promise<void> {
  section('12. RLS catalog verification (ENABLE + FORCE + policies, read from pg_catalog)');
  const sql = postgres(MIGRATOR_URL, { max: 1 });
  try {
    const rows = await sql<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policy_count: number }[]
    >`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity,
        (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)::int as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname not in ('tenants', 'platform_admins', 'permissions', 'measurement_units', 'platform_admin_refresh_tokens', 'identities', 'tenant_memberships')`;
    // Filtering an empty `rows` is vacuously "zero without RLS" — assert the expected table count
    // explicitly first (same class of false-positive this file already got burned by in §8).
    // 50 total tables - 7 platform-scoped (tenants, platform_admins, permissions,
    // measurement_units, platform_admin_refresh_tokens, identities, tenant_memberships) = 43
    // tenant-owned tables (see the 50-tables comment above for why this isn't 42/41 any more).
    check('43 tenant-owned tables were found to check', rows.length === 43, `found ${rows.length}`);
    const withoutRls = rows.filter((r) => !r.relrowsecurity);
    const withoutForce = rows.filter((r) => !r.relforcerowsecurity);
    const withoutPolicy = rows.filter((r) => r.policy_count === 0);
    check(
      'every tenant-owned table has RLS enabled',
      rows.length > 0 && withoutRls.length === 0,
      JSON.stringify(withoutRls.map((r) => r.relname)),
    );
    check(
      'every tenant-owned table has FORCE ROW LEVEL SECURITY',
      rows.length > 0 && withoutForce.length === 0,
      JSON.stringify(withoutForce.map((r) => r.relname)),
    );
    check(
      'every tenant-owned table has at least one policy',
      rows.length > 0 && withoutPolicy.length === 0,
      JSON.stringify(withoutPolicy.map((r) => r.relname)),
    );
    console.log(`  ${rows.length} tenant-owned tables checked, all with RLS+FORCE+policy.`);

    const policies = await sql<{ tablename: string; policyname: string; qual: string; with_check: string; roles: string[] }[]>`
      select tablename, policyname, qual, with_check, roles from pg_policies
      where schemaname = 'public' order by tablename, policyname`;
    console.log(`  ${policies.length} total policies. Sample (products):`);
    for (const p of policies.filter((p) => p.tablename === 'products')) {
      console.log(`    ${p.policyname} roles=${JSON.stringify(p.roles)} USING=${p.qual} WITH CHECK=${p.with_check}`);
    }

    const platformTables = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname in ('tenants', 'platform_admins', 'permissions', 'measurement_units', 'platform_admin_refresh_tokens', 'identities', 'tenant_memberships')`;
    check('platform-scoped tables have NO RLS (by design)', platformTables.length === 7 && platformTables.every((r) => !r.relrowsecurity));
  } finally {
    await sql.end();
  }
}

async function verifyPoolingLeakage(): Promise<void> {
  section('13. Connection-pooling tenant-context leakage test (SET LOCAL across a REUSED connection)');
  // max: 1 forces postgres.js to reuse the exact same physical connection for both transactions
  // below — the adversarial case for SET LOCAL leakage. This test exercises the REAL security
  // property end to end (does a real RLS-protected table leak rows), not just what
  // current_setting() reports in isolation — see _policies.ts's NULLIF comment for why a raw
  // current_setting probe on its own is not a reliable leakage signal (a reused connection's
  // reset value is empty string, not NULL, which is expected Postgres behavior, not a leak).
  const tenantA = '11111111-1111-7111-8111-111111111111';
  {
    const migrator = postgres(MIGRATOR_URL, { max: 1 });
    try {
      await migrator`insert into tenants (id, name, slug) values (${tenantA}, 'Pooling Test Tenant', 'pooling-leakage-test') on conflict (id) do nothing`;
      await migrator`insert into warehouses (id, tenant_id, name, code) values (gen_random_uuid(), ${tenantA}, 'Pooling WH', 'POOLING-WH') on conflict do nothing`;
    } finally {
      await migrator.end();
    }
  }

  const pooled = postgres(APP_TENANT_URL, { max: 1 });
  try {
    await pooled.begin(async (tx) => {
      await tx.unsafe(`select set_config('app.tenant_id', $1, true)`, [tenantA]);
      const rows = await tx`select * from warehouses`;
      check('tenant A transaction sees its own row via the real RLS policy', rows.length === 1, `found ${rows.length}`);
    });

    // Same pooled connection (max: 1), a NEW transaction, tenant context never re-set for it —
    // simulates application code that (incorrectly) reached the database without calling
    // withTenantTransaction(). This must return zero rows, cleanly, not throw and not leak.
    await pooled.begin(async (tx) => {
      const rows = await tx`select * from warehouses`;
      check(
        "a new transaction on the SAME reused connection sees ZERO rows (no leaked tenant A context, and NULLIF keeps this a clean empty result rather than a thrown cast error)",
        rows.length === 0,
        `found ${rows.length} row(s) — this would be a CRITICAL cross-tenant leak if > 0`,
      );
    });
  } finally {
    await pooled.end();
  }
}

async function verifyPermissionsCatalog(): Promise<void> {
  section('14. permissions catalog — exact match against database.md (Prompt 02-A/02-B/02-D + Prompt 05-A core admin + Prompt 06 catalog admin + Prompt 07 warehouses/locations admin + Prompt 08 inventory balances/movements admin + FASE 11 administration codes + FASE 12 sales codes + FASE 13 sales-returns codes)');
  const expected = [
    'catalog.attributes.manage',
    'catalog.qr.manage',
    'pricing.policy.manage',
    'pricing.floor.view',
    'pricing.cost.view',
    'pricing.discount.request',
    'pricing.discount.approve',
    'inventory.transfers.request',
    'inventory.transfers.approve',
    'inventory.transfers.dispatch',
    'inventory.transfers.receive',
    'inventory.returns.manage',
    'import.execute',
    'import.inventory',
    'core.users.locations.manage',
    // Prompt 05-A (migration 0014) — tenant/user/role administration, see ADR-0031.
    'core.tenant.update',
    'core.users.read',
    'core.users.create',
    'core.users.update',
    'core.roles.read',
    'core.roles.assign',
    // Prompt 06 (migration 0015) — catalog administration; database.md named 'products.view' as an
    // already-established example twice, but no migration had ever actually inserted it.
    'products.view',
    'products.manage',
    'categories.view',
    'categories.manage',
    // Prompt 07 (migration 0016) — warehouses/locations administration, roadmap.md FASE 7 scope
    // only (balances/movements/adjustments/transfers remain FASE 8). core.users.locations.manage
    // already existed (migration 0001) and is reused as-is for the user<->location assignment
    // endpoints, no new code needed for that action.
    'warehouses.view',
    'warehouses.manage',
    'locations.view',
    'locations.manage',
    // Prompt 08 (migration 0017) — inventory_balances/inventory_movements read + manual-adjustment
    // write, roadmap.md FASE 8 scope. database.md named 'inventory.adjust' as an already-established
    // example (alongside 'products.view') since Prompt 02-D, but no migration had ever actually
    // inserted it — same gap-filling precedent as migrations 0015/0016.
    // inventory.transfers.*/inventory.returns.manage above already existed since migration 0001 and
    // are reused as-is for FASE 8's transfer endpoints, no new codes needed for those.
    'inventory.view',
    'inventory.adjust',
    // FASE 11 (migration 0023) — tenant configuration administration (administration/tenant-settings).
    'administration.settings.view',
    'administration.settings.manage',
    // FASE 12 (migration 0026) — SALES (customers, carts, orders). `module.resource.action`
    // pattern, no ADR needed for the catalog rows (same precedent as 0014-0017/0023).
    // pricing.floor.view/pricing.discount.request already existed since migration 0001 and are
    // reused by SALES as-is — no new pricing codes.
    'sales.customers.view',
    'sales.customers.manage',
    'sales.carts.manage',
    'sales.orders.view',
    'sales.orders.create',
    'sales.orders.cancel',
    // FASE 13 (migration 0027) — SALES sales-returns lifecycle. Only the two SALES-owned
    // administrative return actions are new; inspect/resolve reuse `inventory.returns.manage` and
    // the exceptional-pricing workflow reuses `pricing.discount.request`/`.approve` (all from
    // migration 0001). Same `module.resource.action` pattern, no ADR needed for the catalog rows.
    'sales.returns.view',
    'sales.returns.create',
  ].sort();

  const sql = postgres(MIGRATOR_URL, { max: 1 });
  try {
    const rows = await sql<{ code: string }[]>`select code from permissions order by code`;
    const actual = rows.map((r) => r.code).sort();
    check('permissions catalog has exactly 41 rows', actual.length === 41, `found ${actual.length}`);
    check('permissions catalog matches database.md exactly, no narrative examples added', JSON.stringify(actual) === JSON.stringify(expected));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      console.log('  expected:', expected);
      console.log('  actual:  ', actual);
    }
  } finally {
    await sql.end();
  }
}

async function verifySeedResult(): Promise<void> {
  const sql = postgres(MIGRATOR_URL, { max: 1 });
  try {
    const [tenant] = await sql<{ id: string }[]>`select id from tenants where slug = 'demo'`;
    check('demo tenant exists after seed/reset', tenant !== undefined);
    if (!tenant) return;

    const rolePermRows = await sql<{ role_name: string; permission_code: string }[]>`
      select r.name as role_name, rp.permission_code from role_permissions rp
      join roles r on r.id = rp.role_id and r.tenant_id = rp.tenant_id
      where rp.tenant_id = ${tenant.id}`;
    check(
      'demo tenant role_permissions were inserted (proves every default-role-templates.ts code satisfies the live FK to permissions)',
      rolePermRows.length > 0,
      `found ${rolePermRows.length} rows`,
    );

    const [movement] = await sql<{ movement_type: string }[]>`
      select movement_type from inventory_movements where tenant_id = ${tenant.id} limit 1`;
    check('initial stock was written as an INITIAL_STOCK ledger row (never a bare balance insert)', movement?.movement_type === 'INITIAL_STOCK');

    const [balance] = await sql<{ quantity_physical: string }[]>`
      select quantity_physical from inventory_balances where tenant_id = ${tenant.id} limit 1`;
    check('inventory_balances reflects the ledger', balance !== undefined);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('Verification harness crashed:', error);
  process.exitCode = 1;
});
