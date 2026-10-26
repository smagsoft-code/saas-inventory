import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantSettingsRepository } from '../../administration/tenant-settings/tenant-settings.repository';
import { DEFAULT_TIMEZONE } from '../../administration/tenant-settings/tenant-settings.service';
import { toHalfOpenRange } from '../../common/reporting/date-range';
import { localDayRangeToUtc } from '../../common/reporting/local-day-range';
import { LocationAuthorizationService } from '../../inventory/location-authorization.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { DEFAULT_CURRENCY } from '../../sales/orders/orders.service';
import { roundMoney } from '../../sales/sales-money';
import type {
  ReturnsCustomerBucketDto,
  ReturnsDispositionBucketDto,
  ReturnsPeriodBucketDto,
  ReturnsProductBucketDto,
  ReturnsSummaryResponseDto,
} from './dto/returns-summary-response.dto';
import type { ReturnsSummaryGroupBy, ReturnsSummaryQueryDto } from './dto/returns-summary-query.dto';
import type { DateTruncUnit } from './returns-report.repository';
import { ReturnsReportRepository } from './returns-report.repository';
import { canReadAllReturns } from '../../sales/orders/order-seller-scope';

/** The return's inventory effect is only committed once `resolve` runs
 * (`database.md#sales-returns-and-disposition`) — the direct analogue of `SalesReportService`'s
 * `DEFAULT_STATUS = 'confirmed'` for orders. */
const DEFAULT_STATUS = 'resolved';

const PERIOD_UNIT_BY_GROUP_BY: Partial<Record<ReturnsSummaryGroupBy, DateTruncUnit>> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

/**
 * `GET /reports/returns-summary` (F18-04, `GAP-RETURN-AGGREGATE`). Buckets are keyed by
 * `sales_returns.created_at` — the only immutable, always-present timestamp on the table
 * (`updated_at` is rewritten by every transition — `inspect`, `resolve`, `cancel` alike — so it
 * cannot answer "when did this specific thing happen"; there is no `resolved_at`/`received_at`
 * column). This is the same judgment call `SalesReportService` already made for `orders.created_at`
 * over a `confirmed_at` that also doesn't exist (`GAP-ORDER-CONFIRMED-AT`) — documented here as
 * `GAP-RETURN-RESOLVED-AT` rather than silently assumed.
 */
@Injectable()
export class ReturnsReportService {
  constructor(
    private readonly returnsReportRepository: ReturnsReportRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly locationAuthorizationService: LocationAuthorizationService,
  ) {}

  /** Mirrors `SalesReportService.resolveTenantTimezone` — kept as its own small copy rather than a
   * cross-module import, per that method's own documented reasoning. */
  private async resolveTenantTimezone(tx: TenantTransaction, tenantId: string): Promise<string> {
    const row = await this.tenantSettingsRepository.find(tx, tenantId);
    return row?.timezone ?? DEFAULT_TIMEZONE;
  }

