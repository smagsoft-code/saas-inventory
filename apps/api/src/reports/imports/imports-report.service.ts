import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantSettingsRepository } from '../../administration/tenant-settings/tenant-settings.repository';
import { DEFAULT_TIMEZONE } from '../../administration/tenant-settings/tenant-settings.service';
import { toHalfOpenRange } from '../../common/reporting/date-range';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { ImportsSummaryBucketDto, ImportsSummaryResponseDto } from './dto/imports-summary-response.dto';
import type { ImportsSummaryGroupBy, ImportsSummaryQueryDto } from './dto/imports-summary-query.dto';
import type { DateTruncUnit, ImportsBucketRow } from './imports-report.repository';
import { ImportsReportRepository } from './imports-report.repository';

const PERIOD_UNIT_BY_GROUP_BY: Partial<Record<ImportsSummaryGroupBy, DateTruncUnit>> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

function toBucket(row: ImportsBucketRow): ImportsSummaryBucketDto {
  return {
    key: row.key,
    jobCount: Number(row.jobCount),
    totalRows: Number(row.totalRows),
    validRows: Number(row.validRows),
    invalidRows: Number(row.invalidRows),
    warningRows: Number(row.warningRows),
    importedRows: Number(row.importedRows),
  };
}

/**
 * `GET /reports/imports-summary` (F18-09 — "Imports analytics"). Resolves `metrics.md`
 * `IMP-ROWS-PERIOD` ("`Σ imported_rows` over jobs completed in range … no filter/sum", **B → A**)
 * and `reports.md`'s "a cross-job 'rows imported this month' rollup is **B**".
 *
 * Anchored on `import_jobs.completed_at` — the timestamp `IMP-ROWS-PERIOD` names, set on every
 * terminal transition (verified in `ImportJobService`). Jobs still running (`completed_at IS NULL`)
 * are excluded; a live "imports in progress" count is `GAP-MULTI-STATUS` territory, not this period
 * report (the same boundary F18-05 drew for `APPR-AGE`).
 *
 * Mirrors `ApprovalsReportService` structure exactly — its own timezone-resolution copy, its own
 * from/to validation, `withTenantTransaction` for RLS + tenant scope. No `currency` (an import has
 * no monetary value — same as `movements-summary`).
 */
@Injectable()
export class ImportsReportService {
  constructor(
    private readonly importsReportRepository: ImportsReportRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
  ) {}

  /** Mirrors `ApprovalsReportService.resolveTenantTimezone` — kept as its own small copy rather than
   * a cross-module import, per that method's documented reasoning. */
  private async resolveTenantTimezone(tx: TenantTransaction, tenantId: string): Promise<string> {
    const row = await this.tenantSettingsRepository.find(tx, tenantId);
    return row?.timezone ?? DEFAULT_TIMEZONE;
  }

  async getImportsSummary(tenantId: string, query: ImportsSummaryQueryDto): Promise<ImportsSummaryResponseDto> {
    if (!query.from || !query.to) {
      throw new BadRequestException('`from` and `to` are both required.');
    }
    const from = query.from;
    const to = query.to;
    if (new Date(from).getTime() >= new Date(to).getTime()) {
      throw new BadRequestException('`from` must be strictly before `to`.');
    }
    const range = toHalfOpenRange(from, to);
    const rangeParams = { gte: range.gte, lt: range.lt, status: query.status };

    return withTenantTransaction(tenantId, async (tx) => {
      const timezone = await this.resolveTenantTimezone(tx, tenantId);

      const [totalsRow, bucketRows] = await Promise.all([
        this.importsReportRepository.totals(tx, tenantId, rangeParams),
        this.loadBucketRows(tx, tenantId, query.groupBy, rangeParams, timezone),
      ]);

      return {
        from,
        to,
        timezone,
        groupBy: query.groupBy,
        totals: toBucket(totalsRow),
        buckets: bucketRows.map(toBucket),
      };
    });
  }

  private async loadBucketRows(
    tx: TenantTransaction,
    tenantId: string,
    groupBy: ImportsSummaryGroupBy,
    rangeParams: { gte: Date; lt: Date; status?: string | undefined },
    timezone: string,
  ): Promise<ImportsBucketRow[]> {
    if (groupBy === 'status') {
      return this.importsReportRepository.summaryByStatus(tx, tenantId, rangeParams);
    }
    const unit = PERIOD_UNIT_BY_GROUP_BY[groupBy];
    if (!unit) {
      // Unreachable given ImportsSummaryQueryDto's @IsIn(IMPORTS_SUMMARY_GROUP_BY) — a defensive
      // guard, matching the other FASE 18 report services' identical guard.
      throw new BadRequestException(`Unsupported groupBy: ${String(groupBy)}`);
    }
    return this.importsReportRepository.summaryByPeriod(tx, tenantId, { ...rangeParams, unit, timezone });
  }
}
