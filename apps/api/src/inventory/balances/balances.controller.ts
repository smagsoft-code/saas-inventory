import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BalancesService } from './balances.service';
import { BalanceResponseDto } from './dto/balance-response.dto';
import { ListBalancesQueryDto } from './dto/list-balances-query.dto';

/**
 * Read-only inventory balances within the caller's own tenant only — `tenantId` always comes from
 * CurrentTenant, never client input. No write route here: every stock-affecting operation lives
 * under /inventory/adjustments or /inventory/transfers, each with its own auditable movement.
 */
@ApiTags('inventory-balances')
@Controller('inventory/balances')
export class BalancesController {
  constructor(private readonly balancesService: BalancesService) {}

  @Get()
  @RequirePermissions('inventory.view')
  @ApiOkResponse({ type: BalanceResponseDto, isArray: true })
  async list(@CurrentTenant() tenantId: string, @Query() query: ListBalancesQueryDto): Promise<PaginatedResult<BalanceResponseDto>> {
    return this.balancesService.list(tenantId, query);
  }

  @Get(':id')
  @RequirePermissions('inventory.view')
  @ApiOkResponse({ type: BalanceResponseDto })
  async getById(@CurrentTenant() tenantId: string, @Param('id') id: string): Promise<BalanceResponseDto> {
    return this.balancesService.getById(tenantId, id);
  }
}
