import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReturnsReportService } from './returns-report.service';
import type { ReturnsSummaryQueryDto } from './dto/returns-summary-query.dto';

/** Same convention as sales-report.service.spec.ts (F18-02): mock withTenantTransaction to just
 * invoke its callback with a stub `tx` — no database, no Nest DI container. Real-PostgreSQL
 * coverage is test/reports/returns-summary.integration.test.ts. */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

function buildService() {
  const returnsReportRepository = {
    summaryByPeriod: vi.fn().mockResolvedValue([]),
    summaryByCustomer: vi.fn().mockResolvedValue([]),
    summaryByProduct: vi.fn().mockResolvedValue([]),
    summaryByDisposition: vi.fn().mockResolvedValue([]),
  };
  const tenantSettingsRepository = { find: vi.fn().mockResolvedValue(undefined) };
  const service = new ReturnsReportService(returnsReportRepository as never, tenantSettingsRepository as never, { resolveReadScope: vi.fn((_tx: unknown, _t: string, _u: string, loc?: string) => Promise.resolve(loc ? { locationId: loc } : {})) } as never);
  return { service, returnsReportRepository, tenantSettingsRepository };
}

interface QueryOverrides {
  from?: string | undefined;
  to?: string | undefined;
  groupBy?: ReturnsSummaryQueryDto['groupBy'] | undefined;
  status?: ReturnsSummaryQueryDto['status'] | undefined;
}

function query(overrides: QueryOverrides = {}): ReturnsSummaryQueryDto {
  return {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-02T00:00:00.000Z',
    groupBy: 'day',
    ...overrides,
  } as ReturnsSummaryQueryDto;
}

// Callers that read every return (the warehouse workflow) — the existing cases are about period / grouping / location scope.
const ALL_RETURNS = ['sales.returns.view', 'inventory.returns.manage'];

