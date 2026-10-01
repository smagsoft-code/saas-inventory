import { sql } from 'drizzle-orm';
import { check, foreignKey, index, numeric, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, updatedAt } from './_helpers';
import { tenantIsolationPolicy } from './_policies';
import { productVariants } from './03-catalog';
import { locations } from './05-inventory';
import { users } from './02-core';

/**
 * Inventory transfers and in-transit stock — database.md#inventory-transfers-and-in-transit-stock,
 * ADR-0020. A transfer is any authorized location -> any other authorized location of the same
 * tenant, not a fixed pair of location types. In-transit stock is derived from open transfers,
 * not a stored balance bucket — see the doc for the full movement mapping.
 */

export const inventoryTransfers = pgTable('inventory_transfers', {
  id: id(),
  tenantId: tenantId(),
  /** Human-readable sequence — `${sourceWarehouse.code}-${sourceLocation.code}-NNN`, e.g.
   * `MATR-ALM-001`. Computed once at create() (InventoryTransfersRepository.nextTransferCode) from
   * the SAME source-location scope the numbering is keyed to; never recomputed from other fields.
   * Sequence scope is per (tenant, source_location) — see nextTransferCode's advisory-lock key,
   * same `pg_advisory_xact_lock(hashtext(...))` + `count(*)` pattern orders.repository.ts's
   * nextOrderNumber() already established. Continuous, never resets by year (no such requirement
   * was given — see the Transferencias implementation report's numbering section). */
  code: text('code').notNull(),
  sourceLocationId: uuid('source_location_id').notNull(),
  destinationLocationId: uuid('destination_location_id').notNull(),
  status: text('status').notNull().default('draft'),
  requestedBy: uuid('requested_by').notNull(),
  approvedBy: uuid('approved_by'),
  dispatchedBy: uuid('dispatched_by'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  receivedAt: timestamp('received_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, (t) => [
  foreignKey({
    name: 'inventory_transfers_source_fk',
    columns: [t.tenantId, t.sourceLocationId],
    foreignColumns: [locations.tenantId, locations.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'inventory_transfers_destination_fk',
    columns: [t.tenantId, t.destinationLocationId],
    foreignColumns: [locations.tenantId, locations.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'inventory_transfers_requested_by_fk',
    columns: [t.tenantId, t.requestedBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'inventory_transfers_approved_by_fk',
    columns: [t.tenantId, t.approvedBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'inventory_transfers_dispatched_by_fk',
    columns: [t.tenantId, t.dispatchedBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  unique('inventory_transfers_tenant_id_id_key').on(t.tenantId, t.id),
  unique('inventory_transfers_tenant_id_code_key').on(t.tenantId, t.code),
  check(
    'inventory_transfers_status_check',
    sql`${t.status} IN ('draft', 'approved', 'preparing', 'dispatched', 'partially_received', 'received', 'cancelled')`,
  ),
  check('inventory_transfers_locations_distinct_check', sql`${t.sourceLocationId} <> ${t.destinationLocationId}`),
  index('inventory_transfers_tenant_status_created_idx').on(t.tenantId, t.status, t.createdAt),
  index('inventory_transfers_tenant_source_idx').on(t.tenantId, t.sourceLocationId),
  index('inventory_transfers_tenant_destination_idx').on(t.tenantId, t.destinationLocationId),
  tenantIsolationPolicy('inventory_transfers'),
]).enableRLS();

export const inventoryTransferItems = pgTable('inventory_transfer_items', {
  id: id(),
  tenantId: tenantId(),
  transferId: uuid('transfer_id').notNull(),
  productVariantId: uuid('product_variant_id').notNull(),
  quantityRequested: numeric('quantity_requested').notNull(),
  quantityDispatched: numeric('quantity_dispatched').notNull().default('0'),
  /** Materialized running total, kept current alongside each receipt-item insert — see
   * database.md#inventory-transfers-and-in-transit-stock. */
  quantityReceived: numeric('quantity_received').notNull().default('0'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({
    name: 'inventory_transfer_items_transfer_fk',
    columns: [t.tenantId, t.transferId],
    foreignColumns: [inventoryTransfers.tenantId, inventoryTransfers.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'inventory_transfer_items_variant_fk',
    columns: [t.tenantId, t.productVariantId],
    foreignColumns: [productVariants.tenantId, productVariants.id],
  }).onDelete('restrict'),
  unique('inventory_transfer_items_tenant_id_id_key').on(t.tenantId, t.id),
  unique('inventory_transfer_items_tenant_transfer_variant_key').on(t.tenantId, t.transferId, t.productVariantId),
  check('inventory_transfer_items_requested_check', sql`${t.quantityRequested} > 0`),
  check('inventory_transfer_items_dispatched_check', sql`${t.quantityDispatched} >= 0`),
  check('inventory_transfer_items_received_check', sql`${t.quantityReceived} >= 0`),
  check('inventory_transfer_items_dispatched_le_requested_check', sql`${t.quantityDispatched} <= ${t.quantityRequested}`),
  check('inventory_transfer_items_received_le_dispatched_check', sql`${t.quantityReceived} <= ${t.quantityDispatched}`),
  index('inventory_transfer_items_tenant_transfer_idx').on(t.tenantId, t.transferId),
  index('inventory_transfer_items_tenant_variant_idx').on(t.tenantId, t.productVariantId),
  tenantIsolationPolicy('inventory_transfer_items'),
]).enableRLS();

/** One row per receiving EVENT — never deleted (database.md#soft-delete-policy). */
export const inventoryTransferReceipts = pgTable('inventory_transfer_receipts', {
  id: id(),
  tenantId: tenantId(),
  transferId: uuid('transfer_id').notNull(),
  receivedBy: uuid('received_by').notNull(),
  notes: text('notes'),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({
    name: 'inventory_transfer_receipts_transfer_fk',
    columns: [t.tenantId, t.transferId],
    foreignColumns: [inventoryTransfers.tenantId, inventoryTransfers.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'inventory_transfer_receipts_received_by_fk',
    columns: [t.tenantId, t.receivedBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  unique('inventory_transfer_receipts_tenant_id_id_key').on(t.tenantId, t.id),
  index('inventory_transfer_receipts_tenant_transfer_idx').on(t.tenantId, t.transferId),
  tenantIsolationPolicy('inventory_transfer_receipts'),
]).enableRLS();

/** Append-only, one row per product per receiving event — never deleted. */
export const inventoryTransferReceiptItems = pgTable('inventory_transfer_receipt_items', {
  id: id(),
  tenantId: tenantId(),
  receiptId: uuid('receipt_id').notNull(),
  transferItemId: uuid('transfer_item_id').notNull(),
  quantityReceived: numeric('quantity_received').notNull(),
  incidentType: text('incident_type'),
  incidentNotes: text('incident_notes'),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({
    name: 'inventory_transfer_receipt_items_receipt_fk',
    columns: [t.tenantId, t.receiptId],
    foreignColumns: [inventoryTransferReceipts.tenantId, inventoryTransferReceipts.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'inventory_transfer_receipt_items_item_fk',
    columns: [t.tenantId, t.transferItemId],
    foreignColumns: [inventoryTransferItems.tenantId, inventoryTransferItems.id],
  }).onDelete('restrict'),
  unique('inventory_transfer_receipt_items_tenant_id_id_key').on(t.tenantId, t.id),
  check('inventory_transfer_receipt_items_quantity_check', sql`${t.quantityReceived} > 0`),
  check('inventory_transfer_receipt_items_incident_type_check', sql`${t.incidentType} IS NULL OR ${t.incidentType} IN ('shortage', 'damage', 'excess')`),
  index('inventory_transfer_receipt_items_tenant_receipt_idx').on(t.tenantId, t.receiptId),
  tenantIsolationPolicy('inventory_transfer_receipt_items'),
]).enableRLS();
