/**
 * Demo tenant reset — database.md#seed-and-demo-tenant, ADR-0014. Resolves the demo tenant by
 * its fixed slug (never a hardcoded id), deletes every row it owns in FK-dependency order
 * (children first), then re-seeds.
 *
 * Deliberately NOT an ON DELETE CASCADE from the tenants row — that capability is not added
 * anywhere in this schema (database.md#soft-delete-policy); the demo tenant gets this narrow,
 * reviewed, explicit script instead of a generic cascade every tenant would otherwise also have.
 *
 * The table list itself lives in apps/api/src/database/tenant-tables.ts, shared with the RLS
 * integration test suite — a future migration adding a new tenant table adds it there once,
 * covering both this reset script and the test coverage check.
 *
 * **Runs as app_migrator, not app_tenant — a deliberate, documented deviation from
 * database.md's literal text ("Runs the demo tenant's own DB session with app_tenant and SET
 * LOCAL app.tenant_id"), discovered by running this script for real (PROMPT 03-A):**
 * database.md#soft-delete-policy deliberately withholds DELETE from app_tenant on several tables
 * this reset list also includes (e.g. `import_job_rows`, `inventory_movements` — the latter is
 * even documented elsewhere in the same file as "never deleted, ever"). Running as app_tenant
 * therefore fails with "permission denied" the moment the loop reaches one of those tables.
 * Two ways to close that gap were considered:
 *   (a) grant app_tenant DELETE on those tables — rejected: that GRANT would apply to every
 *       ordinary request app_tenant ever serves, not just this script, silently reopening the
 *       exact hard-delete risk the soft-delete policy exists to prevent for real tenant traffic
 *       (e.g. a service-layer bug issuing a raw DELETE against the audit ledger).
 *   (b) run this one narrow, already-reviewed, demo-only administrative script as app_migrator
 *       instead — chosen. It does not touch app_tenant's grants (zero blast radius on real
 *       request handling), and every statement stays explicitly `WHERE tenant_id = tenantId`
 *       (resolved from the fixed 'demo' slug) — the primary safety guarantee database.md itself
 *       describes RLS as merely a *second* guarantee "on top of". app_migrator does bypass RLS
 *       (table owner), so that specific redundant layer is not present for this script — a real,
 *       narrow, and consciously accepted trade-off, not a silent one.
 */
import { eq } from 'drizzle-orm';
import { getBootstrapDatabaseUrl } from '@saas-inventory/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { closePostgresClient } from '../../apps/api/src/database/client';
import { TENANT_TABLES_CHILDREN_FIRST } from '../../apps/api/src/database/tenant-tables';
// Direct file import, not the schema barrel (schema/index.ts) — see the header comment in
// seeds/demo-tenant.ts for why: apps/api (CommonJS) re-exported via `export *` chains is
// invisible to an ESM `import * as schema` consumer across the package boundary.
import { tenants } from '../../apps/api/src/database/schema/01-platform';
import { seedDemoTenant } from '../seeds/demo-tenant';

const DEMO_TENANT_SLUG = 'demo';

async function resolveDemoTenantId(): Promise<string | undefined> {
  const migratorClient = postgres(getBootstrapDatabaseUrl(), { max: 1 });
  try {
    const db = drizzle(migratorClient);
    const [row] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, DEMO_TENANT_SLUG));
    return row?.id;
  } finally {
    await migratorClient.end();
  }
}

/** See the file header for why this runs as app_migrator (MIGRATOR_BOOTSTRAP_DATABASE_URL) rather than
 * app_tenant + withTenantTransaction() — app_tenant lacks DELETE on several tables in this list
 * by design. Every statement stays explicitly `WHERE tenant_id = tenantId` regardless. */
async function deleteAllTenantRows(tenantId: string): Promise<void> {
  const migratorClient = postgres(getBootstrapDatabaseUrl(), { max: 1 });
  try {
    const db = drizzle(migratorClient);
    await db.transaction(async (tx) => {
      for (const table of TENANT_TABLES_CHILDREN_FIRST) {
        await tx.delete(table).where(eq(table.tenantId, tenantId));
      }
    });
  } finally {
    await migratorClient.end();
  }
}

export async function resetDemoTenant(): Promise<void> {
  const tenantId = await resolveDemoTenantId();
  if (!tenantId) {
    console.log('Demo tenant does not exist yet — seeding fresh.');
    await seedDemoTenant();
    return;
  }

  await deleteAllTenantRows(tenantId);
  await seedDemoTenant();
  console.log(`Demo tenant reset complete (id: ${tenantId}).`);
}

// seedDemoTenant() calls withTenantTransaction(), which lazily opens a pooled connection via
// apps/api's client.ts singleton (app_tenant) — postgres.js keeps it open indefinitely unless
// explicitly closed, so without this the process never exits on its own once the script finishes
// (PROMPT 03-A). deleteAllTenantRows() above manages its own separate, self-closing connection.
resetDemoTenant()
  .catch((error: unknown) => {
    console.error('Demo tenant reset failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Diagnostic (D-8E.14, set by tools/pg-verify only): the process was seen to stay alive in CI after printing its last line.
    // The timer is unref'd, so it fires only if something else is still keeping the process alive; the first line proves whether
    // closePostgresClient() was reached and the second whether it returned.
    if (process.env['RESET_DEMO_DEBUG_ACTIVE_RESOURCES'] === '1') {
      console.error('[debug] reset-demo: closing the app_tenant client');
      setTimeout(() => console.error('[debug] reset-demo: still alive 15 s later; active resources:', process.getActiveResourcesInfo()), 15_000).unref();
      return closePostgresClient().then(() => console.error('[debug] reset-demo: closePostgresClient() returned'));
    }
    return closePostgresClient();
  });
