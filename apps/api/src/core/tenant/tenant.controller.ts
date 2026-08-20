import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import type { AuthPrincipal } from '../../common/context/request-context';
import { TenantResponseDto } from './dto/tenant-response.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantService } from './tenant.service';

function toResponse(tenant: { id: string; name: string; slug: string; status: string; isDemo: boolean; createdAt: Date }): TenantResponseDto {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    isDemo: tenant.isDemo,
    createdAt: tenant.createdAt.toISOString(),
  };
}

/**
 * The caller's own tenant only — there is no "list tenants" or "look up another tenant" endpoint
 * here, by design (§7/multi-tenancy.md). `tenantId` always comes from CurrentTenant (the verified
 * token via TenantGuard), never from a route/query param.
 */
@ApiTags('tenant')
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get()
  @ApiOkResponse({ type: TenantResponseDto })
  async getCurrent(@CurrentTenant() tenantId: string): Promise<TenantResponseDto> {
    return toResponse(await this.tenantService.getCurrent(tenantId));
  }

  @Patch()
  @RequirePermissions('core.tenant.update')
  @ApiOkResponse({ type: TenantResponseDto })
  async updateCurrent(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: UpdateTenantDto,
    @Req() request: FastifyRequest,
  ): Promise<TenantResponseDto> {
    const updated = await this.tenantService.updateCurrent(tenantId, dto, {
      actorId: principal.userId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
    return toResponse(updated);
  }
}
