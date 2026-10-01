import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ORDER_STATUSES } from '../../../sales/orders/dto/list-orders-query.dto';
import { ReportDateRangeQueryDto } from '../../../common/reporting/report-date-range.dto';

export const SALES_SUMMARY_GROUP_BY = ['day', 'week', 'month', 'product', 'customer'] as const;
export type SalesSummaryGroupBy = (typeof SALES_SUMMARY_GROUP_BY)[number];

/**
 * `exceptional` filter (F18-06, `GAP-EXCEPTIONAL-FILTER`). A **three-state** enum, not a boolean:
 * `all` (the default — every matching order/line, byte-for-byte the pre-F18-06 behaviour) has to
 * stay distinct from `exclude` (only non-exceptional). The source of truth is the frozen,
 * write-once `order_items.is_exceptional_discount` flag (set at `POST /orders` when a line's
 * negotiated price is below the variant's `min_price` — `OrdersService.resolveLines`), **never** a
 * join to `price_approvals`: an exceptional line can exist with no approval row at all (a `pending`
 * order nobody filed a request for yet, or a tenant whose
 * `tenant_price_policies.exceptional_discount_requires_approval = false`), so `price_approvals` is
 * the authorisation-workflow overlay, not the historical truth of the sale.
 */
export const SALES_SUMMARY_EXCEPTIONAL = ['all', 'only', 'exclude'] as const;
export type SalesSummaryExceptional = (typeof SALES_SUMMARY_EXCEPTIONAL)[number];

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
 * `groupBy` has no `location` value yet — a per-location *breakdown* stays out of scope
 * (`GAP-ORDERS-LOCATION`, F18-01). `locationId` (this DTO, OUI-002/`S-HOME` redesign) is a plain
 * equality *filter* on the real, `NOT NULL` `orders.location_id` FK — every order has exactly one —
 * composing with every `groupBy` value the same way `warehouseId` composes with `inventory-summary`
 * and `locationId` composes with `movements-summary`. It narrows the aggregate to one location; it
 * does not add a location dimension to the grouping itself, so `REP-SALES-BY-LOCATION` (a bucket
 * *per* location) stays the still-open part of `GAP-ORDERS-LOCATION`. Does not validate existence
 * (same posture as every other id filter in this report family) — an id matching no order yields an
 * empty result, never a 404.
 *
 * `status` reuses the real `orders.status` enum (`ORDER_STATUSES`, not redefined). Default when
 * omitted is `'confirmed'` (applied in the service, not here) — `metrics.md`'s `SALES-REVENUE`
 * definition is explicitly "Σ orders.total where status='confirmed'"; every other status remains
 * selectable for an operator who wants a non-revenue view (e.g. "how much sits in pending orders").
 *
 * `exceptional` (F18-06) filters by `order_items.is_exceptional_discount`. Default `'all'` — the
 * existing behaviour. `'only'`/`'exclude'` are applied per grouping at that grouping's own grain
 * (`SalesReportRepository`): for `day`/`week`/`month`/`customer` (which aggregate `orders` alone)
 * the filter is an `EXISTS` semi-join — "orders that contain **at least one** exceptional line",
 * with the whole-order totals; for `product` (already line-grain) it filters the joined
 * `order_items` row directly — "exceptional **lines** of this variant". It composes freely with
 * `status` and `from`/`to`.
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

  @ApiPropertyOptional({ enum: SALES_SUMMARY_EXCEPTIONAL, default: 'all' })
  @IsOptional()
  @IsIn(SALES_SUMMARY_EXCEPTIONAL)
  exceptional: SalesSummaryExceptional = 'all';

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'orders.location_id — narrows to one location.' })
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
