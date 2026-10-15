import { generateId } from '@saas-inventory/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/database/schema';
import { getMigratorDb, integrationTestsEnabled } from './helpers';

/**
 * Structural integrity — Prompt 03 §18.A: primary keys, foreign keys, unique constraints, check
 * constraints, delete behavior, timestamps. Runs as app_migrator (table owner, bypasses RLS) so
 * these tests isolate integrity/constraint behavior from RLS — RLS itself is covered separately
 * in multi-tenancy-rls.integration.test.ts. Skipped when TEST_*_DATABASE_URL are unset.
 *
 * The database is reset/migrated once for the whole suite in global-setup.ts, not per file — see
 * that file for why per-file reset was a real race, not just wasteful.
 */
describe.skipIf(!integrationTestsEnabled)('integrity', () => {
  let tenantId: string;

  beforeAll(async () => {
    const { client, db } = getMigratorDb();
    try {
      tenantId = generateId();
      await db.insert(schema.tenants).values({ id: tenantId, name: 'Integrity Test Co', slug: 'integrity-test-co' });
    } finally {
      await client.end();
    }
  }, 60_000);

  it('rejects a duplicate primary key', async () => {
    const { client, db } = getMigratorDb();
    try {
      const id = generateId();
      await db.insert(schema.warehouses).values({ id, tenantId, name: 'W1', code: 'W1' });
      await expect(
        db.insert(schema.warehouses).values({ id, tenantId, name: 'W1 dup', code: 'W1DUP' }),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('rejects a foreign key referencing a non-existent parent', async () => {
    const { client, db } = getMigratorDb();
    try {
      await expect(
        db.insert(schema.warehouses).values({ id: generateId(), tenantId: generateId(), name: 'Orphan', code: 'ORPH' }),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('tenant-aware referential integrity: a composite FK rejects a parent belonging to a different tenant (ADR-0018)', async () => {
    const { client, db } = getMigratorDb();
    try {
      const otherTenantId = generateId();
      await db.insert(schema.tenants).values({ id: otherTenantId, name: 'Other Co', slug: 'other-co-fk-test' });

      const categoryId = generateId();
      await db.insert(schema.categories).values({ id: categoryId, tenantId, name: 'Cat A', code: 'cat-a-fk-test' });

      // A product for tenant B that tries to reference tenant A's category — must fail: there is
      // no row in categories with (tenant_id, id) = (otherTenantId, categoryId), because that
      // category's real tenant_id is `tenantId`, not `otherTenantId`.
      await expect(
        db.insert(schema.products).values({
          id: generateId(),
          tenantId: otherTenantId,
          categoryId,
          name: 'Cross-tenant product',
        }),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('rejects a duplicate value in a tenant-scoped unique constraint', async () => {
    const { client, db } = getMigratorDb();
    try {
      await db.insert(schema.brands).values({ id: generateId(), tenantId, name: 'Acme' });
      await expect(db.insert(schema.brands).values({ id: generateId(), tenantId, name: 'Acme' })).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('allows the same unique value across two different tenants (uniqueness is tenant-scoped, not global)', async () => {
    const { client, db } = getMigratorDb();
    try {
      const otherTenantId = generateId();
      await db.insert(schema.tenants).values({ id: otherTenantId, name: 'Other Co 2', slug: 'other-co-2-unique-test' });
      await db.insert(schema.brands).values({ id: generateId(), tenantId, name: 'SharedName' });
      await expect(
        db.insert(schema.brands).values({ id: generateId(), tenantId: otherTenantId, name: 'SharedName' }),
      ).resolves.not.toThrow();
    } finally {
      await client.end();
    }
  });

  it('rejects a check-constraint violation (negative price)', async () => {
    const { client, db } = getMigratorDb();
    try {
      const productId = generateId();
      await db.insert(schema.products).values({ id: productId, tenantId, name: 'Bad Price Product' });
      await expect(
        db.insert(schema.productVariants).values({
          id: generateId(),
          tenantId,
          productId,
          sku: 'NEG-PRICE',
          maxPrice: '-1',
          basePrice: '-1',
          minPrice: '-1',
        }),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('rejects a status value outside the CHECK-constrained set', async () => {
    const { client, db } = getMigratorDb();
    try {
      await expect(
        db.insert(schema.categories).values({
          id: generateId(),
          tenantId,
          name: 'Bad Status',
          code: 'bad-status-check-test',
          status: 'not_a_real_status',
        }),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('rejects the price-tier ordering check (min <= base <= max)', async () => {
    const { client, db } = getMigratorDb();
    try {
      const productId = generateId();
      await db.insert(schema.products).values({ id: productId, tenantId, name: 'Bad Tier Product' });
      await expect(
        db.insert(schema.productVariants).values({
          id: generateId(),
          tenantId,
          productId,
          sku: 'BAD-TIER',
          maxPrice: '10',
          basePrice: '50', // base > max — invalid
          minPrice: '5',
        }),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('ON DELETE RESTRICT: a referenced row cannot be hard-deleted', async () => {
    const { client, db } = getMigratorDb();
    try {
      const warehouseId = generateId();
      await db.insert(schema.warehouses).values({ id: warehouseId, tenantId, name: 'Restrict WH', code: 'RESTRICT-WH' });
      await db.insert(schema.locations).values({
        id: generateId(),
        tenantId,
        warehouseId,
        name: 'Loc',
        code: 'RESTRICT-LOC',
      });
      await expect(db.delete(schema.warehouses).where(eq(schema.warehouses.id, warehouseId))).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  it('the prevent_tenant_id_change trigger rejects an UPDATE that changes tenant_id', async () => {
    const { client, db } = getMigratorDb();
    try {
      const otherTenantId = generateId();
      await db.insert(schema.tenants).values({ id: otherTenantId, name: 'Other Co 3', slug: 'other-co-3-trigger-test' });
      const warehouseId = generateId();
      await db.insert(schema.warehouses).values({ id: warehouseId, tenantId, name: 'Trigger WH', code: 'TRIGGER-WH' });

      // drizzle-orm wraps the real PostgreSQL error in a generic DrizzleQueryError whose own
      // .message is just "Failed query: ..." — the actual trigger-raised message this test cares
      // about lives on `.cause.message`. Confirmed by running this for real (PROMPT 03-A); a bare
      // `.rejects.toThrow(/pattern/)` checks the wrapper's message and never matches.
      let caughtError: unknown;
      try {
        await db.update(schema.warehouses).set({ tenantId: otherTenantId }).where(eq(schema.warehouses.id, warehouseId));
      } catch (error) {
        caughtError = error;
      }
      expect(caughtError, 'expected the UPDATE to throw').toBeInstanceOf(Error);
      const cause = (caughtError as { cause?: unknown }).cause;
      expect(String(cause instanceof Error ? cause.message : cause)).toMatch(/tenant_id cannot be changed/);

      // Stronger than matching an error message alone: confirm the row's tenant_id genuinely
      // never changed, independent of exactly how the rejection was reported.
      const [row] = await db.select({ tenantId: schema.warehouses.tenantId }).from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId));
      expect(row?.tenantId).toBe(tenantId);
    } finally {
      await client.end();
    }
  });

  it('the set_updated_at trigger keeps updated_at current without application code setting it', async () => {
    const { client, db } = getMigratorDb();
    try {
      const warehouseId = generateId();
      const [inserted] = await db
        .insert(schema.warehouses)
        .values({ id: warehouseId, tenantId, name: 'Timestamp WH', code: 'TS-WH' })
        .returning({ updatedAt: schema.warehouses.updatedAt });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const [updated] = await db
        .update(schema.warehouses)
        .set({ name: 'Timestamp WH Renamed' })
        .where(eq(schema.warehouses.id, warehouseId))
        .returning({ updatedAt: schema.warehouses.updatedAt });
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(inserted?.updatedAt.getTime() ?? 0);
    } finally {
      await client.end();
    }
  });

  it('inventory_movements is append-only: quantity=0 is rejected and idempotency_key is unique per tenant', async () => {
    const { client, db } = getMigratorDb();
    try {
      const productId = generateId();
      await db.insert(schema.products).values({ id: productId, tenantId, name: 'Ledger Product' });
      const variantId = generateId();
      await db.insert(schema.productVariants).values({
        id: variantId,
        tenantId,
        productId,
        sku: 'LEDGER-SKU',
        maxPrice: '10',
        basePrice: '10',
        minPrice: '10',
      });
      const warehouseId = generateId();
      await db.insert(schema.warehouses).values({ id: warehouseId, tenantId, name: 'Ledger WH', code: 'LEDGER-WH' });
      const locationId = generateId();
      await db.insert(schema.locations).values({ id: locationId, tenantId, warehouseId, name: 'Loc', code: 'LEDGER-LOC' });

      await expect(
        db.insert(schema.inventoryMovements).values({
          id: generateId(),
          tenantId,
          productVariantId: variantId,
          locationId,
          movementType: 'INITIAL_STOCK',
          quantity: '0',
          balanceAfter: '0',
          actorType: 'system',
        }),
      ).rejects.toThrow();

      const key = 'dup-key-test';
      await db.insert(schema.inventoryMovements).values({
        id: generateId(),
        tenantId,
        productVariantId: variantId,
        locationId,
        movementType: 'INITIAL_STOCK',
        quantity: '5',
        balanceAfter: '5',
        actorType: 'system',
        idempotencyKey: key,
      });
      await expect(
        db.insert(schema.inventoryMovements).values({
          id: generateId(),
          tenantId,
          productVariantId: variantId,
          locationId,
          movementType: 'ADJUSTMENT_IN',
          quantity: '1',
          balanceAfter: '6',
          actorType: 'system',
          idempotencyKey: key,
        }),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
  });

  describe('global identity + tenant memberships (016-B, ADR-0033)', () => {
    it('identities.email is unique case-insensitively', async () => {
      const { client, db } = getMigratorDb();
      try {
        await db.insert(schema.identities).values({
          id: generateId(),
          email: 'case.test@example.com',
          passwordHash: 'hash-a',
          fullName: 'Case Test',
        });
        await expect(
          db.insert(schema.identities).values({
            id: generateId(),
            // Different case, same normalized address — must collide on the lower(email) index.
            email: 'Case.Test@Example.com',
            passwordHash: 'hash-b',
            fullName: 'Case Test Duplicate',
          }),
        ).rejects.toThrow();
      } finally {
        await client.end();
      }
    });

    it('identities_credential_check rejects an active identity with no password_hash', async () => {
      const { client, db } = getMigratorDb();
      try {
        await expect(
          db.insert(schema.identities).values({
            id: generateId(),
            email: `no-credential-${generateId()}@example.com`,
            passwordHash: null,
            status: 'active',
            fullName: 'No Credential',
          }),
        ).rejects.toThrow();
      } finally {
        await client.end();
      }
    });

    it('identities_credential_check allows pending_credential with a NULL password_hash', async () => {
      const { client, db } = getMigratorDb();
      try {
        await expect(
          db.insert(schema.identities).values({
            id: generateId(),
            email: `pending-${generateId()}@example.com`,
            passwordHash: null,
            status: 'pending_credential',
            fullName: 'Pending Credential',
          }),
        ).resolves.not.toThrow();
      } finally {
        await client.end();
      }
    });

    it('rejects a second membership for the same (identity, tenant) pair', async () => {
      const { client, db } = getMigratorDb();
      try {
        const identityId = generateId();
        await db.insert(schema.identities).values({
          id: identityId,
          email: `dup-membership-${generateId()}@example.com`,
          passwordHash: 'hash',
          fullName: 'Dup Membership',
        });
        const userId = generateId();
        await db.insert(schema.users).values({
          id: userId,
          tenantId,
          email: `dup-membership-${generateId()}@example.com`,
          passwordHash: 'hash',
          fullName: 'Dup Membership User',
        });
        await db.insert(schema.tenantMemberships).values({ id: generateId(), identityId, tenantId, userId });

        const secondUserId = generateId();
        await db.insert(schema.users).values({
          id: secondUserId,
          tenantId,
          email: `dup-membership-2-${generateId()}@example.com`,
          passwordHash: 'hash',
          fullName: 'Dup Membership User 2',
        });
        await expect(
          db.insert(schema.tenantMemberships).values({ id: generateId(), identityId, tenantId, userId: secondUserId }),
        ).rejects.toThrow();
      } finally {
        await client.end();
      }
    });

    it('rejects a second membership for the same user (UNIQUE(user_id))', async () => {
      const { client, db } = getMigratorDb();
      try {
        const identityId = generateId();
        await db.insert(schema.identities).values({
          id: identityId,
          email: `dup-user-${generateId()}@example.com`,
          passwordHash: 'hash',
          fullName: 'Dup User',
        });
        const otherIdentityId = generateId();
        await db.insert(schema.identities).values({
          id: otherIdentityId,
          email: `dup-user-2-${generateId()}@example.com`,
          passwordHash: 'hash',
          fullName: 'Dup User 2',
        });
        const userId = generateId();
        await db.insert(schema.users).values({
          id: userId,
          tenantId,
          email: `dup-user-3-${generateId()}@example.com`,
          passwordHash: 'hash',
          fullName: 'Dup User Profile',
        });
        await db.insert(schema.tenantMemberships).values({ id: generateId(), identityId, tenantId, userId });

        await expect(
          db.insert(schema.tenantMemberships).values({ id: generateId(), identityId: otherIdentityId, tenantId, userId }),
        ).rejects.toThrow();
      } finally {
        await client.end();
      }
    });

    it('the composite user FK rejects a membership pointing at a user from a different tenant', async () => {
      const { client, db } = getMigratorDb();
      try {
        const otherTenantId = generateId();
        await db.insert(schema.tenants).values({ id: otherTenantId, name: 'Other Co (identity FK test)', slug: `other-co-identity-fk-${generateId()}` });
        const identityId = generateId();
        await db.insert(schema.identities).values({
          id: identityId,
          email: `cross-tenant-fk-${generateId()}@example.com`,
          passwordHash: 'hash',
          fullName: 'Cross Tenant FK',
        });
        const userId = generateId();
        await db.insert(schema.users).values({
          id: userId,
          tenantId: otherTenantId,
          email: `cross-tenant-fk-2-${generateId()}@example.com`,
          passwordHash: 'hash',
          fullName: 'Cross Tenant FK User',
        });
        // userId genuinely belongs to otherTenantId — claiming tenantId (the outer suite's tenant)
        // here must violate the composite (tenant_id, user_id) -> users(tenant_id, id) FK.
        await expect(
          db.insert(schema.tenantMemberships).values({ id: generateId(), identityId, tenantId, userId }),
        ).rejects.toThrow();
      } finally {
        await client.end();
      }
    });

    it('ON DELETE RESTRICT: an identity referenced by a membership cannot be hard-deleted', async () => {
      const { client, db } = getMigratorDb();
      try {
        const identityId = generateId();
        await db.insert(schema.identities).values({
          id: identityId,
          email: `restrict-${generateId()}@example.com`,
          passwordHash: 'hash',
          fullName: 'Restrict Identity',
        });
        const userId = generateId();
        await db.insert(schema.users).values({
          id: userId,
          tenantId,
          email: `restrict-2-${generateId()}@example.com`,
          passwordHash: 'hash',
          fullName: 'Restrict Identity User',
        });
        await db.insert(schema.tenantMemberships).values({ id: generateId(), identityId, tenantId, userId });
        await expect(db.delete(schema.identities).where(eq(schema.identities.id, identityId))).rejects.toThrow();
      } finally {
        await client.end();
      }
    });
  });
});
