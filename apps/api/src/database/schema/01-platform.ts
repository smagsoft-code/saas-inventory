import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_helpers';

/**
 * Platform-scoped tables — database.md#core-tenants-users-platform-admins and
 * database.md#data-classification-platform-scoped-vs-tenant-scoped. No tenant_id, no RLS: access
 * is by role/GRANT (app_platform + app_migrator only for tenants/platform_admins; permissions is
 * readable by every role, writable only by app_migrator — see the migration's GRANT block).
 */

export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  status: text('status').notNull().default('active'),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique('tenants_slug_key').on(t.slug),
  check('tenants_status_check', sql`${t.status} IN ('active', 'suspended', 'archived')`),
]);

export const platformAdmins = pgTable('platform_admins', {
  id: id(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  unique('platform_admins_email_key').on(t.email),
  check('platform_admins_status_check', sql`${t.status} IN ('active', 'disabled')`),
]);

/** Migration-managed data (INSERT ... ON CONFLICT DO NOTHING), never tenant/seed data — see
 * database.md#rbac-roles-permissions and database.md#migration-strategy. */
export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
  module: text('module').notNull(),
  description: text('description').notNull(),
  createdAt: createdAt(),
});