describe('ReturnsReportService.getReturnsSummary', () => {
  it('rejects when `from` is missing', async () => {
    const { service } = buildService();
    await expect(service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ from: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `to` is missing', async () => {
    const { service } = buildService();
    await expect(service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ to: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `from` is not strictly before `to`', async () => {
    const { service } = buildService();
    await expect(
      service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ from: '2026-09-02T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ from: '2026-09-03T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('defaults status to "resolved" when omitted', async () => {
    const { service, returnsReportRepository } = buildService();
    await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ status: undefined }));
    expect(returnsReportRepository.summaryByPeriod).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ status: 'resolved' }),
    );
  });

  it('respects an explicit status override', async () => {
    const { service, returnsReportRepository } = buildService();
    await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ status: 'requested' }));
    expect(returnsReportRepository.summaryByPeriod).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ status: 'requested' }),
    );
  });

  it('dispatches groupBy=day/week/month to summaryByPeriod with the matching date_trunc unit, and no other repository method', async () => {
    const { service, returnsReportRepository } = buildService();
    for (const groupBy of ['day', 'week', 'month'] as const) {
      returnsReportRepository.summaryByPeriod.mockClear();
      await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ groupBy }));
      expect(returnsReportRepository.summaryByPeriod).toHaveBeenCalledWith(
        expect.anything(),
        't1',
        expect.objectContaining({ unit: groupBy }),
      );
      expect(returnsReportRepository.summaryByCustomer).not.toHaveBeenCalled();
      expect(returnsReportRepository.summaryByProduct).not.toHaveBeenCalled();
      expect(returnsReportRepository.summaryByDisposition).not.toHaveBeenCalled();
    }
  });

  it('dispatches groupBy=customer to summaryByCustomer only', async () => {
    const { service, returnsReportRepository } = buildService();
    await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ groupBy: 'customer' }));
    expect(returnsReportRepository.summaryByCustomer).toHaveBeenCalledTimes(1);
    expect(returnsReportRepository.summaryByPeriod).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByProduct).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByDisposition).not.toHaveBeenCalled();
  });

  it('dispatches groupBy=product to summaryByProduct only', async () => {
    const { service, returnsReportRepository } = buildService();
    await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ groupBy: 'product' }));
    expect(returnsReportRepository.summaryByProduct).toHaveBeenCalledTimes(1);
    expect(returnsReportRepository.summaryByPeriod).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByCustomer).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByDisposition).not.toHaveBeenCalled();
  });

  it('dispatches groupBy=disposition to summaryByDisposition only', async () => {
    const { service, returnsReportRepository } = buildService();
    await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ groupBy: 'disposition' }));
    expect(returnsReportRepository.summaryByDisposition).toHaveBeenCalledTimes(1);
    expect(returnsReportRepository.summaryByPeriod).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByCustomer).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByProduct).not.toHaveBeenCalled();
  });

  it('echoes the resolved tenant timezone, defaulting to UTC with no tenant_settings row', async () => {
    const { service, tenantSettingsRepository } = buildService();
    tenantSettingsRepository.find.mockResolvedValue(undefined);
    const result = await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query());
    expect(result.timezone).toBe('UTC');
  });

  it('echoes the real tenant_settings.timezone when a row exists', async () => {
    const { service, tenantSettingsRepository } = buildService();
    tenantSettingsRepository.find.mockResolvedValue({ timezone: 'America/Bogota' });
    const result = await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query());
    expect(result.timezone).toBe('America/Bogota');
  });

  it('converts numeric-string sums to numbers and computes avgReturnValue = returnedValue / returnCount, half-up 2dp', async () => {
    const { service, returnsReportRepository } = buildService();
    returnsReportRepository.summaryByPeriod.mockResolvedValue([
      { key: '2026-09-01', returnCount: '3', orderCount: '3', lineCount: '4', quantity: '10', returnedValue: '91.00' },
    ]);
    const result = await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query());
    const bucket = result.buckets[0] as {
      returnCount: number;
      orderCount: number;
      lineCount: number;
      quantity: number;
      returnedValue: number;
      avgReturnValue: number;
    };
    expect(bucket.returnCount).toBe(3);
    expect(bucket.orderCount).toBe(3);
    expect(bucket.lineCount).toBe(4);
    expect(bucket.quantity).toBe(10);
    expect(bucket.returnedValue).toBe(91);
    // 91 / 3 = 30.3333... -> half-up 2dp = 30.33, exercising roundMoney (not just a passthrough).
    expect(bucket.avgReturnValue).toBe(30.33);
  });

  it('avgReturnValue is 0 (never NaN/Infinity) for a zero-return bucket', async () => {
    const { service, returnsReportRepository } = buildService();
    returnsReportRepository.summaryByPeriod.mockResolvedValue([
      { key: '2026-09-01', returnCount: '0', orderCount: '0', lineCount: '0', quantity: '0', returnedValue: '0' },
    ]);
    const result = await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query());
    const bucket = result.buckets[0] as { avgReturnValue: number };
    expect(bucket.avgReturnValue).toBe(0);
  });

  it('returns an empty buckets array (not an error) when nothing matches the range', async () => {
    const { service } = buildService();
    const result = await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query());
    expect(result.buckets).toEqual([]);
    expect(result.from).toBe('2026-09-01T00:00:00.000Z');
    expect(result.to).toBe('2026-09-02T00:00:00.000Z');
    expect(result.groupBy).toBe('day');
    expect(result.currency).toBe('USD');
  });

  it('product buckets carry sku/productName/orderCount, never avgReturnValue', async () => {
    const { service, returnsReportRepository } = buildService();
    returnsReportRepository.summaryByProduct.mockResolvedValue([
      { key: 'variant-1', sku: 'SKU-1', productName: 'Widget', returnCount: '2', orderCount: '2', lineCount: '2', quantity: '5', returnedValue: '50.00' },
    ]);
    const result = await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ groupBy: 'product' }));
    const bucket = result.buckets[0] as unknown as Record<string, unknown>;
    expect(bucket).toEqual({
      key: 'variant-1',
      sku: 'SKU-1',
      productName: 'Widget',
      returnCount: 2,
      orderCount: 2,
      lineCount: 2,
      quantity: 5,
      returnedValue: 50,
    });
    expect(bucket).not.toHaveProperty('avgReturnValue');
  });

  it('customer buckets carry customerName + avgReturnValue', async () => {
    const { service, returnsReportRepository } = buildService();
    returnsReportRepository.summaryByCustomer.mockResolvedValue([
      { key: 'cust-1', customerName: 'Acme Corp', returnCount: '2', orderCount: '2', lineCount: '2', quantity: '4', returnedValue: '100.00' },
    ]);
    const result = await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ groupBy: 'customer' }));
    const bucket = result.buckets[0] as { customerName: string; avgReturnValue: number };
    expect(bucket.customerName).toBe('Acme Corp');
    expect(bucket.avgReturnValue).toBe(50);
  });

  it('disposition buckets carry lineCount/quantity/returnedValue, never returnCount/orderCount/avgReturnValue', async () => {
    const { service, returnsReportRepository } = buildService();
    returnsReportRepository.summaryByDisposition.mockResolvedValue([
      { key: 'restock', lineCount: '3', quantity: '7', returnedValue: '70.00' },
    ]);
    const result = await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, query({ groupBy: 'disposition' }));
    const bucket = result.buckets[0] as unknown as Record<string, unknown>;
    expect(bucket).toEqual({ key: 'restock', lineCount: 3, quantity: 7, returnedValue: 70 });
    expect(bucket).not.toHaveProperty('returnCount');
    expect(bucket).not.toHaveProperty('orderCount');
    expect(bucket).not.toHaveProperty('avgReturnValue');
  });
});

