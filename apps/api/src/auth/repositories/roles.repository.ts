import { generateId } from '@saas-inventory/shared';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { rolePermissions, roles, userRoles } from '../../database/schema';
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

  /** §17/§23 read surface — lists the tenant's roles with their current permission grants, for
   * populating a role-assignment control. No role/permission CRUD here — out of this phase's scope. */
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
}
