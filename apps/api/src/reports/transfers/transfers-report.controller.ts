import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TransfersSummaryQueryDto } from './dto/transfers-summary-query.dto';
import { TransfersSummaryResponseDto } from './dto/transfers-summary-response.dto';
import { TransfersReportService } from './transfers-report.service';

/**
 * FASE 18 read-side (F18-08 — "Transfer analytics"). Reuses `inventory.view` as-is — F18-01's
 * ratified decision: no `reports.*`/`analytics.*` permission family, a report gates on the `*.view`
 * permission of the domain it reports on, exactly like `GET /inventory/transfers`,
 * `GET /reports/inventory-summary` and `GET /reports/movements-summary`, and the exact permission
 * every `TRF-*` / `KPI-INV-INTRANSIT` row in `metrics.md` / `kpis.md` already names.
 *
 * Scope is **tenant-wide** — matching the real, current behaviour of `GET /inventory/transfers`
 * (never restricted by `user_location_assignments`; ADR-0024's guard only ever gates a write-path
 * *action*, never a read). See `TransfersSummaryQueryDto`'s header comment for the full reasoning
 * trail and the scope of what F18-08 deliberately does not build.
 */
@ApiTags('reports')
@Controller('reports')
export class TransfersReportController {
  constructor(private readonly transfersReportService: TransfersReportService) {}

  @Get('transfers-summary')
  @RequirePermissions('inventory.view')
  @ApiOkResponse({ type: TransfersSummaryResponseDto })
  async transfersSummary(
    @CurrentTenant() tenantId: string,
    @Query() query: TransfersSummaryQueryDto,
  ): Promise<TransfersSummaryResponseDto> {
    return this.transfersReportService.getTransfersSummary(tenantId, query);
  }
}
