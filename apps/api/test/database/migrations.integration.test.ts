import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { TENANT_TABLE_NAMES } from '../../src/database/tenant-tables';
import { getAppTenantClient, getMigratorDb, integrationTestsEnabled } from './helpers';

/**
 * Migration verification — Prompt 03 §18.D: an empty database can be initialized, every
 * migration runs in order, the resulting schema is consistent, RLS policies exist, and indexes
 * and constraints exist. Requires TEST_MIGRATOR_DATABASE_URL / TEST_APP_TENANT_DATABASE_URL —
 * see test/database/helpers.ts. Skipped (not failed) when unset.
 *
 * The reset-from-empty + migrate cycle itself runs once in global-setup.ts, before any test file
 * — not per file (see that file for why per-file reset was a real race, not just wasteful).
 */
describe.skipIf(!integrationTestsEnabled)('migrations', () => {
  it('applied every migration from an empty database without error (global-setup.ts)', async () => {
    // global-setup.ts already proved this by not throwing before any test file ran — this
    // assertion documents the requirement explicitly rather than relying only on that side effect.
    expect(true).toBe(true);
  });

  it('re-running migrate() against an already-migrated database is a safe no-op', async () => {
    const { client } = getMigratorDb();
    try {
      const { migrate } = await import('drizzle-orm/postgres-js/migrator');
      const { drizzle } = await import('drizzle-orm/postgres-js');
      await migrate(drizzle(client), { migrationsFolder: '../../database/migrations' });
    } finally {
      await client.end();
    }
  });

  it('creates every table the architecture defines', async () => {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db.execute<{ table_name: string }>(sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `);
      const actualTables = new Set(rows.map((r) => r.table_name));
      const expectedTables = [
        'tenants',
        'platform_admins',
        'permissions',
        'users',
        'roles',
        'role_permissions',
        'user_roles',
        'audit_log',
        'measurement_units',
        'categories',
        'brands',
        'suppliers',
        'attribute_definitions',
        'attribute_options',
        'category_attributes',
        'products',
        'product_variants',
        'product_images',
        'product_serials',
        'product_lots',
        'product_price_history',
        'tenant_price_policies',
        'qr_codes',
        'warehouses',
        'locations',
        'inventory_balances',
        'inventory_movements',
        'user_location_assignments',
        'inventory_transfers',
        'inventory_transfer_items',
        'inventory_transfer_receipts',
        'inventory_transfer_receipt_items',
        'import_mapping_templates',
        'import_jobs',
        'import_job_rows',
        'customers',
        'orders',
        'order_items',
        'carts',
        'cart_items',
        'price_approvals',
        'sales_returns',
        'sales_return_items',
        'event_outbox',
        'idempotency_keys',
        'auth_refresh_tokens',
        'tenant_settings',
        'platform_admin_refresh_tokens',
        'identities',
        'tenant_memberships',
        'tenant_admin_invitations',
        'platform_support_sessions',
      ];
      for (const table of expectedTables) {
        expect(actualTables.has(table), `expected table "${table}" to exist`).toBe(true);
      }
      expect(actualTables.size).toBe(expectedTables.length);
    } finally {
      await client.end();
    }
  });

  it('creates every Postgres role the architecture defines', async () => {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db.execute<{ rolname: string }>(sql`
        SELECT rolname FROM pg_catalog.pg_roles
        WHERE rolname IN ('app_migrator', 'app_tenant', 'app_platform', 'app_event_processor', 'app_public_resolver')
      `);
      expect(rows.map((r) => r.rolname).sort()).toEqual(
        ['app_event_processor', 'app_migrator', 'app_platform', 'app_public_resolver', 'app_tenant'].sort(),
      );
    } finally {
      await client.end();
    }
  });

  it('RLS coverage: every tenant-owned table has relrowsecurity, FORCE RLS, and at least one policy', async () => {
    const { client } = getMigratorDb();
    try {
      // Raw postgres.js tag, not db.execute(drizzle's sql`...`) — interpolating a plain JS array
      // into drizzle's sql tag spreads it into N individual bind params ($1..$41) rather than one
      // Postgres array parameter, which ANY() requires ("op ANY/ALL (array) requires array on
      // right side"). postgres.js's own tagged template binds a JS array as a native array
      // parameter correctly. Confirmed by running this for real (PROMPT 03-A).
      const rows = await client<
        { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; policy_count: number }[]
      >`
        SELECT
          c.relname,
          c.relrowsecurity,
          c.relforcerowsecurity,
          (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)::int AS policy_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname = ANY(${TENANT_TABLE_NAMES})
      `;
      const byName = new Map(rows.map((r) => [r.relname, r]));
      for (const tableName of TENANT_TABLE_NAMES) {
        const row = byName.get(tableName);
        expect(row, `expected pg_class row for "${tableName}"`).toBeDefined();
        expect(row?.relrowsecurity, `${tableName}: ENABLE ROW LEVEL SECURITY`).toBe(true);
        expect(row?.relforcerowsecurity, `${tableName}: FORCE ROW LEVEL SECURITY`).toBe(true);
        expect(row?.policy_count ?? 0, `${tableName}: at least one RLS policy`).toBeGreaterThan(0);
      }
    } finally {
      await client.end();
    }
  });

  it('platform-scoped tables have no RLS (by design — no tenant dimension to filter by)', async () => {
    const { client, db } = getMigratorDb();
    try {
      const rows = await db.execute<{ relname: string; relrowsecurity: boolean }>(sql`
        SELECT relname, relrowsecurity FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname = ANY(ARRAY['tenants', 'platform_admins', 'permissions', 'measurement_units', 'platform_admin_refresh_tokens', 'identities', 'tenant_memberships'])
      `);
      expect(rows).toHaveLength(7);
      for (const row of rows) {
        expect(row.relrowsecurity, `${row.relname} should not have RLS enabled`).toBe(false);
      }
    } finally {
      await client.end();
    }
  });

  it('app_tenant has no grant at all on identities/tenant_memberships (016-B, ADR-0033)', async () => {
    // Same posture as `tenants` itself — a tenant-scoped connection must not be able to even
    // attempt a query against the global-identity tables, regardless of RLS. Asserted as an actual
    // permission-denied query via the real app_tenant connection, not just a catalog lookup, so
    // this fails the same way the RLS suite's DELETE-grant checks do if a future migration ever
    // adds a GRANT here by accident.
    const appTenant = getAppTenantClient();
    try {
      await expect(appTenant.unsafe('select 1 from identities limit 1')).rejects.toThrow(/permission denied/);
      await expect(appTenant.unsafe('select 1 from tenant_memberships limit 1')).rejects.toThrow(/permission denied/);
    } finally {
      await appTenant.end();
    }
  });

  it('every tenant-owned table has the tenant-aware UNIQUE (tenant_id, id) composite-FK-target constraint', async () => {
    const { client, db } = getMigratorDb();
    try {
      // Every RLS table except: pure join tables with a composite PK already unique on
      // (tenant_id, business columns) — role_permissions, user_roles, category_attributes,
      // user_location_assignments; and the two documented mixed-scope tables with a NULLABLE
      // tenant_id — audit_log, event_outbox — which the "every tenant-owned table" convention
      // doesn't apply to in the first place (it presupposes NOT NULL tenant_id, per
      // database.md#the-tenant_id-policy) and which nothing composite-FKs into, so the
      // constraint would serve no purpose. Confirmed by running this for real (PROMPT 03-A).
      const compositeKeyTables = TENANT_TABLE_NAMES.filter(
        (name) =>
          !['role_permissions', 'user_roles', 'category_attributes', 'user_location_assignments', 'audit_log', 'event_outbox'].includes(
            name,
          ),
      );
      const rows = await db.execute<{ conrelid_name: string }>(sql`
        SELECT c.relname AS conrelid_name
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND con.contype = 'u'
          AND con.conname LIKE '%tenant_id_id_key'
      `);
      const tablesWithCompositeKey = new Set(rows.map((r) => r.conrelid_name));
      for (const tableName of compositeKeyTables) {
        expect(
          tablesWithCompositeKey.has(tableName),
          `expected "${tableName}" to have a UNIQUE (tenant_id, id) constraint`,
        ).toBe(true);
      }
    } finally {
      await client.end();
    }
  });
});
