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
  const service = new ReturnsReportService(returnsReportRepository as never, tenantSettingsRepository as never);
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

describe('ReturnsReportService.getReturnsSummary', () => {
  it('rejects when `from` is missing', async () => {
    const { service } = buildService();
    await expect(service.getReturnsSummary('t1', query({ from: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `to` is missing', async () => {
    const { service } = buildService();
    await expect(service.getReturnsSummary('t1', query({ to: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `from` is not strictly before `to`', async () => {
    const { service } = buildService();
    await expect(
      service.getReturnsSummary('t1', query({ from: '2026-09-02T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.getReturnsSummary('t1', query({ from: '2026-09-03T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('defaults status to "resolved" when omitted', async () => {
    const { service, returnsReportRepository } = buildService();
    await service.getReturnsSummary('t1', query({ status: undefined }));
    expect(returnsReportRepository.summaryByPeriod).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ status: 'resolved' }),
    );
  });

  it('respects an explicit status override', async () => {
    const { service, returnsReportRepository } = buildService();
    await service.getReturnsSummary('t1', query({ status: 'requested' }));
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
      await service.getReturnsSummary('t1', query({ groupBy }));
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
    await service.getReturnsSummary('t1', query({ groupBy: 'customer' }));
    expect(returnsReportRepository.summaryByCustomer).toHaveBeenCalledTimes(1);
    expect(returnsReportRepository.summaryByPeriod).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByProduct).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByDisposition).not.toHaveBeenCalled();
  });

  it('dispatches groupBy=product to summaryByProduct only', async () => {
    const { service, returnsReportRepository } = buildService();
    await service.getReturnsSummary('t1', query({ groupBy: 'product' }));
    expect(returnsReportRepository.summaryByProduct).toHaveBeenCalledTimes(1);
    expect(returnsReportRepository.summaryByPeriod).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByCustomer).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByDisposition).not.toHaveBeenCalled();
  });

  it('dispatches groupBy=disposition to summaryByDisposition only', async () => {
    const { service, returnsReportRepository } = buildService();
    await service.getReturnsSummary('t1', query({ groupBy: 'disposition' }));
    expect(returnsReportRepository.summaryByDisposition).toHaveBeenCalledTimes(1);
    expect(returnsReportRepository.summaryByPeriod).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByCustomer).not.toHaveBeenCalled();
    expect(returnsReportRepository.summaryByProduct).not.toHaveBeenCalled();
  });

  it('echoes the resolved tenant timezone, defaulting to UTC with no tenant_settings row', async () => {
    const { service, tenantSettingsRepository } = buildService();
    tenantSettingsRepository.find.mockResolvedValue(undefined);
    const result = await service.getReturnsSummary('t1', query());
    expect(result.timezone).toBe('UTC');
  });

  it('echoes the real tenant_settings.timezone when a row exists', async () => {
    const { service, tenantSettingsRepository } = buildService();
    tenantSettingsRepository.find.mockResolvedValue({ timezone: 'America/Bogota' });
    const result = await service.getReturnsSummary('t1', query());
    expect(result.timezone).toBe('America/Bogota');
  });

  it('converts numeric-string sums to numbers and computes avgReturnValue = returnedValue / returnCount, half-up 2dp', async () => {
    const { service, returnsReportRepository } = buildService();
    returnsReportRepository.summaryByPeriod.mockResolvedValue([
      { key: '2026-09-01', returnCount: '3', orderCount: '3', lineCount: '4', quantity: '10', returnedValue: '91.00' },
    ]);
    const result = await service.getReturnsSummary('t1', query());
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
    const result = await service.getReturnsSummary('t1', query());
    const bucket = result.buckets[0] as { avgReturnValue: number };
    expect(bucket.avgReturnValue).toBe(0);
  });

  it('returns an empty buckets array (not an error) when nothing matches the range', async () => {
    const { service } = buildService();
    const result = await service.getReturnsSummary('t1', query());
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
    const result = await service.getReturnsSummary('t1', query({ groupBy: 'product' }));
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
    const result = await service.getReturnsSummary('t1', query({ groupBy: 'customer' }));
    const bucket = result.buckets[0] as { customerName: string; avgReturnValue: number };
    expect(bucket.customerName).toBe('Acme Corp');
    expect(bucket.avgReturnValue).toBe(50);
  });

  it('disposition buckets carry lineCount/quantity/returnedValue, never returnCount/orderCount/avgReturnValue', async () => {
    const { service, returnsReportRepository } = buildService();
    returnsReportRepository.summaryByDisposition.mockResolvedValue([
      { key: 'restock', lineCount: '3', quantity: '7', returnedValue: '70.00' },
    ]);
    const result = await service.getReturnsSummary('t1', query({ groupBy: 'disposition' }));
    const bucket = result.buckets[0] as unknown as Record<string, unknown>;
    expect(bucket).toEqual({ key: 'restock', lineCount: 3, quantity: 7, returnedValue: 70 });
    expect(bucket).not.toHaveProperty('returnCount');
    expect(bucket).not.toHaveProperty('orderCount');
    expect(bucket).not.toHaveProperty('avgReturnValue');
  });
});
