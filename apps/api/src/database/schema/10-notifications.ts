import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './_helpers';
import { tenantIsolationPolicy } from './_policies';
import { appEventProcessor } from './_roles';
import { tenants } from './01-platform';

/**
 * NOTIFICATIONS — database.md#outbox, ADR-0010. `id` IS the stable event_id consumers dedupe on.
 * tenant_id is nullable for platform-global events (e.g. TENANT_CREATED) — same mixed-scope
 * shape as audit_log.
 */
export const eventOutbox = pgTable('event_outbox', {
  id: id(),
  tenantId: uuid('tenant_id'),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  correlationId: uuid('correlation_id'),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  claimedBy: text('claimed_by'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ name: 'event_outbox_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  check('event_outbox_status_check', sql`${t.status} IN ('pending', 'processing', 'delivered', 'dead_letter')`),
  index('event_outbox_pending_created_idx').on(t.status, t.createdAt).where(sql`${t.status} = 'pending'`),
  index('event_outbox_tenant_created_idx').on(t.tenantId, t.createdAt),
  tenantIsolationPolicy('event_outbox'),
  /** This role sees every tenant's events (its blast radius is this one table — see
   * database.md#row-level-security). */
  pgPolicy('event_outbox_event_processor_access', {
    as: 'permissive',
    for: 'all',
    to: appEventProcessor,
    using: sql`true`,
    withCheck: sql`true`,
  }),
]).enableRLS();
