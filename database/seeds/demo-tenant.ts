/**
 * Demo tenant seed — database.md#seed-and-demo-tenant, ADR-0014. Idempotent (upserts, keyed by
 * the well-known `tenants.slug = 'demo'`, never a hardcoded UUID). Deterministic: no random
 * business data, only a random per-environment password for the demo login (never a real
 * credential — CLAUDE.md §7.4).
 *
 * The demo tenant is seeded through the exact same paths a real tenant's data would go through:
 * the platform-scoped `tenants` row is written via the app_migrator connection (the only role
 * that can touch that table besides app_platform, which this script does not need); every
 * tenant-scoped row after that goes through withTenantTransaction() — the same app_tenant + SET
 * LOCAL app.tenant_id mechanism the running API uses — so RLS is a live guarantee for seed data
 * too, not a bypassed special case (ADR-0014: "no isolation bypass, no shared-with-real-data
 * shortcut").
 *
 * No inventory_balances row is ever inserted directly — every starting quantity is written as an
 * INITIAL_STOCK inventory_movements row first, exactly like a real Excel import
 * (database.md#excel-import-pipeline's "no bypass" rule, restated for seed data in
 * database.md#seed-and-demo-tenant).
 */
import { randomBytes } from 'node:crypto';
import { getBootstrapDatabaseUrl } from '@saas-inventory/config';
import { generateId } from '@saas-inventory/shared';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { withTenantTransaction } from '../../apps/api/src/database/tenant-context';
// Imported from each numbered schema file directly, NOT the barrel (schema/index.ts) — the
// barrel's `export * from './0X-...'` chain compiles to a dynamic re-export pattern that
// cjs-module-lexer (Node's static CJS→ESM named-export detector) cannot see through. apps/api is
// a CommonJS package while this one is ESM ("type": "module"), so an `import * as schema from
// '.../schema'` across that boundary silently resolves every named export to `undefined` at
// runtime (TypeScript has no way to catch this — it only manifests when actually run). Every
// numbered file's own `export const x = ...` declarations are static and lexer-friendly, so
// importing directly from them works correctly. Discovered by running the seed script for real
// against a live PostgreSQL instance (PROMPT 03-A) — `pnpm typecheck`/`pnpm lint` cannot catch a
// cross-module-system runtime-only failure like this.
import { tenants } from '../../apps/api/src/database/schema/01-platform';
import { rolePermissions, roles, userRoles, users } from '../../apps/api/src/database/schema/02-core';
import {
  attributeDefinitions,
  brands,
  categories,
  categoryAttributes,
  productPriceHistory,
  productVariants,
  products,
  suppliers,
  tenantPricePolicies,
} from '../../apps/api/src/database/schema/03-catalog';
import {
  inventoryBalances,
  inventoryMovements,
  locations,
  warehouses,
} from '../../apps/api/src/database/schema/05-inventory';
import { customers } from '../../apps/api/src/database/schema/09-sales';
import { DEFAULT_ROLE_TEMPLATES } from './default-role-templates';

const schema = {
  tenants,
  users,
  roles,
  rolePermissions,
  userRoles,
  categories,
  attributeDefinitions,
  categoryAttributes,
  brands,
  suppliers,
  products,
  productVariants,
  productPriceHistory,
  tenantPricePolicies,
  warehouses,
  locations,
  inventoryBalances,
  inventoryMovements,
  customers,
};

const DEMO_TENANT_SLUG = 'demo';

async function upsertDemoTenant(): Promise<string> {
  const migratorClient = postgres(getBootstrapDatabaseUrl(), { max: 1 });
  try {
    const db = drizzle(migratorClient, { schema });
    const [existing] = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(sql`${schema.tenants.slug} = ${DEMO_TENANT_SLUG}`);
    if (existing) {
      return existing.id;
    }
    const tenantId = generateId();
    await db.insert(schema.tenants).values({
      id: tenantId,
      name: 'Tenant Demo',
      slug: DEMO_TENANT_SLUG,
      status: 'active',
      isDemo: true,
    });
    return tenantId;
  } finally {
    await migratorClient.end();
  }
}

/** Never a real credential — rotated per environment, per CLAUDE.md §7.4. Password hashing
 * itself belongs to FASE 4 (Authentication), out of this phase's scope — this is a structurally
 * valid, non-guessable placeholder so the NOT NULL column is satisfied without asserting a
 * hashing algorithm this phase hasn't decided. */
function generatePlaceholderPasswordHash(): string {
  return `unset:${randomBytes(32).toString('hex')}`;
}

