import { describe, expect, it, vi } from 'vitest';
import { TransfersReportService } from './transfers-report.service';
import type { TransfersSummaryQueryDto } from './dto/transfers-summary-query.dto';

/** Same convention as the other reports service specs (F18-02..07): mock withTenantTransaction to
 * just invoke its callback with a stub `tx` — no database, no Nest DI container. Real-PostgreSQL
 * coverage is test/reports/transfers-summary.integration.test.ts. */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

function buildService() {
  const transfersReportRepository = {
    totals: vi.fn().mockResolvedValue({ inTransitQuantity: '0', openTransferCount: '0' }),
    statusBuckets: vi.fn().mockResolvedValue([]),
    destinationBuckets: vi.fn().mockResolvedValue([]),
    variantBuckets: vi.fn().mockResolvedValue([]),
  };
  const service = new TransfersReportService(transfersReportRepository as never);
  return { service, transfersReportRepository };
}

const query = (overrides: Partial<TransfersSummaryQueryDto> = {}): TransfersSummaryQueryDto =>
  ({ groupBy: 'status', ...overrides }) as TransfersSummaryQueryDto;

describe('TransfersReportService.getTransfersSummary', () => {
  it('defaults to the status rollup and never touches the item-grain bucket queries', async () => {
    const { service, transfersReportRepository } = buildService();
    await service.getTransfersSummary('t1', query());
    expect(transfersReportRepository.statusBuckets).toHaveBeenCalledTimes(1);
    expect(transfersReportRepository.destinationBuckets).not.toHaveBeenCalled();
    expect(transfersReportRepository.variantBuckets).not.toHaveBeenCalled();
  });

  it('dispatches groupBy=destination to destinationBuckets only', async () => {
    const { service, transfersReportRepository } = buildService();
    await service.getTransfersSummary('t1', query({ groupBy: 'destination' }));
    expect(transfersReportRepository.destinationBuckets).toHaveBeenCalledTimes(1);
    expect(transfersReportRepository.statusBuckets).not.toHaveBeenCalled();
    expect(transfersReportRepository.variantBuckets).not.toHaveBeenCalled();
  });

  it('dispatches groupBy=variant to variantBuckets only', async () => {
    const { service, transfersReportRepository } = buildService();
    await service.getTransfersSummary('t1', query({ groupBy: 'variant' }));
    expect(transfersReportRepository.variantBuckets).toHaveBeenCalledTimes(1);
    expect(transfersReportRepository.statusBuckets).not.toHaveBeenCalled();
  });

  it('always loads the groupBy-independent totals', async () => {
    const { service, transfersReportRepository } = buildService();
    for (const groupBy of ['status', 'destination', 'variant'] as const) {
      transfersReportRepository.totals.mockClear();
      await service.getTransfersSummary('t1', query({ groupBy }));
      expect(transfersReportRepository.totals).toHaveBeenCalledTimes(1);
    }
  });

  it('converts numeric-string totals to numbers', async () => {
    const { service, transfersReportRepository } = buildService();
    transfersReportRepository.totals.mockResolvedValue({ inTransitQuantity: '42', openTransferCount: '3' });
    const result = await service.getTransfersSummary('t1', query());
    expect(result.totals).toEqual({ inTransitQuantity: 42, openTransferCount: 3 });
    expect(result.groupBy).toBe('status');
    expect(typeof result.generatedAt).toBe('string');
  });

  it('maps status buckets, converting transferCount to a number', async () => {
    const { service, transfersReportRepository } = buildService();
    transfersReportRepository.statusBuckets.mockResolvedValue([
      { key: 'draft', transferCount: '2' },
      { key: 'dispatched', transferCount: '1' },
    ]);
    const result = await service.getTransfersSummary('t1', query());
    expect(result.buckets).toEqual([
      { key: 'draft', transferCount: 2 },
      { key: 'dispatched', transferCount: 1 },
    ]);
  });

  it('maps destination buckets with name + both numeric fields', async () => {
    const { service, transfersReportRepository } = buildService();
    transfersReportRepository.destinationBuckets.mockResolvedValue([
      { key: 'loc-1', destinationName: 'Store A', inTransitQuantity: '15', openTransferCount: '2' },
    ]);
    const result = await service.getTransfersSummary('t1', query({ groupBy: 'destination' }));
    expect(result.buckets).toEqual([
      { key: 'loc-1', destinationName: 'Store A', inTransitQuantity: 15, openTransferCount: 2 },
    ]);
  });

  it('maps variant buckets with sku + product name', async () => {
    const { service, transfersReportRepository } = buildService();
    transfersReportRepository.variantBuckets.mockResolvedValue([
      { key: 'var-1', sku: 'SKU-1', productName: 'Widget', inTransitQuantity: '7' },
    ]);
    const result = await service.getTransfersSummary('t1', query({ groupBy: 'variant' }));
    expect(result.buckets).toEqual([{ key: 'var-1', sku: 'SKU-1', productName: 'Widget', inTransitQuantity: 7 }]);
  });

  it('returns an empty buckets array (never an error) when nothing is open', async () => {
    const { service } = buildService();
    const result = await service.getTransfersSummary('t1', query({ groupBy: 'destination' }));
    expect(result.buckets).toEqual([]);
    expect(result).not.toHaveProperty('currency');
  });
});
