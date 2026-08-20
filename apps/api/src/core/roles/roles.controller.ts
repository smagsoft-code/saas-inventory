import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RoleResponseDto } from './dto/role-response.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('core.roles.read')
  @ApiOkResponse({ type: RoleResponseDto, isArray: true })
  async list(@CurrentTenant() tenantId: string): Promise<RoleResponseDto[]> {
    return this.rolesService.list(tenantId);
  }
}
