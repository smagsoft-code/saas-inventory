import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { ListMovementsQueryDto } from './dto/list-movements-query.dto';
import { MovementResponseDto } from './dto/movement-response.dto';
import { MovementsService } from './movements.service';

/**
 * The inventory_movements ledger (read) and manual adjustments (write) within the caller's own
 * tenant only. `tenantId` always comes from CurrentTenant, never client input. Adjustment writes
 * additionally require location authorization (ADR-0024), checked in the service once the target
 * location is resolved.
 */
@ApiTags('inventory-movements')
@Controller('inventory')
export class MovementsController {
  constructor(private readonly movementsService: MovementsService) {}

  @Get('movements')
  @RequirePermissions('inventory.view')
  @ApiOkResponse({ type: MovementResponseDto, isArray: true })
  async list(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ListMovementsQueryDto,
    @CurrentPermissions() permissions: string[],
  ): Promise<PaginatedResult<MovementResponseDto>> {
    // unitCost is field-gated on pricing.cost.view (ADR-0028's precedent), same as
    // reports/inventory's totalCostValue — a caller with only inventory.view still gets every
    // other field.
    const canViewCost = permissions.includes('pricing.cost.view');
    return this.movementsService.list(tenantId, principal.userId, permissions, query, canViewCost);
  }

  @Post('adjustments')
  @RequirePermissions('inventory.adjust')
  @ApiCreatedResponse({ type: MovementResponseDto })
  async createAdjustment(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateAdjustmentDto,
    @Req() request: FastifyRequest,
    @CurrentPermissions() permissions: string[],
  ): Promise<MovementResponseDto> {
    const canViewCost = permissions.includes('pricing.cost.view');
    return this.movementsService.createAdjustment(
      tenantId,
      principal.userId,
      dto,
      { correlationId: request.correlationId, ipAddress: request.ip },
      canViewCost,
    );
  }
}
