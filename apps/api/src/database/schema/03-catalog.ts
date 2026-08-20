import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
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

/**
 * CATALOG — database.md#catalog-products-variants-attributes,
 * database.md#dynamic-attributes-governance-for-the-catalog-jsonb,
 * database.md#pricing-history-tenant-policy-and-exceptional-discount-approval.
 */

/** Platform-scoped, migration-managed data — same shape as `permissions`. No RLS. */
export const measurementUnits = pgTable('measurement_units', {
  id: id(),
  code: text('code').notNull(),
  label: text('label').notNull(),
  dimension: text('dimension').notNull(),
  createdAt: createdAt(),
}, (t) => [
  unique('measurement_units_code_key').on(t.code),
]);

export const categories = pgTable('categories', {
  id: id(),
  tenantId: tenantId(),
  parentCategoryId: uuid('parent_category_id'),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  foreignKey({ name: 'categories_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  foreignKey({
    name: 'categories_parent_fk',
    columns: [t.tenantId, t.parentCategoryId],
    foreignColumns: [t.tenantId, t.id],
  }).onDelete('restrict'),
  unique('categories_tenant_id_id_key').on(t.tenantId, t.id),
  unique('categories_tenant_id_slug_key').on(t.tenantId, t.slug),
  check('categories_status_check', sql`${t.status} IN ('active', 'inactive')`),
  tenantIsolationPolicy('categories'),
]).enableRLS();

