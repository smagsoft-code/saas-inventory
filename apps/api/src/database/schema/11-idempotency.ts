import { foreignKey, integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { createdAt, id, tenantId } from './_helpers';
import { tenantIsolationPolicy } from './_policies';
import { tenants } from './01-platform';

/**
 * Whole-request idempotency (order creation and every other genuinely user-retriable action) —
 * database.md#idempotency. TTL-cleaned by a periodic job, no deleted_at (hard delete).
 */
export const idempotencyKeys = pgTable('idempotency_keys', {
  id: id(),
  tenantId: tenantId(),
  scope: text('scope').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  responseStatus: integer('response_status').notNull(),
  responseBody: jsonb('response_body').notNull(),
  createdAt: createdAt(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [
  foreignKey({ name: 'idempotency_keys_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  unique('idempotency_keys_tenant_id_id_key').on(t.tenantId, t.id),
  unique('idempotency_keys_tenant_scope_key_key').on(t.tenantId, t.scope, t.idempotencyKey),
  tenantIsolationPolicy('idempotency_keys'),
]).enableRLS();
