import { Injectable } from '@nestjs/common';
import { TenantSettingsRepository } from '../../administration/tenant-settings/tenant-settings.repository';
import { DEFAULT_TIMEZONE } from '../../administration/tenant-settings/tenant-settings.service';
import { localDayRangeToUtc } from '../../common/reporting/local-day-range';
import { withTenantTransaction } from '../../database/tenant-context';
import { LocationAuthorizationService } from '../../inventory/location-authorization.service';
import { DEFAULT_CURRENCY } from '../../sales/orders/orders.service';
import { roundMoney } from '../../sales/sales-money';
import type { PaymentsReportQueryDto } from './dto/payments-report-query.dto';
import type { PaymentRowDto, PaymentsReportResponseDto } from './dto/payments-report-response.dto';
import type { PaymentListRow } from './payments-report.repository';
import { PaymentsReportRepository } from './payments-report.repository';

/** Hard cap of an export — the result says so (`truncated`) instead of silently cutting. */
export const PAYMENTS_EXPORT_MAX_ROWS = 5000;

export function toPaymentRowDto(row: PaymentListRow): PaymentRowDto {
  const returnCount = Number(row.returnCount);
  return {
    id: row.id,
    paidAt: new Date(row.paidAt).toISOString(),
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    paymentMethod: row.paymentMethod,
    amount: Number(row.amount),
    ...(row.sellerName ? { sellerName: row.sellerName } : {}),
    locationId: row.locationId,
    locationLabel: row.locationLabel ?? '—',
    documentType: row.documentType,
    ...(returnCount > 0
      ? { returns: { count: returnCount, numbers: row.returnNumbers ?? [], returnedValue: roundMoney(Number(row.returnedValue)) } }
      : {}),
  };
}

@Injectable()
export class PaymentsReportService {
  constructor(
    private readonly paymentsReportRepository: PaymentsReportRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly locationAuthorizationService: LocationAuthorizationService,
  ) {}

  /** `forExport` = the first `PAYMENTS_EXPORT_MAX_ROWS` rows of the same filtered set, no paging. */
  async getPayments(
    tenantId: string,
    actorId: string,
    query: PaymentsReportQueryDto,
    canViewAllSellers: boolean,
    forExport = false,
  ): Promise<PaymentsReportResponseDto & { truncated: boolean }> {
    // Same rule as GET /orders: without sales.orders.view_all a seller only sees their own orders.
    const placedByUserId = canViewAllSellers ? query.placedByUserId : actorId;
    return withTenantTransaction(tenantId, async (tx) => {
      const settings = await this.tenantSettingsRepository.find(tx, tenantId);
      const timezone = settings?.timezone ?? DEFAULT_TIMEZONE;
      const range = localDayRangeToUtc(query.dateFrom, query.dateTo, timezone);
      // Same location scope as the writes and the history (ADR-0024/0035).
      const readScope = await this.locationAuthorizationService.resolveReadScope(tx, tenantId, actorId, query.locationId);
      const filters = {
        gte: range.gte,
        lt: range.lt,
        locationId: readScope.locationId,
        locationIds: readScope.locationIds,
        warehouseId: query.warehouseId,
        placedByUserId,
        documentType: query.documentType,
        paymentMethod: query.paymentMethod,
        orderNumber: query.orderNumber,
        customerName: query.customerName,
        sellerName: query.sellerName,
        amount: query.amount,
      };
      const byMethodRows = await this.paymentsReportRepository.totalsByMethod(tx, tenantId, filters);
      const byMethod = byMethodRows.map((r) => ({ paymentMethod: r.paymentMethod, paymentCount: Number(r.paymentCount), amount: Number(r.amount) }));
      const paymentCount = byMethod.reduce((sum, m) => sum + m.paymentCount, 0);
      const amount = roundMoney(byMethod.reduce((sum, m) => sum + m.amount, 0));

      const rows = await this.paymentsReportRepository.list(tx, tenantId, filters, {
        limit: forExport ? PAYMENTS_EXPORT_MAX_ROWS : query.pageSize,
        offset: forExport ? 0 : (query.page - 1) * query.pageSize,
        sort: query.sort ?? 'createdAt',
        dir: query.dir ?? 'desc',
      });
      return {
        timezone,
        currency: DEFAULT_CURRENCY,
        truncated: forExport && paymentCount > PAYMENTS_EXPORT_MAX_ROWS,
        totals: { paymentCount, amount, byMethod },
        data: rows.map(toPaymentRowDto),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total: paymentCount,
          totalPages: Math.max(1, Math.ceil(paymentCount / query.pageSize)),
        },
      };
    });
  }
}
