import { ConflictException, Injectable } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { and, eq, sql } from 'drizzle-orm';
import { inventoryBalances, inventoryMovements } from '../database/schema';
import type { TenantTransaction } from '../database/tenant-context';

export type MovementType =
  | 'RECEIPT'
  | 'SALE'
  | 'RETURN'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'RESERVATION'
  | 'RESERVATION_RELEASE'
  | 'COMMITMENT'
  | 'COMMITMENT_RELEASE'
  | 'INITIAL_STOCK';

type Bucket = 'physical' | 'reserved' | 'committed';

/** Which balance bucket each movement type affects, and its sign — database.md#inventory-warehouses-locations-balance-ledger's
 * full movement_type catalog. FASE 8 only ever writes RECEIPT/ADJUSTMENT_IN/ADJUSTMENT_OUT
 * (adjustments) and RESERVATION/RESERVATION_RELEASE/TRANSFER_OUT/TRANSFER_IN (transfers) — the
 * remaining four (SALE/RETURN/COMMITMENT/COMMITMENT_RELEASE/INITIAL_STOCK) belong to SALES (FASE 10)
 * or the Excel import pipeline and are never reachable from any FASE 8 DTO, but are mapped here too
 * so this table stays the single, complete source of truth for the schema's full enum. */
const MOVEMENT_EFFECT: Record<MovementType, { bucket: Bucket; sign: 1 | -1 }> = {
  RECEIPT: { bucket: 'physical', sign: 1 },
  INITIAL_STOCK: { bucket: 'physical', sign: 1 },
  ADJUSTMENT_IN: { bucket: 'physical', sign: 1 },
  ADJUSTMENT_OUT: { bucket: 'physical', sign: -1 },
  TRANSFER_IN: { bucket: 'physical', sign: 1 },
  TRANSFER_OUT: { bucket: 'physical', sign: -1 },
  SALE: { bucket: 'physical', sign: -1 },
  RETURN: { bucket: 'physical', sign: 1 },
  RESERVATION: { bucket: 'reserved', sign: 1 },
  RESERVATION_RELEASE: { bucket: 'reserved', sign: -1 },
  COMMITMENT: { bucket: 'committed', sign: 1 },
  COMMITMENT_RELEASE: { bucket: 'committed', sign: -1 },
};

