import { Injectable } from '@nestjs/common';
import { resolveImportJobNumbers } from '../../inventory/import-job-numbers';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  inventoryBalances,
  inventoryTransferReceipts,
  inventoryTransfers,
  inventoryMovements,
  locations,
  orders,
  productVariants,
  products,
  salesReturnItems,
  salesReturns,
  warehouses,
} from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface KardexMovementRow {
  id: string;
  occurredAt: Date;
  movementType: string;
  quantity: string;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  unitCost: string | null;
}

export interface LocationBalanceRow {
  locationId: string;
  locationName: string;
  warehouseName: string;
  quantityPhysical: string;
  quantityAvailable: string | null;
}

/**
 * `reports/kardex` read-side — never `InventoryMovementsRepository`/`InventoryBalancesRepository`
 * (the transactional read/write-path repositories), same "reporting is a separate read-side" rule
 * `reports/movements`'s own repository documents. Reads `inventory_movements` directly, plus the
 * handful of other tables needed to resolve a movement's human-readable label (orders, the sales
 * return chain, transfer receipts) — never `InventoryMovementsRepository`'s `listForCosting`, which
 * is the write-side's internal concern.
 */
@Injectable()
export class KardexReportRepository {
  /** Every movement for one (variant, location) pair, chronological, optionally bounded above by
   * `occurredLt` (used both for "the opening balance = everything before `from`" and for "the
   * visible range = everything in [from, to)", called twice with different bounds). */
  async listMovements(
    tx: TenantTransaction,
    tenantId: string,
    params: {
      productVariantId: string;
      locationId: string;
      occurredGte?: Date | undefined;
      occurredLt?: Date | undefined;
      limit?: number | undefined;
    },
  ): Promise<KardexMovementRow[]> {
    const conditions = [
      eq(inventoryMovements.tenantId, tenantId),
      eq(inventoryMovements.productVariantId, params.productVariantId),
      eq(inventoryMovements.locationId, params.locationId),
    ];
    if (params.occurredGte) {
      conditions.push(gte(inventoryMovements.occurredAt, params.occurredGte));
    }
    if (params.occurredLt) {
      conditions.push(lt(inventoryMovements.occurredAt, params.occurredLt));
    }
    const query = tx
      .select({
        id: inventoryMovements.id,
        occurredAt: inventoryMovements.occurredAt,
        movementType: inventoryMovements.movementType,
        quantity: inventoryMovements.quantity,
        reason: inventoryMovements.reason,
        referenceType: inventoryMovements.referenceType,
        referenceId: inventoryMovements.referenceId,
        unitCost: inventoryMovements.unitCost,
      })
      .from(inventoryMovements)
      .where(and(...conditions))
      .orderBy(asc(inventoryMovements.occurredAt), asc(inventoryMovements.createdAt), asc(inventoryMovements.id));
    return params.limit !== undefined ? query.limit(params.limit) : query;
  }

  /** Product/variant display info — originally for export headers only ("Kardex — Producto X
   * (SKU-123)"), now also embedded in the main JSON response so a caller that fetches several
   * different variants' Kardex in the same view (the "Ver todos" tenant-wide feed) can label each
   * one without a separate product lookup per row. */
  async getVariantDisplayInfo(tx: TenantTransaction, tenantId: string, productVariantId: string): Promise<{ productId: string; sku: string; productName: string } | undefined> {
    const [row] = await tx
      .select({ productId: products.id, sku: productVariants.sku, productName: products.name })
      .from(productVariants)
      .innerJoin(products, and(eq(products.tenantId, productVariants.tenantId), eq(products.id, productVariants.productId)))
      .where(and(eq(productVariants.tenantId, tenantId), eq(productVariants.id, productVariantId)));
    return row;
  }

  async getVariantCost(tx: TenantTransaction, tenantId: string, productVariantId: string): Promise<number | null> {
    const [row] = await tx
      .select({ cost: productVariants.cost })
      .from(productVariants)
      .where(and(eq(productVariants.tenantId, tenantId), eq(productVariants.id, productVariantId)));
    return row?.cost !== null && row?.cost !== undefined ? Number(row.cost) : null;
  }

  async resolveImportJobNumbers(tx: TenantTransaction, tenantId: string, jobIds: string[]): Promise<Map<string, number>> {
    return resolveImportJobNumbers(tx, tenantId, jobIds);
  }

