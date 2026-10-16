import { describe, expect, it, vi } from 'vitest';
import { MovingAverageCostService } from './moving-average-cost.service';

function movement(partial: Record<string, unknown>) {
  return {
    id: 'm',
    occurredAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    movementType: 'RECEIPT',
    quantity: '0',
    unitCost: null,
    referenceType: null,
    referenceId: null,
    ...partial,
  };
}

function build(movements: unknown[], variantCost: number | null = 8) {
  const movementsRepository = { listForCosting: vi.fn().mockResolvedValue(movements) };
  const variantCostLookup = { getCost: vi.fn().mockResolvedValue(variantCost) };
  const service = new MovingAverageCostService(movementsRepository as never, variantCostLookup as never);
  return service;
}

describe('MovingAverageCostService.getSaleUnitCost', () => {
  it('returns the average cost vigente just before the order SALE — not the variant cost', async () => {
    const service = build(
      [
        movement({ id: 'm1', occurredAt: new Date('2026-01-01T00:00:00Z'), movementType: 'RECEIPT', quantity: '10', unitCost: '5' }),
        movement({ id: 'm2', occurredAt: new Date('2026-01-02T00:00:00Z'), movementType: 'RECEIPT', quantity: '10', unitCost: '7' }),
        movement({ id: 'm3', occurredAt: new Date('2026-01-03T00:00:00Z'), movementType: 'SALE', quantity: '-4', referenceType: 'order', referenceId: 'order-1' }),
        // Later inbound at a very different cost: must not influence the cost the sale drew at.
        movement({ id: 'm4', occurredAt: new Date('2026-01-04T00:00:00Z'), movementType: 'RECEIPT', quantity: '10', unitCost: '50' }),
      ],
      8,
    );
    const cost = await service.getSaleUnitCost({} as never, 't1', { productVariantId: 'v1', locationId: 'l1', orderId: 'order-1' });
    expect(cost).toBe(6);
  });

  it('is undefined when the order has no SALE movement for that variant at that location', async () => {
    const service = build([
      movement({ id: 'm1', movementType: 'RECEIPT', quantity: '10', unitCost: '5' }),
      movement({ id: 'm2', occurredAt: new Date('2026-01-02T00:00:00Z'), movementType: 'SALE', quantity: '-1', referenceType: 'order', referenceId: 'other-order' }),
    ]);
    const cost = await service.getSaleUnitCost({} as never, 't1', { productVariantId: 'v1', locationId: 'l1', orderId: 'order-1' });
    expect(cost).toBeUndefined();
  });
});