export const brands = pgTable('brands', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  foreignKey({ name: 'brands_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  unique('brands_tenant_id_id_key').on(t.tenantId, t.id),
  unique('brands_tenant_id_name_key').on(t.tenantId, t.name),
  check('brands_status_check', sql`${t.status} IN ('active', 'inactive')`),
  tenantIsolationPolicy('brands'),
]).enableRLS();

/** Placed under CATALOG per ADR-0019 — a passive reference/attribution entity, no
 * purchase-order/receiving workflow. */
export const suppliers = pgTable('suppliers', {
  id: id(),
  tenantId: tenantId(),
  displayName: text('display_name').notNull(),
  taxId: text('tax_id'),
  email: text('email'),
  phone: text('phone'),
  address: jsonb('address'),
  status: text('status').notNull().default('active'),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  foreignKey({ name: 'suppliers_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  unique('suppliers_tenant_id_id_key').on(t.tenantId, t.id),
  uniqueIndex('suppliers_tenant_id_tax_id_key').on(t.tenantId, t.taxId).where(sql`${t.taxId} IS NOT NULL`),
  check('suppliers_status_check', sql`${t.status} IN ('active', 'inactive')`),
  tenantIsolationPolicy('suppliers'),
]).enableRLS();

/** ADR-0026 — governs the JSONB `attributes` keys on products/product_variants. */
export const attributeDefinitions = pgTable('attribute_definitions', {
  id: id(),
  tenantId: tenantId(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  dataType: text('data_type').notNull(),
  appliesTo: text('applies_to').notNull(),
  /** Plain FK — measurement_units is platform-scoped, the documented composite-FK exception. */
  unitId: uuid('unit_id'),
  isRequiredDefault: boolean('is_required_default').notNull().default(false),
  minValue: numeric('min_value'),
  maxValue: numeric('max_value'),
  status: text('status').notNull().default('active'),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  foreignKey({ name: 'attribute_definitions_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  foreignKey({ name: 'attribute_definitions_unit_fk', columns: [t.unitId], foreignColumns: [measurementUnits.id] }).onDelete('restrict'),
  unique('attribute_definitions_tenant_id_id_key').on(t.tenantId, t.id),
  unique('attribute_definitions_tenant_id_code_key').on(t.tenantId, t.code),
  check('attribute_definitions_data_type_check', sql`${t.dataType} IN ('text', 'number', 'decimal', 'boolean', 'date', 'datetime', 'select', 'multi_select')`),
  check('attribute_definitions_applies_to_check', sql`${t.appliesTo} IN ('product', 'variant')`),
  check('attribute_definitions_status_check', sql`${t.status} IN ('active', 'inactive')`),
  check('attribute_definitions_value_range_check', sql`${t.minValue} IS NULL OR ${t.maxValue} IS NULL OR ${t.minValue} <= ${t.maxValue}`),
  check('attribute_definitions_value_type_check', sql`${t.dataType} IN ('number', 'decimal') OR (${t.minValue} IS NULL AND ${t.maxValue} IS NULL)`),
  check('attribute_definitions_unit_type_check', sql`${t.dataType} IN ('number', 'decimal') OR ${t.unitId} IS NULL`),
  index('attribute_definitions_tenant_status_idx').on(t.tenantId, t.status),
  tenantIsolationPolicy('attribute_definitions'),
]).enableRLS();

/** The controlled value catalog for select/multi_select attributes. Status governs lifecycle —
 * no deleted_at, per database.md#soft-delete-policy ("Status, not delete"). */
export const attributeOptions = pgTable('attribute_options', {
  id: id(),
  tenantId: tenantId(),
  attributeDefinitionId: uuid('attribute_definition_id').notNull(),
  code: text('code').notNull(),
  label: text('label').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({
    name: 'attribute_options_definition_fk',
    columns: [t.tenantId, t.attributeDefinitionId],
    foreignColumns: [attributeDefinitions.tenantId, attributeDefinitions.id],
  }).onDelete('restrict'),
  unique('attribute_options_tenant_id_id_key').on(t.tenantId, t.id),
  unique('attribute_options_tenant_def_code_key').on(t.tenantId, t.attributeDefinitionId, t.code),
  check('attribute_options_status_check', sql`${t.status} IN ('active', 'inactive')`),
  index('attribute_options_tenant_def_status_idx').on(t.tenantId, t.attributeDefinitionId, t.status),
  tenantIsolationPolicy('attribute_options'),
]).enableRLS();

/** Which attributes apply to which category, and whether required there. No deleted_at/status —
 * hard-deleted, a plain join/detail row (database.md#soft-delete-policy). */
export const categoryAttributes = pgTable('category_attributes', {
  tenantId: tenantId(),
  categoryId: uuid('category_id').notNull(),
  attributeDefinitionId: uuid('attribute_definition_id').notNull(),
  /** NULL = inherit attribute_definitions.is_required_default. */
  isRequired: boolean('is_required'),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ name: 'category_attributes_pk', columns: [t.categoryId, t.attributeDefinitionId] }),
  foreignKey({
    name: 'category_attributes_category_fk',
    columns: [t.tenantId, t.categoryId],
    foreignColumns: [categories.tenantId, categories.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'category_attributes_definition_fk',
    columns: [t.tenantId, t.attributeDefinitionId],
    foreignColumns: [attributeDefinitions.tenantId, attributeDefinitions.id],
  }).onDelete('restrict'),
  index('category_attributes_tenant_category_idx').on(t.tenantId, t.categoryId),
  tenantIsolationPolicy('category_attributes'),
]).enableRLS();

export const products = pgTable('products', {
  id: id(),
  tenantId: tenantId(),
  categoryId: uuid('category_id'),
  brandId: uuid('brand_id'),
  supplierId: uuid('supplier_id'),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('draft'),
  warrantyMonths: integer('warranty_months'),
  attributes: jsonb('attributes').notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  foreignKey({ name: 'products_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  foreignKey({
    name: 'products_category_fk',
    columns: [t.tenantId, t.categoryId],
    foreignColumns: [categories.tenantId, categories.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'products_brand_fk',
    columns: [t.tenantId, t.brandId],
    foreignColumns: [brands.tenantId, brands.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'products_supplier_fk',
    columns: [t.tenantId, t.supplierId],
    foreignColumns: [suppliers.tenantId, suppliers.id],
  }).onDelete('restrict'),
  unique('products_tenant_id_id_key').on(t.tenantId, t.id),
  check('products_status_check', sql`${t.status} IN ('draft', 'active', 'discontinued')`),
  check('products_warranty_months_check', sql`${t.warrantyMonths} IS NULL OR ${t.warrantyMonths} >= 0`),
  index('products_tenant_category_idx').on(t.tenantId, t.categoryId).where(sql`${t.deletedAt} IS NULL`),
  index('products_tenant_status_idx').on(t.tenantId, t.status).where(sql`${t.deletedAt} IS NULL`),
  tenantIsolationPolicy('products'),
]).enableRLS();

export const productVariants = pgTable('product_variants', {
  id: id(),
  tenantId: tenantId(),
  productId: uuid('product_id').notNull(),
  sku: text('sku').notNull(),
  barcode: text('barcode'),
  unit: text('unit').notNull().default('unit'),
  maxPrice: numeric('max_price').notNull(),
  basePrice: numeric('base_price').notNull(),
  minPrice: numeric('min_price').notNull(),
  cost: numeric('cost'),
  status: text('status').notNull().default('active'),
  isSerialized: boolean('is_serialized').notNull().default(false),
  isLotTracked: boolean('is_lot_tracked').notNull().default(false),
  attributes: jsonb('attributes').notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  foreignKey({
    name: 'product_variants_product_fk',
    columns: [t.tenantId, t.productId],
    foreignColumns: [products.tenantId, products.id],
  }).onDelete('restrict'),
  unique('product_variants_tenant_id_id_key').on(t.tenantId, t.id),
  unique('product_variants_tenant_id_sku_key').on(t.tenantId, t.sku),
  uniqueIndex('product_variants_tenant_id_barcode_key').on(t.tenantId, t.barcode).where(sql`${t.barcode} IS NOT NULL`),
  check('product_variants_max_price_check', sql`${t.maxPrice} >= 0`),
  check('product_variants_base_price_check', sql`${t.basePrice} >= 0`),
  check('product_variants_min_price_check', sql`${t.minPrice} >= 0`),
  check('product_variants_cost_check', sql`${t.cost} IS NULL OR ${t.cost} >= 0`),
  check('product_variants_status_check', sql`${t.status} IN ('active', 'discontinued')`),
  check('product_variants_tracking_mode_check', sql`NOT (${t.isSerialized} AND ${t.isLotTracked})`),
  check('product_variants_price_tier_check', sql`${t.minPrice} <= ${t.basePrice} AND ${t.basePrice} <= ${t.maxPrice}`),
  index('product_variants_tenant_product_idx').on(t.tenantId, t.productId),
  tenantIsolationPolicy('product_variants'),
]).enableRLS();

/** No deleted_at — removed by deleting the row (database.md#catalog-products-variants-attributes). */
export const productImages = pgTable('product_images', {
  id: id(),
  tenantId: tenantId(),
  productId: uuid('product_id').notNull(),
  productVariantId: uuid('product_variant_id'),
  storageKey: text('storage_key').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({
    name: 'product_images_product_fk',
    columns: [t.tenantId, t.productId],
    foreignColumns: [products.tenantId, products.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'product_images_variant_fk',
    columns: [t.tenantId, t.productVariantId],
    foreignColumns: [productVariants.tenantId, productVariants.id],
  }).onDelete('restrict'),
  unique('product_images_tenant_id_id_key').on(t.tenantId, t.id),
  tenantIsolationPolicy('product_images'),
]).enableRLS();

export const productSerials = pgTable('product_serials', {
  id: id(),
  tenantId: tenantId(),
  productVariantId: uuid('product_variant_id').notNull(),
  serialNumber: text('serial_number').notNull(),
  status: text('status').notNull().default('in_stock'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({
    name: 'product_serials_variant_fk',
    columns: [t.tenantId, t.productVariantId],
    foreignColumns: [productVariants.tenantId, productVariants.id],
  }).onDelete('restrict'),
  unique('product_serials_tenant_id_id_key').on(t.tenantId, t.id),
  unique('product_serials_tenant_id_serial_key').on(t.tenantId, t.serialNumber),
  check('product_serials_status_check', sql`${t.status} IN ('in_stock', 'sold', 'returned')`),
  tenantIsolationPolicy('product_serials'),
]).enableRLS();

export const productLots = pgTable('product_lots', {
  id: id(),
  tenantId: tenantId(),
  productVariantId: uuid('product_variant_id').notNull(),
  lotNumber: text('lot_number').notNull(),
  manufacturedDate: date('manufactured_date'),
  expiryDate: date('expiry_date'),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({
    name: 'product_lots_variant_fk',
    columns: [t.tenantId, t.productVariantId],
    foreignColumns: [productVariants.tenantId, productVariants.id],
  }).onDelete('restrict'),
  unique('product_lots_tenant_id_id_key').on(t.tenantId, t.id),
  unique('product_lots_tenant_variant_lot_key').on(t.tenantId, t.productVariantId, t.lotNumber),
  tenantIsolationPolicy('product_lots'),
]).enableRLS();

/** Append-only ledger of price changes — never updated or deleted
 * (database.md#soft-delete-policy). */
export const productPriceHistory = pgTable('product_price_history', {
  id: id(),
  tenantId: tenantId(),
  productVariantId: uuid('product_variant_id').notNull(),
  maxPrice: numeric('max_price').notNull(),
  basePrice: numeric('base_price').notNull(),
  minPrice: numeric('min_price').notNull(),
  changedBy: uuid('changed_by'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({
    name: 'product_price_history_variant_fk',
    columns: [t.tenantId, t.productVariantId],
    foreignColumns: [productVariants.tenantId, productVariants.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'product_price_history_changed_by_fk',
    columns: [t.tenantId, t.changedBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  unique('product_price_history_tenant_id_id_key').on(t.tenantId, t.id),
  check('product_price_history_max_price_check', sql`${t.maxPrice} >= 0`),
  check('product_price_history_base_price_check', sql`${t.basePrice} >= 0`),
  check('product_price_history_min_price_check', sql`${t.minPrice} >= 0`),
  check('product_price_history_price_tier_check', sql`${t.minPrice} <= ${t.basePrice} AND ${t.basePrice} <= ${t.maxPrice}`),
  index('product_price_history_tenant_variant_effective_idx').on(t.tenantId, t.productVariantId, t.effectiveFrom),
  tenantIsolationPolicy('product_price_history'),
]).enableRLS();

/** One row per tenant — discount-governance configuration. Mutable config, never deleted
 * (database.md#soft-delete-policy). */
export const tenantPricePolicies = pgTable('tenant_price_policies', {
  id: id(),
  tenantId: uuid('tenant_id').notNull(),
  exceptionalDiscountRequiresApproval: boolean('exceptional_discount_requires_approval').notNull().default(true),
  maxDiscountBelowMinPercent: numeric('max_discount_below_min_percent'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ name: 'tenant_price_policies_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  unique('tenant_price_policies_tenant_id_id_key').on(t.tenantId, t.id),
  unique('tenant_price_policies_tenant_id_key').on(t.tenantId),
  check('tenant_price_policies_max_discount_check', sql`${t.maxDiscountBelowMinPercent} IS NULL OR ${t.maxDiscountBelowMinPercent} >= 0`),
  tenantIsolationPolicy('tenant_price_policies'),
]).enableRLS();
