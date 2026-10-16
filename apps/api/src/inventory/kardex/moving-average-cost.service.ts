import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../../database/tenant-context';
import { InventoryMovementsRepository } from '../repositories/inventory-movements.repository';
import {
  computeClosingBalance,
  foldKardexLedger,
  ZERO_BALANCE,
  type KardexBalanceState,
  type KardexSourceMovement,
} from './kardex-costing';
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

  /**
   * The unit cost an order's SALE actually drew at: the average cost vigente immediately before that
   * SALE movement at the sale's location, exactly as the Kardex shows it in that row's Costo U (an
   * outflow never stores a cost of its own — it draws at the running average). Used to value a
   * return at the cost the sale removed, so the reingreso does not distort the average. `undefined`
   * when the order has no SALE movement for that variant at that location.
   */
  async getSaleUnitCost(
    tx: TenantTransaction,
    tenantId: string,
    params: { productVariantId: string; locationId: string; orderId: string },
  ): Promise<number | undefined> {
    const [movements, fallbackCost] = await Promise.all([
      this.movementsRepository.listForCosting(tx, tenantId, {
        productVariantId: params.productVariantId,
        locationId: params.locationId,
      }),
      this.variantCostLookup.getCost(tx, tenantId, params.productVariantId),
    ]);
    const sale = movements.find(
      (m) => m.movementType === 'SALE' && m.referenceType === 'order' && m.referenceId === params.orderId,
    );
    if (!sale) {
      return undefined;
    }
    const { rows } = foldKardexLedger(movements.map(toSourceMovement), ZERO_BALANCE, fallbackCost);
    return rows.find((row) => row.movementId === sale.id)?.unitCost;
  }
}