describe('ReturnsReportService.getReturnsSummary — business-day mode and Recibido en', () => {
  it('dateFrom alone resolves to exactly one tenant-local day and passes locationId through', async () => {
    const repo = { summaryByPeriod: vi.fn().mockResolvedValue([]), summaryByCustomer: vi.fn(), summaryByProduct: vi.fn(), summaryByDisposition: vi.fn() };
    const settings = { find: vi.fn().mockResolvedValue({ timezone: 'America/Guayaquil' }) };
    const service = new ReturnsReportService(repo as never, settings as never, { resolveReadScope: vi.fn((_tx: unknown, _t: string, _u: string, loc?: string) => Promise.resolve(loc ? { locationId: loc } : {})) } as never);
    const res = await service.getReturnsSummary('t1', 'u1', ALL_RETURNS, { groupBy: 'day', dateFrom: '2026-10-13', locationId: 'loc-1' } as never);
    const args = repo.summaryByPeriod.mock.calls[0]![2] as { gte: Date; lt: Date; locationId: string };
    expect(args.gte.toISOString()).toBe('2026-10-13T05:00:00.000Z');
    expect(args.lt.toISOString()).toBe('2026-10-14T05:00:00.000Z');
    expect(args.locationId).toBe('loc-1');
    expect(res.from).toBe('2026-10-13T05:00:00.000Z');
  });

  it('rejects dateTo without dateFrom and a missing range', async () => {
    const service = new ReturnsReportService({} as never, { find: vi.fn() } as never, { resolveReadScope: vi.fn((_tx: unknown, _t: string, _u: string, loc?: string) => Promise.resolve(loc ? { locationId: loc } : {})) } as never);
    await expect(service.getReturnsSummary('t1', 'u1', ALL_RETURNS, { groupBy: 'day', dateTo: '2026-10-13' } as never)).rejects.toThrow();
    await expect(service.getReturnsSummary('t1', 'u1', ALL_RETURNS, { groupBy: 'day' } as never)).rejects.toThrow();
  });
});

describe('ReturnsReportService.getReturnsSummary — seller scope (the aggregate must not reveal what GET /sales-returns hides)', () => {
  const GROUPS = ['day', 'customer', 'product', 'disposition'] as const;
  const method = { day: 'summaryByPeriod', customer: 'summaryByCustomer', product: 'summaryByProduct', disposition: 'summaryByDisposition' } as const;

  it('a seller without view_all / warehouse rights aggregates ONLY the returns of their own orders, for every groupBy', async () => {
    for (const groupBy of GROUPS) {
      const { service, returnsReportRepository } = buildService();
      await service.getReturnsSummary('t1', 'seller-1', ['sales.returns.view'], query({ groupBy }));
      expect(returnsReportRepository[method[groupBy]].mock.calls[0]![2], groupBy).toMatchObject({ placedByUserId: 'seller-1' });
    }
  });

  it('view_all and the warehouse workflow aggregate every return — no seller filter', async () => {
    for (const perms of [['sales.returns.view', 'sales.orders.view_all'], ['sales.returns.view', 'inventory.returns.manage']]) {
      const { service, returnsReportRepository } = buildService();
      await service.getReturnsSummary('t1', 'u1', perms, query({ groupBy: 'day' }));
      expect((returnsReportRepository.summaryByPeriod.mock.calls[0]![2] as { placedByUserId?: string }).placedByUserId).toBeUndefined();
    }
  });
});
