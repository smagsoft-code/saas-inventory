import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PermissionCatalogItemDto } from './dto/permission-catalog-item.dto';
import { PermissionsService } from './permissions.service';

/** `GET /permissions` — the full platform-wide catalog (code/module/description), gated by
 * `core.roles.read` (the same read-side permission that already gates `GET /roles` — reading the
 * catalog a role's `permissionCodes` reference is the same "view the roles domain" capability, not
 * a new one). Used by the role editor's permission picker; no tenant-scoped data is exposed here. */
@ApiTags('permissions')
@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @RequirePermissions('core.roles.read')
  @ApiOkResponse({ type: PermissionCatalogItemDto, isArray: true })
  async list(@CurrentTenant() tenantId: string): Promise<PermissionCatalogItemDto[]> {
    return this.permissionsService.listCatalog(tenantId);
  }
}
