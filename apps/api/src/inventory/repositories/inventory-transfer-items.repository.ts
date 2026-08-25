import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { inventoryTransferItems } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface InventoryTransferItemRow {
  id: string;
  tenantId: string;
  transferId: string;
  productVariantId: string;
  quantityRequested: string;
  quantityDispatched: string;
  quantityReceived: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTransferItemValues {
  id: string;
  tenantId: string;
  transferId: string;
  productVariantId: string;
  quantityRequested: number;
}

/**
 * `inventory_transfer_items` — requested/dispatched/received quantities per product on a transfer.
 * `quantityReceived` is a materialized running total kept current alongside each receipt-item insert
 * (database.md#inventory-transfers-and-in-transit-stock) — always via `incrementReceived`'s atomic
 * `SET quantity_received = quantity_received + $delta`, never a read-then-write from application code.
 */
@Injectable()
export class InventoryTransferItemsRepository {
  async listByTransfer(tx: TenantTransaction, tenantId: string, transferId: string): Promise<InventoryTransferItemRow[]> {
    return tx
      .select()
      .from(inventoryTransferItems)
      .where(and(eq(inventoryTransferItems.tenantId, tenantId), eq(inventoryTransferItems.transferId, transferId)));
  }

  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<InventoryTransferItemRow | undefined> {
    const [row] = await tx.select().from(inventoryTransferItems).where(and(eq(inventoryTransferItems.tenantId, tenantId), eq(inventoryTransferItems.id, id)));
    return row;
  }

  async createMany(tx: TenantTransaction, values: CreateTransferItemValues[]): Promise<InventoryTransferItemRow[]> {
    if (values.length === 0) {
      return [];
    }
    return tx
      .insert(inventoryTransferItems)
      .values(values.map((v) => ({ ...v, quantityRequested: String(v.quantityRequested) })))
      .returning();
  }

  async setDispatched(tx: TenantTransaction, tenantId: string, id: string, quantityDispatched: number): Promise<InventoryTransferItemRow | undefined> {
    const [row] = await tx
      .update(inventoryTransferItems)
      .set({ quantityDispatched: String(quantityDispatched), updatedAt: sql`now()` })
      .where(and(eq(inventoryTransferItems.tenantId, tenantId), eq(inventoryTransferItems.id, id)))
      .returning();
    return row;
  }

  /** Atomic increment — the materialized-running-total update database.md requires, always inside
   * the same transaction as the corresponding `inventory_transfer_receipt_items` insert. */
  async incrementReceived(tx: TenantTransaction, tenantId: string, id: string, delta: number): Promise<InventoryTransferItemRow | undefined> {
    const [row] = await tx
      .update(inventoryTransferItems)
      .set({ quantityReceived: sql`${inventoryTransferItems.quantityReceived} + ${String(delta)}`, updatedAt: sql`now()` })
      .where(and(eq(inventoryTransferItems.tenantId, tenantId), eq(inventoryTransferItems.id, id)))
      .returning();
    return row;
  }
}
