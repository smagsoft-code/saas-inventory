import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthPrincipal } from '../../common/context/request-context';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ApprovalsSummaryQueryDto } from './dto/approvals-summary-query.dto';
import { ApprovalsSummaryResponseDto } from './dto/approvals-summary-response.dto';
import { ApprovalsReportService } from './approvals-report.service';

/**
 * FASE 18 read-side (F18-05, `metrics.md` `APPR-RATE` / `APPR-DISCOUNT-VALUE`). No `reports.*` /
 * `analytics.*` permission family (F18-01's ratified decision).
 *
 * **Permission — `pricing.discount.approve`.** `price_approvals` is the one SALES sub-domain with
 * no `*.view` code: the operational `GET /price-approvals` queue uses
 * `@RequireAnyPermission('pricing.discount.request', 'pricing.discount.approve')` (F17-09, closing
 * `GAP-APPROVALS-PERMISSION`) because a *requester* must be able to track their own submissions.
 * This report is a different thing — a tenant-wide **pricing-governance aggregate** (approval rate
 * over time, approved discount value), an approver/supervisor concern, not a "my requests" view —
 * so it reuses the narrower gate that `metrics.md`'s `APPR-RATE` / `APPR-DISCOUNT-VALUE` rows
 * already name: `pricing.discount.approve` (held by Administrador + Supervisor). No new permission.
 *
 * Scope is **tenant-wide** — `price_approvals` has no location dimension (only `order_id` /
 * `order_item_id`), and `GAP-ORDERS-LOCATION` is an open decision this endpoint does not resolve.
 *
 * `discount_amount` is computed at request time against `max_price`, never `min_price`
 * (`PriceApprovalsService`), so `Σ discount_amount` here never leaks the floor — no
 * `pricing.floor.view` gate is needed and `min_price_at_request` is never surfaced by this report.
 */
@ApiTags('reports')
@Controller('reports')
export class ApprovalsReportController {
  constructor(private readonly approvalsReportService: ApprovalsReportService) {}

  @Get('approvals-summary')
  @RequirePermissions('pricing.discount.approve')
  @ApiOkResponse({ type: ApprovalsSummaryResponseDto })
  async approvalsSummary(
    @CurrentTenant() tenantId: string,
    @CurrentUser() principal: AuthPrincipal,
    @Query() query: ApprovalsSummaryQueryDto,
  ): Promise<ApprovalsSummaryResponseDto> {
    return this.approvalsReportService.getApprovalsSummary(tenantId, principal.userId, query);
  }
}
