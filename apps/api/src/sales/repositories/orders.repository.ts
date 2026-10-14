import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { orders } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface OrderRow {
  id: string;
  tenantId: string;
  locationId: string;
  customerId: string | null;
  customerNameSnapshot: string;
  customerTaxIdSnapshot: string | null;
  customerEmailSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  customerAddressSnapshot: unknown;
  orderNumber: string;
  documentType: string;
  invoiceStatus: string | null;
  status: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  currency: string;
  placedByUserId: string | null;
  correlationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrderValues {
  id: string;
  tenantId: string;
  locationId: string;
  customerId: string | null;
  customerNameSnapshot: string;
  customerTaxIdSnapshot: string | null;
  customerEmailSnapshot: string | null;
  customerPhoneSnapshot: string | null;
  customerAddressSnapshot: Record<string, unknown> | null;
  orderNumber: string;
  documentType: string;
  invoiceStatus: string | null;
  status: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  currency: string;
  placedByUserId: string;
  correlationId: string | null;
}

/**
 * `orders` — SALES owns this table (modules.md#sales). No hard delete, no `deleted_at`: an order is
 * never removed, cancellation is the `status = 'cancelled'` transition
 * (database.md#soft-delete-policy, "Status, not delete"). Historical snapshot columns
 * (customer_*_snapshot, totals, document_type) are written once at creation and never updated —
 * the only `UPDATE` this repository issues is a controlled `status` transition.
 */
@Injectable()
export class OrdersRepository {
  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<OrderRow | undefined> {
    const [row] = await tx.select().from(orders).where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)));
    return row;
  }

  async lockById(tx: TenantTransaction, tenantId: string, id: string): Promise<OrderRow | undefined> {
    const [row] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .for('update');
    return row;
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: {
      page: number;
      pageSize: number;
      status?: string | undefined;
      customerId?: string | undefined;
      documentType?: string | undefined;
      createdFrom?: string | undefined;
      createdTo?: string | undefined;
    },
  ): Promise<{ rows: OrderRow[]; total: number }> {
    const conditions: SQL[] = [eq(orders.tenantId, tenantId)];
    if (params.status) {
      conditions.push(eq(orders.status, params.status));
    }
    if (params.customerId) {
      conditions.push(eq(orders.customerId, params.customerId));
    }
    if (params.documentType) {
      conditions.push(eq(orders.documentType, params.documentType));
    }
    if (params.createdFrom) {
      conditions.push(gte(orders.createdAt, new Date(params.createdFrom)));
    }
    if (params.createdTo) {
      conditions.push(lte(orders.createdAt, new Date(params.createdTo)));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(orders).where(where);
    const rows = await tx
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }

  /** Concurrency-safe, tenant-scoped order numbering (§38). A transaction-scoped advisory lock on
   * (tenant) serializes concurrent checkouts before the count; orders are never hard-deleted, so
   * `count(*) + 1` is monotonic per tenant. Not `SELECT MAX(order_number)+1` (§38 forbids that
   * without adequate locking — and parsing a formatted string back to an int is fragile). */
  async nextOrderNumber(tx: TenantTransaction, tenantId: string): Promise<string> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sales.order_number:${tenantId}`}))`);
    const [row] = await tx.select({ total: count() }).from(orders).where(eq(orders.tenantId, tenantId));
    const next = (row?.total ?? 0) + 1;
    return `ORD-${String(next).padStart(6, '0')}`;
  }

  async create(tx: TenantTransaction, values: CreateOrderValues): Promise<OrderRow> {
    const [row] = await tx.insert(orders).values(values).returning();
    if (!row) {
      throw new Error('Order insert did not return a row.');
    }
    return row;
  }

  async updateStatus(
    tx: TenantTransaction,
    tenantId: string,
    id: string,
    values: { status: string },
  ): Promise<OrderRow | undefined> {
    const [row] = await tx
      .update(orders)
      .set(values)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .returning();
    return row;
  }

  /** Owner redesign — the recomputed totals after `PriceApprovalsService` edits a line's price
   * while the order is still `pending` (`order_items.updatePriceWhilePending`). `orders` already
   * has full UPDATE (unlike `order_items`), so this needs no new grant. */
  async updateTotals(
    tx: TenantTransaction,
    tenantId: string,
    id: string,
    values: { subtotal: string; discountTotal: string; total: string },
  ): Promise<OrderRow | undefined> {
    const [row] = await tx
      .update(orders)
      .set(values)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .returning();
    return row;
  }
}
