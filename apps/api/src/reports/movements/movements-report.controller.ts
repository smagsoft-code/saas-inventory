import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MovementsSummaryQueryDto } from './dto/movements-summary-query.dto';
import { MovementsSummaryResponseDto } from './dto/movements-summary-response.dto';
import { MovementsReportService } from './movements-report.service';

/**
 * FASE 18 read-side (F18-07). Reuses `inventory.view` as-is — F18-01's ratified decision: no
 * `reports.*`/`analytics.*` permission family, a report gates on the `*.view` permission of the
 * domain it reports on, exactly like `GET /inventory/movements`, `GET /reports/inventory-summary`
 * and `metrics.md`'s `KPI-INV-MOVEMENTS` / `MOV-*` rows already name.
 *
 * Scope is **tenant-wide** — matching the real, current behaviour of `GET /inventory/movements`
 * and `GET /reports/inventory-summary` (neither is restricted by `user_location_assignments`;
 * ADR-0024's guard only ever gates a write-path *action*, never a read). See
 * `MovementsSummaryQueryDto`'s header comment for the full reasoning trail.
 */
@ApiTags('reports')
@Controller('reports')
export class MovementsReportController {
  constructor(private readonly movementsReportService: MovementsReportService) {}

  @Get('movements-summary')
  @RequirePermissions('inventory.view')
  @ApiOkResponse({ type: MovementsSummaryResponseDto })
  async movementsSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: MovementsSummaryQueryDto,
  ): Promise<MovementsSummaryResponseDto> {
    return this.movementsReportService.getMovementsSummary(tenantId, query);
  }
}
