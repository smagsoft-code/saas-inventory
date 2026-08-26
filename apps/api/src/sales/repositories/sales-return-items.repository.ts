import { Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { salesReturnItems, salesReturns } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export type Disposition = 'restock' | 'quarantine' | 'damaged' | 'scrap';

export interface SalesReturnItemRow {
  id: string;
  tenantId: string;
  returnId: string;
  orderItemId: string;
  productVariantId: string;
  quantityReturned: string;
  disposition: string | null;
  dispositionLocationId: string | null;
  inspectedBy: string | null;
  inspectedAt: Date | null;
  notes: string | null;
  createdAt: Date;
}

export interface CreateSalesReturnItemValues {
  id: string;
  tenantId: string;
  returnId: string;
  orderItemId: string;
  productVariantId: string;
  quantityReturned: string;
}

/**
 * `sales_return_items` — never deleted (database.md#soft-delete-policy: "a record of a fact that
 * happened"). The one mutation is `recordInspection`, which fills the disposition columns
 * (`disposition`, `disposition_location_id`, `inspected_by`, `inspected_at`, `notes`) that are
 * `NULL` until inspection — `app_tenant` has `SELECT, INSERT, UPDATE` (migration 0009), no DELETE.
 * `quantity_returned` and the FK links are frozen at creation.
 */
@Injectable()
export class SalesReturnItemsRepository {
  async createMany(tx: TenantTransaction, values: CreateSalesReturnItemValues[]): Promise<SalesReturnItemRow[]> {
    if (values.length === 0) {
      return [];
    }
    return tx.insert(salesReturnItems).values(values).returning();
  }

  async listByReturn(tx: TenantTransaction, tenantId: string, returnId: string): Promise<SalesReturnItemRow[]> {
    return tx
      .select()
      .from(salesReturnItems)
      .where(and(eq(salesReturnItems.tenantId, tenantId), eq(salesReturnItems.returnId, returnId)))
      .orderBy(salesReturnItems.createdAt);
  }

  /**
   * For each `order_item` of one order, the quantity already committed to a return that is not
   * `cancelled` (a cancelled return frees the returned right back — database.md#sales-returns:
   * "`SUM(quantity_returned) <= order_item.quantity` is an application-layer check"). Read under the
   * `orders` row lock the service already holds, so a concurrent return-creation for the same order
   * cannot slip a second row past this sum (§13 / test R4).
   */
  async sumReturnedByOrder(tx: TenantTransaction, tenantId: string, orderId: string): Promise<Map<string, number>> {
    const rows = await tx
      .select({
        orderItemId: salesReturnItems.orderItemId,
        total: sql<string>`coalesce(sum(${salesReturnItems.quantityReturned}), 0)`,
      })
      .from(salesReturnItems)
      .innerJoin(
        salesReturns,
        and(eq(salesReturns.tenantId, salesReturnItems.tenantId), eq(salesReturns.id, salesReturnItems.returnId)),
      )
      .where(
        and(
          eq(salesReturnItems.tenantId, tenantId),
          eq(salesReturns.orderId, orderId),
          ne(salesReturns.status, 'cancelled'),
        ),
      )
      .groupBy(salesReturnItems.orderItemId);
    return new Map(rows.map((r) => [r.orderItemId, Number(r.total)]));
  }

  async recordInspection(
    tx: TenantTransaction,
    tenantId: string,
    returnItemId: string,
    values: { disposition: Disposition; dispositionLocationId: string; inspectedBy: string; notes: string | null },
  ): Promise<SalesReturnItemRow | undefined> {
    const [row] = await tx
      .update(salesReturnItems)
      .set({
        disposition: values.disposition,
        dispositionLocationId: values.dispositionLocationId,
        inspectedBy: values.inspectedBy,
        inspectedAt: sql`now()`,
        notes: values.notes,
      })
      .where(and(eq(salesReturnItems.tenantId, tenantId), eq(salesReturnItems.id, returnItemId)))
      .returning();
    return row;
  }
}