async function seedTenantScopedData(tenantId: string): Promise<void> {
  await withTenantTransaction(tenantId, async (tx) => {
    // Idempotency guard for this whole block: re-running the seed against an already-seeded
    // demo tenant must be a safe no-op, not a unique-constraint error on the second run.
    const [alreadySeeded] = await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`${schema.users.tenantId} = ${tenantId} AND ${schema.users.email} = 'demo@example.com'`);
    if (alreadySeeded) {
      console.log('Demo tenant already seeded — skipping.');
      return;
    }

    // --- CORE: a demo admin user + the default role templates ---
    const adminUserId = generateId();
    await tx.insert(schema.users).values({
      id: adminUserId,
      tenantId,
      email: 'demo@example.com',
      passwordHash: generatePlaceholderPasswordHash(),
      fullName: 'Demo Administrador',
      status: 'active',
    });

    const roleIdByName = new Map<string, string>();
    for (const [name, template] of Object.entries(DEFAULT_ROLE_TEMPLATES)) {
      const roleId = generateId();
      roleIdByName.set(name, roleId);
      await tx.insert(schema.roles).values({
        id: roleId,
        tenantId,
        name,
        description: template.description,
        isSystemDefault: true,
      });
      if (template.permissionCodes.length > 0) {
        await tx.insert(schema.rolePermissions).values(
          template.permissionCodes.map((permissionCode) => ({
            tenantId,
            roleId,
            permissionCode,
          })),
        );
      }
    }
    const adminRoleId = roleIdByName.get('Administrador');
    if (adminRoleId) {
      await tx.insert(schema.userRoles).values({ tenantId, userId: adminUserId, roleId: adminRoleId });
    }

    // --- CATALOG: one category with a dynamic attribute, one brand/supplier, two products ---
    const furnitureCategoryId = generateId();
    await tx.insert(schema.categories).values({
      id: furnitureCategoryId,
      tenantId,
      name: 'MUEBLES',
      code: 'CAT-001',
      status: 'active',
    });

    const materialAttributeId = generateId();
    await tx.insert(schema.attributeDefinitions).values({
      id: materialAttributeId,
      tenantId,
      code: 'material',
      name: 'Material',
      dataType: 'text',
      appliesTo: 'variant',
      isRequiredDefault: false,
    });
    await tx.insert(schema.categoryAttributes).values({
      tenantId,
      categoryId: furnitureCategoryId,
      attributeDefinitionId: materialAttributeId,
      isRequired: false,
    });

    const brandId = generateId();
    await tx.insert(schema.brands).values({ id: brandId, tenantId, name: 'Marca Demo', status: 'active' });

    const supplierId = generateId();
    await tx
      .insert(schema.suppliers)
      .values({ id: supplierId, tenantId, displayName: 'Proveedor Demo', status: 'active' });

    const productId = generateId();
    await tx.insert(schema.products).values({
      id: productId,
      tenantId,
      categoryId: furnitureCategoryId,
      brandId,
      supplierId,
      name: 'Silla de Comedor',
      status: 'active',
      attributes: {},
    });

    const variantId = generateId();
    const maxPrice = '89.99';
    const basePrice = '79.99';
    const minPrice = '65.00';
    await tx.insert(schema.productVariants).values({
      id: variantId,
      tenantId,
      productId,
      sku: 'DEMO-CHAIR-001',
      unit: 'unit',
      maxPrice,
      basePrice,
      minPrice,
      cost: '40.00',
      status: 'active',
      attributes: { material: 'madera' },
    });
    await tx.insert(schema.productPriceHistory).values({
      id: generateId(),
      tenantId,
      productVariantId: variantId,
      maxPrice,
      basePrice,
      minPrice,
      effectiveTo: null,
    });

    await tx.insert(schema.tenantPricePolicies).values({
      id: generateId(),
      tenantId,
      exceptionalDiscountRequiresApproval: true,
      maxDiscountBelowMinPercent: '20',
    });

    // --- INVENTORY: one warehouse, its default location, initial stock via the ledger ---
    const warehouseId = generateId();
    await tx.insert(schema.warehouses).values({
      id: warehouseId,
      tenantId,
      name: 'Bodega Principal',
      code: 'BP',
      status: 'active',
    });
    const locationId = generateId();
    await tx.insert(schema.locations).values({
      id: locationId,
      tenantId,
      warehouseId,
      name: 'General',
      code: 'GENERAL',
      isSellable: true,
      status: 'active',
    });

    const initialQuantity = '25';
    await tx.insert(schema.inventoryMovements).values({
      id: generateId(),
      tenantId,
      productVariantId: variantId,
      locationId,
      movementType: 'INITIAL_STOCK',
      quantity: initialQuantity,
      balanceAfter: initialQuantity,
      referenceType: 'demo_seed',
      actorType: 'system',
    });
    await tx.insert(schema.inventoryBalances).values({
      id: generateId(),
      tenantId,
      productVariantId: variantId,
      locationId,
      quantityPhysical: initialQuantity,
    });

    // --- SALES (schema only, per modules.md#sales — a reference row, no order flow) ---
    await tx.insert(schema.customers).values({
      id: generateId(),
      tenantId,
      type: 'cedula',
      firstName: 'Cliente',
      lastName: 'Demo',
      status: 'active',
    });
  });
}

export async function seedDemoTenant(): Promise<void> {
  const tenantId = await upsertDemoTenant();
  await seedTenantScopedData(tenantId);
  console.log(`Demo tenant ready (id: ${tenantId}).`);
}
