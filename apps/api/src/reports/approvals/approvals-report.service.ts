import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantSettingsRepository } from '../../administration/tenant-settings/tenant-settings.repository';
import { DEFAULT_TIMEZONE } from '../../administration/tenant-settings/tenant-settings.service';
import { toHalfOpenRange } from '../../common/reporting/date-range';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { DEFAULT_CURRENCY } from '../../sales/orders/orders.service';
import type {
  ApprovalsPeriodBucketDto,
  ApprovalsStatusBucketDto,
  ApprovalsSummaryResponseDto,
} from './dto/approvals-summary-response.dto';
import type { ApprovalsSummaryGroupBy, ApprovalsSummaryQueryDto } from './dto/approvals-summary-query.dto';
import type { DateTruncUnit } from './approvals-report.repository';
import { ApprovalsReportRepository } from './approvals-report.repository';

const PERIOD_UNIT_BY_GROUP_BY: Partial<Record<ApprovalsSummaryGroupBy, DateTruncUnit>> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

/** `approvalRate = approvedCount / (approvedCount + rejectedCount)`, rounded to 4dp. Cancelled and
 * pending are deliberately excluded from the denominator — neither is a decision (a cancelled
 * request lost its order before resolution; a pending one has no outcome yet). `null` (never `0`,
 * never `NaN`) when nothing in the bucket has been decided. */
function approvalRate(approvedCount: number, rejectedCount: number): number | null {
  const decided = approvedCount + rejectedCount;
  if (decided === 0) {
    return null;
  }
  return Math.round((approvedCount / decided) * 10_000) / 10_000;
}

/**
 * `GET /reports/approvals-summary` (F18-05, `metrics.md` `APPR-RATE` / `APPR-DISCOUNT-VALUE` — both
 * previously **B** ("not time-bounded" / "no server-side aggregation"), now **A**). Buckets are
 * keyed by `price_approvals.requested_at` (when the request was *filed*): the immutable,
 * always-present timestamp. `price_approvals` does carry a real `resolved_at` (unlike
 * `sales_returns`, `GAP-RETURN-RESOLVED-AT`), but a period that must still surface *pending*
 * requests cannot be anchored on a column that is `NULL` for exactly those rows — so this report
 * uses `requested_at` and presents each bucket as a request-cohort. A future `dateField` toggle
 * (`requested` | `resolved`) is possible but out of F18-05 scope (the F18-02/03/04 reports each
 * anchor on a single timestamp; consistency over a speculative knob).
 *
 * Mirrors `ReturnsReportService` structure exactly — its own timezone-resolution copy, its own
 * from/to validation, `withTenantTransaction` for RLS + tenant scope.
 */
@Injectable()
export class ApprovalsReportService {
  constructor(
    private readonly approvalsReportRepository: ApprovalsReportRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
  ) {}

  /** Mirrors `SalesReportService.resolveTenantTimezone` / `ReturnsReportService` — kept as its own
   * small copy rather than a cross-module import, per that method's documented reasoning. */
  private async resolveTenantTimezone(tx: TenantTransaction, tenantId: string): Promise<string> {
    const row = await this.tenantSettingsRepository.find(tx, tenantId);
    return row?.timezone ?? DEFAULT_TIMEZONE;
  }

  async getApprovalsSummary(tenantId: string, query: ApprovalsSummaryQueryDto): Promise<ApprovalsSummaryResponseDto> {
    if (!query.from || !query.to) {
      throw new BadRequestException('`from` and `to` are both required.');
    }
    const from = query.from;
    const to = query.to;
    if (new Date(from).getTime() >= new Date(to).getTime()) {
      throw new BadRequestException('`from` must be strictly before `to`.');
    }
    const range = toHalfOpenRange(from, to);
    const status = query.status;

    return withTenantTransaction(tenantId, async (tx) => {
      const timezone = await this.resolveTenantTimezone(tx, tenantId);

      if (query.groupBy === 'status') {
        const rows = await this.approvalsReportRepository.summaryByStatus(tx, tenantId, {
          gte: range.gte,
          lt: range.lt,
          status,
        });
        const buckets: ApprovalsStatusBucketDto[] = rows.map((row) => ({
          key: row.key,
          requestCount: Number(row.requestCount),
          discountValue: Number(row.discountValue),
        }));
        return { from, to, timezone, currency: DEFAULT_CURRENCY, groupBy: query.groupBy, buckets };
      }

      // day | week | month
      const unit = PERIOD_UNIT_BY_GROUP_BY[query.groupBy];
      if (!unit) {
        // Unreachable given ApprovalsSummaryQueryDto's @IsIn(APPROVALS_SUMMARY_GROUP_BY) — a
        // defensive guard, matching SalesReportService/ReturnsReportService's identical guard.
        throw new BadRequestException(`Unsupported groupBy: ${String(query.groupBy)}`);
      }
      const rows = await this.approvalsReportRepository.summaryByPeriod(tx, tenantId, {
        gte: range.gte,
        lt: range.lt,
        status,
        unit,
        timezone,
      });
      const buckets: ApprovalsPeriodBucketDto[] = rows.map((row) => {
        const approvedCount = Number(row.approvedCount);
        const rejectedCount = Number(row.rejectedCount);
        return {
          key: row.key,
          requestCount: Number(row.requestCount),
          approvedCount,
          rejectedCount,
          cancelledCount: Number(row.cancelledCount),
          pendingCount: Number(row.pendingCount),
          approvedDiscountValue: Number(row.approvedDiscountValue),
          approvalRate: approvalRate(approvedCount, rejectedCount),
        };
      });
      return { from, to, timezone, currency: DEFAULT_CURRENCY, groupBy: query.groupBy, buckets };
    });
  }
}
