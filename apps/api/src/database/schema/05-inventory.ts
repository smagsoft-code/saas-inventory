import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, tenantId, updatedAt } from './_helpers';
import { tenantIsolationPolicy } from './_policies';
import { tenants } from './01-platform';
import { productVariants } from './03-catalog';

/**
 * INVENTORY — database.md#inventory-warehouses-locations-balance-ledger. Inventory is never a
 * `quantity` column on products: `inventory_balances` is a materialized read model,
 * `inventory_movements` is the append-only source of truth.
 */

export const warehouses = pgTable('warehouses', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  address: jsonb('address'),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  foreignKey({ name: 'warehouses_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  unique('warehouses_tenant_id_id_key').on(t.tenantId, t.id),
  unique('warehouses_tenant_id_code_key').on(t.tenantId, t.code),
  check('warehouses_status_check', sql`${t.status} IN ('active', 'inactive')`),
  tenantIsolationPolicy('warehouses'),
]).enableRLS();

export const locations = pgTable('locations', {
  id: id(),
  tenantId: tenantId(),
  warehouseId: uuid('warehouse_id').notNull(),
  parentLocationId: uuid('parent_location_id'),
  name: text('name').notNull(),
  code: text('code').notNull(),
  isSellable: boolean('is_sellable').notNull().default(true),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  foreignKey({
    name: 'locations_warehouse_fk',
    columns: [t.tenantId, t.warehouseId],
    foreignColumns: [warehouses.tenantId, warehouses.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'locations_parent_fk',
    columns: [t.tenantId, t.parentLocationId],
    foreignColumns: [t.tenantId, t.id],
  }).onDelete('restrict'),
  unique('locations_tenant_id_id_key').on(t.tenantId, t.id),
  unique('locations_tenant_warehouse_code_key').on(t.tenantId, t.warehouseId, t.code),
  check('locations_status_check', sql`${t.status} IN ('active', 'inactive')`),
  tenantIsolationPolicy('locations'),
]).enableRLS();

/** MATERIALIZED READ MODEL — not the source of truth (inventory_movements is). */
export const inventoryBalances = pgTable('inventory_balances', {
  id: id(),
  tenantId: tenantId(),
  productVariantId: uuid('product_variant_id').notNull(),
  locationId: uuid('location_id').notNull(),
  quantityPhysical: numeric('quantity_physical').notNull().default('0'),
  quantityReserved: numeric('quantity_reserved').notNull().default('0'),
  quantityCommitted: numeric('quantity_committed').notNull().default('0'),
  quantityAvailable: numeric('quantity_available').generatedAlwaysAs(
    sql`(quantity_physical - quantity_reserved - quantity_committed)`,
  ),
  /** Optimistic-lock counter — see database.md#concurrency-strategy. */
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({
    name: 'inventory_balances_variant_fk',
    columns: [t.tenantId, t.productVariantId],
    foreignColumns: [productVariants.tenantId, productVariants.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'inventory_balances_location_fk',
    columns: [t.tenantId, t.locationId],
    foreignColumns: [locations.tenantId, locations.id],
  }).onDelete('restrict'),
  unique('inventory_balances_tenant_id_id_key').on(t.tenantId, t.id),
  unique('inventory_balances_tenant_variant_location_key').on(t.tenantId, t.productVariantId, t.locationId),
  check('inventory_balances_physical_check', sql`${t.quantityPhysical} >= 0`),
  check('inventory_balances_reserved_check', sql`${t.quantityReserved} >= 0`),
  check('inventory_balances_committed_check', sql`${t.quantityCommitted} >= 0`),
  check('inventory_balances_availability_check', sql`${t.quantityReserved} + ${t.quantityCommitted} <= ${t.quantityPhysical}`),
  index('inventory_balances_tenant_variant_idx').on(t.tenantId, t.productVariantId),
  index('inventory_balances_tenant_location_idx').on(t.tenantId, t.locationId),
  tenantIsolationPolicy('inventory_balances'),
]).enableRLS();

/** SOURCE OF TRUTH — append-only, never updated or deleted. */
export const inventoryMovements = pgTable('inventory_movements', {
  id: id(),
  tenantId: tenantId(),
  productVariantId: uuid('product_variant_id').notNull(),
  locationId: uuid('location_id').notNull(),
  movementType: text('movement_type').notNull(),
  /** Signed, relative to the bucket it affects. */
  quantity: numeric('quantity').notNull(),
  /** quantity_physical snapshot immediately after this movement. */
  balanceAfter: numeric('balance_after').notNull(),
  referenceType: text('reference_type'),
  /** Polymorphic soft reference — not FK-constrained, documented exception. */
  referenceId: uuid('reference_id'),
  reason: text('reason'),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id'),
  idempotencyKey: text('idempotency_key'),
  correlationId: uuid('correlation_id'),
  /** When the physical movement happened — backdatable. */
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  /** When the row was written — never backdated. */
  createdAt: createdAt(),
}, (t) => [
  foreignKey({
    name: 'inventory_movements_variant_fk',
    columns: [t.tenantId, t.productVariantId],
    foreignColumns: [productVariants.tenantId, productVariants.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'inventory_movements_location_fk',
    columns: [t.tenantId, t.locationId],
    foreignColumns: [locations.tenantId, locations.id],
  }).onDelete('restrict'),
  unique('inventory_movements_tenant_id_id_key').on(t.tenantId, t.id),
  uniqueIndex('inventory_movements_tenant_idempotency_key').on(t.tenantId, t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  check(
    'inventory_movements_movement_type_check',
    sql`${t.movementType} IN ('RECEIPT', 'SALE', 'RETURN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'RESERVATION', 'RESERVATION_RELEASE', 'COMMITMENT', 'COMMITMENT_RELEASE', 'INITIAL_STOCK')`,
  ),
  check('inventory_movements_quantity_check', sql`${t.quantity} <> 0`),
  check('inventory_movements_actor_type_check', sql`${t.actorType} IN ('user', 'system', 'platform_admin')`),
  index('inventory_movements_tenant_variant_location_created_idx').on(t.tenantId, t.productVariantId, t.locationId, t.createdAt),
  index('inventory_movements_tenant_reference_idx').on(t.tenantId, t.referenceType, t.referenceId).where(sql`${t.referenceId} IS NOT NULL`),
  index('inventory_movements_tenant_created_idx').on(t.tenantId, t.createdAt),
  tenantIsolationPolicy('inventory_movements'),
]).enableRLS();
