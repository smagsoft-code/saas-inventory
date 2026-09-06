import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ReportDateRangeQueryDto } from '../../../common/reporting/report-date-range.dto';

export const RETURNS_SUMMARY_GROUP_BY = ['day', 'week', 'month', 'product', 'customer', 'disposition'] as const;
export type ReturnsSummaryGroupBy = (typeof RETURNS_SUMMARY_GROUP_BY)[number];

/** The real `sales_returns.status` enum (`ListReturnsQueryDto`'s own constant is not exported, so
 * this is redeclared identically rather than reaching into that operational DTO's module). */
export const RETURNS_SUMMARY_STATUSES = ['requested', 'inspecting', 'resolved', 'cancelled'] as const;

/**
 * `GET /reports/returns-summary` (F18-04). Extends the F18-01 `ReportDateRangeQueryDto` as-is —
 * `from`/`to` stay `string | undefined` here for the same `useDefineForClassFields` reason
 * `SalesSummaryQueryDto` documents. **This report requires both**, enforced by
 * `ReturnsReportService` (400 when either is missing) — same conservative F18-02 precedent: no
 * invented default period, no untested timezone math in a DTO default.
 *
 * `groupBy` has no `location` value — `sales_returns.location_id` is "where the goods were
 * physically received", not a documented reporting dimension, and no gap doc asks for it.
 * `reason` is free text (no enum/category on `sales_returns.reason`), so it is not a groupBy value
 * either — grouping by an unbounded free-text column would not produce a meaningful bucket set
 * (see this phase's final report, §Grouping).
 *
 * `status` reuses the real `sales_returns.status` enum. Default when omitted is `'resolved'`
 * (applied in the service, not here) — the return's inventory effect is only committed once
 * `resolve` runs (`database.md#sales-returns-and-disposition`), the direct analogue of
 * `SalesSummaryQueryDto`'s `'confirmed'` default for orders. Every other status remains selectable
 * for an operator who wants a non-terminal view (e.g. the pending inspection queue by day).
 */
export class ReturnsSummaryQueryDto extends ReportDateRangeQueryDto {
  @ApiPropertyOptional({ enum: RETURNS_SUMMARY_GROUP_BY, default: 'day' })
  @IsOptional()
  @IsIn(RETURNS_SUMMARY_GROUP_BY)
  groupBy: ReturnsSummaryGroupBy = 'day';

  @ApiPropertyOptional({ enum: RETURNS_SUMMARY_STATUSES, default: 'resolved' })
  @IsOptional()
  @IsIn(RETURNS_SUMMARY_STATUSES)
  status?: (typeof RETURNS_SUMMARY_STATUSES)[number];
}
