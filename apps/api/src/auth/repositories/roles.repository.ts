import { generateId } from '@saas-inventory/shared';
import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import { permissions, rolePermissions, roles, userRoles } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { loadEffectivePermissions } from '../../common/permissions/load-effective-permissions';

export interface RoleTemplate {
  name: string;
  description: string;
  permissionCodes: string[];
}

export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystemDefault: boolean;
}

export interface RoleWithPermissions extends RoleRow {
  permissionCodes: string[];
}

export interface PermissionCatalogRow {
  code: string;
  module: string;
  description: string;
}

/**
 * Tenant-scoped RBAC writes/reads used by registration provisioning (ADR-0009's fixed-catalog,
 * tenant-toggleable-assignment model). Every method takes the caller's already-open tenant
 * transaction, same convention as UsersRepository.
 */
@Injectable()
export class RolesRepository {
  /** Copies the fixed role template set into a newly-created tenant's roles/role_permissions —
   * database.md#rbac-roles-permissions. Returns the new role ids by name, for assigning the
   * provisioning user their initial role. */
  async provisionTemplates(
    tx: TenantTransaction,
    tenantId: string,
    templates: RoleTemplate[],
  ): Promise<Map<string, string>> {
    const roleIdByName = new Map<string, string>();
    for (const template of templates) {
      const roleId = generateId();
      roleIdByName.set(template.name, roleId);
      await tx.insert(roles).values({
        id: roleId,
        tenantId,
        name: template.name,
        description: template.description,
        isSystemDefault: true,
      });
      if (template.permissionCodes.length > 0) {
        await tx.insert(rolePermissions).values(
          template.permissionCodes.map((permissionCode) => ({ tenantId, roleId, permissionCode })),
        );
      }
    }
    return roleIdByName;
  }

  async assignRole(tx: TenantTransaction, tenantId: string, userId: string, roleId: string): Promise<void> {
    await tx.insert(userRoles).values({ tenantId, userId, roleId });
  }

