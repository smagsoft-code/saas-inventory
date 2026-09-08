import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SalesReportService } from './sales-report.service';
import type { SalesSummaryQueryDto } from './dto/sales-summary-query.dto';

/** Same convention as auth.service.spec.ts (F18-01): mock withTenantTransaction to just invoke its
 * callback with a stub `tx` — no database, no Nest DI container. Real-PostgreSQL coverage is
 * test/reports/sales-summary.integration.test.ts. */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

function buildService() {
  const salesReportRepository = {
    summaryByPeriod: vi.fn().mockResolvedValue([]),
    summaryByCustomer: vi.fn().mockResolvedValue([]),
    summaryByProduct: vi.fn().mockResolvedValue([]),
  };
  const tenantSettingsRepository = { find: vi.fn().mockResolvedValue(undefined) };
  const service = new SalesReportService(salesReportRepository as never, tenantSettingsRepository as never);
  return { service, salesReportRepository, tenantSettingsRepository };
}

interface QueryOverrides {
  from?: string | undefined;
  to?: string | undefined;
  groupBy?: SalesSummaryQueryDto['groupBy'] | undefined;
  status?: SalesSummaryQueryDto['status'] | undefined;
  exceptional?: SalesSummaryQueryDto['exceptional'] | undefined;
}

function query(overrides: QueryOverrides = {}): SalesSummaryQueryDto {
  return {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-02T00:00:00.000Z',
    groupBy: 'day',
    ...overrides,
  } as SalesSummaryQueryDto;
}