export interface StockBalanceRow {
  id: string;
  tenantId: string;
  productVariantId: string;
  locationId: string;
  quantityPhysical: string;
  quantityReserved: string;
  quantityCommitted: string;
  quantityAvailable: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockMovementRow {
  id: string;
  tenantId: string;
  productVariantId: string;
  locationId: string;
  movementType: string;
  quantity: string;
  balanceAfter: string;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  actorType: string;
  actorId: string | null;
  idempotencyKey: string | null;
  correlationId: string | null;
  occurredAt: Date;
  createdAt: Date;
  unitCost: string | null;
}

/** A stock operation is not legal given the current balance — insufficient available stock, or the
 * resulting quantity would violate a schema CHECK (negative physical, reserved+committed > physical).
 * Mapped to 409 Conflict by every caller (a state conflict, not malformed input). */
export class InsufficientStockError extends Error {}

export interface ApplyMovementParams {
  tenantId: string;
  productVariantId: string;
  locationId: string;
  movementType: MovementType;
  /** Positive magnitude — the sign appropriate to movementType is applied internally. */
  quantity: number;
  reason?: string | undefined;
  referenceType?: string | undefined;
  referenceId?: string | undefined;
  actorType?: 'user' | 'system';
  actorId?: string | undefined;
  idempotencyKey?: string | undefined;
  correlationId?: string | undefined;
  occurredAt?: Date | undefined;
  /** Unit cost of an inbound movement — see kardex-costing.ts for who populates this and why
   * outbound movement types never do. Ignored (left NULL) if omitted. */
  unitCost?: number | undefined;
}

/**
 * The single locking convoy every stock-affecting write in FASE 8 goes through —
 * database.md#concurrency-strategy, implemented verbatim:
 *
 * 1. INSERT the balance row ON CONFLICT DO NOTHING (closes the first-touch race for a
 *    product+location combination that has never had a movement before).
 * 2. SELECT ... FOR UPDATE — takes the row lock; a concurrent transaction on the same balance row
 *    blocks here until this one commits or rolls back.
 * 3. Validate the resulting quantities in application code (clean domain error) — the table's own
 *    CHECK constraints remain the final backstop if this is ever bypassed.
 * 4. INSERT the append-only inventory_movements row, balance_after = the resulting quantity_physical.
 * 5. UPDATE inventory_balances with an optimistic-lock WHERE version = $version_read_in_step_2 —
 *    redundant with the row lock under normal operation, kept as a second, independent guard per
 *    the doc's explicit instruction.
 *
 * Reused, unchanged, by every write path in this module (adjustments, transfer prepare/dispatch/
 * receive) — never copy-pasted, so the locking behavior only has to be gotten right once.
 */
@Injectable()
export class StockLedgerService {
  async applyMovement(tx: TenantTransaction, params: ApplyMovementParams): Promise<{ balance: StockBalanceRow; movement: StockMovementRow }> {
    if (!Number.isFinite(params.quantity) || params.quantity <= 0) {
      throw new Error('StockLedgerService.applyMovement: quantity must be a positive, finite magnitude.');
    }
    const effect = MOVEMENT_EFFECT[params.movementType];
    const delta = effect.sign * params.quantity;

    await tx
      .insert(inventoryBalances)
      .values({
        id: generateId(),
        tenantId: params.tenantId,
        productVariantId: params.productVariantId,
        locationId: params.locationId,
      })
      .onConflictDoNothing({
        target: [inventoryBalances.tenantId, inventoryBalances.productVariantId, inventoryBalances.locationId],
      });

    const [balance] = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, params.tenantId),
          eq(inventoryBalances.productVariantId, params.productVariantId),
          eq(inventoryBalances.locationId, params.locationId),
        ),
      )
      .for('update');
    if (!balance) {
      throw new Error('StockLedgerService.applyMovement: balance row not found immediately after upsert.');
    }

    const physical = Number(balance.quantityPhysical);
    const reserved = Number(balance.quantityReserved);
    const committed = Number(balance.quantityCommitted);

    let newPhysical = physical;
    let newReserved = reserved;
    let newCommitted = committed;
    if (effect.bucket === 'physical') newPhysical = physical + delta;
    if (effect.bucket === 'reserved') newReserved = reserved + delta;
    if (effect.bucket === 'committed') newCommitted = committed + delta;

    if (newPhysical < 0 || newReserved < 0 || newCommitted < 0) {
      throw new InsufficientStockError('Resulting quantity would be negative.');
    }
    if (newReserved + newCommitted > newPhysical) {
      throw new InsufficientStockError('Insufficient available stock for this operation.');
    }

    const [movement] = await tx
      .insert(inventoryMovements)
      .values({
        id: generateId(),
        tenantId: params.tenantId,
        productVariantId: params.productVariantId,
        locationId: params.locationId,
        movementType: params.movementType,
        quantity: String(delta),
        balanceAfter: String(newPhysical),
        referenceType: params.referenceType ?? null,
        referenceId: params.referenceId ?? null,
        reason: params.reason ?? null,
        actorType: params.actorType ?? 'user',
        actorId: params.actorId ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
        correlationId: params.correlationId ?? null,
        unitCost: params.unitCost !== undefined ? String(params.unitCost) : null,
        ...(params.occurredAt ? { occurredAt: params.occurredAt } : {}),
      })
      .returning();
    if (!movement) {
      throw new Error('StockLedgerService.applyMovement: movement insert did not return a row.');
    }

    const [updatedBalance] = await tx
      .update(inventoryBalances)
      .set({
        quantityPhysical: String(newPhysical),
        quantityReserved: String(newReserved),
        quantityCommitted: String(newCommitted),
        version: sql`${inventoryBalances.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(inventoryBalances.id, balance.id), eq(inventoryBalances.version, balance.version)))
      .returning();
    if (!updatedBalance) {
      // Only reachable if some other code path touched this row outside this convoy's FOR UPDATE
      // hold — see database.md#concurrency-strategy's own note on why this check exists at all.
      throw new ConflictException('Balance was concurrently modified — please retry.');
    }

    return { balance: updatedBalance, movement };
  }
}
