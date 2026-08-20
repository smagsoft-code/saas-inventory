import { Injectable } from '@nestjs/common';
import { DEFAULT_ROLE_TEMPLATES, generateId } from '@saas-inventory/shared';
import { withTenantTransaction } from '../../database/tenant-context';
import type { RolesRepository } from '../repositories/roles.repository';
import type { TenantsPlatformRepository } from '../repositories/tenants-platform.repository';
import type { UsersRepository } from '../repositories/users.repository';

export interface ProvisionTenantInput {
  companyName: string;
  adminEmail: string;
  adminPasswordHash: string;
  adminFullName: string;
}

export interface ProvisionedTenant {
  tenantId: string;
  tenantSlug: string;
  userId: string;
}

const ADMIN_ROLE_NAME = 'Administrador';

/**
 * Self-service registration = provisioning a brand-new tenant, per database/seeds/
 * default-role-templates.ts's own comment: "Whichever phase actually builds tenant provisioning
 * ... (FASE 4/7) owns refining it." Two phases, on two different Postgres roles/connections
 * (database.md#row-level-security), because they cannot share one transaction:
 *
 * 1. The `tenants` row itself — app_platform (no tenant context can exist for a tenant that
 *    doesn't exist yet; app_tenant has no GRANT on `tenants` at all).
 * 2. Everything tenant-owned (roles, role_permissions, users, user_roles) — app_tenant, inside
 *    the normal withTenantTransaction() path, now that the new tenant's id is known.
 *
 * If step 2 fails after step 1 succeeded, the orphaned tenant is marked 'suspended' (there is no
 * tenant hard-delete — database.md's soft-delete policy) rather than left 'active' with no user
 * able to log into it.
 */
@Injectable()
export class TenantProvisioningService {
  constructor(
    private readonly tenantsPlatformRepository: TenantsPlatformRepository,
    private readonly usersRepository: UsersRepository,
    private readonly rolesRepository: RolesRepository,
  ) {}

  async provision(input: ProvisionTenantInput): Promise<ProvisionedTenant> {
    const tenantId = generateId();
    const slug = await this.tenantsPlatformRepository.reserveSlug(input.companyName);
    await this.tenantsPlatformRepository.create({ id: tenantId, name: input.companyName, slug });

    try {
      const userId = await withTenantTransaction(tenantId, async (tx) => {
        const templates = Object.entries(DEFAULT_ROLE_TEMPLATES).map(([name, template]) => ({
          name,
          description: template.description,
          permissionCodes: template.permissionCodes,
        }));
        const roleIdByName = await this.rolesRepository.provisionTemplates(tx, tenantId, templates);

        const newUserId = generateId();
        await this.usersRepository.create(tx, {
          id: newUserId,
          tenantId,
          email: input.adminEmail,
          passwordHash: input.adminPasswordHash,
          fullName: input.adminFullName,
        });

        const adminRoleId = roleIdByName.get(ADMIN_ROLE_NAME);
        if (adminRoleId) {
          await this.rolesRepository.assignRole(tx, tenantId, newUserId, adminRoleId);
        }
        return newUserId;
      });
      return { tenantId, tenantSlug: slug, userId };
    } catch (error) {
      await this.tenantsPlatformRepository.markSuspended(tenantId).catch(() => undefined);
      throw error;
    }
  }
}
