import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentPermissions } from '../../common/decorators/current-permissions.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { InventorySummaryQueryDto } from './dto/inventory-summary-query.dto';
import { InventorySummaryResponseDto } from './dto/inventory-summary-response.dto';
import { InventoryReportService } from './inventory-report.service';

/**
 * FASE 18 read-side (F18-03). Reuses `inventory.view` as-is — F18-01's ratified decision
 * (`docs/architecture/reporting/filters-periods-and-scope.md#4-permission-catalogue`): no
 * `reports.*`/`analytics.*` permission family, a report gates on the `*.view` permission of the
 * domain it reports on, exactly like `GET /inventory/balances` and `GET /reports/sales-summary`.
 *
 * Scope is **tenant-wide** — matching the real, current behaviour of `GET /inventory/balances` and
 * `GET /inventory/movements` (neither is restricted by `user_location_assignments`; ADR-0024's
 * guard only ever gates a write-path *action*, never a read). See
 * `InventoryReportRepository`'s own header comment for the full reasoning trail.
 */
@ApiTags('reports')
@Controller('reports')
export class InventoryReportController {
  constructor(private readonly inventoryReportService: InventoryReportService) {}

  @Get('inventory-summary')
  @RequirePermissions('inventory.view')
  @ApiOkResponse({ type: InventorySummaryResponseDto })
  async inventorySummary(
    @CurrentTenant() tenantId: string,
    @Query() query: InventorySummaryQueryDto,
    @CurrentPermissions() permissions: string[],
  ): Promise<InventorySummaryResponseDto> {
    // OUI-002/S-HOME redesign — totals.totalCostValue/missingCostCount are field-gated on
    // pricing.cost.view (ADR-0028's existing precedent for cost), not on this route's own
    // @RequirePermissions — a caller with inventory.view but not pricing.cost.view still gets the
    // rest of the response, just without those two fields.
    const canViewCost = permissions.includes('pricing.cost.view');
    return this.inventoryReportService.getInventorySummary(tenantId, query, canViewCost);
  }
}