  async findRoleIdByName(tx: TenantTransaction, tenantId: string, name: string): Promise<string | undefined> {
    const [row] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.name, name)));
    return row?.id;
  }

  async effectivePermissionsForUser(tx: TenantTransaction, userId: string): Promise<string[]> {
    return loadEffectivePermissions(tx, userId);
  }

  /** Tenant-scoped lookup by id — the load-bearing check that stops a client-supplied `roleId`
   * from ever crossing into another tenant's role (multi-tenancy.md): the WHERE clause filters on
   * tenantId explicitly, so a foreign-tenant roleId simply resolves to undefined. */
  async findById(tx: TenantTransaction, tenantId: string, roleId: string): Promise<RoleRow | undefined> {
    const [row] = await tx
      .select({ id: roles.id, name: roles.name, description: roles.description, isSystemDefault: roles.isSystemDefault })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId), isNull(roles.deletedAt)));
    return row;
  }

  /** Same tenant-scoped lookup as `findById`, plus its current permission grants — used wherever a
   * caller needs one role's full state (e.g. before/after audit snapshots in RolesService). */
  async findByIdWithPermissions(tx: TenantTransaction, tenantId: string, roleId: string): Promise<RoleWithPermissions | undefined> {
    const role = await this.findById(tx, tenantId, roleId);
    if (!role) {
      return undefined;
    }
    const permissionRows = await tx
      .select({ code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleId, roleId)));
    return { ...role, permissionCodes: permissionRows.map((row) => row.code) };
  }

  /** §17/§23 read surface — lists the tenant's roles with their current permission grants, for
   * populating a role-assignment control, plus the roles list screen. */
  async listByTenant(tx: TenantTransaction, tenantId: string): Promise<RoleWithPermissions[]> {
    const roleRows = await tx
      .select({ id: roles.id, name: roles.name, description: roles.description, isSystemDefault: roles.isSystemDefault })
      .from(roles)
      .where(and(eq(roles.tenantId, tenantId), isNull(roles.deletedAt)))
      .orderBy(roles.name);

    const permissionRows = await tx
      .select({ roleId: rolePermissions.roleId, code: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(eq(rolePermissions.tenantId, tenantId));

    const permissionsByRole = new Map<string, string[]>();
    for (const permissionRow of permissionRows) {
      const existing = permissionsByRole.get(permissionRow.roleId) ?? [];
      existing.push(permissionRow.code);
      permissionsByRole.set(permissionRow.roleId, existing);
    }

    return roleRows.map((role) => ({ ...role, permissionCodes: permissionsByRole.get(role.id) ?? [] }));
  }

  /** Names of every role currently assigned to each of the given users, batched to avoid N+1
   * (one query for a whole listing page, not one per row). */
  async roleNamesForUsers(
    tx: TenantTransaction,
    tenantId: string,
    userIds: string[],
  ): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (userIds.length === 0) {
      return result;
    }
    const rows = await tx
      .select({ userId: userRoles.userId, roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.tenantId, tenantId)))
      .where(and(eq(userRoles.tenantId, tenantId), inArray(userRoles.userId, userIds)));
    for (const row of rows) {
      const existing = result.get(row.userId) ?? [];
      existing.push(row.roleName);
      result.set(row.userId, existing);
    }
    return result;
  }

  /** Replaces a user's role assignment with exactly one role — the single-role-per-user
   * convention already established by tenant-provisioning.service.ts (registration assigns
   * exactly one role). The join table supports many-to-many, but no part of this system's UX
   * assigns more than one role to a user, so this method doesn't invent that surface. Hard-deletes
   * the prior assignment row(s), per database.md's "both join tables are hard-deleted on
   * unassignment" policy — the audit_log entry the caller writes is the durable record of the
   * change, not a tombstone row here. */
  async setUserRole(
    tx: TenantTransaction,
    tenantId: string,
    userId: string,
    roleId: string,
    assignedBy: string,
  ): Promise<void> {
    await tx.delete(userRoles).where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, userId)));
    await tx.insert(userRoles).values({ tenantId, userId, roleId, assignedBy });
  }

  /** ROLES/PERMISSIONS block — custom role CRUD (`GAP-ROLE-CRUD`, closed). Creates a tenant-owned
   * custom role; `isSystemDefault` is always `false` here — only `provisionTemplates` (tenant
   * provisioning) ever sets it `true`. */
  async create(
    tx: TenantTransaction,
    values: { id: string; tenantId: string; name: string; description: string | undefined },
  ): Promise<RoleRow> {
    const [row] = await tx
      .insert(roles)
      .values({ ...values, isSystemDefault: false })
      .returning({ id: roles.id, name: roles.name, description: roles.description, isSystemDefault: roles.isSystemDefault });
    if (!row) {
      throw new Error('Role insert did not return a row.');
    }
    return row;
  }

  /** Updates name/description only — never `isSystemDefault` (a label set once at provisioning,
   * per database.md#rbac-roles-permissions) and never the permission set (that is
   * `replacePermissions`, gated by its own ADR-0034 self-escalation check, kept as a separate
   * method/endpoint so this one is always safe to call on the caller's own role). */
  async updateProfile(
    tx: TenantTransaction,
    tenantId: string,
    roleId: string,
    values: { name?: string; description?: string },
  ): Promise<RoleRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findById(tx, tenantId, roleId);
    }
    const [row] = await tx
      .update(roles)
      .set(values)
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId), isNull(roles.deletedAt)))
      .returning({ id: roles.id, name: roles.name, description: roles.description, isSystemDefault: roles.isSystemDefault });
    return row;
  }

  async softDelete(tx: TenantTransaction, tenantId: string, roleId: string): Promise<void> {
    await tx
      .update(roles)
      .set({ deletedAt: new Date() })
      .where(and(eq(roles.tenantId, tenantId), eq(roles.id, roleId)));
  }

  /** How many of the tenant's users currently hold this role — the delete-guard ("reassign your
   * users before removing a role") and, as a side effect, the same check that stops a role
   * currently held by the caller from being deleted out from under them. */
  async countUsersAssigned(tx: TenantTransaction, tenantId: string, roleId: string): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(userRoles)
      .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.roleId, roleId)));
    return row?.total ?? 0;
  }

  /** Role ids currently assigned to one user — ADR-0034's self-escalation check reads this live,
   * at the moment of the permission-replace call, rather than trusting anything cached on the
   * caller's token. */
  async roleIdsForUser(tx: TenantTransaction, tenantId: string, userId: string): Promise<string[]> {
    const rows = await tx
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, userId)));
    return rows.map((row) => row.roleId);
  }

  /** The full platform-wide permission catalog (`permissions` — no tenant_id, no RLS, readable by
   * every role per database.md#rbac-roles-permissions) — backs the role-editor's "group by module"
   * permission picker. Never tenant-filtered; there is nothing tenant-specific to filter. */
  async listCatalog(tx: TenantTransaction): Promise<PermissionCatalogRow[]> {
    return await tx
      .select({ code: permissions.code, module: permissions.module, description: permissions.description })
      .from(permissions)
      .orderBy(permissions.module, permissions.code);
  }

  /** Every code in `codes` that does NOT exist in the platform-wide `permissions` catalog — used
   * to reject an unknown code with a clear 400 before attempting the insert, rather than relying on
   * `role_permissions.permission_code`'s plain FK to surface as a raw 23503 constraint violation. */
  async findUnknownPermissionCodes(tx: TenantTransaction, codes: string[]): Promise<string[]> {
    if (codes.length === 0) {
      return [];
    }
    const rows = await tx.select({ code: permissions.code }).from(permissions).where(inArray(permissions.code, codes));
    const known = new Set(rows.map((row) => row.code));
    return codes.filter((code) => !known.has(code));
  }

  /** Replaces a role's entire permission set — delete-then-insert, same shape as `setUserRole`,
   * since `role_permissions` is a plain join table with no history requirement (database.md: "both
   * join tables are hard-deleted on unassignment"). Caller (`RolesService.setPermissions`) is
   * responsible for the ADR-0034 self-escalation check and for validating codes beforehand via
   * `findUnknownPermissionCodes` — this method trusts its input. */
  async replacePermissions(tx: TenantTransaction, tenantId: string, roleId: string, codes: string[]): Promise<void> {
    await tx.delete(rolePermissions).where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.roleId, roleId)));
    if (codes.length > 0) {
      await tx.insert(rolePermissions).values(codes.map((permissionCode) => ({ tenantId, roleId, permissionCode })));
    }
  }
}
