import { Injectable } from '@nestjs/common';
import { RolesRepository } from '../../auth/repositories/roles.repository';
import { withTenantTransaction } from '../../database/tenant-context';
import type { PermissionCatalogItemDto } from './dto/permission-catalog-item.dto';

/** Read-only surface over the platform-wide `permissions` catalog — backs the ROLES/PERMISSIONS
 * block's role editor ("group by module" picker). The catalog itself is never tenant-specific;
 * `tenantId` is only here to open the same tenant transaction every other CORE call uses. */
@Injectable()
export class PermissionsService {
  constructor(private readonly rolesRepository: RolesRepository) {}

  async listCatalog(tenantId: string): Promise<PermissionCatalogItemDto[]> {
    return withTenantTransaction(tenantId, (tx) => this.rolesRepository.listCatalog(tx));
  }
}
