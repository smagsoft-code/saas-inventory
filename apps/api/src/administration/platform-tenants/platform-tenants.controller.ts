import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentPlatformAdmin } from '../../common/decorators/current-platform-admin.decorator';
import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import type { PlatformPrincipal } from '../../common/context/request-context';
import type { TenantRow } from '../../auth/repositories/tenants-platform.repository';
import { PlatformTenantResponseDto } from '../dto/platform-tenant-response.dto';
import { PlatformTenantsService } from './platform-tenants.service';

function toResponse(tenant: TenantRow): PlatformTenantResponseDto {
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
 * SuperAdmin-only (multi-tenancy.md#superadmin-vs-tenant) — every route is @PlatformOnly(),
 * TenantGuard-enforced (common/guards/tenant.guard.ts), never gated by the tenant RBAC
 * PermissionsGuard (§13: there is no tenant permission catalog entry for these routes, by design —
 * a tenant Administrador role can never be configured into platform access). `:tenantId` is a
 * genuine path parameter here (unlike every tenant-scoped controller in this codebase) because the
 * caller has no tenant of its own to scope to — this is the one controller in the API where that is
 * the correct, narrow exception, per multi-tenancy.md#administrative--cross-tenant-queries.
 */
@ApiTags('platform-administration')
@Controller('platform/tenants')
@PlatformOnly()
export class PlatformTenantsController {
  constructor(private readonly platformTenantsService: PlatformTenantsService) {}

  @Get()
  @ApiOkResponse({ type: PlatformTenantResponseDto, isArray: true })
  async list(): Promise<PlatformTenantResponseDto[]> {
    const tenants = await this.platformTenantsService.list();
    return tenants.map(toResponse);
  }

  @Get(':tenantId')
  @ApiOkResponse({ type: PlatformTenantResponseDto })
  async getById(@Param('tenantId') tenantId: string): Promise<PlatformTenantResponseDto> {
    return toResponse(await this.platformTenantsService.getById(tenantId));
  }

  @Post(':tenantId/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlatformTenantResponseDto })
  async suspend(
    @Param('tenantId') tenantId: string,
    @CurrentPlatformAdmin() principal: PlatformPrincipal,
    @Req() request: FastifyRequest,
  ): Promise<PlatformTenantResponseDto> {
    const tenant = await this.platformTenantsService.suspend(tenantId, {
      actorId: principal.adminId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
    return toResponse(tenant);
  }

  @Post(':tenantId/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlatformTenantResponseDto })
  async activate(
    @Param('tenantId') tenantId: string,
    @CurrentPlatformAdmin() principal: PlatformPrincipal,
    @Req() request: FastifyRequest,
  ): Promise<PlatformTenantResponseDto> {
    const tenant = await this.platformTenantsService.activate(tenantId, {
      actorId: principal.adminId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
    return toResponse(tenant);
  }
}
