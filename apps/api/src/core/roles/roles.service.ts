import { Injectable } from '@nestjs/common';
import { RolesRepository } from '../../auth/repositories/roles.repository';
import { withTenantTransaction } from '../../database/tenant-context';
import type { RoleResponseDto } from './dto/role-response.dto';

@Injectable()
export class RolesService {
  constructor(private readonly rolesRepository: RolesRepository) {}

  async list(tenantId: string): Promise<RoleResponseDto[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const roles = await this.rolesRepository.listByTenant(tx, tenantId);
      return roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description ?? undefined,
        isSystemDefault: role.isSystemDefault,
        permissionCodes: role.permissionCodes,
      }));
    });
  }
}