  async getReturnsSummary(tenantId: string, actorId: string, permissions: string[], query: ReturnsSummaryQueryDto): Promise<ReturnsSummaryResponseDto> {
    // Business-day mode (`dateFrom`/`dateTo`, tenant timezone) replaces from/to when present.
    if (query.dateTo && !query.dateFrom) {
      throw new BadRequestException('`dateTo` requires `dateFrom`.');
    }
    if (!query.dateFrom && (!query.from || !query.to)) {
      throw new BadRequestException('`from` and `to` are both required.');
    }
    const from = query.from ?? '';
    const to = query.to ?? '';
    if (!query.dateFrom && new Date(from).getTime() >= new Date(to).getTime()) {
      throw new BadRequestException('`from` must be strictly before `to`.');
    }
    const status = query.status ?? DEFAULT_STATUS;

    return withTenantTransaction(tenantId, async (tx) => {
      const timezone = await this.resolveTenantTimezone(tx, tenantId);
      // Same location scope as the writes (ADR-0024/0035): a restricted caller never aggregates
      // beyond their assigned locations, and asking for another one is a 403.
      const readScope = await this.locationAuthorizationService.resolveReadScope(tx, tenantId, actorId, query.locationId);
      const range = query.dateFrom ? localDayRangeToUtc(query.dateFrom, query.dateTo, timezone) : toHalfOpenRange(from, to);
      // Seller scope of the read, identical to `GET /sales-returns` — an aggregate must not reveal what the list hides.
      const sellerScope = canReadAllReturns(permissions) ? {} : { placedByUserId: actorId };

      if (query.groupBy === 'customer') {
        const rows = await this.returnsReportRepository.summaryByCustomer(tx, tenantId, { gte: range.gte, lt: range.lt, status, locationId: readScope.locationId,
          locationIds: readScope.locationIds, ...sellerScope });
        const buckets: ReturnsCustomerBucketDto[] = rows.map((row) => {
          const returnCount = Number(row.returnCount);
          const returnedValue = Number(row.returnedValue);
          return {
            key: row.key,
            customerName: row.customerName,
            returnCount,
            orderCount: Number(row.orderCount),
            lineCount: Number(row.lineCount),
            quantity: Number(row.quantity),
            returnedValue,
            avgReturnValue: returnCount > 0 ? roundMoney(returnedValue / returnCount) : 0,
          };
        });
        return { from: range.gte.toISOString(), to: range.lt.toISOString(), timezone, currency: DEFAULT_CURRENCY, groupBy: query.groupBy, buckets };
      }

      if (query.groupBy === 'product') {
        const rows = await this.returnsReportRepository.summaryByProduct(tx, tenantId, { gte: range.gte, lt: range.lt, status, locationId: readScope.locationId,
          locationIds: readScope.locationIds, ...sellerScope });
        const buckets: ReturnsProductBucketDto[] = rows.map((row) => ({
          key: row.key,
          sku: row.sku,
          productName: row.productName,
          returnCount: Number(row.returnCount),
          orderCount: Number(row.orderCount),
          lineCount: Number(row.lineCount),
          quantity: Number(row.quantity),
          returnedValue: Number(row.returnedValue),
        }));
        return { from: range.gte.toISOString(), to: range.lt.toISOString(), timezone, currency: DEFAULT_CURRENCY, groupBy: query.groupBy, buckets };
      }

      if (query.groupBy === 'disposition') {
        const rows = await this.returnsReportRepository.summaryByDisposition(tx, tenantId, { gte: range.gte, lt: range.lt, status, locationId: readScope.locationId,
          locationIds: readScope.locationIds, ...sellerScope });
        const buckets: ReturnsDispositionBucketDto[] = rows.map((row) => ({
          key: row.key,
          lineCount: Number(row.lineCount),
          quantity: Number(row.quantity),
          returnedValue: Number(row.returnedValue),
        }));
        return { from: range.gte.toISOString(), to: range.lt.toISOString(), timezone, currency: DEFAULT_CURRENCY, groupBy: query.groupBy, buckets };
      }

      // day | week | month
      const unit = PERIOD_UNIT_BY_GROUP_BY[query.groupBy];
      if (!unit) {
        // Unreachable given ReturnsSummaryQueryDto's @IsIn(RETURNS_SUMMARY_GROUP_BY) — a defensive
        // guard, not a second validation layer, matching SalesReportService's identical guard.
        throw new BadRequestException(`Unsupported groupBy: ${String(query.groupBy)}`);
      }
      const rows = await this.returnsReportRepository.summaryByPeriod(tx, tenantId, { gte: range.gte, lt: range.lt, status, unit, timezone, locationId: readScope.locationId,
          locationIds: readScope.locationIds, ...sellerScope });
      const buckets: ReturnsPeriodBucketDto[] = rows.map((row) => {
        const returnCount = Number(row.returnCount);
        const returnedValue = Number(row.returnedValue);
        return {
          key: row.key,
          returnCount,
          orderCount: Number(row.orderCount),
          lineCount: Number(row.lineCount),
          quantity: Number(row.quantity),
          returnedValue,
          avgReturnValue: returnCount > 0 ? roundMoney(returnedValue / returnCount) : 0,
        };
      });
      return { from: range.gte.toISOString(), to: range.lt.toISOString(), timezone, currency: DEFAULT_CURRENCY, groupBy: query.groupBy, buckets };
    });
  }
}
