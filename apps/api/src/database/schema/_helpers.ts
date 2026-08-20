import { sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Shared column builders for the conventions fixed in
 * docs/architecture/database.md#conventions — kept in one place so every table applies them
 * identically instead of re-typing the same DEFAULT/NOT NULL shape 45 times.
 */

/** UUIDv7, generated in application code (ADR-0016). gen_random_uuid() is only a fallback
 * default for a manual/administrative INSERT that forgets to supply an id — see ADR-0016. */
export function id() {
  return uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
}

/** Every tenant-owned table's tenant_id — see database.md#the-tenant_id-policy. Never nullable
 * except on the two documented mixed-scope tables (audit_log, event_outbox), which declare it
 * without this helper. */
export function tenantId() {
  return uuid('tenant_id').notNull();
}

export function createdAt() {
  return timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
}

/** Kept current by the shared set_updated_at() trigger (see migration 0000), not application
 * code — see database.md#timestamps. */
export function updatedAt() {
  return timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
}

/** Only present on tables listed in database.md#soft-delete-policy. Set explicitly by
 * application code, never trigger-set. */
export function deletedAt() {
  return timestamp('deleted_at', { withTimezone: true });
}
