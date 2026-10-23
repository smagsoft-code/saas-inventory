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
  SalesCustomerBucketDto,
  SalesPeriodBucketDto,
  SalesProductBucketDto,
  SalesSummaryResponseDto,
} from './dto/sales-summary-response.dto';
import type { SalesSummaryGroupBy, SalesSummaryQueryDto } from './dto/sales-summary-query.dto';
import type { DateTruncUnit } from './sales-report.repository';
import { SalesReportRepository } from './sales-report.repository';

const DEFAULT_STATUS = 'confirmed';

const PERIOD_UNIT_BY_GROUP_BY: Partial<Record<SalesSummaryGroupBy, DateTruncUnit>> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

@Injectable()
export class SalesReportService {
  constructor(
    private readonly salesReportRepository: SalesReportRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly locationAuthorizationService: LocationAuthorizationService,
  ) {}

  /** Mirrors `AuthService.resolveTenantTimezone` (F18-01) — same default, same "no permission
   * required" posture. Kept as its own small copy rather than a cross-module import of a private
   * AuthService method; both read the identical `DEFAULT_TIMEZONE` constant so the default itself
   * can never drift between the two call sites. */
  private async resolveTenantTimezone(tx: TenantTransaction, tenantId: string): Promise<string> {
    const row = await this.tenantSettingsRepository.find(tx, tenantId);
    return row?.timezone ?? DEFAULT_TIMEZONE;
  }

