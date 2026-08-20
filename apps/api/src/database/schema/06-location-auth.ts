import { foreignKey, index, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantId } from './_helpers';
import { tenantIsolationPolicy } from './_policies';
import { users } from './02-core';
import { locations } from './05-inventory';

/**
 * Location-scoped authorization — database.md#location-scoped-authorization, ADR-0024. A
 * business-authorization control (which of a tenant's own locations a user may operate on), not
 * a tenant-isolation mechanism. Zero rows for a user = unrestricted; one or more = restricted to
 * exactly those locations (enforced by application provisioning convention, not a schema
 * constraint — see the doc section for why).
 */
export const userLocationAssignments = pgTable('user_location_assignments', {
  tenantId: tenantId(),
  userId: uuid('user_id').notNull(),
  locationId: uuid('location_id').notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  /** Soft reference to users.id — the admin who assigned it. */
  assignedBy: uuid('assigned_by'),
}, (t) => [
  primaryKey({ name: 'user_location_assignments_pk', columns: [t.userId, t.locationId] }),
  foreignKey({
    name: 'user_location_assignments_user_fk',
    columns: [t.tenantId, t.userId],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'user_location_assignments_location_fk',
    columns: [t.tenantId, t.locationId],
    foreignColumns: [locations.tenantId, locations.id],
  }).onDelete('restrict'),
  index('user_location_assignments_tenant_location_idx').on(t.tenantId, t.locationId),
  tenantIsolationPolicy('user_location_assignments'),
]).enableRLS();