describe('SalesReportService.getSalesSummary', () => {
  it('rejects when `from` is missing', async () => {
    const { service } = buildService();
    await expect(service.getSalesSummary('t1', query({ from: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `to` is missing', async () => {
    const { service } = buildService();
    await expect(service.getSalesSummary('t1', query({ to: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `from` is not strictly before `to`', async () => {
    const { service } = buildService();
    await expect(
      service.getSalesSummary('t1', query({ from: '2026-09-02T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.getSalesSummary('t1', query({ from: '2026-09-03T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('defaults status to "confirmed" when omitted', async () => {
    const { service, salesReportRepository } = buildService();
    await service.getSalesSummary('t1', query({ status: undefined }));
    expect(salesReportRepository.summaryByPeriod).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ status: 'confirmed' }),
    );
  });

  it('respects an explicit status override', async () => {
    const { service, salesReportRepository } = buildService();
    await service.getSalesSummary('t1', query({ status: 'pending' }));
    expect(salesReportRepository.summaryByPeriod).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ status: 'pending' }),
    );
  });

  it('defaults the exceptional filter to "all" and echoes it in the response (F18-06)', async () => {
    const { service, salesReportRepository } = buildService();
    const result = await service.getSalesSummary('t1', query({ exceptional: undefined }));
    expect(salesReportRepository.summaryByPeriod).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ exceptional: 'all' }),
    );
    expect((result as { exceptional: string }).exceptional).toBe('all');
  });

  it('passes exceptional=only/exclude through to every grouping and echoes it (F18-06)', async () => {
    for (const [groupBy, method] of [
      ['day', 'summaryByPeriod'],
      ['customer', 'summaryByCustomer'],
      ['product', 'summaryByProduct'],
    ] as const) {
      for (const exceptional of ['only', 'exclude'] as const) {
        const { service, salesReportRepository } = buildService();
        const result = await service.getSalesSummary('t1', query({ groupBy, exceptional }));
        expect(salesReportRepository[method]).toHaveBeenCalledWith(
          expect.anything(),
          't1',
          expect.objectContaining({ exceptional }),
        );
        expect((result as { exceptional: string }).exceptional).toBe(exceptional);
      }
    }
  });

  it('dispatches groupBy=day/week/month to summaryByPeriod with the matching date_trunc unit', async () => {
    const { service, salesReportRepository } = buildService();
    for (const groupBy of ['day', 'week', 'month'] as const) {
      salesReportRepository.summaryByPeriod.mockClear();
      await service.getSalesSummary('t1', query({ groupBy }));
      expect(salesReportRepository.summaryByPeriod).toHaveBeenCalledWith(
        expect.anything(),
        't1',
        expect.objectContaining({ unit: groupBy }),
      );
      expect(salesReportRepository.summaryByCustomer).not.toHaveBeenCalled();
      expect(salesReportRepository.summaryByProduct).not.toHaveBeenCalled();
    }
  });

  it('dispatches groupBy=customer to summaryByCustomer only', async () => {
    const { service, salesReportRepository } = buildService();
    await service.getSalesSummary('t1', query({ groupBy: 'customer' }));
    expect(salesReportRepository.summaryByCustomer).toHaveBeenCalledTimes(1);
    expect(salesReportRepository.summaryByPeriod).not.toHaveBeenCalled();
    expect(salesReportRepository.summaryByProduct).not.toHaveBeenCalled();
  });

  it('dispatches groupBy=product to summaryByProduct only', async () => {
    const { service, salesReportRepository } = buildService();
    await service.getSalesSummary('t1', query({ groupBy: 'product' }));
    expect(salesReportRepository.summaryByProduct).toHaveBeenCalledTimes(1);
    expect(salesReportRepository.summaryByPeriod).not.toHaveBeenCalled();
    expect(salesReportRepository.summaryByCustomer).not.toHaveBeenCalled();
  });

  it('echoes the resolved tenant timezone, defaulting to UTC with no tenant_settings row', async () => {
    const { service, tenantSettingsRepository } = buildService();
    tenantSettingsRepository.find.mockResolvedValue(undefined);
    const result = await service.getSalesSummary('t1', query());
    expect(result.timezone).toBe('UTC');
  });

  it('echoes the real tenant_settings.timezone when a row exists', async () => {
    const { service, tenantSettingsRepository } = buildService();
    tenantSettingsRepository.find.mockResolvedValue({ timezone: 'America/Bogota' });
    const result = await service.getSalesSummary('t1', query());
    expect(result.timezone).toBe('America/Bogota');
  });

  it('converts numeric-string sums to numbers (Postgres SUM of exact-2dp values is always exact — no rounding needed there) and computes avgTicket = total / orderCount, half-up 2dp', async () => {
    const { service, salesReportRepository } = buildService();
    salesReportRepository.summaryByPeriod.mockResolvedValue([
      { key: '2026-09-01', orderCount: 3, subtotal: '100.00', discountTotal: '10.00', total: '91.00' },
    ]);
    const result = await service.getSalesSummary('t1', query());
    const bucket = result.buckets[0] as { subtotal: number; discountTotal: number; total: number; avgTicket: number };
    expect(bucket.subtotal).toBe(100);
    expect(bucket.discountTotal).toBe(10);
    expect(bucket.total).toBe(91);
    // 91 / 3 = 30.3333... -> half-up 2dp = 30.33, exercising roundMoney (not just a passthrough).
    expect(bucket.avgTicket).toBe(30.33);
  });

  it('avgTicket is 0 (never NaN/Infinity) for a zero-order bucket', async () => {
    const { service, salesReportRepository } = buildService();
    salesReportRepository.summaryByPeriod.mockResolvedValue([
      { key: '2026-09-01', orderCount: 0, subtotal: '0', discountTotal: '0', total: '0' },
    ]);
    const result = await service.getSalesSummary('t1', query());
    const bucket = result.buckets[0] as { avgTicket: number };
    expect(bucket.avgTicket).toBe(0);
  });

  it('returns an empty buckets array (not an error) when nothing matches the range', async () => {
    const { service } = buildService();
    const result = await service.getSalesSummary('t1', query());
    expect(result.buckets).toEqual([]);
    expect(result.from).toBe('2026-09-01T00:00:00.000Z');
    expect(result.to).toBe('2026-09-02T00:00:00.000Z');
    expect(result.groupBy).toBe('day');
    expect(result.currency).toBe('USD');
  });

  it('product buckets carry sku/productName/quantity, never subtotal/avgTicket', async () => {
    const { service, salesReportRepository } = buildService();
    salesReportRepository.summaryByProduct.mockResolvedValue([
      { key: 'variant-1', sku: 'SKU-1', productName: 'Widget', orderCount: '2', quantity: '5', discountTotal: '1.00', total: '50.00' },
    ]);
    const result = await service.getSalesSummary('t1', query({ groupBy: 'product' }));
    const bucket = result.buckets[0] as unknown as Record<string, unknown>;
    expect(bucket).toEqual({
      key: 'variant-1',
      sku: 'SKU-1',
      productName: 'Widget',
      orderCount: 2,
      quantity: 5,
      discountTotal: 1,
      total: 50,
    });
    expect(bucket).not.toHaveProperty('subtotal');
    expect(bucket).not.toHaveProperty('avgTicket');
  });

  it('customer buckets carry customerName + avgTicket', async () => {
    const { service, salesReportRepository } = buildService();
    salesReportRepository.summaryByCustomer.mockResolvedValue([
      { key: 'cust-1', customerName: 'Acme Corp', orderCount: 2, subtotal: '100.00', discountTotal: '0', total: '100.00' },
    ]);
    const result = await service.getSalesSummary('t1', query({ groupBy: 'customer' }));
    const bucket = result.buckets[0] as { customerName: string; avgTicket: number };
    expect(bucket.customerName).toBe('Acme Corp');
    expect(bucket.avgTicket).toBe(50);
  });
});
