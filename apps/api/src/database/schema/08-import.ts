import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, updatedAt } from './_helpers';
import { tenantIsolationPolicy } from './_policies';
import { users } from './02-core';
import { categories, productVariants } from './03-catalog';
import { locations } from './05-inventory';

/**
 * Excel import pipeline — database.md#excel-import-pipeline, ADR-0027. Staged upload -> map ->
 * validate -> preview -> commit; import_job_rows never writes directly to catalog/inventory
 * tables (that happens through the same repository path every other flow uses, see
 * database.md#committing-transactional-strategy-duplicates-rollback).
 */

/** Hard-deleted on user removal — safe because import_jobs.column_mapping is always a frozen
 * copy, never a live reference (database.md#soft-delete-policy). */
export const importMappingTemplates = pgTable('import_mapping_templates', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  categoryId: uuid('category_id'),
  columnMapping: jsonb('column_mapping').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({
    name: 'import_mapping_templates_category_fk',
    columns: [t.tenantId, t.categoryId],
    foreignColumns: [categories.tenantId, categories.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'import_mapping_templates_created_by_fk',
    columns: [t.tenantId, t.createdBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  unique('import_mapping_templates_tenant_id_id_key').on(t.tenantId, t.id),
  unique('import_mapping_templates_tenant_id_name_key').on(t.tenantId, t.name),
  tenantIsolationPolicy('import_mapping_templates'),
]).enableRLS();

export const importJobs = pgTable('import_jobs', {
  id: id(),
  tenantId: tenantId(),
  createdBy: uuid('created_by').notNull(),
  defaultLocationId: uuid('default_location_id'),
  mappingTemplateId: uuid('mapping_template_id'),
  /** The mapping actually used — a frozen copy, even when sourced from a template. */
  columnMapping: jsonb('column_mapping').notNull(),
  duplicateHandlingMode: text('duplicate_handling_mode').notNull().default('update_catalog_only'),
  storageKey: text('storage_key').notNull(),
  originalFilename: text('original_filename').notNull(),
  status: text('status').notNull().default('uploaded'),
  totalRows: integer('total_rows'),
  validRows: integer('valid_rows'),
  invalidRows: integer('invalid_rows'),
  warningRows: integer('warning_rows'),
  importedRows: integer('imported_rows'),
  errorReportStorageKey: text('error_report_storage_key'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({
    name: 'import_jobs_created_by_fk',
    columns: [t.tenantId, t.createdBy],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'import_jobs_default_location_fk',
    columns: [t.tenantId, t.defaultLocationId],
    foreignColumns: [locations.tenantId, locations.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'import_jobs_mapping_template_fk',
    columns: [t.tenantId, t.mappingTemplateId],
    foreignColumns: [importMappingTemplates.tenantId, importMappingTemplates.id],
  }).onDelete('restrict'),
  unique('import_jobs_tenant_id_id_key').on(t.tenantId, t.id),
  check(
    'import_jobs_duplicate_handling_mode_check',
    sql`${t.duplicateHandlingMode} IN ('update_catalog_only', 'update_catalog_and_inventory', 'skip_existing', 'reject_on_duplicate')`,
  ),
  check(
    'import_jobs_status_check',
    sql`${t.status} IN ('uploaded', 'mapping', 'validating', 'ready', 'importing', 'completed', 'completed_with_errors', 'failed', 'cancelled')`,
  ),
  index('import_jobs_tenant_status_created_idx').on(t.tenantId, t.status, t.createdAt),
  tenantIsolationPolicy('import_jobs'),
]).enableRLS();

/** Staging — one row per Excel row; never writes directly to catalog/inventory tables. */
export const importJobRows = pgTable('import_job_rows', {
  id: id(),
  tenantId: tenantId(),
  importJobId: uuid('import_job_id').notNull(),
  rowNumber: integer('row_number').notNull(),
  rawData: jsonb('raw_data').notNull(),
  mappedData: jsonb('mapped_data'),
  status: text('status').notNull().default('pending'),
  matchAction: text('match_action'),
  matchedProductVariantId: uuid('matched_product_variant_id'),
  errors: jsonb('errors').notNull().default([]),
  warnings: jsonb('warnings').notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({
    name: 'import_job_rows_job_fk',
    columns: [t.tenantId, t.importJobId],
    foreignColumns: [importJobs.tenantId, importJobs.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'import_job_rows_matched_variant_fk',
    columns: [t.tenantId, t.matchedProductVariantId],
    foreignColumns: [productVariants.tenantId, productVariants.id],
  }).onDelete('restrict'),
  unique('import_job_rows_tenant_id_id_key').on(t.tenantId, t.id),
  unique('import_job_rows_tenant_job_row_key').on(t.tenantId, t.importJobId, t.rowNumber),
  check('import_job_rows_status_check', sql`${t.status} IN ('pending', 'valid', 'warning', 'invalid', 'imported', 'skipped')`),
  check('import_job_rows_match_action_check', sql`${t.matchAction} IS NULL OR ${t.matchAction} IN ('create', 'update', 'skip')`),
  index('import_job_rows_tenant_job_status_idx').on(t.tenantId, t.importJobId, t.status),
  tenantIsolationPolicy('import_job_rows'),
]).enableRLS();
