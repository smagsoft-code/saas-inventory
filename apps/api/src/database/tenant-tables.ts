import { getTableName } from 'drizzle-orm';
import * as schema from './schema';

/**
 * Every RLS-enabled, tenant-owned table, in children-first FK-dependency order — the single
 * source of truth reused by database/scripts/reset-demo-tenant.ts (ordered DELETE) and the RLS
 * integration test suite (per-table isolation/coverage checks, database.md#testing-rls).
 *
 * Deliberately excludes the platform-scoped tables with no RLS (tenants, platform_admins,
 * permissions, measurement_units) — see database.md#data-classification-platform-scoped-vs-tenant-scoped.
 *
 * Any migration that adds a new tenant-owned table must add it here too — the RLS coverage test
 * (database.md#testing-rls, point 3) fails CI if a table has `RLS: yes` in the architecture but
 * is missing from this list or from Postgres's own `pg_policies`.
 */
export const TENANT_TABLES_CHILDREN_FIRST = [
  schema.authRefreshTokens,
  schema.importJobRows,
  schema.importJobs,
  schema.importMappingTemplates,
  schema.salesReturnItems,
  schema.salesReturns,
  schema.priceApprovals,
  schema.orderItems,
  schema.orders,
  schema.cartItems,
  schema.carts,
  schema.inventoryTransferReceiptItems,
  schema.inventoryTransferReceipts,
  schema.inventoryTransferItems,
  schema.inventoryTransfers,
  schema.inventoryMovements,
  schema.inventoryBalances,
  schema.productPriceHistory,
  schema.productImages,
  schema.productSerials,
  schema.productLots,
  schema.productVariants,
  schema.products,
  schema.categoryAttributes,
  schema.attributeOptions,
  schema.attributeDefinitions,
  schema.categories,
  schema.brands,
  schema.suppliers,
  schema.tenantPricePolicies,
  schema.userLocationAssignments,
  schema.locations,
  schema.warehouses,
  schema.customers,
  schema.qrCodes,
  schema.userRoles,
  schema.rolePermissions,
  schema.roles,
  schema.users,
  schema.idempotencyKeys,
  schema.eventOutbox,
  schema.auditLog,
] as const;

/** The bare table names, in the same order — convenient for SQL that needs a string list rather
 * than the Drizzle table objects (e.g. the pg_class/pg_policies coverage query). */
export const TENANT_TABLE_NAMES = TENANT_TABLES_CHILDREN_FIRST.map((table) => getTableName(table));
