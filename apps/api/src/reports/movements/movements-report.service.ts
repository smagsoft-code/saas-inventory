import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantSettingsRepository } from '../../administration/tenant-settings/tenant-settings.repository';
import { DEFAULT_TIMEZONE } from '../../administration/tenant-settings/tenant-settings.service';
import { toHalfOpenRange } from '../../common/reporting/date-range';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type {
  MovementsPeriodBucketDto,
  MovementsSummaryResponseDto,
  MovementsTypeBucketDto,
} from './dto/movements-summary-response.dto';
import type { MovementsSummaryGroupBy, MovementsSummaryQueryDto } from './dto/movements-summary-query.dto';
import type { DateTruncUnit } from './movements-report.repository';
import { MovementsReportRepository } from './movements-report.repository';

const PERIOD_UNIT_BY_GROUP_BY: Partial<Record<MovementsSummaryGroupBy, DateTruncUnit>> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

/**
 * `GET /reports/movements-summary` (F18-07) — resolves the aggregation half of `metrics.md`
 * `KPI-INV-MOVEMENTS` / `MOV-QTY-BY-TYPE` / `MOV-RECEIPTS-PERIOD` / `MOV-ADJUSTMENTS-PERIOD` (Σ),
 * all previously **B** ("no server-side aggregation"). Aggregates `inventory_movements` standalone —
 * exact `COUNT(*)` / `SUM(quantity)` with no fan-out. Buckets are keyed by `occurred_at` (period)
 * or `movement_type` (type).
 *
 * Mirrors `ApprovalsReportService` structure exactly — its own timezone-resolution copy, its own
 * from/to validation, `withTenantTransaction` for RLS + tenant scope.
 */
@Injectable()
export class MovementsReportService {
  constructor(
    private readonly movementsReportRepository: MovementsReportRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
  ) {}

  /** Mirrors `ApprovalsReportService.resolveTenantTimezone` — kept as its own small copy rather than
   * a cross-module import, per that method's documented reasoning. */
  private async resolveTenantTimezone(tx: TenantTransaction, tenantId: string): Promise<string> {
    const row = await this.tenantSettingsRepository.find(tx, tenantId);
    return row?.timezone ?? DEFAULT_TIMEZONE;
  }

  async getMovementsSummary(tenantId: string, query: MovementsSummaryQueryDto): Promise<MovementsSummaryResponseDto> {
    if (!query.from || !query.to) {
      throw new BadRequestException('`from` and `to` are both required.');
    }
    const from = query.from;
    const to = query.to;
    if (new Date(from).getTime() >= new Date(to).getTime()) {
      throw new BadRequestException('`from` must be strictly before `to`.');
    }
    const range = toHalfOpenRange(from, to);
    const filters = {
      movementType: query.movementType,
      locationId: query.locationId,
      productVariantId: query.productVariantId,
    };

    return withTenantTransaction(tenantId, async (tx) => {
      const timezone = await this.resolveTenantTimezone(tx, tenantId);

      if (query.groupBy === 'type') {
        const rows = await this.movementsReportRepository.summaryByType(tx, tenantId, {
          gte: range.gte,
          lt: range.lt,
          ...filters,
        });
        const buckets: MovementsTypeBucketDto[] = rows.map((row) => ({
          key: row.key,
          movementCount: Number(row.movementCount),
          totalQuantity: Number(row.totalQuantity),
        }));
        return { from, to, timezone, groupBy: query.groupBy, buckets };
      }

      // day | week | month
      const unit = PERIOD_UNIT_BY_GROUP_BY[query.groupBy];
      if (!unit) {
        // Unreachable given MovementsSummaryQueryDto's @IsIn(MOVEMENTS_SUMMARY_GROUP_BY) — a
        // defensive guard, matching the other FASE 18 report services' identical guard.
        throw new BadRequestException(`Unsupported groupBy: ${String(query.groupBy)}`);
      }
      const rows = await this.movementsReportRepository.summaryByPeriod(tx, tenantId, {
        gte: range.gte,
        lt: range.lt,
        ...filters,
        unit,
        timezone,
      });
      const buckets: MovementsPeriodBucketDto[] = rows.map((row) => ({
        key: row.key,
        movementCount: Number(row.movementCount),
        totalQuantity: Number(row.totalQuantity),
      }));
      return { from, to, timezone, groupBy: query.groupBy, buckets };
    });
  }
}
