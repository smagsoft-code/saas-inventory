import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { AuthPrincipal } from '../../common/context/request-context';
import { TenantSettingsResponseDto } from '../dto/tenant-settings-response.dto';
import { UpdateTenantSettingsDto } from '../dto/update-tenant-settings.dto';
import { TenantSettingsService } from './tenant-settings.service';

/**
 * modules.md#administration — tenant-level configuration only (business hours, timezone). The
 * caller's own tenant, always: `tenantId` comes from CurrentTenant (TenantGuard-resolved), never
 * from a route/query/body parameter, same posture as core/tenant/tenant.controller.ts.
 */
@ApiTags('administration')
@Controller('administration/tenant-settings')
export class TenantSettingsController {
  constructor(private readonly tenantSettingsService: TenantSettingsService) {}

  @Get()
  @RequirePermissions('administration.settings.view')
  @ApiOkResponse({ type: TenantSettingsResponseDto })
  async getEffective(@CurrentTenant() tenantId: string): Promise<TenantSettingsResponseDto> {
    return this.tenantSettingsService.getEffective(tenantId);
  }

  @Patch()
  @RequirePermissions('administration.settings.manage')
  @ApiOkResponse({ type: TenantSettingsResponseDto })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: UpdateTenantSettingsDto,
    @Req() request: FastifyRequest,
  ): Promise<TenantSettingsResponseDto> {
    return this.tenantSettingsService.update(tenantId, dto, {
      actorId: principal.userId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
