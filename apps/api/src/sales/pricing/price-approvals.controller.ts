import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal, TenantRequestContext } from '../../common/context/request-context';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../common/decorators/require-any-permission.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreatePriceApprovalDto } from './dto/create-price-approval.dto';
import { ListPriceApprovalsQueryDto } from './dto/list-price-approvals-query.dto';
import { PriceApprovalResponseDto } from './dto/price-approval-response.dto';
import { ResolvePriceApprovalDto } from './dto/resolve-price-approval.dto';
import { PriceApprovalsService } from './price-approvals.service';

/**
 * Exceptional-discount approvals within the caller's own tenant only (§55, §90). State changes go
 * through explicit command routes (`/approve`, `/reject`), never `PATCH { status }` (§54). Listing
 * and reading require either `pricing.discount.request` or `pricing.discount.approve` —
 * `@RequireAnyPermission` declares that at the route (F17-09, closing `GAP-APPROVALS-PERMISSION`);
 * the service keeps the equivalent check as defense in depth. `pricing.floor.view`
 * (CurrentPermissions) controls whether the frozen `minPriceAtRequest` appears in the response
 * (ADR-0028, §45).
 */
@ApiTags('sales-price-approvals')
@Controller('price-approvals')
export class PriceApprovalsController {
  constructor(private readonly priceApprovalsService: PriceApprovalsService) {}

  @Get()
  @RequireAnyPermission('pricing.discount.request', 'pricing.discount.approve')
  @ApiOkResponse({ type: PriceApprovalResponseDto, isArray: true })
  async list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Query() query: ListPriceApprovalsQueryDto,
  ): Promise<PaginatedResult<PriceApprovalResponseDto>> {
    return this.priceApprovalsService.list(tenantId, principal.userId, permissions, query);
  }

  @Get(':id')
  @RequireAnyPermission('pricing.discount.request', 'pricing.discount.approve')
  @ApiOkResponse({ type: PriceApprovalResponseDto })
  async getById(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PriceApprovalResponseDto> {
    return this.priceApprovalsService.getById(tenantId, principal.userId, permissions, id);
  }

  @Post()
  @RequirePermissions('pricing.discount.request')
  @ApiCreatedResponse({ type: PriceApprovalResponseDto })
  async request(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Body() dto: CreatePriceApprovalDto,
    @Req() request: FastifyRequest,
  ): Promise<PriceApprovalResponseDto> {
    return this.priceApprovalsService.request(tenantId, principal.userId, permissions, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('pricing.discount.approve')
  @ApiOkResponse({ type: PriceApprovalResponseDto })
  async approve(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolvePriceApprovalDto,
    @Req() request: FastifyRequest,
  ): Promise<PriceApprovalResponseDto> {
    return this.priceApprovalsService.approve(
      tenantId,
      principal.userId,
      permissions,
      id,
      { correlationId: request.correlationId, ipAddress: request.ip },
      dto.price,
    );
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('pricing.discount.approve')
  @ApiOkResponse({ type: PriceApprovalResponseDto })
  async reject(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @CurrentPermissions() permissions: TenantRequestContext['permissions'],
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest,
  ): Promise<PriceApprovalResponseDto> {
    return this.priceApprovalsService.reject(tenantId, principal.userId, permissions, id, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
