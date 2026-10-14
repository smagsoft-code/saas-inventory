import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ReturnsSummaryQueryDto } from './dto/returns-summary-query.dto';
import { ReturnsSummaryResponseDto } from './dto/returns-summary-response.dto';
import { ReturnsReportService } from './returns-report.service';

/**
 * FASE 18 read-side (F18-04, `GAP-RETURN-AGGREGATE`). `sales.returns.view` is reused as-is —
 * `metrics.md`'s own `RET-BY-DISPOSITION`/`RET-VALUE` rows already name this exact permission; no
 * `reports.*`/`analytics.*` family (F18-01's ratified decision). `order_items.unit_price_snapshot`
 * (the actual sale price) is not gated by `pricing.floor.view` — that permission only controls
 * `min_price`/`max_price` floor visibility (ADR-0028) — so no second permission is needed to expose
 * `returnedValue`.
 *
 * Scope is **tenant-wide** — `GET /sales-returns` is not location-scoped either
 * (`LocationAuthorizationService` only ever gates a *write* action: inspect/resolve, never a read),
 * so this report reuses that same real policy rather than inventing per-report location scoping.
 */
@ApiTags('reports')
@Controller('reports')
export class ReturnsReportController {
  constructor(private readonly returnsReportService: ReturnsReportService) {}

  @Get('returns-summary')
  @RequirePermissions('sales.returns.view')
  @ApiOkResponse({ type: ReturnsSummaryResponseDto })
  async returnsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ReturnsSummaryQueryDto,
  ): Promise<ReturnsSummaryResponseDto> {
    return this.returnsReportService.getReturnsSummary(tenantId, principal.userId, query);
  }
}
