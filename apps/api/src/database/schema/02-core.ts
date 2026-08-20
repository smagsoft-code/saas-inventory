import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  inet,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, tenantId, updatedAt } from './_helpers';
import { tenantIsolationPolicy } from './_policies';
import { permissions, tenants } from './01-platform';

/**
 * CORE — the identity/access substrate. database.md#core-tenants-users-platform-admins and
 * database.md#rbac-roles-permissions. Every table here is tenant-owned with RLS, except
 * `permissions` (platform-scoped, defined in 01-platform.ts) which role_permissions references.
 */

export const users = pgTable('users', {
  id: id(),
  tenantId: tenantId(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  status: text('status').notNull().default('invited'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  foreignKey({ name: 'users_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  unique('users_tenant_id_id_key').on(t.tenantId, t.id),
  unique('users_tenant_id_email_key').on(t.tenantId, t.email),
  check('users_status_check', sql`${t.status} IN ('invited', 'active', 'disabled')`),
  tenantIsolationPolicy('users'),
]).enableRLS();

export const roles = pgTable('roles', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  isSystemDefault: boolean('is_system_default').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  foreignKey({ name: 'roles_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  unique('roles_tenant_id_id_key').on(t.tenantId, t.id),
  unique('roles_tenant_id_name_key').on(t.tenantId, t.name),
  tenantIsolationPolicy('roles'),
]).enableRLS();

/** permission_code -> permissions(code) is a plain (non-composite) FK, the documented exception:
 * permissions is platform-scoped with no tenant_id to compose against — this is exactly the
 * mechanism that stops a tenant inventing a permission outside the fixed catalog. */
export const rolePermissions = pgTable('role_permissions', {
  tenantId: tenantId(),
  roleId: uuid('role_id').notNull(),
  permissionCode: text('permission_code').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'role_permissions_pk', columns: [t.roleId, t.permissionCode] }),
  foreignKey({
    name: 'role_permissions_role_fk',
    columns: [t.tenantId, t.roleId],
    foreignColumns: [roles.tenantId, roles.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'role_permissions_permission_fk',
    columns: [t.permissionCode],
    foreignColumns: [permissions.code],
  }).onDelete('restrict'),
  tenantIsolationPolicy('role_permissions'),
]).enableRLS();

export const userRoles = pgTable('user_roles', {
  tenantId: tenantId(),
  userId: uuid('user_id').notNull(),
  roleId: uuid('role_id').notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  /** Soft reference to users.id — the admin who assigned it. Not FK-constrained (a departed
   * admin must never block reading who assigned a role). */
  assignedBy: uuid('assigned_by'),
}, (t) => [
  primaryKey({ name: 'user_roles_pk', columns: [t.userId, t.roleId] }),
  foreignKey({
    name: 'user_roles_user_fk',
    columns: [t.tenantId, t.userId],
    foreignColumns: [users.tenantId, users.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'user_roles_role_fk',
    columns: [t.tenantId, t.roleId],
    foreignColumns: [roles.tenantId, roles.id],
  }).onDelete('restrict'),
  tenantIsolationPolicy('user_roles'),
]).enableRLS();

/** Append-only — never updated or deleted. tenant_id is nullable for platform/global actions
 * (SuperAdmin actions not scoped to one tenant) — see database.md's "mixed scope" note; the
 * standard tenant_isolation policy already fails closed for NULL rows with no special-casing. */
export const auditLog = pgTable('audit_log', {
  id: id(),
  tenantId: uuid('tenant_id'),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id'),
  actionCode: text('action_code').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  correlationId: uuid('correlation_id'),
  ipAddress: inet('ip_address'),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ name: 'audit_log_tenant_fk', columns: [t.tenantId], foreignColumns: [tenants.id] }).onDelete('restrict'),
  check('audit_log_actor_type_check', sql`${t.actorType} IN ('user', 'platform_admin', 'system')`),
  index('audit_log_tenant_entity_idx').on(t.tenantId, t.entityType, t.entityId),
  index('audit_log_tenant_created_at_idx').on(t.tenantId, t.createdAt),
  index('audit_log_action_code_created_at_idx').on(t.actionCode, t.createdAt),
  tenantIsolationPolicy('audit_log'),
]).enableRLS();
