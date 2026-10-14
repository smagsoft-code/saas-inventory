import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { orderItems } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface OrderItemRow {
  id: string;
  tenantId: string;
  orderId: string;
  productVariantId: string;
  skuSnapshot: string;
  productNameSnapshot: string;
  maxPriceSnapshot: string;
  basePriceSnapshot: string;
  minPriceSnapshot: string;
  unitPriceSnapshot: string;
  unitCostSnapshot: string | null;
  quantity: string;
  discountAmount: string;
  isExceptionalDiscount: boolean;
  lineTotal: string;
  createdAt: Date;
}

export interface CreateOrderItemValues {
  id: string;
  tenantId: string;
  orderId: string;
  productVariantId: string;
  skuSnapshot: string;
  productNameSnapshot: string;
  maxPriceSnapshot: string;
  basePriceSnapshot: string;
  minPriceSnapshot: string;
  unitPriceSnapshot: string;
  unitCostSnapshot: string | null;
  quantity: string;
  discountAmount: string;
  isExceptionalDiscount: boolean;
  lineTotal: string;
}

/**
 * `order_items` — frozen historical lines (database.md#orders). Every `*_snapshot` column is copied
 * from the product/variant at order-creation time and generally never updated. The one sanctioned
 * exception (owner redesign, migration 0040's narrow column-level GRANT): `updatePriceWhilePending`,
 * used only while the parent order is still `pending` — an administrator editing a line's price
 * while reviewing its exceptional-discount request, or a vendor resubmitting a new price after a
 * rejection. Once an order leaves `pending` (confirmed/cancelled), every column here is immutable
 * history again, same as always — nothing in this repository ever touches a non-`pending` order's
 * lines. A line is hard-deleted only while its parent order is still `draft`.
 */
@Injectable()
export class OrderItemsRepository {
  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<OrderItemRow | undefined> {
    const [row] = await tx
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.tenantId, tenantId), eq(orderItems.id, id)));
    return row;
  }

  /** Product label snapshots (sku + name, frozen at sale time) for a batch of order lines — one query,
   * used to put product names on return / approval lists without a lookup per row. */
  async findLabelsByIds(
    tx: TenantTransaction,
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, { sku: string; productName: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({ id: orderItems.id, sku: orderItems.skuSnapshot, productName: orderItems.productNameSnapshot })
      .from(orderItems)
      .where(and(eq(orderItems.tenantId, tenantId), inArray(orderItems.id, ids)));
    return new Map(rows.map((row) => [row.id, { sku: row.sku, productName: row.productName }]));
  }

  async listByOrder(tx: TenantTransaction, tenantId: string, orderId: string): Promise<OrderItemRow[]> {
    return tx
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.tenantId, tenantId), eq(orderItems.orderId, orderId)))
      .orderBy(orderItems.createdAt);
  }

  async createMany(tx: TenantTransaction, values: CreateOrderItemValues[]): Promise<OrderItemRow[]> {
    if (values.length === 0) {
      return [];
    }
    return tx.insert(orderItems).values(values).returning();
  }

  /** The caller (`PriceApprovalsService`) is responsible for only ever calling this while the
   * parent order is still `pending` — this repository has no order-status awareness of its own,
   * same division of responsibility as every other repository in this codebase (database.md's
   * "repositories don't own business rules" convention). */
  async updatePriceWhilePending(
    tx: TenantTransaction,
    tenantId: string,
    id: string,
    values: { unitPriceSnapshot: string; lineTotal: string; discountAmount: string; isExceptionalDiscount: boolean },
  ): Promise<OrderItemRow> {
    const [row] = await tx
      .update(orderItems)
      .set(values)
      .where(and(eq(orderItems.tenantId, tenantId), eq(orderItems.id, id)))
      .returning();
    if (!row) {
      throw new Error('Order item price update did not return a row.');
    }
    return row;
  }
}
