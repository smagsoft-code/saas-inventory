import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { priceApprovals } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface PriceApprovalRow {
  id: string;
  tenantId: string;
  orderId: string;
  orderItemId: string;
  requestedPrice: string;
  minPriceAtRequest: string;
  maxPriceAtRequest: string;
  discountAmount: string;
  reason: string;
  requestedBy: string;
  approvedBy: string | null;
  status: string;
  requestedAt: Date;
  resolvedAt: Date | null;
}

export interface CreatePriceApprovalValues {
  id: string;
  tenantId: string;
  orderId: string;
  orderItemId: string;
  requestedPrice: string;
  minPriceAtRequest: string;
  maxPriceAtRequest: string;
  discountAmount: string;
  reason: string;
  requestedBy: string;
}

/**
 * `price_approvals` — SALES owns this table (modules.md#sales, database.md#pricing). No hard delete,
 * no `deleted_at`: `status` governs the lifecycle (`pending` → `approved`/`rejected`/`cancelled`,
 * terminal). The only `UPDATE` this repository issues is the controlled `resolve` transition, always
 * guarded by `WHERE status = 'pending'` — a double-click / retried resolution affects 0 rows the
 * second time (database.md#concurrency-strategy). The partial unique index
 * `(tenant_id, order_item_id) WHERE status = 'pending'` (migration 0009) is the structural guard
 * against two open requests for the same line — the caller catches the 23505 and maps it to 409.
 */
@Injectable()
export class PriceApprovalsRepository {
  async create(tx: TenantTransaction, values: CreatePriceApprovalValues): Promise<PriceApprovalRow> {
    const [row] = await tx.insert(priceApprovals).values(values).returning();
    if (!row) {
      throw new Error('Price approval insert did not return a row.');
    }
    return row;
  }

  /** The single still-`pending` approval for a line, if any — the partial unique index
   * `(tenant_id, order_item_id) WHERE status = 'pending'` guarantees at most one. Read under the
   * `orders` row lock the request path already holds, so two concurrent requests for the same line
   * serialize and the second sees the first. */
  async findPendingByOrderItem(
    tx: TenantTransaction,
    tenantId: string,
    orderItemId: string,
  ): Promise<PriceApprovalRow | undefined> {
    const [row] = await tx
      .select()
      .from(priceApprovals)
      .where(
        and(
          eq(priceApprovals.tenantId, tenantId),
          eq(priceApprovals.orderItemId, orderItemId),
          eq(priceApprovals.status, 'pending'),
        ),
      );
    return row;
  }

  /** Cancels every still-`pending` approval attached to an order — used when the order itself is
   * cancelled (a pending exceptional-discount request has nothing left to authorize). */
  async cancelPendingByOrder(tx: TenantTransaction, tenantId: string, orderId: string): Promise<number> {
    const rows = await tx
      .update(priceApprovals)
      .set({ status: 'cancelled', resolvedAt: sql`now()` })
      .where(
        and(
          eq(priceApprovals.tenantId, tenantId),
          eq(priceApprovals.orderId, orderId),
          eq(priceApprovals.status, 'pending'),
        ),
      )
      .returning({ id: priceApprovals.id });
    return rows.length;
  }

  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<PriceApprovalRow | undefined> {
    const [row] = await tx
      .select()
      .from(priceApprovals)
      .where(and(eq(priceApprovals.tenantId, tenantId), eq(priceApprovals.id, id)));
    return row;
  }

  async lockById(tx: TenantTransaction, tenantId: string, id: string): Promise<PriceApprovalRow | undefined> {
    const [row] = await tx
      .select()
      .from(priceApprovals)
      .where(and(eq(priceApprovals.tenantId, tenantId), eq(priceApprovals.id, id)))
      .for('update');
    return row;
  }

  /** Every approval attached to one order, locked FOR UPDATE — the confirm gate reads this inside
   * the same transaction that already holds the `orders` row lock, so a concurrent
   * approve/reject on one of these rows serializes against confirmation. */
  async lockByOrder(tx: TenantTransaction, tenantId: string, orderId: string): Promise<PriceApprovalRow[]> {
    return tx
      .select()
      .from(priceApprovals)
      .where(and(eq(priceApprovals.tenantId, tenantId), eq(priceApprovals.orderId, orderId)))
      .for('update');
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: { page: number; pageSize: number; status?: string | undefined; orderId?: string | undefined },
  ): Promise<{ rows: PriceApprovalRow[]; total: number }> {
    const conditions: SQL[] = [eq(priceApprovals.tenantId, tenantId)];
    if (params.status) {
      conditions.push(eq(priceApprovals.status, params.status));
    }
    if (params.orderId) {
      conditions.push(eq(priceApprovals.orderId, params.orderId));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(priceApprovals).where(where);
    const rows = await tx
      .select()
      .from(priceApprovals)
      .where(where)
      .orderBy(desc(priceApprovals.requestedAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    return { rows, total: totalRow?.total ?? 0 };
  }

  /** Conditional resolution — only a still-`pending` row is transitioned. Returns `undefined` when
   * the row was already resolved (0 rows updated), which the caller maps to a 409. */
  async resolveIfPending(
    tx: TenantTransaction,
    tenantId: string,
    id: string,
    values: { status: 'approved' | 'rejected'; approvedBy: string },
  ): Promise<PriceApprovalRow | undefined> {
    const [row] = await tx
      .update(priceApprovals)
      .set({ status: values.status, approvedBy: values.approvedBy, resolvedAt: sql`now()` })
      .where(
        and(
          eq(priceApprovals.tenantId, tenantId),
          eq(priceApprovals.id, id),
          eq(priceApprovals.status, 'pending'),
        ),
      )
      .returning();
    return row;
  }
}
