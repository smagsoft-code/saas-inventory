import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { ListWarehousesQueryDto } from './dto/list-warehouses-query.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { WarehouseResponseDto } from './dto/warehouse-response.dto';
import { WarehousesService } from './warehouses.service';

/**
 * Warehouses within the caller's own tenant only. Every route runs the full guard chain
 * (JwtAuthGuard -> TenantGuard -> CsrfGuard -> PermissionsGuard) — `tenantId` always comes from
 * CurrentTenant, never from client input. No DELETE route — deactivation is a status update
 * (PATCH), same posture as catalog/categories/categories.controller.ts.
 */
@ApiTags('warehouses')
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehousesService: WarehousesService) {}

  @Get()
  @RequirePermissions('warehouses.view')
  @ApiOkResponse({ type: WarehouseResponseDto, isArray: true })
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListWarehousesQueryDto,
  ): Promise<PaginatedResult<WarehouseResponseDto>> {
    return this.warehousesService.list(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('warehouses.view')
  @ApiOkResponse({ type: WarehouseResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<WarehouseResponseDto> {
    return this.warehousesService.getById(tenantId, id);
  }

  @Post()
  @RequirePermissions('warehouses.manage')
  @ApiCreatedResponse({ type: WarehouseResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateWarehouseDto,
    @Req() request: FastifyRequest,
  ): Promise<WarehouseResponseDto> {
    return this.warehousesService.create(tenantId, principal.userId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Patch(':id')
  @RequirePermissions('warehouses.manage')
  @ApiOkResponse({ type: WarehouseResponseDto })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
    @Req() request: FastifyRequest,
  ): Promise<WarehouseResponseDto> {
    return this.warehousesService.update(tenantId, principal.userId, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
