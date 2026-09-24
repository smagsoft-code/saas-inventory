import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KardexReportService } from './kardex-report.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const VARIANT_ID = 'variant-1';
const LOCATION_ID = 'location-1';
const ORDER_ID = 'order-1';

function movementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `mv-${Math.random()}`,
    occurredAt: new Date('2026-01-05T00:00:00Z'),
    movementType: 'RECEIPT',
    quantity: '10',
    reason: 'Restock',
    referenceType: 'manual_adjustment',
    referenceId: null,
    unitCost: '5',
    ...overrides,
  };
}

function buildService() {
  const repository = {
    listMovements: vi.fn().mockResolvedValue([]),
    getVariantCost: vi.fn().mockResolvedValue(null),
    resolveOrderNumbers: vi.fn().mockResolvedValue(new Map()),
    resolveReturnOrderNumbers: vi.fn().mockResolvedValue(new Map()),
    resolveReceiptTransferIds: vi.fn().mockResolvedValue(new Map()),
    listLocationBalances: vi.fn().mockResolvedValue([]),
    getVariantDisplayInfo: vi.fn().mockResolvedValue({ productId: 'product-1', productName: 'Producto X', sku: 'SKU-1' }),
  };
  const service = new KardexReportService(repository as never);
  return { service, repository };
}

describe('KardexReportService.getKardex', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when from is not strictly before to', async () => {
    const { service } = buildService();
    await expect(
      service.getKardex(TENANT_ID, { productVariantId: VARIANT_ID, locationId: LOCATION_ID, from: '2026-09-02T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' }, true),
    ).rejects.toThrow(BadRequestException);
  });

  it('folds a RECEIPT row into opening=0/closing with running average, when caller can view cost', async () => {
    const { service, repository } = buildService();
    repository.listMovements.mockResolvedValueOnce([movementRow()]);

    const result = await service.getKardex(TENANT_ID, { productVariantId: VARIANT_ID, locationId: LOCATION_ID }, true);

    expect(result).toMatchObject({ productId: 'product-1', productName: 'Producto X', sku: 'SKU-1' });
    expect(result.opening).toEqual({ stockUnits: 0, averageCost: 0, stockValue: 0, estimated: false });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ entrada: 10, salida: 0, unitCost: 5, averageCostAfter: 5, stockAfter: 10, stockValueAfter: 50 });
    expect(result.closing).toEqual({ stockUnits: 10, averageCost: 5, stockValue: 50, estimated: false });
  });

  it('omits cost fields entirely when the caller lacks pricing.cost.view', async () => {
    const { service, repository } = buildService();
    repository.listMovements.mockResolvedValueOnce([movementRow()]);

    const result = await service.getKardex(TENANT_ID, { productVariantId: VARIANT_ID, locationId: LOCATION_ID }, false);

    expect(result.opening).toEqual({ stockUnits: 0 });
    expect(result.rows[0]).not.toHaveProperty('unitCost');
    expect(result.rows[0]).not.toHaveProperty('averageCostAfter');
    expect(result.rows[0]).not.toHaveProperty('stockValueAfter');
    expect(result.closing).toEqual({ stockUnits: 10 });
  });

  it('seeds the opening balance from movements before `from`, not from zero', async () => {
    const { service, repository } = buildService();
    repository.listMovements
      .mockResolvedValueOnce([movementRow({ quantity: '10', unitCost: '5' })]) // prior history
      .mockResolvedValueOnce([movementRow({ quantity: '10', unitCost: '7' })]); // in-range

    const result = await service.getKardex(TENANT_ID, { productVariantId: VARIANT_ID, locationId: LOCATION_ID, from: '2026-01-10T00:00:00.000Z' }, true);

    expect(result.opening).toEqual({ stockUnits: 10, averageCost: 5, stockValue: 50, estimated: false });
    expect(result.rows[0]).toMatchObject({ averageCostAfter: 6, stockAfter: 20, stockValueAfter: 120 });
  });

  it('labels a SALE row with the order number resolved from the reference chain', async () => {
    const { service, repository } = buildService();
    repository.listMovements.mockResolvedValueOnce([
      movementRow({ movementType: 'SALE', quantity: '-3', unitCost: null, referenceType: 'order', referenceId: ORDER_ID, reason: null }),
    ]);
    repository.resolveOrderNumbers.mockResolvedValueOnce(new Map([[ORDER_ID, 'ORD-000123']]));

    const result = await service.getKardex(TENANT_ID, { productVariantId: VARIANT_ID, locationId: LOCATION_ID }, true);

    expect(result.rows[0]!.label).toBe('Venta #ORD-000123');
    expect(result.rows[0]!.salida).toBe(3);
  });

  it('marks the response truncated when the range exceeds the row cap', async () => {
    const { service, repository } = buildService();
    const overflow = Array.from({ length: 2001 }, (_, index) => movementRow({ id: `mv-${index}`, quantity: '1', unitCost: '1' }));
    repository.listMovements.mockResolvedValueOnce(overflow);

    const result = await service.getKardex(TENANT_ID, { productVariantId: VARIANT_ID, locationId: LOCATION_ID }, true);

    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(2000);
  });

  it('falls back to the variant cost and flags the row as estimated when a legacy movement has no unitCost', async () => {
    const { service, repository } = buildService();
    repository.getVariantCost.mockResolvedValueOnce(9);
    repository.listMovements.mockResolvedValueOnce([movementRow({ unitCost: null })]);

    const result = await service.getKardex(TENANT_ID, { productVariantId: VARIANT_ID, locationId: LOCATION_ID }, true);

    expect(result.rows[0]).toMatchObject({ unitCost: 9, unitCostEstimated: true });
    expect(result.closing.estimated).toBe(true);
  });
});
