import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lt } from 'drizzle-orm';
import { inventoryMovements } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface InventoryMovementRow {
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
}

/**
 * Read-only access to `inventory_movements` — database.md#inventory-warehouses-locations-balance-ledger's
 * SOURCE OF TRUTH, append-only. Writes happen exclusively through StockLedgerService.applyMovement
 * (never here) — this repository never exposes insert/update/delete.
 */
@Injectable()
export class InventoryMovementsRepository {
  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: {
      page: number;
      pageSize: number;
      productVariantId?: string | undefined;
      locationId?: string | undefined;
      movementType?: string | undefined;
      referenceType?: string | undefined;
      referenceId?: string | undefined;
      /** [occurredGte, occurredLt) — half-open, filtered on `occurred_at` (F18-03,
       * `GAP-MOVEMENTS-DATE-FILTER`), never `created_at`. */
      occurredGte?: Date | undefined;
      occurredLt?: Date | undefined;
    },
  ): Promise<{ rows: InventoryMovementRow[]; total: number }> {
    const conditions = [eq(inventoryMovements.tenantId, tenantId)];
    if (params.productVariantId) {
      conditions.push(eq(inventoryMovements.productVariantId, params.productVariantId));
    }
    if (params.locationId) {
      conditions.push(eq(inventoryMovements.locationId, params.locationId));
    }
    if (params.movementType) {
      conditions.push(eq(inventoryMovements.movementType, params.movementType));
    }
    if (params.referenceType) {
      conditions.push(eq(inventoryMovements.referenceType, params.referenceType));
    }
    if (params.referenceId) {
      conditions.push(eq(inventoryMovements.referenceId, params.referenceId));
    }
    if (params.occurredGte) {
      conditions.push(gte(inventoryMovements.occurredAt, params.occurredGte));
    }
    if (params.occurredLt) {
      conditions.push(lt(inventoryMovements.occurredAt, params.occurredLt));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(inventoryMovements).where(where);

    const rows = await tx
      .select()
      .from(inventoryMovements)
      .where(where)
      .orderBy(desc(inventoryMovements.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }
}
