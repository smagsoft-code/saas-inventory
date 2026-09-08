import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ReportDateRangeQueryDto } from '../../../common/reporting/report-date-range.dto';

export const APPROVALS_SUMMARY_GROUP_BY = ['day', 'week', 'month', 'status'] as const;
export type ApprovalsSummaryGroupBy = (typeof APPROVALS_SUMMARY_GROUP_BY)[number];

/** The real `price_approvals.status` enum (`price_approvals_status_check`, migration 0009 /
 * `09-sales.ts:265`). `ListPriceApprovalsQueryDto`'s own constant is not exported, so it is
 * redeclared identically here rather than reaching into that operational DTO's module — the same
 * convention `ReturnsSummaryQueryDto` follows for `sales_returns.status`. */
export const APPROVALS_SUMMARY_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

/**
 * `GET /reports/approvals-summary` (F18-05). Extends the F18-01 `ReportDateRangeQueryDto` as-is —
 * `from`/`to` stay `string | undefined` here for the same `useDefineForClassFields` reason
 * `SalesSummaryQueryDto`/`ReturnsSummaryQueryDto` document; **this report requires both**, enforced
 * by `ApprovalsReportService` (400 when either is missing) — no invented default period, no
 * untested timezone math in a DTO default.
 *
 * `groupBy` has:
 * - `day`/`week`/`month` — period buckets keyed by `price_approvals.requested_at` (when the request
 *   was *filed*: the immutable, always-present timestamp — `resolved_at` is `NULL` for a `pending`
 *   row, so it cannot anchor a period that must include still-open requests). Buckets are a
 *   request-cohort: "of the requests filed in this period, what became of them".
 * - `status` — one bucket per real `price_approvals.status` value present in the range.
 *
 * No `requester`/`approver` groupBy — `price_approvals` carries only the user *ids*
 * (`requested_by`/`approved_by`), and name enrichment on report responses is `GAP-NAME-ENRICHMENT`
 * (F17-needed, explicitly out of F18 scope). No `product`/`customer` groupBy — no `metrics.md`
 * row, KPI or gap asks for approvals grouped that way (section 5's catalogue is count / pending /
 * age / rate / discount-value only), and it is deliberately left out rather than built speculatively.
 *
 * `status` (optional filter) reuses the real enum. **There is no default** — unlike
 * `sales-summary` (`confirmed`) / `returns-summary` (`resolved`), whose default isolates a
 * *committed* effect, this report's whole point is the outcome mix (rate, per-status breakdown), so
 * omitting `status` includes every status and the period bucket exposes the split. An invalid value
 * is a 400 via `@IsIn`, never silently ignored.
 */
export class ApprovalsSummaryQueryDto extends ReportDateRangeQueryDto {
  @ApiPropertyOptional({ enum: APPROVALS_SUMMARY_GROUP_BY, default: 'day' })
  @IsOptional()
  @IsIn(APPROVALS_SUMMARY_GROUP_BY)
  groupBy: ApprovalsSummaryGroupBy = 'day';

  @ApiPropertyOptional({ enum: APPROVALS_SUMMARY_STATUSES })
  @IsOptional()
  @IsIn(APPROVALS_SUMMARY_STATUSES)
  status?: (typeof APPROVALS_SUMMARY_STATUSES)[number];
}
