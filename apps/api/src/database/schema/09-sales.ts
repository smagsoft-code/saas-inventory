import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
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
import { users } from './02-core';
import { productVariants } from './03-catalog';
import { locations } from './05-inventory';

/**
 * SALES — database.md#cart, database.md#orders-conceptual--sales-not-built-yet,
 * database.md#pricing-history-tenant-policy-and-exceptional-discount-approval,
 * database.md#sales-returns-and-disposition. Schema only, per modules.md#sales — no SALES
 * endpoints/services exist yet; the table existing early does not imply the module is built.
 *
 * Table order within this file follows the migration-ordering note in database.md#cart: orders
 * and order_items are created before carts/cart_items, since carts.order_id references orders.
 */

export const customers = pgTable('customers', {
  id: id(),
  tenantId: tenantId(),
  /** The identification document type (owner redesign, F17-CUSTOMERS-AUDIT) — not
   * individual/business (that distinction is dropped entirely). Drives `taxId`'s expected format:
   * `cedula` → exactly 10 digits, `ruc` → exactly 13 digits, `pasaporte` → alphanumeric. */
  type: text('type').notNull(),
  firstName: text('first_name').notNull(),
  /** Nullable only for the rare legacy/backfilled row with no second name token — the create/update
   * DTOs (apps/api/src/sales/customers/dto) require it, same as `firstName`. */
  lastName: text('last_name'),
  /** Derived, never written directly. `concat_ws` would skip a NULL `lastName` cleanly, but
   * Postgres's built-in `concat_ws`/`concat` are STABLE, not IMMUTABLE (their generic `"any"`
   * variadic goes through a type's output function, which isn't guaranteed immutable for every
   * type — e.g. timestamptz depends on the session's TimeZone GUC) — a GENERATED column requires
   * an IMMUTABLE expression, so this uses plain `||` (immutable for text) with an explicit CASE
   * instead. Every existing reader of `customers.displayName` (order snapshot, audit log, search)
   * keeps working unchanged. */
  displayName: text('display_name')
    .notNull()
    .generatedAlwaysAs(sql`CASE WHEN last_name IS NULL OR last_name = '' THEN first_name ELSE first_name || ' ' || last_name END`),
  taxId: text('tax_id'),
  email: text('email'),
  phone: text('phone'),
  /** A single free-form line (owner redesign) — was a structured jsonb object
   * (line1/line2/city/state/postalCode/country); `orders.customer_address_snapshot` (a separate,
   * historical column) is untouched and keeps its own jsonb shape. */
  address: text('address'),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  foreignKey({ name: 'customers_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  unique('customers_tenant_id_id_key').on(t.tenantId, t.id),
  uniqueIndex('customers_tenant_id_tax_id_key').on(t.tenantId, t.taxId).where(sql`${t.taxId} IS NOT NULL`),
  check('customers_type_check', sql`${t.type} IN ('cedula', 'ruc', 'pasaporte')`),
  check('customers_status_check', sql`${t.status} IN ('active', 'inactive')`),
  tenantIsolationPolicy('customers'),
]).enableRLS();

export const orders = pgTable('orders', {
  id: id(),
  tenantId: tenantId(),
  locationId: uuid('location_id').notNull(),
  customerId: uuid('customer_id'),
  customerNameSnapshot: text('customer_name_snapshot').notNull(),
  customerTaxIdSnapshot: text('customer_tax_id_snapshot'),
  customerEmailSnapshot: text('customer_email_snapshot'),
  customerPhoneSnapshot: text('customer_phone_snapshot'),
  customerAddressSnapshot: jsonb('customer_address_snapshot'),
  orderNumber: text('order_number').notNull(),
  documentType: text('document_type').notNull(),
  invoiceStatus: text('invoice_status'),
  status: text('status').notNull().default('draft'),
  subtotal: numeric('subtotal').notNull(),
  discountTotal: numeric('discount_total').notNull().default('0'),
  taxTotal: numeric('tax_total').notNull().default('0'),
  total: numeric('total').notNull(),
  currency: char('currency', { length: 3 }).notNull(),
  placedByUserId: uuid('placed_by_user_id'),
  correlationId: uuid('correlation_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({
    name: 'orders_location_fk',
    columns: [t.tenantId, t.locationId],
    foreignColumns: [locations.tenantId, locations.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'orders_customer_fk',
    columns: [t.tenantId, t.customerId],
    foreignColumns: [customers.tenantId, customers.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'orders_placed_by_fk',
    columns: [t.tenantId, t.placedByUserId],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  unique('orders_tenant_id_id_key').on(t.tenantId, t.id),
  unique('orders_tenant_id_order_number_key').on(t.tenantId, t.orderNumber),
  check('orders_document_type_check', sql`${t.documentType} IN ('invoice', 'sales_note')`),
  check('orders_invoice_status_check', sql`${t.invoiceStatus} IS NULL OR ${t.invoiceStatus} IN ('pending', 'issued', 'failed')`),
  check(
    'orders_status_check',
    sql`${t.status} IN ('draft', 'pending', 'confirmed', 'fulfilled', 'cancelled')`,
  ),
  check('orders_subtotal_check', sql`${t.subtotal} >= 0`),
  check('orders_discount_total_check', sql`${t.discountTotal} >= 0`),
  check('orders_tax_total_check', sql`${t.taxTotal} >= 0`),
  check('orders_total_check', sql`${t.total} >= 0`),
  check(
    'orders_document_invoice_status_consistency_check',
    sql`(${t.documentType} = 'invoice' AND ${t.invoiceStatus} IS NOT NULL) OR (${t.documentType} = 'sales_note' AND ${t.invoiceStatus} IS NULL)`,
  ),
  index('orders_tenant_customer_idx').on(t.tenantId, t.customerId),
  index('orders_tenant_status_created_idx').on(t.tenantId, t.status, t.createdAt),
  tenantIsolationPolicy('orders'),
]).enableRLS();

export const orderItems = pgTable('order_items', {
  id: id(),
  tenantId: tenantId(),
  orderId: uuid('order_id').notNull(),
  productVariantId: uuid('product_variant_id').notNull(),
  skuSnapshot: text('sku_snapshot').notNull(),
  productNameSnapshot: text('product_name_snapshot').notNull(),
  maxPriceSnapshot: numeric('max_price_snapshot').notNull(),
  basePriceSnapshot: numeric('base_price_snapshot').notNull(),
  minPriceSnapshot: numeric('min_price_snapshot').notNull(),
  unitPriceSnapshot: numeric('unit_price_snapshot').notNull(),
  unitCostSnapshot: numeric('unit_cost_snapshot'),
  quantity: numeric('quantity').notNull(),
  discountAmount: numeric('discount_amount').notNull().default('0'),
  isExceptionalDiscount: boolean('is_exceptional_discount').notNull().default(false),
  lineTotal: numeric('line_total').notNull(),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({
    name: 'order_items_order_fk',
    columns: [t.tenantId, t.orderId],
    foreignColumns: [orders.tenantId, orders.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'order_items_variant_fk',
    columns: [t.tenantId, t.productVariantId],
    foreignColumns: [productVariants.tenantId, productVariants.id],
  }).onDelete('restrict'),
  unique('order_items_tenant_id_id_key').on(t.tenantId, t.id),
  check('order_items_max_price_snapshot_check', sql`${t.maxPriceSnapshot} >= 0`),
  check('order_items_base_price_snapshot_check', sql`${t.basePriceSnapshot} >= 0`),
  check('order_items_min_price_snapshot_check', sql`${t.minPriceSnapshot} >= 0`),
  check('order_items_unit_price_snapshot_check', sql`${t.unitPriceSnapshot} >= 0`),
  check('order_items_quantity_check', sql`${t.quantity} > 0`),
  check('order_items_discount_amount_check', sql`${t.discountAmount} >= 0`),
  check('order_items_line_total_check', sql`${t.lineTotal} >= 0`),
  tenantIsolationPolicy('order_items'),
]).enableRLS();

export const carts = pgTable('carts', {
  id: id(),
  tenantId: tenantId(),
  locationId: uuid('location_id').notNull(),
  userId: uuid('user_id').notNull(),
  customerId: uuid('customer_id'),
  orderId: uuid('order_id'),
  status: text('status').notNull().default('open'),
  version: integer('version').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (t) => [
  foreignKey({
    name: 'carts_location_fk',
    columns: [t.tenantId, t.locationId],
    foreignColumns: [locations.tenantId, locations.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'carts_user_fk',
    columns: [t.tenantId, t.userId],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'carts_customer_fk',
    columns: [t.tenantId, t.customerId],
    foreignColumns: [customers.tenantId, customers.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'carts_order_fk',
    columns: [t.tenantId, t.orderId],
    foreignColumns: [orders.tenantId, orders.id],
  }).onDelete('restrict'),
  unique('carts_tenant_id_id_key').on(t.tenantId, t.id),
  check('carts_status_check', sql`${t.status} IN ('open', 'checked_out', 'abandoned')`),
  index('carts_tenant_user_open_idx').on(t.tenantId, t.userId, t.status).where(sql`${t.status} = 'open'`),
  tenantIsolationPolicy('carts'),
]).enableRLS();

export const cartItems = pgTable('cart_items', {
  id: id(),
  tenantId: tenantId(),
  cartId: uuid('cart_id').notNull(),
  productVariantId: uuid('product_variant_id').notNull(),
  quantity: numeric('quantity').notNull(),
  negotiatedUnitPrice: numeric('negotiated_unit_price'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({
    name: 'cart_items_cart_fk',
    columns: [t.tenantId, t.cartId],
    foreignColumns: [carts.tenantId, carts.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'cart_items_variant_fk',
    columns: [t.tenantId, t.productVariantId],
    foreignColumns: [productVariants.tenantId, productVariants.id],
  }).onDelete('restrict'),
  unique('cart_items_tenant_id_id_key').on(t.tenantId, t.id),
  unique('cart_items_tenant_cart_variant_key').on(t.tenantId, t.cartId, t.productVariantId),
  check('cart_items_quantity_check', sql`${t.quantity} > 0`),
  check('cart_items_negotiated_price_check', sql`${t.negotiatedUnitPrice} IS NULL OR ${t.negotiatedUnitPrice} >= 0`),
  tenantIsolationPolicy('cart_items'),
]).enableRLS();

export const priceApprovals = pgTable('price_approvals', {
  id: id(),
  tenantId: tenantId(),
  orderId: uuid('order_id').notNull(),
  orderItemId: uuid('order_item_id').notNull(),
  requestedPrice: numeric('requested_price').notNull(),
  minPriceAtRequest: numeric('min_price_at_request').notNull(),
  maxPriceAtRequest: numeric('max_price_at_request').notNull(),
  discountAmount: numeric('discount_amount').notNull(),
  reason: text('reason').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  approvedBy: uuid('approved_by'),
  status: text('status').notNull().default('pending'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  foreignKey({
    name: 'price_approvals_order_fk',
    columns: [t.tenantId, t.orderId],
    foreignColumns: [orders.tenantId, orders.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'price_approvals_order_item_fk',
    columns: [t.tenantId, t.orderItemId],
    foreignColumns: [orderItems.tenantId, orderItems.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'price_approvals_requested_by_fk',
    columns: [t.tenantId, t.requestedBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'price_approvals_approved_by_fk',
    columns: [t.tenantId, t.approvedBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  unique('price_approvals_tenant_id_id_key').on(t.tenantId, t.id),
  uniqueIndex('price_approvals_tenant_pending_item_key').on(t.tenantId, t.orderItemId).where(sql`${t.status} = 'pending'`),
  check('price_approvals_requested_price_check', sql`${t.requestedPrice} >= 0`),
  check('price_approvals_min_price_at_request_check', sql`${t.minPriceAtRequest} >= 0`),
  check('price_approvals_max_price_at_request_check', sql`${t.maxPriceAtRequest} >= 0`),
  check('price_approvals_discount_amount_check', sql`${t.discountAmount} >= 0`),
  check('price_approvals_status_check', sql`${t.status} IN ('pending', 'approved', 'rejected', 'cancelled')`),
  index('price_approvals_tenant_pending_queue_idx').on(t.tenantId, t.status, t.requestedAt).where(sql`${t.status} = 'pending'`),
  index('price_approvals_tenant_order_idx').on(t.tenantId, t.orderId),
  tenantIsolationPolicy('price_approvals'),
]).enableRLS();

export const salesReturns = pgTable('sales_returns', {
  id: id(),
  tenantId: tenantId(),
  orderId: uuid('order_id').notNull(),
  locationId: uuid('location_id').notNull(),
  status: text('status').notNull().default('requested'),
  requestedBy: uuid('requested_by').notNull(),
  receivedBy: uuid('received_by'),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({
    name: 'sales_returns_order_fk',
    columns: [t.tenantId, t.orderId],
    foreignColumns: [orders.tenantId, orders.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'sales_returns_location_fk',
    columns: [t.tenantId, t.locationId],
    foreignColumns: [locations.tenantId, locations.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'sales_returns_requested_by_fk',
    columns: [t.tenantId, t.requestedBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'sales_returns_received_by_fk',
    columns: [t.tenantId, t.receivedBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  unique('sales_returns_tenant_id_id_key').on(t.tenantId, t.id),
  check('sales_returns_status_check', sql`${t.status} IN ('requested', 'inspecting', 'resolved', 'cancelled')`),
  index('sales_returns_tenant_order_idx').on(t.tenantId, t.orderId),
  index('sales_returns_tenant_status_created_idx').on(t.tenantId, t.status, t.createdAt),
  tenantIsolationPolicy('sales_returns'),
]).enableRLS();

/** Never deleted — a record of a fact that happened (database.md#soft-delete-policy). */
export const salesReturnItems = pgTable('sales_return_items', {
  id: id(),
  tenantId: tenantId(),
  returnId: uuid('return_id').notNull(),
  orderItemId: uuid('order_item_id').notNull(),
  productVariantId: uuid('product_variant_id').notNull(),
  quantityReturned: numeric('quantity_returned').notNull(),
  disposition: text('disposition'),
  dispositionLocationId: uuid('disposition_location_id'),
  inspectedBy: uuid('inspected_by'),
  inspectedAt: timestamp('inspected_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({
    name: 'sales_return_items_return_fk',
    columns: [t.tenantId, t.returnId],
    foreignColumns: [salesReturns.tenantId, salesReturns.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'sales_return_items_order_item_fk',
    columns: [t.tenantId, t.orderItemId],
    foreignColumns: [orderItems.tenantId, orderItems.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'sales_return_items_variant_fk',
    columns: [t.tenantId, t.productVariantId],
    foreignColumns: [productVariants.tenantId, productVariants.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'sales_return_items_disposition_location_fk',
    columns: [t.tenantId, t.dispositionLocationId],
    foreignColumns: [locations.tenantId, locations.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'sales_return_items_inspected_by_fk',
    columns: [t.tenantId, t.inspectedBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  unique('sales_return_items_tenant_id_id_key').on(t.tenantId, t.id),
  check('sales_return_items_quantity_check', sql`${t.quantityReturned} > 0`),
  check('sales_return_items_disposition_check', sql`${t.disposition} IS NULL OR ${t.disposition} IN ('restock', 'quarantine', 'damaged', 'scrap')`),
  index('sales_return_items_tenant_order_item_idx').on(t.tenantId, t.orderItemId),
  tenantIsolationPolicy('sales_return_items'),
]).enableRLS();