  /** referenceType='order' (SALE) → order_number, e.g. "ORD-000123". */
  async resolveOrderNumbers(tx: TenantTransaction, tenantId: string, orderIds: string[], placedBy?: string): Promise<Map<string, string>> {
    if (orderIds.length === 0) return new Map();
    const rows = await tx
      .select({ id: orders.id, orderNumber: orders.orderNumber })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, orderIds), ...(placedBy ? [eq(orders.placedByUserId, placedBy)] : [])));
    return new Map(rows.map((row) => [row.id, row.orderNumber]));
  }

  /** referenceType='sales_return_item' (RETURN) → the return line's order_number, two hops:
   * sales_return_items -> sales_returns -> orders. */
  async resolveReturnOrderNumbers(tx: TenantTransaction, tenantId: string, returnItemIds: string[], placedBy?: string): Promise<Map<string, string>> {
    if (returnItemIds.length === 0) return new Map();
    const rows = await tx
      .select({ returnItemId: salesReturnItems.id, orderNumber: orders.orderNumber })
      .from(salesReturnItems)
      .innerJoin(salesReturns, and(eq(salesReturns.tenantId, salesReturnItems.tenantId), eq(salesReturns.id, salesReturnItems.returnId)))
      .innerJoin(orders, and(eq(orders.tenantId, salesReturns.tenantId), eq(orders.id, salesReturns.orderId)))
      .where(and(eq(salesReturnItems.tenantId, tenantId), inArray(salesReturnItems.id, returnItemIds), ...(placedBy ? [eq(orders.placedByUserId, placedBy)] : [])));
    return new Map(rows.map((row) => [row.returnItemId, row.orderNumber]));
  }

  /** referenceType='transfer_receipt' (TRANSFER_IN) → the parent transfer id, so a TRANSFER_IN can
   * display the same transfer identifier as its paired TRANSFER_OUT (referenceType='transfer'
   * already gives that id directly, no lookup needed there). */
  async resolveReceiptTransferIds(tx: TenantTransaction, tenantId: string, receiptIds: string[]): Promise<Map<string, string>> {
    if (receiptIds.length === 0) return new Map();
    const rows = await tx
      .select({ receiptId: inventoryTransferReceipts.id, transferId: inventoryTransferReceipts.transferId })
      .from(inventoryTransferReceipts)
      .where(and(eq(inventoryTransferReceipts.tenantId, tenantId), inArray(inventoryTransferReceipts.id, receiptIds)));
    return new Map(rows.map((row) => [row.receiptId, row.transferId]));
  }

  /** `inventory_transfers.id` → its human-readable `code` (e.g. "SUC-PRIN-ALM-PRIN-005",
   * F17-TRANSFERS-AUDIT) — the Kardex label for TRANSFER_OUT/TRANSFER_IN shows this instead of a
   * truncated id. */
  async resolveTransferCodes(tx: TenantTransaction, tenantId: string, transferIds: string[]): Promise<Map<string, string>> {
    if (transferIds.length === 0) return new Map();
    const rows = await tx
      .select({ id: inventoryTransfers.id, code: inventoryTransfers.code })
      .from(inventoryTransfers)
      .where(and(eq(inventoryTransfers.tenantId, tenantId), inArray(inventoryTransfers.id, transferIds)));
    return new Map(rows.map((row) => [row.id, row.code]));
  }

  /** "Stock por sucursal" — current balance for this variant at every location it has one,
   * joined with location/warehouse names for display. */
  async listLocationBalances(tx: TenantTransaction, tenantId: string, productVariantId: string): Promise<LocationBalanceRow[]> {
    return tx
      .select({
        locationId: inventoryBalances.locationId,
        locationName: locations.name,
        warehouseName: warehouses.name,
        quantityPhysical: inventoryBalances.quantityPhysical,
        quantityAvailable: inventoryBalances.quantityAvailable,
      })
      .from(inventoryBalances)
      .innerJoin(locations, and(eq(locations.tenantId, inventoryBalances.tenantId), eq(locations.id, inventoryBalances.locationId)))
      .innerJoin(warehouses, and(eq(warehouses.tenantId, locations.tenantId), eq(warehouses.id, locations.warehouseId)))
      .where(and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.productVariantId, productVariantId)))
      .orderBy(asc(warehouses.name), asc(locations.name));
  }
}
