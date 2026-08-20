import { generateId } from '@saas-inventory/shared';
import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { rolePermissions, roles, userRoles } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { loadEffectivePermissions } from '../../common/permissions/load-effective-permissions';

export interface RoleTemplate {
  name: string;
  description: string;
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
}
