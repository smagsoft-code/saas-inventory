import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { SalesSummaryQueryDto } from './dto/sales-summary-query.dto';
import { SalesSummaryResponseDto } from './dto/sales-summary-response.dto';
import { SalesReportService } from './sales-report.service';

/**
 * FASE 18 read-side (F18-02). `sales.orders.view` is reused as-is — F18-01's ratified decision
 * (`docs/architecture/reporting/filters-periods-and-scope.md#4-permission-catalogue-41-codes`): no
 * `reports.*`/`analytics.*` permission family. Scope is **tenant-wide** — `GAP-ORDERS-LOCATION`
 * (order visibility is not location-scoped anywhere in SALES) is an open decision this endpoint
 * does not resolve; there is no `location` groupBy and no location filter.
 */
@ApiTags('reports')
@Controller('reports')
export class SalesReportController {
  constructor(private readonly salesReportService: SalesReportService) {}

  @Get('sales-summary')
  @RequirePermissions('sales.orders.view')
  @ApiOkResponse({ type: SalesSummaryResponseDto })
  async salesSummary(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: SalesSummaryQueryDto,
  ): Promise<SalesSummaryResponseDto> {
    return this.salesReportService.getSalesSummary(tenantId, principal.userId, query);
  }
}
