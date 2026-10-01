import { describe, expect, it, vi } from 'vitest';
import { InventoryReportService } from './inventory-report.service';
import type { InventorySummaryQueryDto } from './dto/inventory-summary-query.dto';

/** Same convention as sales-report.service.spec.ts (F18-02): mock withTenantTransaction to just
 * invoke its callback with a stub `tx` — no database, no Nest DI container. Real-PostgreSQL
 * coverage is test/reports/inventory-summary.integration.test.ts. */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

function buildService() {
  const inventoryReportRepository = {
    summaryByWarehouse: vi.fn().mockResolvedValue([]),
    summaryByCategory: vi.fn().mockResolvedValue([]),
    totals: vi.fn().mockResolvedValue({ availableQuantity: '0', reservedQuantity: '0', outOfStockCount: '0' }),
  };
  const service = new InventoryReportService(inventoryReportRepository as never);
  return { service, inventoryReportRepository };
}

function query(overrides: Partial<InventorySummaryQueryDto> = {}): InventorySummaryQueryDto {
  return { groupBy: 'warehouse', ...overrides } as InventorySummaryQueryDto;
}

describe('InventoryReportService.getInventorySummary', () => {
  it('defaults to groupBy=warehouse, calling summaryByWarehouse only', async () => {
    const { service, inventoryReportRepository } = buildService();
    await service.getInventorySummary('t1', query(), false);
    expect(inventoryReportRepository.summaryByWarehouse).toHaveBeenCalledTimes(1);
    expect(inventoryReportRepository.summaryByCategory).not.toHaveBeenCalled();
  });

  it('dispatches groupBy=category to summaryByCategory only', async () => {
    const { service, inventoryReportRepository } = buildService();
    await service.getInventorySummary('t1', query({ groupBy: 'category' }));
    expect(inventoryReportRepository.summaryByCategory).toHaveBeenCalledTimes(1);
    expect(inventoryReportRepository.summaryByWarehouse).not.toHaveBeenCalled();
  });

  it('passes warehouseId/locationId/categoryId filters through to the repository', async () => {
    const { service, inventoryReportRepository } = buildService();
    await service.getInventorySummary('t1', query({ warehouseId: 'w1', locationId: 'l1', categoryId: 'c1' }));
    expect(inventoryReportRepository.summaryByWarehouse).toHaveBeenCalledWith(expect.anything(), 't1', {
      warehouseId: 'w1',
      locationId: 'l1',
      categoryId: 'c1',
    });
    expect(inventoryReportRepository.totals).toHaveBeenCalledWith(expect.anything(), 't1', {
      warehouseId: 'w1',
      locationId: 'l1',
      categoryId: 'c1',
    });
  });

  it('never sends tenantId from anywhere but the CurrentTenant-resolved argument', async () => {
    const { service, inventoryReportRepository } = buildService();
    await service.getInventorySummary('t1', query(), false);
    expect(JSON.stringify(inventoryReportRepository.summaryByWarehouse.mock.calls)).toContain('t1');
  });

  it('converts numeric-string aggregates to numbers', async () => {
    const { service, inventoryReportRepository } = buildService();
    inventoryReportRepository.totals.mockResolvedValue({ availableQuantity: '120', reservedQuantity: '20', outOfStockCount: '3' });
    const result = await service.getInventorySummary('t1', query());
    expect(result.totals).toEqual({ availableQuantity: 120, reservedQuantity: 20, outOfStockCount: 3 });
  });

  it('maps warehouse bucket rows: key/warehouseName/quantities', async () => {
    const { service, inventoryReportRepository } = buildService();
    inventoryReportRepository.summaryByWarehouse.mockResolvedValue([
      { key: 'wh-1', name: 'Main Warehouse', availableQuantity: '100', reservedQuantity: '20', outOfStockCount: '3' },
    ]);
    const result = await service.getInventorySummary('t1', query());
    expect(result.buckets[0]).toEqual({
      key: 'wh-1',
      warehouseName: 'Main Warehouse',
      availableQuantity: 100,
      reservedQuantity: 20,
      outOfStockCount: 3,
    });
  });

  it('maps a real category bucket row: key/categoryName/quantities', async () => {
    const { service, inventoryReportRepository } = buildService();
    inventoryReportRepository.summaryByCategory.mockResolvedValue([
      { key: 'cat-1', name: 'Appliances', availableQuantity: '50', reservedQuantity: '5', outOfStockCount: '1' },
    ]);
    const result = await service.getInventorySummary('t1', query({ groupBy: 'category' }));
    expect(result.buckets[0]).toEqual({
      key: 'cat-1',
      categoryName: 'Appliances',
      availableQuantity: 50,
      reservedQuantity: 5,
      outOfStockCount: 1,
    });
  });

  it('maps a NULL category_id (no category assigned) to the "uncategorized" sentinel — never an invented UUID', async () => {
    const { service, inventoryReportRepository } = buildService();
    inventoryReportRepository.summaryByCategory.mockResolvedValue([
      { key: null, name: null, availableQuantity: '10', reservedQuantity: '0', outOfStockCount: '0' },
    ]);
    const result = await service.getInventorySummary('t1', query({ groupBy: 'category' }));
    expect(result.buckets[0]).toEqual({
      key: 'uncategorized',
      categoryName: 'Uncategorized',
      availableQuantity: 10,
      reservedQuantity: 0,
      outOfStockCount: 0,
    });
  });

  it('echoes groupBy and a fresh generatedAt timestamp, never a stored snapshot', async () => {
    const { service } = buildService();
    const before = Date.now();
    const result = await service.getInventorySummary('t1', query({ groupBy: 'category' }));
    expect(result.groupBy).toBe('category');
    expect(new Date(result.generatedAt).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('returns an empty buckets array (not an error) when nothing matches the filter', async () => {
    const { service } = buildService();
    const result = await service.getInventorySummary('t1', query());
    expect(result.buckets).toEqual([]);
  });

  it('omits totalCostValue/missingCostCount entirely when the caller lacks pricing.cost.view', async () => {
    const { service, inventoryReportRepository } = buildService();
    inventoryReportRepository.totals.mockResolvedValue({
      availableQuantity: '10',
      reservedQuantity: '0',
      outOfStockCount: '0',
      totalCostValue: '999',
      missingCostCount: '2',
    });
    const result = await service.getInventorySummary('t1', query(), false);
    expect(result.totals).toEqual({ availableQuantity: 10, reservedQuantity: 0, outOfStockCount: 0 });
    expect(result.totals).not.toHaveProperty('totalCostValue');
    expect(result.totals).not.toHaveProperty('missingCostCount');
  });

  it('includes totalCostValue/missingCostCount as numbers when the caller holds pricing.cost.view', async () => {
    const { service, inventoryReportRepository } = buildService();
    inventoryReportRepository.totals.mockResolvedValue({
      availableQuantity: '10',
      reservedQuantity: '0',
      outOfStockCount: '0',
      totalCostValue: '1234.5',
      missingCostCount: '2',
    });
    const result = await service.getInventorySummary('t1', query(), true);
    expect(result.totals).toEqual({
      availableQuantity: 10,
      reservedQuantity: 0,
      outOfStockCount: 0,
      totalCostValue: 1234.5,
      missingCostCount: 2,
    });
  });
});
