/**
 * Weighted-average-cost (moving average) engine for the inventory Kardex.
 *
 * GAP-COST (docs/architecture/reporting/data-gaps.md) documented that no table anywhere stores a
 * running average cost, and that `inventory_movements` carried no per-movement cost at all. This
 * module is the resolution: a pure fold over the append-only ledger, never storing its own output,
 * so a backdated movement (occurredAt is explicitly backdatable, see 05-inventory.ts) can never
 * leave a stale average behind — every read recomputes from the ordered movement history.
 *
 * Only inbound physical movements ever carry a real `unitCost` (see stock-ledger.service.ts's
 * `unitCost` field and each write-site's own comment for why). Outbound movements draw at the
 * average vigente immediately before them and never change it — the textbook weighted-average
 * rule. This one function is reused by both the write side (`getCurrentAverageCost` below, called
 * before writing an ADJUSTMENT_IN with no explicit cost, or a TRANSFER_OUT) and the read side
 * (the Kardex report, seeded with the opening balance folded from everything before the filtered
 * range's start).
 */

const INBOUND_PHYSICAL_TYPES = new Set(['RECEIPT', 'ADJUSTMENT_IN', 'TRANSFER_IN', 'RETURN', 'INITIAL_STOCK']);
const OUTBOUND_PHYSICAL_TYPES = new Set(['SALE', 'ADJUSTMENT_OUT', 'TRANSFER_OUT']);

export function isPhysicalMovementType(movementType: string): boolean {
  return INBOUND_PHYSICAL_TYPES.has(movementType) || OUTBOUND_PHYSICAL_TYPES.has(movementType);
}

export function isInboundPhysicalMovementType(movementType: string): boolean {
  return INBOUND_PHYSICAL_TYPES.has(movementType);
}

export interface KardexSourceMovement {
  id: string;
  occurredAt: Date;
  movementType: string;
  /** Signed quantity as stored on inventory_movements (physical bucket). */
  quantity: number;
  /** Only ever non-null on inbound-type rows — see stock-ledger.service.ts. */
  unitCost: number | null;
}

export interface KardexLedgerRow {
  movementId: string;
  occurredAt: Date;
  movementType: string;
  entrada: number;
  salida: number;
  /** Unit cost attributed to this row — the movement's own stored cost if inbound, or the average
   * vigente immediately before it if outbound. */
  unitCost: number;
  /** True when this row's cost (or an ancestor it was averaged with) had to fall back to the
   * variant's current cost because no per-movement cost was recorded — legacy pre-migration rows,
   * or a variant with no cost configured at all. */
  unitCostEstimated: boolean;
  averageCostAfter: number;
  stockAfter: number;
  stockValueAfter: number;
}

export interface KardexBalanceState {
  stock: number;
  averageCost: number;
  estimated: boolean;
}

export interface KardexFoldResult {
  rows: KardexLedgerRow[];
  closing: KardexBalanceState;
}

export const ZERO_BALANCE: KardexBalanceState = { stock: 0, averageCost: 0, estimated: false };

/**
 * Folds an ordered slice of the ledger (must already be sorted by occurredAt, then a stable
 * tiebreak such as createdAt/id) into per-row running Costo K / Stock U / Stock S, seeded with
 * `opening` (the balance state as of just before the first movement in `movements`).
 *
 * `fallbackUnitCost` (typically the variant's current `cost`) is used only when an inbound row has
 * no stored `unitCost` — it never overwrites a real recorded cost, and the substitution is always
 * reported back via `unitCostEstimated` rather than silently blended in as if it were fact.
 */
export function foldKardexLedger(
  movements: readonly KardexSourceMovement[],
  opening: KardexBalanceState,
  fallbackUnitCost: number | null,
): KardexFoldResult {
  let stock = opening.stock;
  let averageCost = opening.averageCost;
  let estimatedCarry = opening.estimated;
  const rows: KardexLedgerRow[] = [];

  for (const movement of movements) {
    const isInbound = INBOUND_PHYSICAL_TYPES.has(movement.movementType);
    const isOutbound = OUTBOUND_PHYSICAL_TYPES.has(movement.movementType);
    if (!isInbound && !isOutbound) continue;

    const magnitude = Math.abs(movement.quantity);
    let rowUnitCost: number;
    let rowEstimated: boolean;

    if (isInbound) {
      if (movement.unitCost !== null) {
        rowUnitCost = movement.unitCost;
        rowEstimated = false;
      } else if (fallbackUnitCost !== null) {
        rowUnitCost = fallbackUnitCost;
        rowEstimated = true;
      } else {
        rowUnitCost = 0;
        rowEstimated = true;
      }
      const newStock = stock + magnitude;
      averageCost = newStock > 0 ? (stock * averageCost + magnitude * rowUnitCost) / newStock : rowUnitCost;
      stock = newStock;
      estimatedCarry = estimatedCarry || rowEstimated;
    } else {
      rowUnitCost = averageCost;
      rowEstimated = estimatedCarry;
      stock = stock - magnitude;
    }

    rows.push({
      movementId: movement.id,
      occurredAt: movement.occurredAt,
      movementType: movement.movementType,
      entrada: isInbound ? magnitude : 0,
      salida: isOutbound ? magnitude : 0,
      unitCost: rowUnitCost,
      unitCostEstimated: rowEstimated,
      averageCostAfter: averageCost,
      stockAfter: stock,
      stockValueAfter: stock * averageCost,
    });
  }

  return { rows, closing: { stock, averageCost, estimated: estimatedCarry } };
}

/** Convenience for write-side callers that only need the closing state (e.g. "what's the average
 * cost right now, before I insert this new movement") — folds the variant+location's entire
 * physical-movement history from an empty opening balance. */
export function computeClosingBalance(
  movements: readonly KardexSourceMovement[],
  fallbackUnitCost: number | null,
): KardexBalanceState {
  return foldKardexLedger(movements, ZERO_BALANCE, fallbackUnitCost).closing;
}
