import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { orderPayments } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface OrderPaymentRow {
  id: string;
  tenantId: string;
  orderId: string;
  paymentMethod: string;
  amount: string;
  createdAt: Date;
}

export interface CreateOrderPaymentValues {
  id: string;
  tenantId: string;
  orderId: string;
  paymentMethod: string;
  amount: string;
}

/**
 * `order_payments` — frozen at checkout (owner redesign, split payment), never updated: no
 * `update` method on this repository by design, same posture as `OrderItemsRepository`.
 */
@Injectable()
export class OrderPaymentsRepository {
  async listByOrder(tx: TenantTransaction, tenantId: string, orderId: string): Promise<OrderPaymentRow[]> {
    return tx
      .select()
      .from(orderPayments)
      .where(and(eq(orderPayments.tenantId, tenantId), eq(orderPayments.orderId, orderId)))
      .orderBy(orderPayments.createdAt);
  }

  async createMany(tx: TenantTransaction, values: CreateOrderPaymentValues[]): Promise<OrderPaymentRow[]> {
    if (values.length === 0) {
      return [];
    }
    return tx.insert(orderPayments).values(values).returning();
  }
}
