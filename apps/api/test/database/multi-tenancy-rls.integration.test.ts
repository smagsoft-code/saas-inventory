import { generateId } from '@saas-inventory/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { TENANT_TABLE_NAMES } from '../../src/database/tenant-tables';
import { getAppTenantClient, getMigratorDb, integrationTestsEnabled, withTenantSql } from './helpers';

/**
 * Multi-tenancy + RLS — Prompt 03 §18.B/C. This is the core requirement: isolation must be
 * enforced by PostgreSQL itself (the app_tenant role + RLS policies), not by an application-level
 * `WHERE tenant_id = ...` the service layer happens to remember to add. Every test in this file
 * therefore issues raw SQL through the app_tenant Postgres role — never through app_migrator
 * (table owner, RLS-exempt) — for the assertions that matter.
 *
 * Skipped (not failed) when TEST_MIGRATOR_DATABASE_URL / TEST_APP_TENANT_DATABASE_URL are unset
 * — see test/database/helpers.ts. The database is reset/migrated once for the whole suite in
 * global-setup.ts, not per file — see that file for why per-file reset was a real race, not just
 * wasteful (this file's app_tenant connection was the one that hit it).
 */
describe.skipIf(!integrationTestsEnabled)('multi-tenancy and RLS', () => {
  let tenantAId: string;
  let tenantBId: string;
  const appTenant = getAppTenantClient();

  beforeAll(async () => {
    const { client, db } = getMigratorDb();
    try {
      tenantAId = generateId();
      tenantBId = generateId();
      await db.insert(schema.tenants).values([
        { id: tenantAId, name: 'Tenant A', slug: 'tenant-a-rls-test' },
        { id: tenantBId, name: 'Tenant B', slug: 'tenant-b-rls-test' },
      ]);
    } finally {
      await client.end();
    }
  }, 60_000);

  afterAll(async () => {
    await appTenant.end();
  });

  describe('fail-closed: no tenant context set at all', () => {
    it('a session with app.tenant_id never set sees zero rows on a tenant-owned table', async () => {
      const { client, db } = getMigratorDb();
      try {
        await db.insert(schema.warehouses).values({ id: generateId(), tenantId: tenantAId, name: 'W', code: 'FAILCLOSED-WH' });
      } finally {
        await client.end();
      }

      const rows = await withTenantSql(appTenant, undefined, async (tx) => {
        return tx`select * from warehouses`;
      });
      expect(rows).toHaveLength(0);
    });

    it('an INSERT with no tenant context set is rejected (WITH CHECK has nothing to satisfy)', async () => {
      await expect(
        withTenantSql(appTenant, undefined, async (tx) => {
          return tx`insert into warehouses (id, tenant_id, name, code) values (gen_random_uuid(), ${tenantAId}, 'X', 'FAILCLOSED-INSERT-WH')`;
        }),
      ).rejects.toThrow();
    });
  });

  describe('cross-tenant isolation, per representative table', () => {
    type IsolationCase = {
      table: string;
      insertColumns: string[];
      insertValuesFor: (tenantId: string, rowId: string) => unknown[];
    };

    const cases: IsolationCase[] = [
      {
        table: 'warehouses',
        insertColumns: ['id', 'tenant_id', 'name', 'code'],
        insertValuesFor: (tenantId, rowId) => [rowId, tenantId, 'Isolation WH', `ISO-WH-${rowId.slice(0, 8)}`],
      },
      {
        table: 'categories',
        insertColumns: ['id', 'tenant_id', 'name', 'slug'],
        insertValuesFor: (tenantId, rowId) => [rowId, tenantId, 'Isolation Cat', `iso-cat-${rowId.slice(0, 8)}`],
      },
      {
        table: 'brands',
        insertColumns: ['id', 'tenant_id', 'name'],
        insertValuesFor: (tenantId, rowId) => [rowId, tenantId, `Isolation Brand ${rowId.slice(0, 8)}`],
      },
      {
        table: 'customers',
        insertColumns: ['id', 'tenant_id', 'type', 'display_name'],
        insertValuesFor: (tenantId, rowId) => [rowId, tenantId, 'individual', 'Isolation Customer'],
      },
      {
        table: 'users',
        insertColumns: ['id', 'tenant_id', 'email', 'password_hash', 'full_name'],
        insertValuesFor: (tenantId, rowId) => [rowId, tenantId, `iso-${rowId.slice(0, 8)}@example.com`, 'x', 'Isolation User'],
      },
      {
        // FASE 11 — tenant_settings (migration 0022). Singleton per tenant (unique(tenant_id)), so
        // tenantA's and tenantB's rows here are naturally distinct rows, not a re-used id — no
        // special-casing needed versus the other representative tables. timezone/business_hours
        // are left at their column defaults ('UTC' / '[]'::jsonb).
        table: 'tenant_settings',
        insertColumns: ['id', 'tenant_id'],
        insertValuesFor: (tenantId, rowId) => [rowId, tenantId],
      },
      {
        // Company logo (migration 0048) — one row per tenant (unique(tenant_id)), like tenant_settings.
        table: 'tenant_logos',
        insertColumns: ['id', 'tenant_id', 'storage_key', 'mime_type'],
        insertValuesFor: (tenantId, rowId) => [rowId, tenantId, `tenant-logos/${tenantId}/${rowId}.png`, 'image/png'],
      },
    ];

    describe('auth_refresh_tokens (Prompt 04)', () => {
      // Separate from `cases` above (not a simple insert-two-rows-and-compare shape) because the
      // table has a composite FK to users(tenant_id, id) — each tenant needs its own user row to
      // reference first.
      let userAId: string;
      let userBId: string;
      let tokenAId: string;
      let tokenBId: string;

      beforeAll(async () => {
        userAId = generateId();
        userBId = generateId();
        tokenAId = generateId();
        tokenBId = generateId();
        const { client } = getMigratorDb();
        try {
          await client`
            insert into users (id, tenant_id, email, password_hash, full_name)
            values (${userAId}, ${tenantAId}, 'auth-iso-a@example.com', 'x', 'Auth Isolation User A'),
                   (${userBId}, ${tenantBId}, 'auth-iso-b@example.com', 'x', 'Auth Isolation User B')
          `;
          await client`
            insert into auth_refresh_tokens (id, tenant_id, user_id, token_hash, expires_at)
            values (${tokenAId}, ${tenantAId}, ${userAId}, 'hash-a', now() + interval '30 days'),
                   (${tokenBId}, ${tenantBId}, ${userBId}, 'hash-b', now() + interval '30 days')
          `;
        } finally {
          await client.end();
        }
      });

      it('Tenant A sees only its own refresh token on a plain SELECT', async () => {
        const rows = await withTenantSql(appTenant, tenantAId, async (tx) => {
          return tx<{ id: string }[]>`select id from auth_refresh_tokens`;
        });
        const ids = rows.map((r) => r.id);
        expect(ids).toContain(tokenAId);
        expect(ids).not.toContain(tokenBId);
      });

      it("Tenant A cannot SELECT Tenant B's refresh token by primary key", async () => {
        const rows = await withTenantSql(appTenant, tenantAId, async (tx) => {
          return tx`select id from auth_refresh_tokens where id = ${tokenBId}`;
        });
        expect(rows).toHaveLength(0);
      });

      it("Tenant A cannot revoke (UPDATE) Tenant B's refresh token", async () => {
        const result = await withTenantSql(appTenant, tenantAId, async (tx) => {
          return tx`update auth_refresh_tokens set revoked_at = now() where id = ${tokenBId}`;
        });
        expect(result.count).toBe(0);
      });

      it('a session with no tenant context set sees zero refresh tokens', async () => {
        const rows = await withTenantSql(appTenant, undefined, async (tx) => {
          return tx`select id from auth_refresh_tokens`;
        });
        expect(rows).toHaveLength(0);
      });
    });

    for (const testCase of cases) {
      describe(testCase.table, () => {
        let rowAId: string;
        let rowBId: string;

        beforeAll(async () => {
          rowAId = generateId();
          rowBId = generateId();
          const columnList = testCase.insertColumns.join(', ');
          const placeholdersFor = (n: number) =>
            Array.from({ length: n }, (_, i) => `$${i + 1}`).join(', ');

          const { client } = getMigratorDb();
          try {
            await client.unsafe(
              `insert into ${testCase.table} (${columnList}) values (${placeholdersFor(testCase.insertColumns.length)})`,
              testCase.insertValuesFor(tenantAId, rowAId) as never[],
            );
            await client.unsafe(
              `insert into ${testCase.table} (${columnList}) values (${placeholdersFor(testCase.insertColumns.length)})`,
              testCase.insertValuesFor(tenantBId, rowBId) as never[],
            );
          } finally {
            await client.end();
          }
        });

        it('Tenant A sees only its own row on a plain SELECT', async () => {
          const rows = await withTenantSql(appTenant, tenantAId, async (tx) => {
            return tx.unsafe<{ id: string }[]>(`select id from ${testCase.table}`);
          });
          const ids = rows.map((r) => r.id);
          expect(ids).toContain(rowAId);
          expect(ids).not.toContain(rowBId);
        });

        it("Tenant A cannot SELECT Tenant B's row by primary key", async () => {
          const rows = await withTenantSql(appTenant, tenantAId, async (tx) => {
            return tx.unsafe(`select id from ${testCase.table} where id = $1`, [rowBId]);
          });
          expect(rows).toHaveLength(0);
        });

        it("Tenant A cannot UPDATE Tenant B's row (0 rows affected)", async () => {
          const result = await withTenantSql(appTenant, tenantAId, async (tx) => {
            return tx.unsafe(`update ${testCase.table} set id = id where id = $1`, [rowBId]);
          });
          expect(result.count).toBe(0);
        });

        it("Tenant A cannot DELETE Tenant B's row", async () => {
          // Two DIFFERENT, both-valid ways the database can make this "impossible", depending on
          // the table's soft-delete-policy category (database.md#soft-delete-policy): a
          // hard-deletable table (e.g. cart_items) rejects it via RLS — 0 rows affected, no
          // error. A soft-delete table (all 5 representative tables here: warehouses, categories,
          // brands, customers, users) has no DELETE grant for app_tenant AT ALL — an even
          // stronger guarantee, surfaced as "permission denied" rather than a 0-row result.
          // Confirmed by running this for real (PROMPT 03-A) — the original assertion only
          // accepted the RLS outcome and failed on these tables' GRANT-level rejection, which is
          // not a weaker guarantee, just a different one.
          let permissionDenied = false;
          let rowsAffected: number | undefined;
          try {
            const result = await withTenantSql(appTenant, tenantAId, async (tx) => {
              return tx.unsafe(`delete from ${testCase.table} where id = $1`, [rowBId]);
            });
            rowsAffected = result.count;
          } catch (error) {
            permissionDenied = /permission denied/.test((error as Error).message);
            if (!permissionDenied) throw error;
          }
          expect(permissionDenied || rowsAffected === 0, `expected 0 rows affected or a permission-denied rejection`).toBe(true);

          // Prove the row is genuinely still there — not actually deleted — by reading it back
          // as its own tenant.
          const stillThere = await withTenantSql(appTenant, tenantBId, async (tx) => {
            return tx.unsafe(`select id from ${testCase.table} where id = $1`, [rowBId]);
          });
          expect(stillThere).toHaveLength(1);
        });
      });
    }
  });

  describe('INSERT cannot introduce a tenant_id belonging to another tenant', () => {
    it("a session scoped to Tenant A is rejected when it tries to INSERT a row with Tenant B's tenant_id", async () => {
      await expect(
        withTenantSql(appTenant, tenantAId, async (tx) => {
          return tx`insert into warehouses (id, tenant_id, name, code)
                     values (gen_random_uuid(), ${tenantBId}, 'Smuggled', 'SMUGGLED-WH')`;
        }),
      ).rejects.toThrow();
    });
  });

  describe('RLS coverage (CI gate) — every tenant-owned table actually has RLS + at least one policy', () => {
    it('matches the exact query from database.md#testing-rls', async () => {
      const { client } = getMigratorDb();
      try {
        // Raw postgres.js tag, not db.execute(drizzle's sql`...`) — see the identical fix/comment
        // in migrations.integration.test.ts for why (ANY() needs one array param, not N spread
        // params). Confirmed by running this for real (PROMPT 03-A).
        const rows = await client<{ relname: string }[]>`
          SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
            AND c.relname = ANY(${TENANT_TABLE_NAMES})
        `;
        expect(rows, `tables missing RLS: ${rows.map((r) => r.relname).join(', ')}`).toHaveLength(0);
      } finally {
        await client.end();
      }
    });
  });
});