  async getSalesSummary(
    tenantId: string,
    actorId: string,
    query: SalesSummaryQueryDto,
    canViewCost = false,
    canViewAllSellers = false,
  ): Promise<SalesSummaryResponseDto> {
    // Without sales.orders.view_all the aggregates only cover the caller's own orders — the same
    // scope as GET /orders, so a seller's report can never reveal other sellers' totals.
    // With it, the optional `placedByUserId` query param narrows to one seller.
    const placedByUserId = canViewAllSellers ? query.placedByUserId : actorId;
    // ReportDateRangeQueryDto leaves from/to optional (F18-01); this report requires both — see
    // the DTO's own comment for why that is enforced here rather than by the DTO's type.
    // Business-day mode (`dateFrom`/`dateTo`, tenant timezone) replaces from/to when present.
    if (query.dateTo && !query.dateFrom) {
      throw new BadRequestException('`dateTo` requires `dateFrom`.');
    }
    if (!query.dateFrom && (!query.from || !query.to)) {
      throw new BadRequestException('`from` and `to` are both required.');
    }
    // Narrowed `const`s (not `query.from`/`query.to` re-accessed below) so the check above
    // actually survives into the closure passed to withTenantTransaction — a property-access
    // narrowing does not persist across a nested function boundary the way a local const does.
    const from = query.from ?? '';
    const to = query.to ?? '';
    // [from, to) — half-open, `to` exclusive (F18-01, ratified for every new FASE 18 endpoint).
    // `from >= to` is a caller mistake no date format check catches, so it is rejected here rather
    // than silently returning an empty result.
    if (!query.dateFrom && new Date(from).getTime() >= new Date(to).getTime()) {
      throw new BadRequestException('`from` must be strictly before `to`.');
    }
    const status = query.status ?? DEFAULT_STATUS;
    const exceptional = query.exceptional ?? 'all';

    return withTenantTransaction(tenantId, async (tx) => {
      const timezone = await this.resolveTenantTimezone(tx, tenantId);
      // Same location scope as the writes (ADR-0024/0035): a restricted caller never aggregates
      // beyond their assigned locations, and asking for another one is a 403.
      const readScope = await this.locationAuthorizationService.resolveReadScope(tx, tenantId, actorId, query.locationId);
      const range = query.dateFrom
        ? localDayRangeToUtc(query.dateFrom, query.dateTo, timezone)
        : toHalfOpenRange(from, to);

      if (query.groupBy === 'customer') {
        const rows = await this.salesReportRepository.summaryByCustomer(tx, tenantId, {
          gte: range.gte,
          lt: range.lt,
          status,
          exceptional,
          locationId: readScope.locationId,
          locationIds: readScope.locationIds,
          documentType: query.documentType,
          customerId: query.customerId,
          placedByUserId,
          warehouseId: query.warehouseId,
          columnFilters: { q: query.q, orderNumber: query.orderNumber, customerName: query.customerName, sellerName: query.sellerName, total: query.total, notificationStatus: query.notificationStatus },
        });
        const buckets: SalesCustomerBucketDto[] = rows.map((row) => {
          const subtotal = Number(row.subtotal);
          const discountTotal = Number(row.discountTotal);
          const total = Number(row.total);
          return {
            key: row.key,
            customerName: row.customerName,
            orderCount: row.orderCount,
            subtotal,
            discountTotal,
            total,
            avgTicket: row.orderCount > 0 ? roundMoney(total / row.orderCount) : 0,
          };
        });
        return { from: range.gte.toISOString(), to: range.lt.toISOString(), timezone, currency: DEFAULT_CURRENCY, groupBy: query.groupBy, exceptional, buckets };
      }

      if (query.groupBy === 'product') {
        const rows = await this.salesReportRepository.summaryByProduct(tx, tenantId, {
          gte: range.gte,
          lt: range.lt,
          status,
          exceptional,
          locationId: readScope.locationId,
          locationIds: readScope.locationIds,
          documentType: query.documentType,
          customerId: query.customerId,
          placedByUserId,
          warehouseId: query.warehouseId,
          columnFilters: { q: query.q, orderNumber: query.orderNumber, customerName: query.customerName, sellerName: query.sellerName, total: query.total, notificationStatus: query.notificationStatus },
        });
        const buckets: SalesProductBucketDto[] = rows.map((row) => ({
          key: row.key,
          sku: row.sku,
          productName: row.productName,
          orderCount: Number(row.orderCount),
          quantity: Number(row.quantity),
          discountTotal: Number(row.discountTotal),
          total: Number(row.total),
        }));
        return { from: range.gte.toISOString(), to: range.lt.toISOString(), timezone, currency: DEFAULT_CURRENCY, groupBy: query.groupBy, exceptional, buckets };
      }

      // day | week | month
      const unit = PERIOD_UNIT_BY_GROUP_BY[query.groupBy];
      if (!unit) {
        // Unreachable given SalesSummaryQueryDto's @IsIn(SALES_SUMMARY_GROUP_BY) — a defensive
        // guard, not a second validation layer, so a future groupBy value can never silently fall
        // through to the wrong query shape.
        throw new BadRequestException(`Unsupported groupBy: ${String(query.groupBy)}`);
      }
      const rows = await this.salesReportRepository.summaryByPeriod(tx, tenantId, {
        gte: range.gte,
        lt: range.lt,
        status,
        unit,
        timezone,
        exceptional,
        locationId: readScope.locationId,
          locationIds: readScope.locationIds,
        documentType: query.documentType,
        customerId: query.customerId,
          placedByUserId,
          warehouseId: query.warehouseId,
          columnFilters: { q: query.q, orderNumber: query.orderNumber, customerName: query.customerName, sellerName: query.sellerName, total: query.total, notificationStatus: query.notificationStatus },
      });
      // Cost/profit are field-gated on pricing.cost.view (ADR-0028): without it the keys are absent.
      const costRows = canViewCost
        ? await this.salesReportRepository.costByPeriod(tx, tenantId, {
            gte: range.gte,
            lt: range.lt,
            status,
            unit,
            timezone,
            exceptional,
            locationId: readScope.locationId,
            locationIds: readScope.locationIds,
            documentType: query.documentType,
            customerId: query.customerId,
          placedByUserId,
          warehouseId: query.warehouseId,
          columnFilters: { q: query.q, orderNumber: query.orderNumber, customerName: query.customerName, sellerName: query.sellerName, total: query.total, notificationStatus: query.notificationStatus },
          })
        : [];
      const costByKey = new Map(costRows.map((c) => [c.key, c]));
      const buckets: SalesPeriodBucketDto[] = rows.map((row) => {
        const subtotal = Number(row.subtotal);
        const discountTotal = Number(row.discountTotal);
        const total = Number(row.total);
        const cost = costByKey.get(row.key);
        const costTotal = canViewCost ? roundMoney(Number(cost?.costTotal ?? 0)) : undefined;
        return {
          key: row.key,
          orderCount: row.orderCount,
          subtotal,
          discountTotal,
          total,
          avgTicket: row.orderCount > 0 ? roundMoney(total / row.orderCount) : 0,
          ...(costTotal !== undefined
            ? { costTotal, profit: roundMoney(total - costTotal), missingCostLines: Number(cost?.missingCostLines ?? 0) }
            : {}),
        };
      });
      return { from: range.gte.toISOString(), to: range.lt.toISOString(), timezone, currency: DEFAULT_CURRENCY, groupBy: query.groupBy, exceptional, buckets };
    });
  }
}
