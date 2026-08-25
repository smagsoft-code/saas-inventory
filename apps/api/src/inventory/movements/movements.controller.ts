import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../../common/context/request-context';
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
  async list(@CurrentTenant() tenantId: string, @Query() query: ListMovementsQueryDto): Promise<PaginatedResult<MovementResponseDto>> {
    return this.movementsService.list(tenantId, query);
  }

  @Post('adjustments')
  @RequirePermissions('inventory.adjust')
  @ApiCreatedResponse({ type: MovementResponseDto })
  async createAdjustment(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Body() dto: CreateAdjustmentDto,
    @Req() request: FastifyRequest,
  ): Promise<MovementResponseDto> {
    return this.movementsService.createAdjustment(tenantId, principal.userId, dto, {
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
  }
}
