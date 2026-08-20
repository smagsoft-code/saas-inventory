import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateLocationDto } from './dto/create-location.dto';
import { ListLocationsQueryDto } from './dto/list-locations-query.dto';
import { LocationResponseDto } from './dto/location-response.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationsService } from './locations.service';

/**
 * Locations within the caller's own tenant only. Every route runs the full guard chain
 * (JwtAuthGuard -> TenantGuard -> CsrfGuard -> PermissionsGuard) — `tenantId` always comes from
 * CurrentTenant, never from client input. No DELETE route — deactivation is a status update
 * (PATCH), same posture as catalog/categories/categories.controller.ts. The RBAC+location-scoped
 * authorization guard (ADR-0024) that gates *operating on* a location's stock is FASE-8 work, not
 * built here — this controller only manages the location tree itself.
 */
@ApiTags('locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Get()
  @RequirePermissions('locations.view')
  @ApiOkResponse({ type: LocationResponseDto, isArray: true })
  async list(
    @CurrentTenant() tenantId: string,
    @Query() query: ListLocationsQueryDto,
  ): Promise<PaginatedResult<LocationResponseDto>> {
    return this.locationsService.list(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('locations.view')
  @ApiOkResponse({ type: LocationResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<LocationResponseDto> {
    return this.locationsService.getById(tenantId, id);
  }

  @Post()
  @RequirePermissions('locations.manage')
  @ApiCreatedResponse({ type: LocationResponseDto })
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateLocationDto,
    @Req() request: FastifyRequest,
  ): Promise<LocationResponseDto> {
    return this.locationsService.create(tenantId, principal.userId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }

  @Patch(':id')
  @RequirePermissions('locations.manage')
  @ApiOkResponse({ type: LocationResponseDto })
  async update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Param('id') id: string,
    @Body() dto: UpdateLocationDto,
    @Req() request: FastifyRequest,
  ): Promise<LocationResponseDto> {
    return this.locationsService.update(tenantId, principal.userId, id, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
