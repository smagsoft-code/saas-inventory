import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { inventoryMovements, inventoryTransferReceipts, inventoryTransfers, orders, salesReturnItems, salesReturns } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { resolveImportJobNumbers } from '../import-job-numbers';

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
  unitCost: string | null;
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

  /** A single movement matched by its polymorphic reference — used to look up the TRANSFER_OUT that
   * paired a TRANSFER_IN, so the receiving movement can carry forward the exact cost that left the
   * source rather than recomputing a (potentially now-different) average at the destination. */
  async findOneByReference(
    tx: TenantTransaction,
    tenantId: string,
    params: { referenceType: string; referenceId: string; productVariantId: string; movementType: string },
  ): Promise<InventoryMovementRow | undefined> {
    const [row] = await tx
      .select()
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, tenantId),
          eq(inventoryMovements.referenceType, params.referenceType),
          eq(inventoryMovements.referenceId, params.referenceId),
          eq(inventoryMovements.productVariantId, params.productVariantId),
          eq(inventoryMovements.movementType, params.movementType),
        ),
      )
      .orderBy(desc(inventoryMovements.createdAt))
      .limit(1);
    return row;
  }

  /**
   * Every movement for one (variant, location) pair, in strict chronological order — the sole
   * shape kardex-costing.ts's fold ever consumes, whether called from the write side (the current
   * moving-average cost, before inserting a new movement) or the read side (a date-ranged Kardex,
   * with `occurredBefore` used to fold the opening balance). Includes non-physical movement types
   * (RESERVATION/COMMITMENT/…) uncfiltered — the fold itself skips those, so filtering here would
   * only save a little payload at the cost of a second, easily-to-drift movement-type list.
   */
  async listForCosting(
    tx: TenantTransaction,
    tenantId: string,
    params: { productVariantId: string; locationId: string; occurredBefore?: Date | undefined },
  ): Promise<InventoryMovementRow[]> {
    const conditions = [
      eq(inventoryMovements.tenantId, tenantId),
      eq(inventoryMovements.productVariantId, params.productVariantId),
      eq(inventoryMovements.locationId, params.locationId),
    ];
    if (params.occurredBefore) {
      conditions.push(lt(inventoryMovements.occurredAt, params.occurredBefore));
    }
    return tx
      .select()
      .from(inventoryMovements)
      .where(and(...conditions))
      .orderBy(asc(inventoryMovements.occurredAt), asc(inventoryMovements.createdAt), asc(inventoryMovements.id));
  }

  /** referenceType='order' (SALE) → order_number, e.g. "ORD-000123" — same lookup
   * `reports/kardex/kardex-report.repository.ts` already does for the Kardex ledger's own label,
   * duplicated here rather than shared across the transactional/reporting boundary (that module's
   * own convention: reporting never reaches into this repository, so this repository doesn't reach
   * into it either). */
  async resolveImportJobNumbers(tx: TenantTransaction, tenantId: string, jobIds: string[]): Promise<Map<string, number>> {
    return resolveImportJobNumbers(tx, tenantId, jobIds);
  }

  /** `placedBy` (ADR-0040): only the orders that user placed resolve — the rest stay unresolved, so a caller without
   * `sales.orders.view_all` never learns another seller's order number. Omit it to resolve every order. */
  async resolveOrderNumbers(tx: TenantTransaction, tenantId: string, orderIds: string[], placedBy?: string): Promise<Map<string, string>> {
    if (orderIds.length === 0) return new Map();
    const rows = await tx
      .select({ id: orders.id, orderNumber: orders.orderNumber })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds), ...(placedBy ? [eq(orders.placedByUserId, placedBy)] : [])));
    return new Map(rows.map((row) => [row.id, row.orderNumber]));
  }

  /** referenceType='sales_return_item' (a RETURN movement) → the return's own number ("DEV-001"). */
  async resolveReturnNumbers(tx: TenantTransaction, tenantId: string, returnItemIds: string[], placedBy?: string): Promise<Map<string, string>> {
    if (returnItemIds.length === 0) return new Map();
    const rows = await tx
      .select({ itemId: salesReturnItems.id, returnNumber: salesReturns.returnNumber })
      .from(salesReturnItems)
      .innerJoin(salesReturns, and(eq(salesReturns.tenantId, salesReturnItems.tenantId), eq(salesReturns.id, salesReturnItems.returnId)))
      .innerJoin(orders, and(eq(orders.tenantId, salesReturns.tenantId), eq(orders.id, salesReturns.orderId)))
      .where(and(eq(salesReturnItems.tenantId, tenantId), inArray(salesReturnItems.id, returnItemIds), ...(placedBy ? [eq(orders.placedByUserId, placedBy)] : [])));
    return new Map(rows.map((row) => [row.itemId, row.returnNumber]));
  }

  /** referenceType='transfer_receipt' (TRANSFER_IN) → the parent transfer id, so a TRANSFER_IN can
   * be labeled with the same transfer identifier as its paired TRANSFER_OUT. */
  async resolveReceiptTransferIds(tx: TenantTransaction, tenantId: string, receiptIds: string[]): Promise<Map<string, string>> {
    if (receiptIds.length === 0) return new Map();
    const rows = await tx
      .select({ receiptId: inventoryTransferReceipts.id, transferId: inventoryTransferReceipts.transferId })
      .from(inventoryTransferReceipts)
      .where(and(eq(inventoryTransferReceipts.tenantId, tenantId), inArray(inventoryTransferReceipts.id, receiptIds)));
    return new Map(rows.map((row) => [row.receiptId, row.transferId]));
  }

  /** `inventory_transfers.id` → its human-readable `code` (e.g. "SUC-PRIN-ALM-PRIN-005",
   * F17-TRANSFERS-AUDIT) — same lookup `reports/kardex/kardex-report.repository.ts` duplicates for
   * its own ledger label, per this module's "reporting never reaches into this repository, so this
   * repository doesn't reach into it either" convention. */
  async resolveTransferCodes(tx: TenantTransaction, tenantId: string, transferIds: string[]): Promise<Map<string, string>> {
    if (transferIds.length === 0) return new Map();
    const rows = await tx
      .select({ id: inventoryTransfers.id, code: inventoryTransfers.code })
      .from(inventoryTransfers)
      .where(and(eq(inventoryTransfers.tenantId, tenantId), inArray(inventoryTransfers.id, transferIds)));
    return new Map(rows.map((row) => [row.id, row.code]));
  }
}
