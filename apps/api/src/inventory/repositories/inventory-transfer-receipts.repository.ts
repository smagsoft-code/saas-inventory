import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { inventoryTransferReceiptItems, inventoryTransferReceipts } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface InventoryTransferReceiptRow {
  id: string;
  tenantId: string;
  transferId: string;
  receivedBy: string;
  notes: string | null;
  createdAt: Date;
}

export interface InventoryTransferReceiptItemRow {
  id: string;
  tenantId: string;
  receiptId: string;
  transferItemId: string;
  quantityReceived: string;
  incidentType: string | null;
  incidentNotes: string | null;
  createdAt: Date;
}

export interface CreateReceiptItemValues {
  id: string;
  tenantId: string;
  receiptId: string;
  transferItemId: string;
  quantityReceived: number;
  incidentType?: string | undefined;
  incidentNotes?: string | undefined;
}

/**
 * `inventory_transfer_receipts`/`inventory_transfer_receipt_items` — one row per receiving EVENT,
 * append-only, never deleted or updated (database.md#soft-delete-policy). Receiving is genuinely
 * repeatable (a transfer can be received across several trucks/days), so unlike dispatch (a
 * one-time event) this needs its own ledger rather than a single mutable column.
 */
@Injectable()
export class InventoryTransferReceiptsRepository {
  async createReceipt(
    tx: TenantTransaction,
    values: { id: string; tenantId: string; transferId: string; receivedBy: string; notes?: string | undefined },
  ): Promise<InventoryTransferReceiptRow> {
    const [row] = await tx.insert(inventoryTransferReceipts).values(values).returning();
    if (!row) {
      throw new Error('Transfer receipt insert did not return a row.');
    }
    return row;
  }

  async createReceiptItems(tx: TenantTransaction, values: CreateReceiptItemValues[]): Promise<InventoryTransferReceiptItemRow[]> {
    if (values.length === 0) {
      return [];
    }
    return tx
      .insert(inventoryTransferReceiptItems)
      .values(values.map((v) => ({ ...v, quantityReceived: String(v.quantityReceived) })))
      .returning();
  }

  async listByTransfer(tx: TenantTransaction, tenantId: string, transferId: string): Promise<InventoryTransferReceiptRow[]> {
    return tx
      .select()
      .from(inventoryTransferReceipts)
      .where(and(eq(inventoryTransferReceipts.tenantId, tenantId), eq(inventoryTransferReceipts.transferId, transferId)));
  }
}
