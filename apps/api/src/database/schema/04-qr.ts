import { sql } from 'drizzle-orm';
import { check, foreignKey, pgPolicy, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId, updatedAt } from './_helpers';
import { tenantIsolationPolicy } from './_policies';
import { appPublicResolver } from './_roles';
import { tenants } from './01-platform';

/**
 * QR — database.md#qr-codes. `code` is a documented, deliberate exception to the tenant-scoped
 * uniqueness convention: globally unique, since the public resolver (GET /q/:code) has no tenant
 * context until the code is resolved. A tenant-scoped unique constraint would let two tenants
 * mint the same code, making resolution ambiguous.
 *
 * The column-level GRANTs restricting app_public_resolver to (id, tenant_id, product_id,
 * max_price, status) on product_variants and (id, name) on products — never base_price/
 * min_price/cost — are not expressible in the Drizzle schema DSL; they live in migration
 * 0003_catalog.sql's custom SQL block (see that file for why `name` comes from products, not
 * product_variants — a database.md-internal discrepancy corrected there).
 */
export const qrCodes = pgTable('qr_codes', {
  id: id(),
  tenantId: tenantId(),
  code: text('code').notNull(),
  targetType: text('target_type').notNull(),
  /** Polymorphic soft reference (target table depends on target_type) — not FK-constrained, the
   * documented exception per database.md#tenant-aware-referential-integrity. */
  targetId: uuid('target_id').notNull(),
  status: text('status').notNull().default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  foreignKey({ name: 'qr_codes_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  unique('qr_codes_tenant_id_id_key').on(t.tenantId, t.id),
  unique('qr_codes_code_key').on(t.code),
  check('qr_codes_target_type_check', sql`${t.targetType} IN ('product_variant', 'location')`),
  check('qr_codes_status_check', sql`${t.status} IN ('active', 'revoked')`),
  tenantIsolationPolicy('qr_codes'),
  pgPolicy('qr_codes_public_resolve', {
    as: 'permissive',
    for: 'select',
    to: appPublicResolver,
    using: sql`${t.status} = 'active' AND (${t.expiresAt} IS NULL OR ${t.expiresAt} > now())`,
  }),
]).enableRLS();
