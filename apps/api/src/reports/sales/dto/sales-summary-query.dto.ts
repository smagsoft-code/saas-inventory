import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ORDER_STATUSES } from '../../../sales/orders/dto/list-orders-query.dto';
import { ReportDateRangeQueryDto } from '../../../common/reporting/report-date-range.dto';

export const SALES_SUMMARY_GROUP_BY = ['day', 'week', 'month', 'product', 'customer'] as const;
export type SalesSummaryGroupBy = (typeof SALES_SUMMARY_GROUP_BY)[number];

/**
 * `GET /reports/sales-summary` (F18-02). Extends the F18-01 `ReportDateRangeQueryDto` as-is —
 * `from`/`to` stay typed `string | undefined` here (redeclaring them as required conflicts with
 * `useDefineForClassFields`, TS2612, without a meaningful initializer to give them). **This report
 * requires both** — a deliberate, conservative decision (F18-02 §7): the catalogue does not pin a
 * default period for this endpoint, and inventing one (a calendar-period default, or "all time")
 * would either need untested timezone math here or risk an unbounded aggregate query. Requiring
 * both avoids inventing either. Enforced by `SalesReportService.getSalesSummary` (400 when either
 * is missing), not by this DTO's type — the frontend still offers a sensible pre-filled default
 * (last 30 days) in the filter UI so a normal user never hits that 400.
 *
 * `groupBy` has no `location` value yet — `GAP-ORDERS-LOCATION` is still an open product decision
 * (F18-01), so `REP-SALES-BY-LOCATION` stays out of scope for this endpoint.
 *
 * `status` reuses the real `orders.status` enum (`ORDER_STATUSES`, not redefined). Default when
 * omitted is `'confirmed'` (applied in the service, not here) — `metrics.md`'s `SALES-REVENUE`
 * definition is explicitly "Σ orders.total where status='confirmed'"; every other status remains
 * selectable for an operator who wants a non-revenue view (e.g. "how much sits in pending orders").
 */
export class SalesSummaryQueryDto extends ReportDateRangeQueryDto {
  @ApiPropertyOptional({ enum: SALES_SUMMARY_GROUP_BY, default: 'day' })
  @IsOptional()
  @IsIn(SALES_SUMMARY_GROUP_BY)
  groupBy: SalesSummaryGroupBy = 'day';

  @ApiPropertyOptional({ enum: ORDER_STATUSES, default: 'confirmed' })
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: (typeof ORDER_STATUSES)[number];
}
