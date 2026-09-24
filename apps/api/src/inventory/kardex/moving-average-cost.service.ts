import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../database/tenant-context';
import { InventoryMovementsRepository } from '../repositories/inventory-movements.repository';
import { computeClosingBalance, type KardexBalanceState, type KardexSourceMovement } from './kardex-costing';
import { VariantCostLookupRepository } from './variant-cost-lookup.repository';

function toSourceMovement(row: { id: string; occurredAt: Date; movementType: string; quantity: string; unitCost: string | null }): KardexSourceMovement {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    movementType: row.movementType,
    quantity: Number(row.quantity),
    unitCost: row.unitCost !== null ? Number(row.unitCost) : null,
  };
}

/**
 * The write-side face of kardex-costing.ts's fold — "what's the moving average cost for this
 * (variant, location) right now, before I insert a new movement". Called from within the same
 * transaction that holds the balance row's `FOR UPDATE` lock (stock-ledger.service.ts), so the
 * history it folds cannot change underneath it. Used only by the two write paths that need a
 * computed cost rather than a directly-known one: a manual ADJUSTMENT_IN with no explicit unit
 * cost, and a transfer dispatch (TRANSFER_OUT) — see each call site's own comment for why every
 * other movement type either requires an explicit cost, copies one, or never carries one at all.
 */
@Injectable()
export class MovingAverageCostService {
  constructor(
    private readonly movementsRepository: InventoryMovementsRepository,
    private readonly variantCostLookup: VariantCostLookupRepository,
  ) {}

  async getCurrentAverageCost(
    tx: TenantTransaction,
    tenantId: string,
    productVariantId: string,
    locationId: string,
  ): Promise<KardexBalanceState> {
    const [movements, fallbackCost] = await Promise.all([
      this.movementsRepository.listForCosting(tx, tenantId, { productVariantId, locationId }),
      this.variantCostLookup.getCost(tx, tenantId, productVariantId),
    ]);
    return computeClosingBalance(movements.map(toSourceMovement), fallbackCost);
  }
}
