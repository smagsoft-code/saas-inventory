import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
 * from the product/variant at order-creation time and never updated: no `update` method exists on
 * this repository by design. `app_tenant` has SELECT/INSERT/DELETE only (no UPDATE grant, migration
 * 0009) — a line is hard-deleted only while its parent order is still `draft`, otherwise it is
 * immutable order history.
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
}
